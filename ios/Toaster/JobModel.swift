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
    /// 저장 중인 곳 (한 번에 하나만. 저장 중에는 버튼을 막아 두 번 눌러도 한 번만 저장한다)
    var saving: SaveTarget?
    /// 저장을 마친 곳들. 다시 누르면 "또 저장할까요?" 하고 묻는다
    var saved: Set<SaveTarget> = [] { didSet { if saved != oldValue { onChange?() } } }
    /// 기록에 남길 내용이 바뀌면 부른다 (JobStore 가 기록 파일을 다시 쓴다)
    @ObservationIgnored var onChange: (() -> Void)?
    /// 마지막 저장 결과 (알림으로 띄운다)
    var saveResult: SaveResult?
    /// 텔레그램 스티커 변환 진행 (끝난 수, 전체)
    var stickerProgress: (done: Int, total: Int)?
    var stickerErrors: [String] = []

    enum SaveTarget: String, Hashable { case folder, stickers, photos }

    struct SaveResult: Identifiable {
        let id = UUID()
        let ok: Bool
        let title: String
        let message: String
    }

    /// 지금 작업이 쓰는 임시 폴더 (받는 중·스티커 변환 중이면 캐시 삭제에서 빼야 한다)
    var busy: Bool { saving == .stickers || (job.map { !$0.status.isFinished } ?? true) }

    func start(_ input: CollectInput) async {
        job = nil
        saveResult = nil
        saved = []
        await Collector.run(input) { [weak self] next in
            self?.job = next
        }
    }

    /// 받은 파일을 그대로 `<저장 폴더>/<name>/` 에 넣는다. 복사는 메인 스레드 밖에서 한다.
    func saveToFolder(_ folder: SaveFolder, name: String) async {
        guard let files = job?.images, !files.isEmpty, saving == nil, let root = folder.url else { return }
        saving = .folder
        defer { saving = nil }
        let list = files.map { (name: $0.filename, source: $0.fileURL) }
        do {
            let target = try await Task.detached { try SaveFolder.write(list, into: name, root: root) }.value
            saved.insert(.folder)
            saveResult = SaveResult(ok: true, title: "저장했습니다", message: "\(folder.displayName)/\(target.lastPathComponent) 폴더에 \(files.count)개를 저장했습니다.")
        } catch {
            saveResult = SaveResult(ok: false, title: "저장하지 못했습니다", message: error.localizedDescription)
        }
    }

    /// 텔레그램 스티커 규격으로 바꿔 `<저장 폴더>/<name>/1.webm … thumbnail.png` 에 넣는다 (같은 이름이 있으면 `<name>_2`).
    func saveStickers(_ folder: SaveFolder, name: String) async {
        guard let job, !job.images.isEmpty, saving == nil, let root = folder.url else { return }
        saving = .stickers
        stickerErrors = []
        let total = job.images.count + 1  // 썸네일 하나 더
        stickerProgress = (0, total)
        defer {
            stickerProgress = nil
            saving = nil
        }

        let result = await Sticker.convert(job.images, referer: job.url, server: Sticker.server) { [weak self] done in
            self?.stickerProgress = (done, total)
        }
        stickerErrors = result.errors
        guard !result.files.isEmpty else {
            saveResult = SaveResult(ok: false, title: "저장하지 못했습니다", message: "스티커로 바꾼 파일이 없습니다.")
            return
        }
        do {
            let files = result.files
            let target = try await Task.detached { try SaveFolder.write(files, into: name, root: root) }.value
            let stickers = files.filter { !$0.name.hasPrefix("thumbnail.") }.count
            let what = files.count > stickers ? "스티커 \(stickers)개와 썸네일을" : "스티커 \(stickers)개를"
            let failed = result.errors.isEmpty ? "" : " \(result.errors.count)개는 바꾸지 못했습니다."
            saved.insert(.stickers)
            saveResult = SaveResult(ok: true, title: "저장했습니다", message: "\(folder.displayName)/\(target.lastPathComponent) 폴더에 \(what) 저장했습니다.\(failed)")
        } catch {
            saveResult = SaveResult(ok: false, title: "저장하지 못했습니다", message: error.localizedDescription)
        }
    }

    #if os(iOS)
    /// 받은 이미지·영상을 전부 사진 앱에 저장.
    func saveAllToPhotos() async {
        guard let files = job?.images, !files.isEmpty, saving == nil else { return }
        saving = .photos
        defer { saving = nil }

        guard await Photos.authorize() else {
            saveResult = SaveResult(ok: false, title: "사진 앱에 저장할 수 없습니다", message: "사진 추가 권한이 없습니다. 설정 > Toaster > 사진에서 허용해 주세요.")
            return
        }
        let items = files.map { (url: $0.fileURL, video: $0.isVideo) }
        let count = await Photos.add(items)
        if count > 0 { saved.insert(.photos) }
        let skipped = files.count - count
        saveResult = SaveResult(
            ok: count > 0,
            title: count > 0 ? "사진 앱에 저장했습니다" : "사진 앱에 저장하지 못했습니다",
            message: "\(files.count)개 중 \(count)개를 저장했습니다." + (skipped > 0 ? " SVG·WEBM 처럼 사진 앱이 지원하지 않는 형식 \(skipped)개는 건너뛰었습니다." : "")
        )
    }
    #endif
}

#if os(iOS)
/// 사진 앱 저장. PhotoKit 은 콜백을 메인이 아닌 스레드에서 부르므로 MainActor 밖(nonisolated)에서 다룬다.
/// (MainActor 클래스 안에서 performChanges 클로저를 만들면 Swift 6 가 다른 스레드에서 불렸다고 앱을 멈춘다)
private enum Photos {
    nonisolated static func authorize() async -> Bool {
        let status = await withCheckedContinuation { (done: CheckedContinuation<PHAuthorizationStatus, Never>) in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { done.resume(returning: $0) }
        }
        return status == .authorized || status == .limited
    }

    /// 하나씩 넣고 성공한 개수를 돌려준다. 사진 앱이 못 받는 형식(SVG·WEBM 등)은 건너뛴다.
    nonisolated static func add(_ items: [(url: URL, video: Bool)]) async -> Int {
        var saved = 0
        // 사진 앱을 "캡처됨"으로 정렬해도 받은 순서대로 보이게, 찍은 날짜를 1초씩 늘려 적는다
        // (원본에 찍은 날짜가 없거나 제각각이면 순서가 꼬인다)
        let base = Date()
        for (index, item) in items.enumerated() {
            let ok = await withCheckedContinuation { (done: CheckedContinuation<Bool, Never>) in
                PHPhotoLibrary.shared().performChanges({
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: item.video ? .video : .photo, fileURL: item.url, options: nil)
                    request.creationDate = base.addingTimeInterval(TimeInterval(index))
                }, completionHandler: { success, _ in done.resume(returning: success) })
            }
            if ok { saved += 1 }
        }
        return saved
    }
}
#endif
