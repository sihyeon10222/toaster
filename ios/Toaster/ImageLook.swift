import CoreGraphics
import Foundation
import ImageIO

/// 그림의 "생김새": 크기와 9x8 흑백으로 줄인 차이 해시(dHash).
/// 같은 그림이 크기만 다르게(썸네일·원본, 1x·2x) 여러 번 나오면 가장 큰 것만 남기는 데 쓴다.
/// 크기가 같은 그림끼리는 절대 합치지 않는다 (비슷하게 생긴 이모티콘 여러 개를 지우지 않도록).
struct ImageLook: Sendable {
    let width: Int
    let height: Int
    let hash: UInt64

    /// 해시가 이만큼까지 달라도 같은 그림으로 본다 (줄일 때 생기는 차이)
    private static let maxDistance = 5

    init?(_ data: Data) {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int,
              w > 0, h > 0
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 64,
        ]
        guard let small = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let hash = Self.dHash(small)
        else { return nil }
        width = w
        height = h
        self.hash = hash
    }

    /// 9x8 흑백으로 줄여 옆 칸끼리 밝기를 비교한 64비트. 투명한 곳은 흰 바탕으로 본다.
    private static func dHash(_ image: CGImage) -> UInt64? {
        let w = 9, h = 8
        var pixels = [UInt8](repeating: 255, count: w * h)
        let ok = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let ctx = CGContext(
                data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            ctx.setFillColor(gray: 1, alpha: 1)
            ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
            ctx.interpolationQuality = .medium
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard ok else { return nil }
        var hash: UInt64 = 0
        for y in 0..<h {
            for x in 0..<(w - 1) {
                hash <<= 1
                if pixels[y * w + x] > pixels[y * w + x + 1] { hash |= 1 }
            }
        }
        return hash
    }

    private var pixels: Int { width * height }

    /// 크기만 다른 같은 그림인지: 해시가 거의 같고, 가로세로 비율이 같고, 크기는 다르다
    func isResized(_ other: ImageLook) -> Bool {
        guard width != other.width || height != other.height else { return false }
        let ratio = Double(width) / Double(height), otherRatio = Double(other.width) / Double(other.height)
        guard abs(ratio - otherRatio) / max(ratio, otherRatio) < 0.03 else { return false }
        return (hash ^ other.hash).nonzeroBitCount <= Self.maxDistance
    }

    /// 같은 그림 무리마다 가장 큰 것 하나만 남기고, 지울 번호들을 돌려준다
    static func smallerDuplicates(_ looks: [ImageLook?]) -> [Int] {
        var keep: [Int] = []  // 지금까지 남긴 그림의 번호
        var drop: [Int] = []
        for (index, look) in looks.enumerated() {
            guard let look else { continue }
            if let k = keep.firstIndex(where: { looks[$0]!.isResized(look) }) {
                let kept = keep[k]
                if look.pixels > looks[kept]!.pixels {
                    drop.append(kept)
                    keep[k] = index
                } else {
                    drop.append(index)
                }
            } else {
                keep.append(index)
            }
        }
        return drop
    }
}
