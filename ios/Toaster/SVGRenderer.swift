import SwiftUI
import WebKit

/// SVG 미리보기. 애플 기기의 이미지 디코더(ImageIO)는 SVG 를 못 읽어서
/// 보이지 않는 WKWebView 안의 캔버스에 그려 PNG 로 받아 온다. 결과는 기억해 둔다.
@MainActor
final class SVGRenderer: NSObject, WKNavigationDelegate {
    static let shared = SVGRenderer()

    private var webView: WKWebView?
    private var ready: Task<Void, Never>?
    private var loaded: CheckedContinuation<Void, Never>?
    private let cache = NSCache<NSString, CGImageBox>()

    /// SVG 바이트를 pixels x pixels 칸에 비율을 지켜 그린 그림. 못 그리면 nil.
    func render(_ data: Data, pixels: Int) async -> CGImage? {
        let key = "\(data.hashValue)-\(pixels)" as NSString
        if let hit = cache.object(forKey: key) { return hit.image }
        let webView = await prepare()
        let script = """
            const img = new Image();
            img.src = src;
            await img.decode();
            // 크기 정보가 없는 SVG(viewBox 만 있음)는 칸을 꽉 채운다
            const w = img.naturalWidth || size, h = img.naturalHeight || size;
            const k = Math.min(size / w, size / h);
            const canvas = document.createElement("canvas");
            canvas.width = size; canvas.height = size;
            canvas.getContext("2d").drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
            return canvas.toDataURL("image/png");
            """
        let src = "data:image/svg+xml;base64," + data.base64EncodedString()
        guard let result = try? await webView.callAsyncJavaScript(
                  script, arguments: ["src": src, "size": pixels], contentWorld: .defaultClient
              ),
              let url = result as? String, let comma = url.firstIndex(of: ","),
              let png = Data(base64Encoded: String(url[url.index(after: comma)...])),
              let source = CGImageSourceCreateWithData(png as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }
        cache.setObject(CGImageBox(image), forKey: key)
        return image
    }

    /// 빈 페이지를 한 번 열어 둔 웹뷰 (스크립트만 돌리니 화면에 붙일 필요가 없다)
    private func prepare() async -> WKWebView {
        if let ready { await ready.value; return webView! }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 10, height: 10), configuration: config)
        view.navigationDelegate = self
        webView = view
        let task = Task { @MainActor in
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                self.loaded = c
                view.loadHTMLString("<!doctype html><title>svg</title>", baseURL: nil)
            }
        }
        ready = task
        await task.value
        return view
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated { finish() }
    }

    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        MainActor.assumeIsolated { finish() }
    }

    private func finish() {
        loaded?.resume()
        loaded = nil
    }
}

private final class CGImageBox {
    let image: CGImage
    init(_ image: CGImage) { self.image = image }
}

/// 받아 둔 파일(또는 바이트)을 보여 주는 그림. SVG 는 SVGRenderer 로, 나머지는 ImageIO 로 줄여 그린다.
struct LocalImage: View {
    let url: URL
    let isSVG: Bool
    /// 그릴 크기(포인트). 큰 그림을 원본 그대로 메모리에 올리지 않도록 줄여서 그린다.
    var side: CGFloat = 200
    var inset: CGFloat = 0

    @State private var image: CGImage?
    @State private var failed = false
    @Environment(\.displayScale) private var scale

    var body: some View {
        Group {
            if let image {
                Image(decorative: image, scale: scale).resizable().scaledToFit().padding(inset)
            } else if failed {
                Image(systemName: "photo").foregroundStyle(Color.tMuted)
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .task(id: url) {
            guard let data = try? Data(contentsOf: url) else { failed = true; return }
            let pixels = Int(side * scale)
            image = isSVG ? await SVGRenderer.shared.render(data, pixels: pixels) : Self.downsample(data, maxPixel: pixels)
            failed = image == nil
        }
    }

    nonisolated static func downsample(_ data: Data, maxPixel: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}
