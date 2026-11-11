import CryptoKit
import Foundation
import ImageIO
import SwiftSoup
import WebKit

// 아이폰 안에서 모든 일을 한다: 페이지 읽기(필요하면 WKWebView 로 렌더링) → 선택자로 주소 찾기
// → 파일 받기 → 실제 형식 판별·중복 제거. 서버가 필요 없다. (웹의 lib/collect.ts 와 같은 흐름)
// 저장은 SaveFolder 가 고른 폴더에 파일 그대로 한다.

/// 받을 종류. video 는 직접 링크된 mp4/mov 등만 (스트리밍·DRM 미지원)
enum Media: String, CaseIterable, Sendable {
    case image, video, all
}

enum JobStatus: Sendable {
    case fetching, downloading, done, failed

    var isFinished: Bool { self == .done || self == .failed }

    var label: String {
        switch self {
        case .fetching: "페이지 분석 중"
        case .downloading: "받는 중"
        case .done: "완료"
        case .failed: "실패"
        }
    }
}

struct CollectInput: Sendable {
    var url: String
    var selector: String
    var media: Media = .image
    /// 자바스크립트로 그리는 페이지: WKWebView 로 열어 끝까지 스크롤한 뒤 찾는다
    var render = false
}

struct CollectedFile: Identifiable, Hashable, Sendable {
    let filename: String
    let fileURL: URL
    let sourceURL: URL
    let contentType: String
    let size: Int

    var id: String { filename }
    var isVideo: Bool { contentType.hasPrefix("video/") }
    var isSVG: Bool { contentType == "image/svg+xml" }
}

struct Job: Sendable {
    var url: String
    var title = ""
    var status: JobStatus = .fetching
    var total = 0
    var processed = 0
    var images: [CollectedFile] = []
    var errors: [String] = []
    var error: String?
}

struct CollectError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum Collector {
    static let userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    private static let concurrency = 6
    private static let maxURLs = 500
    private static let maxFileBytes = 100 * 1024 * 1024

    /// 페이지를 분석하고 파일을 모두 받는다. 진행될 때마다 update 로 현재 상태를 넘긴다.
    /// 실패해도 throw 하지 않고 status == .failed 로 끝난다.
    static func run(_ input: CollectInput, update: @MainActor @Sendable (Job) -> Void) async {
        var job = Job(url: input.url)
        await update(job)

        // 1) 페이지 분석
        let pageURL: URL
        let urls: [URL]
        do {
            let (html, finalURL) = try await loadPage(input.url, render: input.render)
            let found = try extract(html: html, pageURL: finalURL, selector: input.selector)
            pageURL = finalURL
            urls = found.urls
            job.url = finalURL.absoluteString
            job.title = found.title
        } catch {
            job.status = .failed
            job.error = error.localizedDescription
            await update(job)
            return
        }
        guard !urls.isEmpty else {
            job.status = .failed
            job.error = "선택자에 맞는 이미지·영상을 찾지 못했습니다."
            await update(job)
            return
        }

        // 2) 파일 받기 (병렬). 번호는 페이지 순서대로 매긴다.
        job.status = .downloading
        job.total = urls.count
        await update(job)

        let folder = FileManager.default.temporaryDirectory.appending(path: "toaster-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let width = max(3, String(urls.count).count)
        var results = [CollectedFile?](repeating: nil, count: urls.count)
        var looks = [ImageLook?](repeating: nil, count: urls.count)
        var seen = Set<String>()

        await withTaskGroup(of: (Int, Result<(Data, String), Error>).self) { group in
            var next = 0
            func addNext() {
                guard next < urls.count else { return }
                let index = next, url = urls[index]
                next += 1
                group.addTask { (index, await Result { try await download(url, referer: pageURL) }) }
            }
            for _ in 0..<concurrency { addNext() }

            for await (index, result) in group {
                switch result {
                case .success(let (data, type)):
                    let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                    // 고르지 않은 종류이거나, 같은 파일이 다른 주소로 또 나온 경우는 조용히 건너뛴다
                    if wanted(type, input.media), !seen.contains(hash) {
                        seen.insert(hash)
                        let name = String(format: "%0\(width)d", index + 1) + (extByType[type] ?? "")
                        let file = folder.appending(path: name)
                        do {
                            try data.write(to: file)
                            results[index] = CollectedFile(
                                filename: name, fileURL: file, sourceURL: urls[index], contentType: type, size: data.count
                            )
                            if type.hasPrefix("image/") { looks[index] = ImageLook(data) }
                        } catch {
                            job.errors.append("\(urls[index].absoluteString): 저장 실패")
                        }
                    }
                case .failure(let error):
                    job.errors.append("\(urls[index].absoluteString): \(error.localizedDescription)")
                }
                job.processed += 1
                job.images = results.compactMap { $0 }
                await update(job)
                addNext()
            }
        }

        // 같은 그림이 크기만 다르게 여러 번 나왔으면 가장 큰 것만 남긴다
        for drop in ImageLook.smallerDuplicates(looks) {
            if let file = results[drop] { try? FileManager.default.removeItem(at: file.fileURL) }
            results[drop] = nil
        }
        job.images = results.compactMap { $0 }
        if job.images.isEmpty {
            job.status = .failed
            job.error = "받은 파일이 없습니다."
        } else {
            job.status = .done
        }
        await update(job)
    }

    // MARK: 페이지

    private static func request(_ url: URL, referer: URL? = nil) -> URLRequest {
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        req.setValue("ko,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        if let referer { req.setValue(referer.absoluteString, forHTTPHeaderField: "Referer") }
        return req
    }

    /// 페이지 HTML 과 (넘겨 주기 뒤) 실제 주소. render 면 WKWebView 로 열어 끝까지 스크롤한 뒤 꺼낸다.
    static func loadPage(_ address: String, render: Bool) async throws -> (String, URL) {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespaces)),
              ["http", "https"].contains(url.scheme?.lowercased())
        else { throw CollectError(message: "http 또는 https 주소를 넣어 주세요.") }
        return render ? try await PageRenderer.render(url) : try await fetchHTML(url)
    }

