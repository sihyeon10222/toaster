import Foundation

/// 최근 작업 기록을 기기에 남겨 앱을 껐다 켜도 그대로 보이게 한다.
/// 받은 파일은 `Application Support/jobs/toaster-…` 폴더에, 기록은 `Application Support/history.json` 에 둔다.
/// (임시 폴더는 앱이 꺼져 있는 동안 시스템이 비울 수 있어서 쓰지 않는다)
/// 앱을 다시 깔면 폴더 경로가 바뀌므로 기록에는 폴더·파일 이름만 적고 경로는 열 때마다 다시 만든다.
enum History {
    static let base: URL = {
        let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    /// 받은 파일 폴더들이 들어가는 곳
    static let jobsRoot: URL = {
        let url = base.appending(path: "jobs")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    private static var file: URL { base.appending(path: "history.json") }

    struct Record: Codable {
        var id: String
        var mode: String
        var title: String
        var folderName: String
        var url: String
        var startedAt: Date
        var saved: [String]
        var job: JobRecord?
    }

    struct JobRecord: Codable {
        var url: String
        var title: String
        var status: String
        var total: Int
        var processed: Int
        var images: [FileRecord]
        var errors: [String]
        var error: String?
        /// jobsRoot 안의 폴더 이름
        var folder: String?
    }

    struct FileRecord: Codable {
        var filename: String
        var sourceURL: String
        var contentType: String
        var size: Int
    }

    @MainActor
    static func save(_ entries: [JobEntry]) {
        let records = entries.map { entry in
            Record(
                id: entry.id, mode: entry.mode.rawValue, title: entry.title, folderName: entry.folderName,
                url: entry.url, startedAt: entry.startedAt,
                saved: entry.model.saved.map(\.rawValue).sorted(),
                job: entry.model.job.map { job in
                    JobRecord(
                        url: job.url, title: job.title, status: job.status.rawValue, total: job.total,
                        processed: job.processed,
                        images: job.images.map {
                            FileRecord(filename: $0.filename, sourceURL: $0.sourceURL.absoluteString,
                                       contentType: $0.contentType, size: $0.size)
                        },
                        errors: job.errors, error: job.error, folder: job.folder?.lastPathComponent
                    )
                }
            )
        }
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(records).write(to: file, options: .atomic)
        } catch {
            // 기록을 못 남겨도 앱은 계속 쓸 수 있다
        }
    }

    /// 남겨 둔 기록을 읽는다. 받는 도중에 앱이 꺼진 작업은 실패로, 파일이 사라진 작업은 그만큼 빼서 보여 준다.
    /// 어느 기록에도 속하지 않는 받은 파일 폴더(받다가 꺼진 것 등)는 지운다.
    @MainActor
    static func load() -> [JobEntry] {
        let fm = FileManager.default
        var records: [Record] = []
        if let data = try? Data(contentsOf: file) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            records = (try? decoder.decode([Record].self, from: data)) ?? []
        }

        var keep = Set<String>()
        let entries = records.compactMap { record -> JobEntry? in
            guard let mode = Mode(rawValue: record.mode) else { return nil }
            let entry = JobEntry(mode: mode, title: record.title, folderName: record.folderName, url: record.url,
                                 id: record.id, startedAt: record.startedAt)
            entry.model.saved = Set(record.saved.compactMap(JobModel.SaveTarget.init(rawValue:)))

            guard let r = record.job, let status = JobStatus(rawValue: r.status) else {
                entry.model.job = interrupted(url: record.url)
                return entry
            }
            var job = Job(url: r.url)
            job.title = r.title
            job.total = r.total
            job.processed = r.processed
            job.errors = r.errors
            job.error = r.error
            job.status = status

            let folder = r.folder.map { jobsRoot.appending(path: $0) }
            if !status.isFinished {
                if let folder { try? fm.removeItem(at: folder) }
                var stopped = interrupted(url: r.url)
                stopped.title = r.title
                entry.model.job = stopped
                return entry
            }
            if let folder {
                job.folder = folder
                job.images = r.images.compactMap { f in
                    let fileURL = folder.appending(path: f.filename)
                    guard fm.fileExists(atPath: fileURL.path), let source = URL(string: f.sourceURL) else { return nil }
                    return CollectedFile(filename: f.filename, fileURL: fileURL, sourceURL: source,
                                         contentType: f.contentType, size: f.size)
                }
                if !job.images.isEmpty { keep.insert(folder.lastPathComponent) }
            }
            if status == .done, job.images.isEmpty {
                job.status = .failed
                job.error = "받아 둔 파일이 기기에서 지워졌습니다. 다시 받아 주세요."
                if let folder { try? fm.removeItem(at: folder) }
                job.folder = nil
            }
            entry.model.job = job
            return entry
        }

        // 어느 기록에도 속하지 않는 폴더는 정리한다 (앱을 켤 때는 받는 중인 작업이 없다)
        let folders = (try? fm.contentsOfDirectory(at: jobsRoot, includingPropertiesForKeys: nil)) ?? []
        for folder in folders where !keep.contains(folder.lastPathComponent) {
            try? fm.removeItem(at: folder)
        }
        return entries
    }

    private static func interrupted(url: String) -> Job {
        var job = Job(url: url)
        job.status = .failed
        job.error = "받는 도중에 앱이 꺼져서 멈췄습니다. 다시 받아 주세요."
        return job
    }
}
