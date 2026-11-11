import AVFoundation
import ImageIO
import SwiftUI

// 움직이는 그림(GIF·WEBP·APNG)과 영상 미리보기. 파일에 "몇 번만 재생" 이 적혀 있어도 미리보기는 끝없이 반복한다.
// (웹의 lib/animation.ts 와 같은 동작. 저장하는 원본은 건드리지 않는다)

/// 줄인 장면들과 장면마다 보여 줄 시간
struct ImageFrames: @unchecked Sendable {
    let frames: [CGImage]
    let delays: [Double]
    let duration: Double

    var isAnimated: Bool { frames.count > 1 }

    init(single: CGImage) {
        frames = [single]
        delays = [1]
        duration = 1
    }

    private init(frames: [CGImage], delays: [Double]) {
        self.frames = frames
        self.delays = delays
        duration = delays.reduce(0, +)
    }

    private static let maxFrames = 150

    /// 이미지 바이트를 긴 변 maxPixel 로 줄여 장면별로 푼다. ImageIO 가 못 읽으면(SVG 등) nil.
    static func decode(_ data: Data, maxPixel: Int) -> ImageFrames? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let count = min(CGImageSourceGetCount(source), maxFrames)
        guard count > 0 else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        var frames: [CGImage] = []
        var delays: [Double] = []
        for i in 0..<count {
            guard let frame = CGImageSourceCreateThumbnailAtIndex(source, i, options as CFDictionary) else { continue }
            frames.append(frame)
            delays.append(delay(source, i))
        }
        guard let first = frames.first else { return nil }
        return frames.count > 1 ? ImageFrames(frames: frames, delays: delays) : ImageFrames(single: first)
    }

    /// 장면 시간. 0·10ms 이하는 브라우저처럼 100ms 로 본다.
    private static func delay(_ source: CGImageSource, _ index: Int) -> Double {
        let props = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any] ?? [:]
        let pairs: [(CFString, CFString, CFString)] = [
            (kCGImagePropertyGIFDictionary, kCGImagePropertyGIFUnclampedDelayTime, kCGImagePropertyGIFDelayTime),
            (kCGImagePropertyPNGDictionary, kCGImagePropertyAPNGUnclampedDelayTime, kCGImagePropertyAPNGDelayTime),
            (kCGImagePropertyWebPDictionary, kCGImagePropertyWebPUnclampedDelayTime, kCGImagePropertyWebPDelayTime),
        ]
        for (dict, unclamped, clamped) in pairs {
            guard let d = props[dict] as? [CFString: Any] else { continue }
            let value = (d[unclamped] as? Double) ?? (d[clamped] as? Double) ?? 0
            return value <= 0.01 ? 0.1 : value
        }
        return 0.1
    }

    /// 시각 t 에 보여 줄 장면 (전체 길이로 나눈 나머지 → 끝없이 반복)
    func frame(at t: TimeInterval) -> CGImage {
        guard isAnimated, duration > 0 else { return frames[0] }
        var rest = t.truncatingRemainder(dividingBy: duration)
        for (i, d) in delays.enumerated() {
            if rest < d { return frames[i] }
            rest -= d
        }
        return frames[frames.count - 1]
    }
}

/// 장면들을 시간에 맞춰 바꿔 그린다. 정지 그림이면 한 장만.
struct FramesView: View {
    let frames: ImageFrames
    var scale: CGFloat = 1

    var body: some View {
        if frames.isAnimated {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                image(frames.frame(at: context.date.timeIntervalSinceReferenceDate))
            }
        } else {
            image(frames.frames[0])
        }
    }

    private func image(_ cg: CGImage) -> some View {
        Image(decorative: cg, scale: scale).resizable().scaledToFit()
    }
}

// MARK: - 영상

/// 소리 없이 끝없이 반복하는 영상 (썸네일용, 조작 버튼 없음)
struct LoopingVideo: View {
    let url: URL
    @State private var looper: VideoLooper?

    var body: some View {
        PlayerLayerView(player: looper?.player)
            .background(Color.black)
            .onAppear {
                if looper == nil { looper = VideoLooper(url: url, muted: true) }
                looper?.player.play()
            }
            .onDisappear { looper?.player.pause() }
    }
}

/// AVPlayerLooper 는 살아 있는 동안만 반복시키므로 플레이어와 같이 들고 있는다.
@MainActor
final class VideoLooper {
    let player: AVQueuePlayer
    private let looper: AVPlayerLooper

    init(url: URL, muted: Bool) {
        let item = AVPlayerItem(url: url)
        player = AVQueuePlayer()
        player.isMuted = muted
        player.preventsDisplaySleepDuringVideoPlayback = false
        looper = AVPlayerLooper(player: player, templateItem: item)
    }
}

#if os(iOS)
private struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer?

    func makeUIView(context: Context) -> PlayerUIView { PlayerUIView() }

    func updateUIView(_ view: PlayerUIView, context: Context) {
        view.playerLayer.player = player
    }

    final class PlayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        override init(frame: CGRect) {
            super.init(frame: frame)
            playerLayer.videoGravity = .resizeAspect
            isUserInteractionEnabled = false
        }
        required init?(coder: NSCoder) { fatalError() }
    }
}
#else
private struct PlayerLayerView: NSViewRepresentable {
    let player: AVPlayer?

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        let layer = AVPlayerLayer()
        layer.videoGravity = .resizeAspect
        view.layer = layer
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        (view.layer as? AVPlayerLayer)?.player = player
    }
}
#endif
