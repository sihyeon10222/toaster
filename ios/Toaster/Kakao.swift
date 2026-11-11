import Foundation

// 카카오 이모티콘샵 프리셋 (web/src/lib/kakao.ts 와 맞춤).
// 이모티콘 목록은 페이지 HTML 에 그대로 들어 있어 렌더링 없이 받을 수 있다.
enum Kakao {
    static let emoticonBase = "https://e.kakao.com/t/"
    /// 이모티콘 상세 페이지의 이모티콘 목록. 카카오가 페이지를 개편하면 바꿔야 한다.
    static let emoticonSelector = "ul.grid li button img"

    // Regex 는 Sendable 이 아니라 static let 대신 계산 속성으로 둔다 (Swift 6)
    private static var slugPattern: Regex<Substring> { /^[a-z0-9]+(?:-[a-z0-9]+)*$/.ignoresCase() }
    private static var pathPattern: Regex<(Substring, Substring)> { /^\/(?:app\/)?t\/([^\/]+)\/?$/ }

    /// 사용자가 넣은 값에서 이모티콘 주소 끝부분(slug)을 뽑는다.
    ///   kakao-friends-classic
    ///   https://e.kakao.com/t/kakao-friends-classic
    ///   https://e.kakao.com/app/t/kakao-friends-classic?t_ch=shared_item
    ///   e.kakao.com/t/kakao-friends-classic/
    /// 형식이 맞지 않으면 nil.
    static func parseSlug(_ input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if value.wholeMatch(of: slugPattern) != nil { return value.lowercased() }

        let withScheme = value.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil
            ? value : "https://\(value)"
        guard let components = URLComponents(string: withScheme),
              components.host?.lowercased() == "e.kakao.com",
              let match = components.percentEncodedPath.wholeMatch(of: pathPattern),
              let slug = String(match.1).removingPercentEncoding,
              slug.wholeMatch(of: slugPattern) != nil
        else { return nil }
        return slug.lowercased()
    }

    static func emoticonURL(slug: String) -> String {
        emoticonBase + (slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug)
    }
}
