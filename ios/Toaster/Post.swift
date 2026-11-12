import Foundation

/// 게시물 안의 사진·영상 하나
struct PostItem: Sendable {
    let url: URL
    let isVideo: Bool
    /// 미리보기 그림 (영상은 표지, 없으면 nil)
    let preview: URL?
}

/// 붙여 넣은 SNS 게시물 주소 (인스타그램·X·스레드).
/// 게시물 페이지는 로그인 창과 자바스크립트로 그려서 그대로는 사진·영상이 없다.
/// 대신 누구나 볼 수 있는 퍼가기(embed) 데이터를 읽는다. 로그인·쿠키 없이 공개된 것만 쓴다.
/// (웹의 lib/post.ts, lib/server/post.ts 와 같은 규칙)
enum Post: Sendable, Equatable {
    case instagram(code: String)
    case x(id: String)
    case threads(code: String)

    init?(_ address: String) {
        if let code = Instagram.code(address) {
            self = .instagram(code: code)
        } else if let id = XPost.id(address) {
            self = .x(id: id)
        } else if let code = Threads.code(address) {
            self = .threads(code: code)
        } else {
            return nil
        }
    }

    /// 이름표·폴더 이름에 쓰는 영문 이름
    private var key: String {
        switch self {
        case .instagram: "instagram"
        case .x: "x"
        case .threads: "threads"
        }
    }

    private var name: String {
        switch self {
        case .instagram: "인스타그램"
        case .x: "X"
        case .threads: "스레드"
        }
    }

    /// 받은 파일을 넣을 폴더 이름 (instagram_코드, x_번호, threads_코드)
    var folderName: String {
        switch self {
        case .instagram(let code), .threads(let code): "\(key)_\(code)"
        case .x(let id): "x_\(id)"
        }
    }

    /// 실제로 읽는 공개 퍼가기 주소
    var source: URL {
        switch self {
        case .instagram(let code): Instagram.embedURL(code)
        case .x(let id): XPost.dataURL(id)
        case .threads(let code): Threads.embedURL(code)
        }
    }

    /// X·스레드 퍼가기 데이터는 브라우저인 척하지 않고 이 이름으로 받는다. (웹의 postUserAgent 와 같다)
    /// 스레드는 데스크톱 브라우저에는 자바스크립트로만 그리는 빈 페이지를 주고, 그 밖에는 사진·영상이 든 HTML 을 준다.
    /// 인스타그램은 예전 그대로(nil = Collector.userAgent) 둔다.
    var userAgent: String? {
        switch self {
        case .instagram: nil
        case .x, .threads: "Toaster/1.0"
        }
    }

    /// "찾을 요소" 대신 쓰는 이름표. CSS 에 없는 모양이라 진짜 선택자와 헷갈리지 않는다.
    var imagesToken: String { ":\(key)-image" }
    var videosToken: String { ":\(key)-video" }

    func isToken(_ selector: String) -> Bool {
        selector.contains(imagesToken) || selector.contains(videosToken)
    }

    /// 퍼가기 데이터에서 게시물의 사진·영상을 순서대로 모은다
    func items(_ text: String) async -> (items: [PostItem], title: String) {
        switch self {
        case .instagram: Instagram.items(html: text)
        case .x: await XPost.items(json: text)
        case .threads: Threads.items(html: text)
        }
    }

    /// 고른 이름표(사진·영상)에 맞는 주소만
    func pick(_ items: [PostItem], selector: String) -> [URL] {
        let images = selector.contains(imagesToken), videos = selector.contains(videosToken)
        return items.filter { $0.isVideo ? videos : images }.map(\.url)
    }

    /// 사진·영상을 하나도 찾지 못했을 때
    var emptyMessage: String {
        switch self {
        case .instagram: "인스타그램 게시물을 읽지 못했습니다. 비공개 계정이거나 지워진 게시물일 수 있습니다."
        default: "\(name) 게시물에서 사진·영상을 찾지 못했습니다. 사진·영상이 없거나, 비공개·지워진 게시물일 수 있습니다."
        }
    }
}
