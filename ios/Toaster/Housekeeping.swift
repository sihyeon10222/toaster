import Foundation

/// 앱이 기기에 남기는 것들을 정리한다 (설정의 캐시 삭제·데이터 삭제·앱 초기화).
/// 받은 파일은 History.jobsRoot 의 `toaster-…`(예전 버전은 임시 폴더), 스티커 변환 결과는 임시 폴더의 `sticker-…` 에 있다.
/// 맥은 임시 폴더를 다른 앱과 같이 쓸 수 있어서 이 이름으로 시작하는 것만 건드린다.
/// 사용자가 고른 저장 폴더와 사진 앱에 넣은 파일은 절대 지우지 않는다.
enum Housekeeping {
    private static let prefixes = ["toaster-", "sticker-"]

    private static var tempItems: [URL] {
        let fm = FileManager.default
        let items = [fm.temporaryDirectory, History.jobsRoot].flatMap {
            (try? fm.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)) ?? []
        }
        return items.filter { url in prefixes.contains { url.lastPathComponent.hasPrefix($0) } }
    }

    /// 캐시 크기: 지금 기록에 없는 임시 파일 + 네트워크 캐시
    static func cacheBytes(keeping live: Set<URL>, busy: Bool = false) -> Int {
        let orphans = tempItems.filter { removable($0, live: live, busy: busy) }
        return orphans.reduce(0) { $0 + size(of: $1) } + URLCache.shared.currentDiskUsage
    }

    /// 지금 기록에 남은 작업의 파일은 두고, 나머지 임시 파일과 네트워크 캐시를 지운다.
    static func clearCache(keeping live: Set<URL>, busy: Bool = false) {
        for item in tempItems where removable(item, live: live, busy: busy) {
            try? FileManager.default.removeItem(at: item)
        }
        URLCache.shared.removeAllCachedResponses()
    }

    /// 임시 파일·캐시를 모두 지운다 (앱 초기화)
    static func clearEverything() {
        for item in tempItems { try? FileManager.default.removeItem(at: item) }
        URLCache.shared.removeAllCachedResponses()
    }

    /// 기록에 남은 작업의 폴더는 두고, 무언가 진행 중이면 스티커 변환 폴더(sticker-)도 둔다
    private static func removable(_ item: URL, live: Set<URL>, busy: Bool) -> Bool {
        if live.contains(item.standardizedFileURL) { return false }
        if busy && item.lastPathComponent.hasPrefix("sticker-") { return false }
        return true
    }

    private static func size(of url: URL) -> Int {
        let keys: Set<URLResourceKey> = [.totalFileAllocatedSizeKey, .isRegularFileKey]
        guard let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: Array(keys)) else { return 0 }
        var total = 0
        for case let file as URL in walker {
            guard let values = try? file.resourceValues(forKeys: keys), values.isRegularFile == true else { continue }
            total += values.totalFileAllocatedSize ?? 0
        }
        return total
    }
}
