import Foundation
import Observation
#if os(iOS)
import Photos
#endif

/// 작업 하나의 상태. 실제 받기는 Collector 가 기기 안에서 한다.
@MainActor
@Observable
final class JobModel {
    var job: Job?
    var isSaving = false
    var saveMessage: String?
    /// 텔레그램 스티커 변환 진행 (끝난 수, 전체)
    var stickerProgress: (done: Int, total: Int)?
    var stickerErrors: [String] = []

    func start(_ input: CollectInput) async {
        job = nil
        saveMessage = nil
        await Collector.run(input) { [weak self] next in
            self?.job = next
        }
    }

    /// 받은 파일을 그대로 `<저장 폴더>/<name>/` 에 넣는다.
    func saveToFolder(_ folder: SaveFolder, name: String) {
        guard let files = job?.images, !files.isEmpty else { return }
        do {
            let target = try folder.write(files.map { ($0.filename, $0.fileURL) }, into: name)
            saveMessage = "\(folder.displayName)/\(target.lastPathComponent) 에 \(files.count)개 저장했습니다."
        } catch {
            saveMessage = error.localizedDescription
        }
    }

    /// 텔레그램 스티커 규격으로 바꿔 `<저장 폴더>/<name>_telegram/1.webm …` 에 넣는다.
    func saveStickers(_ folder: SaveFolder, name: String) async {
        guard let job, !job.images.isEmpty, stickerProgress == nil else { return }
        saveMessage = nil
        stickerErrors = []
        let total = job.images.count + 1  // 썸네일 하나 더
        stickerProgress = (0, total)
        defer { stickerProgress = nil }

        let result = await Sticker.convert(job.images, referer: job.url, server: Sticker.server) { [weak self] done in
            self?.stickerProgress = (done, total)
        }
        stickerErrors = result.errors
        guard !result.files.isEmpty else {
            saveMessage = "스티커로 바꾼 파일이 없습니다."
            return
        }
        do {
            let target = try folder.write(result.files, into: "\(name)_telegram")
            let stickers = result.files.filter { !$0.name.hasPrefix("thumbnail.") }.count
            let what = result.files.count > stickers ? "스티커 \(stickers)개와 썸네일을" : "스티커 \(stickers)개를"
            saveMessage = "\(folder.displayName)/\(target.lastPathComponent) 에 \(what) 저장했습니다."
        } catch {
            saveMessage = error.localizedDescription
        }
    }

    #if os(iOS)
    /// 받은 이미지·영상을 전부 사진 앱에 저장.
    func saveAllToPhotos() async {
        guard let files = job?.images, !files.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }

        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else {
            saveMessage = "사진 저장 권한이 없습니다. 설정 > Toaster 에서 허용해 주세요."
            return
        }

        var saved = 0
        for file in files {
            do {
                try await PHPhotoLibrary.shared().performChanges {
                    PHAssetCreationRequest.forAsset().addResource(with: file.isVideo ? .video : .photo, fileURL: file.fileURL, options: nil)
                }
                saved += 1
            } catch {
                continue  // SVG·webm 처럼 사진 앱이 못 받는 형식은 건너뜀
            }
        }
        saveMessage = "사진 앱에 \(saved)/\(files.count)개 저장했습니다."
    }
    #endif
}
