import Foundation

/// X(트위터) 게시물. 게시물 페이지는 로그인 창과 자바스크립트로 그려서 그대로는 사진·영상이 없다.
/// 대신 X 공식 퍼가기 위젯(platform.twitter.com/embed)이 읽는 공개 데이터를 같은 방법으로 읽는다.
/// (웹의 lib/server/x.ts 와 같은 규칙)
///
///   cdn.syndication.twimg.com/tweet-result?id=번호&token=… → JSON
///   mediaDetails[]: type photo → media_url_https (?name=orig 가 원본 크기)
///                   type video / animated_gif → video_info.variants 중 받기 크기 제한 안에 드는 가장 좋은 mp4
enum XPost {
    /// 게시물 주소에서 게시물 번호를 뽑는다. X 게시물이 아니면 nil.
    static func id(_ address: String) -> String? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespaces)),
              let host = url.host()?.lowercased(),
              ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].contains(host)
        else { return nil }
        // /사용자이름/status/번호, /i/status/번호, /i/web/status/번호 (뒤에 /photo/1 등이 붙기도 한다)
        guard let m = url.path().firstMatch(of: /^\/(?:[^\/]+|i\/web)\/status(?:es)?\/(\d{1,25})/) else { return nil }
        return String(m.1)
    }

    static func dataURL(_ id: String) -> URL {
        URL(string: "https://cdn.syndication.twimg.com/tweet-result?id=\(id)&token=\(token(id))")!
    }

    /// 게시물의 사진·영상을 순서대로 모은다. 영상은 화질마다 실제 파일 크기를 확인해서 고른다.
    static func items(json: String) async -> (items: [PostItem], title: String) {
        guard let tweet = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              tweet["__typename"] as? String == "Tweet" || tweet["id_str"] != nil
        else { return ([], "") }
        let media = (tweet["mediaDetails"] as? [[String: Any]] ?? []).compactMap { m -> Media? in
            guard let base = m["media_url_https"] as? String else { return nil }
            let variants = ((m["video_info"] as? [String: Any])?["variants"] as? [[String: Any]])?.compactMap { v -> Variant? in
                guard let url = (v["url"] as? String).flatMap(URL.init(string:)) else { return nil }
                return Variant(url: url, type: v["content_type"] as? String ?? "", bitrate: (v["bitrate"] as? NSNumber)?.doubleValue ?? 0)
            }
            return Media(base: base, variants: variants)
        }
        var items = [PostItem?](repeating: nil, count: media.count)
        await withTaskGroup(of: (Int, PostItem?).self) { group in
            for (index, m) in media.enumerated() {
                group.addTask {
                    let preview = URL(string: sized(m.base, "small"))
                    guard let variants = m.variants else {
                        return (index, URL(string: sized(m.base, "orig")).map { PostItem(url: $0, isVideo: false, preview: preview) })
                    }
                    return (index, await best(variants).map { PostItem(url: $0, isVideo: true, preview: preview) })
                }
            }
            for await (index, item) in group { items[index] = item }
        }
        let user = (tweet["user"] as? [String: Any])?["screen_name"] as? String
        return (items.compactMap { $0 }, user.map { "@\($0)" } ?? "")
    }

    private struct Media: Sendable {
        let base: String
        /// 영상이면 화질별 주소, 사진이면 nil
        let variants: [Variant]?
    }

    struct Variant: Sendable {
        let url: URL
        let type: String
        let bitrate: Double
    }

    /// 가장 좋은 영상. bitrate 가 큰 mp4 부터 실제 파일 크기를 확인해 받기 크기 제한(100MB) 안에 드는 첫 번째를 고른다.
    /// (bitrate 값은 화질 이름표에 가까워 실제 크기와 많이 다르다)
    /// 모두 너무 크면 스트리밍(m3u8)으로 받는다 (HLS.swift 가 가장 큰 화질을 골라 조각으로 받으므로 크기 제한이 더 크다).
    static func best(_ variants: [Variant]) async -> URL? {
        let mp4 = variants.filter { $0.type == "video/mp4" }.sorted { $0.bitrate > $1.bitrate }
        for v in mp4 {
            // 크기를 알 수 없으면 일단 받아 본다
            guard let size = await fileSize(v.url), size > Collector.maxFileBytes else { return v.url }
        }
        return variants.first { $0.type == "application/x-mpegURL" }?.url ?? mp4.first?.url
    }

    /// 첫 1바이트만 요청해서 Content-Range 의 전체 크기를 읽는다
    private static func fileSize(_ url: URL) async -> Int? {
        var req = Collector.request(url)
        req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        guard let (_, response) = try? await Collector.load(req), let http = response as? HTTPURLResponse else { return nil }
        if let range = http.value(forHTTPHeaderField: "Content-Range"), let total = range.split(separator: "/").last {
            return Int(total)
        }
        return http.statusCode == 200 ? Int(http.expectedContentLength) : nil
    }

    /// pbs.twimg.com 그림 주소에 크기를 붙인다 (orig = 원본, small = 미리보기)
    private static func sized(_ base: String, _ name: String) -> String {
        base + (base.contains("?") ? "&" : "?") + "name=\(name)"
    }

    /// 퍼가기 위젯이 붙이는 token 값: (번호 / 1e15 * π) 를 36진수로 쓰고 0 과 점을 뺀 것.
    /// 자바스크립트 Number.prototype.toString(36) 과 같은 결과를 내도록 V8 의 방식을 그대로 옮겼다.
    static func token(_ id: String) -> String {
        guard let n = Double(id) else { return "0" }
        return radix36(n / 1e15 * Double.pi).filter { $0 != "0" && $0 != "." }
    }

    private static func radix36(_ value: Double) -> String {
        let chars = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        let radix = 36.0
        var integer = value.rounded(.down)
        var fraction = value - integer
        var delta = max(0.5 * (value.nextUp - value), Double(0).nextUp)
        var digits: [Character] = []
        if fraction >= delta {
            repeat {
                fraction *= radix
                delta *= radix
                let digit = Int(fraction)
                digits.append(chars[digit])
                fraction -= Double(digit)
                if fraction > 0.5 || (fraction == 0.5 && digit & 1 == 1), fraction + delta > 1 {
                    // 반올림해서 올린다
                    while true {
                        guard let last = digits.popLast() else {
                            integer += 1
                            break
                        }
                        let d = chars.firstIndex(of: last)!
                        if d + 1 < 36 {
                            digits.append(chars[d + 1])
                            break
                        }
                    }
                    break
                }
            } while fraction >= delta
        }
        var whole: [Character] = []
        repeat {
            let remainder = integer.truncatingRemainder(dividingBy: radix)
            whole.insert(chars[Int(remainder)], at: 0)
            integer = (integer - remainder) / radix
        } while integer > 0
        return String(whole) + (digits.isEmpty ? "" : "." + String(digits))
    }
}
