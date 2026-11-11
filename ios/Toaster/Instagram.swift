import Foundation
import SwiftSoup

/// 인스타그램 게시물·릴스. 게시물 페이지는 로그인 창과 자바스크립트로 그려서 그대로는 사진·영상이 없다.
/// 대신 누구나 볼 수 있는 "퍼가기(embed)" 페이지를 읽는다. (웹의 lib/server/instagram.ts 와 같은 규칙)
///
///   여러 장·영상 게시물: <script> 안 contextJSON → gql_data.shortcode_media (video_url, display_url, 여러 장이면 children)
///   사진 한 장 게시물:   <img class="EmbeddedMediaImage" srcset="… 1440w"> 에서 가장 큰 것
enum Instagram {
    /// "찾을 요소" 대신 쓰는 이름표. CSS 에 없는 모양이라 진짜 선택자와 헷갈리지 않는다.
    static let imagesToken = ":instagram-image"
    static let videosToken = ":instagram-video"

    struct Item: Sendable {
        let url: URL
        let isVideo: Bool
        /// 미리보기 그림 (영상은 표지)
        let preview: URL?
    }

    /// 게시물·릴스 주소에서 게시물 코드를 뽑는다. 인스타그램 게시물이 아니면 nil.
    static func code(_ address: String) -> String? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespaces)),
              let host = url.host()?.lowercased(),
              ["instagram.com", "www.instagram.com", "m.instagram.com"].contains(host)
        else { return nil }
        // /p/코드, /reel/코드, /reels/코드, /tv/코드, 앞에 /사용자이름/ 이 붙기도 한다
        let path = url.path()
        guard let m = path.firstMatch(of: /^\/(?:[^\/]+\/)?(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/) else { return nil }
        return String(m.1)
    }

    static func embedURL(_ code: String) -> URL {
        URL(string: "https://www.instagram.com/p/\(code)/embed/captioned/")!
    }

    /// 퍼가기 페이지에서 게시물의 사진·영상을 순서대로 모은다.
    static func items(html: String) -> (items: [Item], title: String) {
        if let media = shortcodeMedia(html) {
            let children = ((media["edge_sidecar_to_children"] as? [String: Any])?["edges"] as? [[String: Any]])?
                .compactMap { $0["node"] as? [String: Any] }
            let nodes = children ?? [media]
            let items = nodes.compactMap { node -> Item? in
                let display = (node["display_url"] as? String).flatMap(URL.init(string:))
                if let video = (node["video_url"] as? String).flatMap(URL.init(string:)) {
                    return Item(url: video, isVideo: true, preview: display)
                }
                return display.map { Item(url: $0, isVideo: false, preview: $0) }
            }
            let user = (media["owner"] as? [String: Any])?["username"] as? String
            return (items, user.map { "@\($0)" } ?? "")
        }

        // 사진 한 장: srcset 후보 중 가장 큰 것
        guard let doc = try? SwiftSoup.parse(html), let img = try? doc.select("img.EmbeddedMediaImage").first() else {
            return ([], "")
        }
        var best = (try? img.attr("src")) ?? ""
        var bestWidth = 0
        for part in ((try? img.attr("srcset")) ?? "").split(separator: ",") {
            let bits = part.split(whereSeparator: \.isWhitespace)
            guard let first = bits.first else { continue }
            let width = bits.count > 1 ? Int(bits[1].dropLast()) ?? 0 : 0
            if width > bestWidth {
                best = String(first)
                bestWidth = width
            }
        }
        let user = (try? doc.select(".UsernameText").first()?.text()) ?? ""
        guard let url = URL(string: best), !best.isEmpty else { return ([], "") }
        return ([Item(url: url, isVideo: false, preview: url)], user.isEmpty ? "" : "@\(user)")
    }

    /// 고른 이름표(사진·영상)에 맞는 주소만
    static func pick(_ items: [Item], selector: String) -> [URL] {
        let images = selector.contains(imagesToken), videos = selector.contains(videosToken)
        return items.filter { $0.isVideo ? videos : images }.map(\.url)
    }

    static func isToken(_ selector: String) -> Bool {
        selector.contains(imagesToken) || selector.contains(videosToken)
    }

    /// contextJSON 은 JSON 문자열 안에 JSON 이 한 번 더 들어 있다
    private static func shortcodeMedia(_ html: String) -> [String: Any]? {
        guard let m = html.firstMatch(of: /"contextJSON":"((?:[^"\\]|\\.)*)"/),
              let outer = try? JSONSerialization.jsonObject(with: Data("\"\(m.1)\"".utf8), options: .fragmentsAllowed) as? String,
              let context = try? JSONSerialization.jsonObject(with: Data(outer.utf8)) as? [String: Any],
              let gql = context["gql_data"] as? [String: Any]
        else { return nil }
        return gql["shortcode_media"] as? [String: Any]
    }
}
