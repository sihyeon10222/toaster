import Foundation
import Observation

enum Mode: String, CaseIterable, Identifiable {
    case kakao, general
    var id: Self { self }
    var title: String { self == .kakao ? "카카오 이모티콘" : "일반 페이지" }
}

/// "최근 작업" 한 줄. 작업마다 자기 JobModel 을 가져서 여러 개를 동시에 돌린다.
@MainActor
@Observable
final class JobEntry: Identifiable {
    let id = UUID().uuidString
    let mode: Mode
    /// 기록 제목 (이모티콘 끝주소 또는 페이지 주소)
    let title: String
    /// 저장 폴더 안에 만들 폴더 이름 (카카오는 끝주소, 일반은 사이트 주소)
    let folderName: String
    let startedAt = Date()
    let model = JobModel()
    fileprivate var task: Task<Void, Never>?

    init(mode: Mode, title: String, folderName: String) {
        self.mode = mode
        self.title = title
        self.folderName = folderName
    }

    var isRunning: Bool { model.job.map { !$0.status.isFinished } ?? true }
    var isFailed: Bool { model.job?.status == .failed }

    /// 결과 화면 큰 제목: 카카오는 이모티콘 이름(예: 카카오프렌즈 클래식)
    var displayTitle: String {
        if mode == .kakao, let t = model.job?.title, !t.isEmpty { return t }
        return title
    }

    /// 기록 줄에 보이는 한 줄 요약
    var summary: String {
        guard let job = model.job else { return "시작 중" }
        switch job.status {
        case .fetching: return "페이지 분석 중"
        case .downloading: return job.total > 0 ? "받는 중 \(job.processed)/\(job.total)" : "받는 중"
        case .failed: return job.error ?? "실패"
        case .done: return "\(job.images.count)개 · \(formatBytes(job.images.reduce(0) { $0 + $1.size }))"
        }
    }
}

@MainActor
@Observable
final class JobStore {
    private static let maxEntries = 12
    var entries: [JobEntry] = []

    func entry(_ id: String) -> JobEntry? { entries.first { $0.id == id } }

    @discardableResult
    func start(mode: Mode, title: String, input: CollectInput, folderName: String) -> JobEntry {
        let entry = JobEntry(mode: mode, title: title, folderName: folderName)
        entries.insert(entry, at: 0)
        if entries.count > Self.maxEntries { discard(entries.removeLast()) }
        entry.task = Task { await entry.model.start(input) }
        return entry
    }

    /// 기록 하나를 지운다. 받는 중이면 멈추고, 기기에 임시로 받아 둔 파일도 지운다.
    func remove(_ id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        discard(entries.remove(at: index))
    }

    func removeAll() {
        let old = entries
        entries = []
        old.forEach(discard)
    }

    /// 지금 기록에 남아 있는 작업들이 쓰는 임시 폴더 (캐시 삭제 때 건드리지 않는다)
    var liveFolders: Set<URL> {
        Set(entries.flatMap { $0.model.job?.images.map { $0.fileURL.deletingLastPathComponent().standardizedFileURL } ?? [] })
    }

    /// 기록에 남은 작업들이 받아 둔 파일 크기 합
    var downloadedBytes: Int {
        entries.reduce(0) { sum, entry in sum + (entry.model.job?.images.reduce(0) { $0 + $1.size } ?? 0) }
    }

    private func discard(_ entry: JobEntry) {
        entry.task?.cancel()
        let folders = Set(entry.model.job?.images.map { $0.fileURL.deletingLastPathComponent() } ?? [])
        for folder in folders { try? FileManager.default.removeItem(at: folder) }
    }
}
