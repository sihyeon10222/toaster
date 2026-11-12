import Foundation
import SwiftSoup

/// 스레드(Threads) 게시물. 게시물 페이지는 로그인 없이 보면 사진·영상이 빠져 있다.
/// 대신 누구나 볼 수 있는 "퍼가기(embed)" 페이지를 읽는다. (웹의 lib/server/threads.ts 와 같은 규칙)
///
///   사진·영상 한 개:  .SoloMediaContainer 안의 <img> / <video><source>
///   여러 개:          .MediaScrollContainer 안의 <img> / <video><source> (게시물 순서대로)
enum Threads {
    /// 게시물 주소에서 게시물 코드를 뽑는다. 스레드 게시물이 아니면 nil.
    static func code(_ address: String) -> String? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespaces)),
              let host = url.host()?.lowercased(),
              ["threads.com", "www.threads.com", "threads.net", "www.threads.net"].contains(host)
        else { return nil }
        // /@사용자이름/post/코드, /t/코드
        guard let m = url.path().firstMatch(of: /^\/(?:@[^\/]+\/post|t)\/([A-Za-z0-9_-]+)/) else { return nil }
        return String(m.1)
    }

    static func embedURL(_ code: String) -> URL {
        URL(string: "https://www.threads.com/t/\(code)/embed")!
    }

    /// 퍼가기 페이지에서 게시물의 사진·영상을 순서대로 모은다
    static func items(html: String) -> (items: [PostItem], title: String) {
        guard let doc = try? SwiftSoup.parse(html, "https://www.threads.com/") else { return ([], "") }
        let media = (try? doc.select(".SoloMediaContainer img, .SoloMediaContainer video, .MediaScrollContainer img, .MediaScrollContainer video").array()) ?? []
        var seen = Set<String>()
        let items = media.compactMap { el -> PostItem? in
            if el.tagName() == "video" {
                let src = (try? el.select("source[src]").first()?.absUrl("src")).flatMap { $0 } ?? (try? el.absUrl("src")) ?? ""
                guard let url = URL(string: src), !src.isEmpty, seen.insert(src).inserted else { return nil }
                let poster = (try? el.absUrl("poster")).flatMap { $0.isEmpty ? nil : URL(string: $0) }
                return PostItem(url: url, isVideo: true, preview: poster)
            }
            let src = (try? el.absUrl("src")) ?? ""
            guard let url = URL(string: src), !src.isEmpty, seen.insert(src).inserted else { return nil }
            return PostItem(url: url, isVideo: false, preview: url)
        }
        let user = (try? doc.select(".HeaderLink span").first()?.text()) ?? ""
        return (items, user.isEmpty ? "" : "@\(user)")
    }
}
