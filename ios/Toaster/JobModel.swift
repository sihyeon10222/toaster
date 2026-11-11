import Foundation
import Observation
import Photos

@MainActor
@Observable
final class JobModel {
    var job: Job?
    var errorMessage: String?
    var isSubmitting = false
    var isSaving = false
    var saveMessage: String?
    var zipFileURL: URL?

    private var pollTask: Task<Void, Never>?
    /// 공유할 zip 파일 이름. nil 이면 toaster-<id>.zip
    private var zipName: String?

    var isRunning: Bool { job.map { !$0.status.isFinished } ?? false }

    func start(api: ToasterAPI, url: String, selector: String, render: Bool, zipName: String? = nil) async {
        pollTask?.cancel()
        self.zipName = zipName
        job = nil
        errorMessage = nil
        saveMessage = nil
        zipFileURL = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let created = try await api.createJob(url: url, selector: selector, render: render)
            job = created
            poll(api: api, id: created.id)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func poll(api: ToasterAPI, id: String) {
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(800))
                do {
                    let next = try await api.job(id: id)
                    guard let self, !Task.isCancelled else { return }
                    self.job = next
                    if next.status.isFinished {
                        if next.status == .done { await self.prepareZip(api: api, job: next) }
                        return
                    }
                } catch {
                    self?.errorMessage = error.localizedDescription
                    return
                }
            }
        }
    }

    /// 공유 시트에 바로 넘길 수 있게 zip 을 임시 폴더에 받아 둔다.
    private func prepareZip(api: ToasterAPI, job: Job) async {
        guard let zipUrl = job.zipUrl else { return }
        do {
            let data = try await api.data(from: zipUrl)
            // 작업마다 폴더를 나눠서 같은 이름(<slug>.zip)이어도 겹치지 않게 한다
            let dir = FileManager.default.temporaryDirectory.appending(path: "toaster-\(job.id)")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appending(path: zipName ?? "toaster-\(job.id.prefix(8)).zip")
            try data.write(to: file, options: .atomic)
            zipFileURL = file
        } catch {
            // zip 은 부가 기능이라 실패해도 결과 화면은 유지
        }
    }

    /// 받은 이미지를 전부 사진 앱에 저장.
    func saveAllToPhotos(api: ToasterAPI) async {
        guard let images = job?.images, !images.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }

        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            saveMessage = "사진 저장 권한이 없어요. 설정 > Toaster 에서 허용해 주세요."
            return
        }

        var saved = 0
        for image in images {
            guard let data = try? await api.data(from: image.url) else { continue }
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
                }
                saved += 1
            } catch {
                continue  // SVG 처럼 사진 앱이 못 받는 형식은 건너뜀
            }
        }
        saveMessage = "사진 앱에 \(saved)/\(images.count)장 저장했어요."
    }
}