    /// 요소 고르기 화면의 작은 미리보기. 원본을 받아 긴 변 maxPixel 로 줄인다.
    /// 움직이는 그림은 장면을 모두 풀어 돌려준다 (미리보기에서 끝없이 반복).
    static func thumbnail(_ url: URL, referer: URL, maxPixel: Int = 160) async -> ImageFrames? {
        guard let (data, _) = try? await load(request(url, referer: referer)) else { return nil }
        // SVG 는 ImageIO 가 못 읽어서 웹뷰에 그려 뜬다
        if sniffType(data) == "image/svg+xml" {
            return await SVGRenderer.shared.render(data, pixels: maxPixel).map(ImageFrames.init(single:))
        }
        return ImageFrames.decode(data, maxPixel: maxPixel)
    }

    private static func fetchHTML(_ url: URL) async throws -> (String, URL) {
        let (data, response) = try await load(request(url))
        let text = String(decoding: data, as: UTF8.self)
        return (text, response.url ?? url)
    }

    private static func load(_ req: URLRequest) async throws -> (Data, URLResponse) {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw CollectError(message: "연결하지 못했습니다 (\(req.url?.host() ?? ""))")
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw CollectError(message: "HTTP \(http.statusCode)")
        }
        return (data, response)
    }

    private static func download(_ url: URL, referer: URL) async throws -> (Data, String) {
        let (data, _) = try await load(request(url, referer: referer))
        guard data.count <= maxFileBytes else { throw CollectError(message: "파일이 너무 큽니다") }
        guard let type = sniffType(data) else { throw CollectError(message: "이미지나 영상이 아닙니다") }
        return (data, type)
    }

    // MARK: 선택자 (예전 서버 scraper.extract_media_urls 와 같은 규칙)

    /// 한 요소의 "본 그림" 주소가 들어 있을 수 있는 속성. 같은 그림의 크기별 주소라서 이 중 가장 큰 것 하나만 받는다.
    /// srcset 이 있으면 그중 가장 큰 후보, 없으면 이 순서로 처음 나오는 것 (lazy-load 원본이 src 보다 크다)
    private static let mainAttrs = ["data-original", "data-lazy-src", "data-src", "data-url", "src"]
    private static let srcsetAttrs = ["srcset", "data-srcset"]
    /// 본 그림과 다른 파일을 가리키는 속성 (링크한 원본, 영상, 영상 포스터)
    private static let extraAttrs = ["href", "data-video-src", "poster"]
    private static let innerMedia = "img, picture source, video, video source"

    static func extract(html: String, pageURL: URL, selector: String) throws -> (urls: [URL], title: String) {
        let doc = try SwiftSoup.parse(html, pageURL.absoluteString)
        let urls = try mediaURLs(in: doc, base: baseURL(doc, pageURL), selector: selector)

        // "카카오프렌즈 클래식 | 카카오 이모티콘샵" → "카카오프렌즈 클래식"
        let rawTitle = (try? doc.select("meta[property=og:title]").first()?.attr("content")).flatMap { $0.isEmpty ? nil : $0 }
            ?? (try? doc.title()) ?? ""
        let title = rawTitle.components(separatedBy: " | ").first?.trimmingCharacters(in: .whitespaces) ?? ""
        return (urls, title)
    }

    fileprivate static func baseURL(_ doc: Document, _ pageURL: URL) -> URL {
        if let href = try? doc.select("base[href]").first()?.attr("href"), let b = URL(string: href, relativeTo: pageURL) {
            return b.absoluteURL
        }
        return pageURL
    }

    /// 선택자에 맞는 요소들(과 그 안쪽 미디어)에서 이미지·영상 주소를 페이지 순서대로 모은다.
    fileprivate static func mediaURLs(in doc: Document, base: URL, selector: String) throws -> [URL] {
        let matched: Elements
        do {
            matched = try doc.select(selector)
        } catch {
            throw CollectError(message: "잘못된 선택자입니다: \(selector)")
        }

        var seen = Set<String>()
        var urls: [URL] = []
        for el in matched {
            var candidates = urlsFromTag(el)
            // <div class="thumb">, <video> 처럼 감싸는 요소라면 안쪽 미디어도 본다
            if el.tagName() != "img", el.tagName() != "source", let inner = try? el.select(innerMedia) {
                for i in inner where !isPictureAlternative(i) { candidates += urlsFromTag(i) }
            }
            for raw in candidates {
                guard let url = resolve(raw, base: base), seen.insert(url.absoluteString).inserted else { continue }
                urls.append(url)
                if urls.count >= maxURLs { return urls }
            }
        }
        return urls
    }

    fileprivate static func resolve(_ raw: String, base: URL) -> URL? {
        let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if v.isEmpty || v.hasPrefix("data:") || v.hasPrefix("javascript:") || v.hasPrefix("#") { return nil }
        guard let url = URL(string: v, relativeTo: base)?.absoluteURL, ["http", "https"].contains(url.scheme?.lowercased()) else {
            return nil
        }
        return url
    }

    /// <picture> 안의 <source> 는 같은 그림의 다른 형식·크기라서, 안에 <img> 가 있으면 그 <img> 하나만 본다
    private static func isPictureAlternative(_ el: Element) -> Bool {
        guard el.tagName() == "source", let parent = el.parent(), parent.tagName() == "picture" else { return false }
        return parent.children().contains { $0.tagName() == "img" }
    }

    fileprivate static func urlsFromTag(_ el: Element) -> [String] {
        var urls: [String] = []
        // 같은 그림의 크기별 주소(srcset 후보, src, data-src …) 중에서는 가장 큰 것 하나만
        let srcset = srcsetAttrs.compactMap { try? el.attr($0) }.filter { !$0.isEmpty }.joined(separator: ",")
        if let best = bestFromSrcset(srcset) {
            urls.append(best)
        } else if let main = mainAttrs.lazy.compactMap({ try? el.attr($0) }).first(where: { !$0.isEmpty }) {
            urls.append(main)
        }
        for attr in extraAttrs {
            if let v = try? el.attr(attr), !v.isEmpty { urls.append(v) }
        }
        if let style = try? el.attr("style"), !style.isEmpty {
            for m in style.matches(of: /url\(\s*['"]?([^'")]+)['"]?\s*\)/) { urls.append(String(m.1)) }
        }
        return urls
    }

    /// srcset 에서 가장 큰 후보 ('1x', '640w' 같은 서술자 비교)
    private static func bestFromSrcset(_ value: String) -> String? {
        var best: String?
        var bestScore = -1.0
        for candidate in value.split(separator: ",") {
            let bits = candidate.split(whereSeparator: \.isWhitespace)
            guard let first = bits.first else { continue }
            let score = bits.count > 1 ? Double(bits[1].dropLast()) ?? 1 : 1
            if score > bestScore {
                best = String(first)
                bestScore = score
            }
        }
        return best
    }

    // MARK: 형식 판별

    static let extByType: [String: String] = [
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
        "image/svg+xml": ".svg", "image/avif": ".avif", "image/bmp": ".bmp", "image/x-icon": ".ico",
        "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv",
        "video/x-msvideo": ".avi", "video/ogg": ".ogv",
    ]

    private static let mp4Brands: Set<String> = [
        "isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1",
        "M4V ", "M4VP", "dash", "MSNV", "f4v ", "3gp4", "3gp5", "3g2a",
    ]

    /// 헤더를 믿지 않고 실제 바이트로 이미지·영상 형식을 판별한다. 모르면 nil.
    static func sniffType(_ data: Data) -> String? {
        let b = [UInt8](data.prefix(2048))
        func ascii(_ from: Int, _ to: Int) -> String {
            guard b.count >= to else { return "" }
            return String(decoding: b[from..<to], as: UTF8.self)
        }
        func starts(_ bytes: [UInt8]) -> Bool { b.count >= bytes.count && Array(b.prefix(bytes.count)) == bytes }

        if starts([0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return "image/png" }
        if ascii(0, 6) == "GIF87a" || ascii(0, 6) == "GIF89a" { return "image/gif" }
        if ascii(0, 4) == "RIFF", ascii(8, 12) == "WEBP" { return "image/webp" }
        if ascii(0, 4) == "RIFF", ascii(8, 12) == "AVI " { return "video/x-msvideo" }
        if ascii(4, 8) == "ftyp" {
            let brand = ascii(8, 12)
            if brand == "avif" || brand == "avis" { return "image/avif" }
            if brand == "qt  " { return "video/quicktime" }
            return mp4Brands.contains(brand) ? "video/mp4" : nil
        }
        if ascii(0, 4) == "OggS" {
            return data.prefix(512).range(of: Data([0x80] + Array("theora".utf8))) != nil ? "video/ogg" : nil
        }
        if starts([0x1A, 0x45, 0xDF, 0xA3]) {
            return data.prefix(64).range(of: Data("webm".utf8)) != nil ? "video/webm" : "video/x-matroska"
        }
        if ascii(0, 2) == "BM" { return "image/bmp" }
        if starts([0x00, 0x00, 0x01, 0x00]) { return "image/x-icon" }
        let text = String(decoding: b, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if (text.hasPrefix("<svg") || text.hasPrefix("<?xml")) && text.contains("<svg") { return "image/svg+xml" }
        return nil
    }

    private static func wanted(_ type: String, _ media: Media) -> Bool {
        media == .all || (media == .video) == type.hasPrefix("video/")
    }
}

// MARK: - 페이지에 있는 요소 묶음 (일반 페이지의 "찾을 요소" 고르기)

/// 페이지에서 같은 모양으로 반복되는 이미지·영상 묶음 하나. selector 로 그대로 받을 수 있다.
struct ElementGroup: Identifiable, Hashable, Sendable {
    let selector: String
    let isVideo: Bool
    /// 이 묶음으로 받게 될 파일 수 (영상은 영상 요소 수)
    let count: Int
    /// 미리보기용 주소 몇 개 (영상은 포스터 이미지)
    let previews: [URL]
    /// "페이지의 모든 이미지/영상"
    let isEverything: Bool

    var id: String { selector }
}

extension Collector {
    private static let maxGroups = 16
    /// 상태에 따라 붙었다 떨어지는 클래스는 묶음 이름에 쓰지 않는다
    private static let unstableClasses: Set<String> = [
        "lazy", "lazyload", "lazyloaded", "lazyloading", "loaded", "loading", "active", "on", "selected",
        "show", "hide", "hidden", "visible", "current", "is-active", "is-loaded",
    ]

    /// 페이지 안의 이미지·영상을 "태그.클래스" 모양이 같은 것끼리 묶는다.
    /// 묶음마다 만든 선택자를 실제 받기와 같은 규칙(mediaURLs)으로 다시 돌려 개수·미리보기를 정확히 맞춘다.
    static func scanElements(html: String, pageURL: URL) throws -> [ElementGroup] {
        let doc = try SwiftSoup.parse(html, pageURL.absoluteString)
        let base = baseURL(doc, pageURL)

        var signatures: [String] = []
        var kinds: [String: Bool] = [:]
        for el in try doc.select("img, video, [style*=url]") {
            let tag = el.tagName()
            if tag == "img", isPixel(el) { continue }
            if tag != "img", tag != "video", urlsFromTag(el).isEmpty { continue }
            let sig = signature(el)
            if kinds[sig] == nil {
                signatures.append(sig)
                kinds[sig] = tag == "video"
            }
        }

        func group(_ selector: String, video: Bool, everything: Bool) -> (ElementGroup, Set<String>)? {
            guard let urls = try? mediaURLs(in: doc, base: base, selector: selector), !urls.isEmpty else { return nil }
            let count: Int
            let previews: [URL]
            if video {
                let videos = (try? doc.select(selector).array()) ?? []
                count = videos.count
                previews = videos.compactMap { try? $0.attr("poster") }.compactMap { resolve($0, base: base) }
            } else {
                count = urls.count
                // 한 요소가 큰·작은 주소를 같이 갖는 경우가 많아 미리보기는 요소마다 한 장만
                var shown = Set<String>()
                var firsts: [URL] = []
                for el in (try? doc.select(selector).array()) ?? [] {
                    let inner = (try? el.select(innerMedia).array()) ?? []
                    let first = ([el] + inner).flatMap(urlsFromTag).lazy.compactMap { resolve($0, base: base) }.first
                    if let first, shown.insert(first.absoluteString).inserted { firsts.append(first) }
                    if firsts.count >= 4 { break }
                }
                previews = firsts
            }
            let g = ElementGroup(
                selector: selector, isVideo: video, count: count, previews: Array(previews.prefix(4)), isEverything: everything
            )
            return (g, Set(urls.map(\.absoluteString)))
        }

        var result: [ElementGroup] = []
        var seen: [Set<String>] = []
        for (selector, video) in [("img", false), ("video", true)] {
            if let (g, urls) = group(selector, video: video, everything: true) {
                result.append(g)
                seen.append(urls)
            }
        }
        var specific: [ElementGroup] = []
        for sig in signatures where sig != "img" && sig != "video" {
            guard let (g, urls) = group(sig, video: kinds[sig] ?? false, everything: false), !seen.contains(urls) else { continue }
            seen.append(urls)
            specific.append(g)
        }
        // 많이 나오는 묶음이 위로 (같으면 페이지 순서)
        let ordered = specific.enumerated().sorted { a, b in
            a.element.count != b.element.count ? a.element.count > b.element.count : a.offset < b.offset
        }.map(\.element)
        return result + ordered.prefix(maxGroups)
    }

    /// 1x1 추적 픽셀 같은 것
    private static func isPixel(_ el: Element) -> Bool {
        let w = Int((try? el.attr("width")) ?? "") ?? .max
        let h = Int((try? el.attr("height")) ?? "") ?? .max
        return w <= 2 || h <= 2
    }

    /// "img.emoticon", 클래스가 없으면 클래스가 있는 조상을 붙여 "div.thumb img"
    private static func signature(_ el: Element) -> String {
        let own = part(el)
        if own.contains(".") { return own }
        var ancestor = el.parent()
        var depth = 0
        while let a = ancestor, depth < 3, a.tagName() != "body", a.tagName() != "html" {
            let p = part(a)
            if p.contains(".") { return "\(p) \(own)" }
            ancestor = a.parent()
            depth += 1
        }
        return own
    }

    private static func part(_ el: Element) -> String {
        let classes = ((try? el.classNames()) ?? []).filter(isUsableClass).sorted().prefix(2)
        return el.tagName() + classes.map { ".\($0)" }.joined()
    }

    private static func isUsableClass(_ name: String) -> Bool {
        name.count <= 40 && !unstableClasses.contains(name.lowercased())
            && name.wholeMatch(of: /-?[A-Za-z_][A-Za-z0-9_-]*/) != nil
    }
}

// MARK: - 자바스크립트로 그리는 페이지

/// 화면에 보이지 않는 WKWebView 로 페이지를 열어 끝까지 스크롤한 뒤 HTML 을 꺼낸다.
@MainActor
final class PageRenderer: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private var continuation: CheckedContinuation<Void, Error>?

    private override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        webView.customUserAgent = Collector.userAgent
        super.init()
        webView.navigationDelegate = self
    }

    static func render(_ url: URL) async throws -> (String, URL) {
        let renderer = PageRenderer()
        return try await renderer.load(url)
    }

    private func load(_ url: URL) async throws -> (String, URL) {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            continuation = c
            webView.load(URLRequest(url: url, timeoutInterval: 20))
        }
        // lazy-load 이미지를 깨우기 위해 끝까지 스크롤
        _ = try? await webView.callAsyncJavaScript(
            """
            for (let y = 0; y < document.body.scrollHeight; y += innerHeight) {
                scrollTo(0, y); await new Promise(r => setTimeout(r, 150));
            }
            await new Promise(r => setTimeout(r, 500));
            """,
            contentWorld: .page
        )
        let html = try await webView.evaluateJavaScript("document.documentElement.outerHTML") as? String ?? ""
        return (html, webView.url ?? url)
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated { finish(nil) }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { finish(error) }
    }

    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { finish(error) }
    }

    private func finish(_ error: Error?) {
        guard let c = continuation else { return }
        continuation = nil
        if let error { c.resume(throwing: CollectError(message: "페이지를 열지 못했습니다: \(error.localizedDescription)")) }
        else { c.resume() }
    }
}
