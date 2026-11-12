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
        url = Self.restore() ?? Self.defaultURL
    }

    /// 처음 상태: 맥은 다운로드 폴더, 아이폰은 고르지 않음 (설정에서 바꿀 수 있다)
    private static var defaultURL: URL? {
        #if os(macOS)
        FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        #else
        nil
        #endif
    }

    /// 고른 폴더를 잊고 처음 상태로 돌린다 (앱 초기화)
    func reset() {
        UserDefaults.standard.removeObject(forKey: Self.bookmarkKey)
        url = Self.defaultURL
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

    /// 고른 폴더 안에 `name` 폴더를 새로 만들고(이미 있으면 "name_2", "name_3" …) 파일들을 넣는다. 만든 폴더를 돌려준다.
    /// 파일 복사가 오래 걸릴 수 있어 메인 스레드 밖에서 부른다.
    nonisolated static func write(_ files: [(name: String, source: URL)], into name: String, root: URL) throws -> URL {
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }

        let fm = FileManager.default
        // 같은 이름이 있으면 name_2, name_3 … (만들기에 성공한 폴더만 우리 것이다)
        var target = root.appending(path: name, directoryHint: .isDirectory)
        var n = 2
        while true {
            do {
                try fm.createDirectory(at: target, withIntermediateDirectories: false)
                break
            } catch where n < 10_000 && fm.fileExists(atPath: target.path(percentEncoded: false)) {
                target = root.appending(path: "\(name)_\(n)", directoryHint: .isDirectory)
                n += 1
            } catch {
                throw CollectError(message: "폴더를 만들지 못했습니다. 설정에서 저장 폴더를 다시 골라 주세요. (\(error.localizedDescription))")
            }
        }
        do {
            for file in files { try fm.copyItem(at: file.source, to: target.appending(path: file.name)) }
        } catch {
            // 방금 만든 폴더에 반쯤 들어간 파일은 남기지 않는다
            try? fm.removeItem(at: target)
            throw CollectError(message: "폴더에 저장하지 못했습니다. 설정에서 저장 폴더를 다시 골라 주세요. (\(error.localizedDescription))")
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
        if stale {
            // 오래된 북마크는 폴더에 접근한 상태에서 새로 만들어야 한다
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let fresh = try? url.bookmarkData(options: bookmarkOptions, includingResourceValuesForKeys: nil, relativeTo: nil) {
                UserDefaults.standard.set(fresh, forKey: bookmarkKey)
            }
        }
        return url
    }
}
