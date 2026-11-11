import Foundation
import Observation

/// 받은 파일을 저장할 폴더. 한 번 고르면 기억해 두고(북마크) 다음부터 바로 그 안에 저장한다.
/// zip 으로 묶지 않고 `<고른 폴더>/<작업 이름>/1.png …` 처럼 파일 그대로 넣는다.
@MainActor
@Observable
final class SaveFolder {
    private static let bookmarkKey = "saveFolderBookmark"

    private(set) var url: URL?

    init() {
        url = Self.restore()
        #if os(macOS)
        // 맥은 처음엔 다운로드 폴더에 저장한다 (설정에서 바꿀 수 있다)
        if url == nil { url = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first }
        #endif
    }

    /// 화면에 보여 줄 폴더 이름. 아이폰 "나의 iPhone" 최상위는 시스템 이름이 "File Provider Storage" 라 바꿔 보여 준다.
    var displayName: String {
        guard let url else { return "고르지 않음" }
        let name = FileManager.default.displayName(atPath: url.path(percentEncoded: false))
        return name == "File Provider Storage" ? "나의 iPhone" : name
    }

    /// 파일 선택기에서 고른 폴더를 기억한다.
    func choose(_ picked: URL) throws {
        let scoped = picked.startAccessingSecurityScopedResource()
        defer { if scoped { picked.stopAccessingSecurityScopedResource() } }
        let data = try picked.bookmarkData(options: Self.bookmarkOptions, includingResourceValuesForKeys: nil, relativeTo: nil)
        UserDefaults.standard.set(data, forKey: Self.bookmarkKey)
        url = picked
    }

    /// 고른 폴더 안에 `name` 폴더를 새로 만들고(이미 있으면 "name 2") 파일들을 넣는다. 만든 폴더를 돌려준다.
    func write(_ files: [(name: String, source: URL)], into name: String) throws -> URL {
        guard let root = url else { throw CollectError(message: "저장할 폴더를 먼저 골라 주세요.") }
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }

        let fm = FileManager.default
        var target = root.appending(path: name, directoryHint: .isDirectory)
        var n = 2
        while fm.fileExists(atPath: target.path(percentEncoded: false)) {
            target = root.appending(path: "\(name) \(n)", directoryHint: .isDirectory)
            n += 1
        }
        do {
            try fm.createDirectory(at: target, withIntermediateDirectories: true)
            for file in files { try fm.copyItem(at: file.source, to: target.appending(path: file.name)) }
        } catch {
            throw CollectError(message: "폴더에 저장하지 못했습니다. 폴더를 다시 골라 주세요. (\(error.localizedDescription))")
        }
        return target
    }

    private static var bookmarkOptions: URL.BookmarkCreationOptions {
        #if os(macOS)
        [.withSecurityScope]
        #else
        []
        #endif
    }

    private static func restore() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkResolutionOptions = []
        #endif
        guard let url = try? URL(resolvingBookmarkData: data, options: options, relativeTo: nil, bookmarkDataIsStale: &stale) else {
            return nil
        }
        if stale, let fresh = try? url.bookmarkData(options: bookmarkOptions, includingResourceValuesForKeys: nil, relativeTo: nil) {
            UserDefaults.standard.set(fresh, forKey: bookmarkKey)
        }
        return url
    }
}
