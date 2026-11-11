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

    /// 입력칸에 미리 보여 줄 링크 모양
    static let linkPlaceholder = "https://e.kakao.com/t/…"

    /// 이모티콘샵 링크에서 이모티콘 주소 끝부분(slug)을 뽑는다. https://e.kakao.com/ 링크만 받는다.
    ///   https://e.kakao.com/t/kakao-friends-classic
    ///   https://e.kakao.com/app/t/kakao-friends-classic?t_ch=shared_item
    /// 끝주소만 넣거나 다른 주소면 nil.
    static func parseSlug(_ input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^https?://e\.kakao\.com/"#, options: [.regularExpression, .caseInsensitive]) != nil,
              let components = URLComponents(string: value),
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
