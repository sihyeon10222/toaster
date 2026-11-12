import AVFoundation
import CommonCrypto
import Foundation
import JavaScriptCore

// 스트리밍 영상(HLS, .m3u8)을 받아 mp4 한 파일로 만든다. 기기 안에서 모두 한다. (웹의 lib/hls.ts 와 같은 규칙)
//
//   1) 재생 목록을 읽는다. 화질 목록(master)이면 가장 큰 화질을 고르고, 소리가 따로 있으면 소리 목록도 고른다.
//   2) 조각(segment)을 차례대로 받는다. AES-128 로 잠긴 조각은 목록에 적힌 열쇠로 푼다.
//      그 밖의 잠금(SAMPLE-AES, FairPlay 같은 DRM)은 받지 않는다.
//   3) 조각이 fMP4 면 그대로 잇고, MPEG-TS 면 mux.js(JavaScriptCore 안에서 실행)로 fMP4 로 바꿔 잇는다.
//   4) AVFoundation 으로 영상·소리를 한 파일에 담아 보통 mp4 로 다시 쓴다 (사진 앱·다른 앱이 잘 읽게).
//
// 재생 목록 규칙: RFC 8216 (https://datatracker.ietf.org/doc/html/rfc8216)

enum HLS {
    /// "찾을 요소" 대신 쓰는 이름표: 페이지 속 스트리밍 영상(.m3u8) 또는 붙여 넣은 .m3u8 주소 자체
    static let token = ":stream-video"

    private static let concurrency = 6
    private static let maxSegments = 20_000
    private static let maxBytes: Int64 = 4 * 1024 * 1024 * 1024

    /// 받은 내용이 HLS 재생 목록인가
    static func isPlaylist(_ data: Data) -> Bool {
        var text = String(decoding: data.prefix(64), as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("#EXTM3U")
    }

    /// 선택자에서 이름표를 떼어 낸다. (CSS 선택자 부분, 이름표가 있었는지)
    static func split(_ selector: String) -> (css: String, streams: Bool) {
        let parts = selector.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        let css = parts.filter { $0 != token && !$0.isEmpty }.joined(separator: ", ")
        return (css, parts.contains(token))
    }

    /// 페이지 HTML·스크립트 안에 적힌 .m3u8 주소들 (자바스크립트 플레이어가 쓰는 주소도 잡는다)
    static func urls(inPage html: String, pageURL: URL) -> [URL] {
        let text = html.replacingOccurrences(of: "\\/", with: "/")
            .replacingOccurrences(of: "\\u002F", with: "/", options: .caseInsensitive)
            .replacingOccurrences(of: "&amp;", with: "&")
        var seen = Set<String>()
        var found: [URL] = []
        for m in text.matches(of: /https?:\/\/[^\s"'<>\\()\[\]{}]+?\.m3u8(?:\?[^\s"'<>\\()\[\]{}]*)?/) {
            let raw = String(m.output)
            guard let url = URL(string: raw), seen.insert(raw).inserted else { continue }
            found.append(url)
            if found.count >= 20 { break }
        }
        return found
    }

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: 받기

    /// 재생 목록(이미 받은 내용 first)을 받아 mp4 로 만들어 destination 에 쓴다.
    /// progress(끝낸 조각 수, 전체 조각 수) 는 조각을 받을 때마다 부른다.
    static func download(
        _ url: URL, first: Data, referer: URL, to destination: URL,
        progress: @escaping @Sendable (Int, Int) async -> Void
    ) async throws {
        let work = FileManager.default.temporaryDirectory.appending(path: "hls-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: work) }

        // 1) 재생 목록
        var video = (url: url, text: String(decoding: first, as: UTF8.self))
        var audio: (url: URL, text: String)?
        if Playlist.isMaster(video.text) {
            let master = Playlist.master(video.text, base: url)
            guard let best = master.variants.max(by: { ($0.pixels, $0.bandwidth) < ($1.pixels, $1.bandwidth) }) else {
                throw Failure(message: "재생 목록에 영상이 없습니다.")
            }
            video = (best.url, try await text(best.url, referer: referer))
            if let group = best.audio,
               let rendition = master.audio.filter({ $0.group == group }).sorted(by: { $0.isDefault && !$1.isDefault }).first,
               let audioURL = rendition.url {
                audio = (audioURL, try await text(audioURL, referer: referer))
            }
        }
        let videoList = try Playlist.media(video.text, base: video.url)
        let audioList = try audio.map { try Playlist.media($0.text, base: $0.url) }

        let total = videoList.segments.count + (audioList?.segments.count ?? 0)
        guard total > 0 else { throw Failure(message: "재생 목록에 영상 조각이 없습니다.") }
        guard total <= maxSegments else { throw Failure(message: "영상이 너무 깁니다.") }
        let counter = Counter(total: total, report: progress)
        await counter.start()

        // 2)·3) 조각을 받아 fMP4 파일로 잇는다
        let videoFile = work.appending(path: "video.mp4")
        try await fetch(videoList, referer: referer, into: videoFile, counter: counter)
        var audioFile: URL?
        if let audioList {
            let file = work.appending(path: "audio.mp4")
            try await fetch(audioList, referer: referer, into: file, counter: counter)
            audioFile = file
        }

        // 4) 보통 mp4 로
        try? FileManager.default.removeItem(at: destination)
        try await finish(video: videoFile, audio: audioFile, to: destination)
    }

    private static func text(_ url: URL, referer: URL) async throws -> String {
        let (data, _) = try await Collector.load(Collector.request(url, referer: referer))
        guard isPlaylist(data) else { throw Failure(message: "재생 목록(m3u8)이 아닙니다.") }
        return String(decoding: data, as: UTF8.self)
    }

    /// 조각을 동시에 몇 개씩 받되 파일에는 순서대로 쓴다.
    private static func fetch(_ list: Playlist.Media, referer: URL, into file: URL, counter: Counter) async throws {
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        let keys = KeyStore(referer: referer)
        var written: Int64 = 0
        var transmuxer: Transmuxer?
        var container: Container?

        func write(_ data: Data) throws {
            written += Int64(data.count)
            guard written <= maxBytes else { throw Failure(message: "영상이 너무 큽니다.") }
            try handle.write(contentsOf: data)
        }

        // fMP4 는 조각 앞에 붙는 초기화 조각(EXT-X-MAP)이 있다
        var lastMap: Playlist.Range?
        try await withThrowingTaskGroup(of: (Int, Data).self) { group in
            var next = 0
            var ready: [Int: Data] = [:]
            var expected = 0
            func addNext() {
                guard next < list.segments.count else { return }
                let index = next, segment = list.segments[index]
                next += 1
                group.addTask {
                    var data = try await bytes(segment.part, referer: referer)
                    if let key = segment.key { data = try await keys.decrypt(data, key: key) }
                    return (index, data)
                }
            }
            for _ in 0..<concurrency { addNext() }

            while let (index, data) = try await group.next() {
                try Task.checkCancellation()
                ready[index] = data
                while let data = ready.removeValue(forKey: expected) {
                    let segment = list.segments[expected]
                    if container == nil {
                        container = segment.map != nil || Container.isFragmentedMP4(data) ? .fmp4 : .ts
                        if container == .ts { transmuxer = try Transmuxer() }
                    }
                    switch container! {
                    case .fmp4:
                        if let map = segment.map, map != lastMap {
                            var initData = try await bytes(map, referer: referer)
                            if let key = segment.key, segment.mapEncrypted { initData = try await keys.decrypt(initData, key: key) }
                            try write(initData)
                            lastMap = map
                        }
                        try write(data)
                    case .ts:
                        try write(try transmuxer!.push(data))
                    }
                    expected += 1
                    await counter.tick()
                }
                addNext()
            }
        }
    }

    private static func bytes(_ part: Playlist.Range, referer: URL) async throws -> Data {
        var req = Collector.request(part.url, referer: referer)
        req.timeoutInterval = 60
        if let range = part.bytes { req.setValue("bytes=\(range.lowerBound)-\(range.upperBound - 1)", forHTTPHeaderField: "Range") }
        let (data, response) = try await Collector.load(req)
        // Range 를 무시하고 파일 전체를 준 서버면 필요한 부분만 자른다
        if let range = part.bytes, (response as? HTTPURLResponse)?.statusCode == 200, data.count >= range.upperBound {
            return data.subdata(in: range)
        }
        return data
    }

    /// 영상(과 따로 받은 소리)을 보통 mp4 하나로 다시 쓴다. 다시 쓰지 못하면 이어 붙인 파일을 그대로 쓴다.
    private static func finish(video: URL, audio: URL?, to destination: URL) async throws {
        let videoAsset = AVURLAsset(url: video)
        let source: AVAsset
        if let audio {
            let composition = AVMutableComposition()
            let audioAsset = AVURLAsset(url: audio)
            let duration = try await videoAsset.load(.duration)
            for (asset, type) in [(videoAsset, AVMediaType.video), (AVURLAsset(url: video), .audio), (audioAsset, .audio)] {
                // 영상 파일에 소리가 이미 있으면 따로 받은 소리는 넣지 않는다
                if asset === audioAsset, !(try await composition.loadTracks(withMediaType: .audio)).isEmpty { continue }
                for track in try await asset.loadTracks(withMediaType: type) {
                    let range = try await track.load(.timeRange)
                    let target = composition.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)
                    try target?.insertTimeRange(
                        CMTimeRange(start: range.start, duration: min(range.duration, duration)), of: track, at: .zero
                    )
                }
            }
            source = composition
        } else {
            source = videoAsset
        }

        if let session = AVAssetExportSession(asset: source, presetName: AVAssetExportPresetPassthrough) {
            session.shouldOptimizeForNetworkUse = true
            do {
                try await session.export(to: destination, as: .mp4)
                return
            } catch {
                try? FileManager.default.removeItem(at: destination)
            }
        }
        guard audio == nil else { throw Failure(message: "영상과 소리를 합치지 못했습니다.") }
        try FileManager.default.moveItem(at: video, to: destination)
    }

    private enum Container {
        case fmp4, ts

        /// 첫 상자가 ftyp/styp/moof/sidx 면 fMP4
        static func isFragmentedMP4(_ data: Data) -> Bool {
            guard data.count >= 8 else { return false }
            let type = String(decoding: data[data.startIndex + 4 ..< data.startIndex + 8], as: UTF8.self)
            return ["ftyp", "styp", "moof", "sidx", "moov"].contains(type)
        }
    }
}

// MARK: - 재생 목록 읽기

enum Playlist {
    struct Range: Equatable, Sendable {
        let url: URL
        let bytes: Swift.Range<Int>?
    }

    struct Key: Equatable, Sendable {
        let url: URL
        let iv: Data?
        let sequence: Int
    }

    struct Segment: Sendable {
        let part: Range
        let key: Key?
        let map: Range?
        /// 초기화 조각도 같은 열쇠로 잠겨 있다 (EXT-X-MAP 이 EXT-X-KEY 뒤에 나온 경우)
        let mapEncrypted: Bool
    }

    struct Media: Sendable {
        let segments: [Segment]
    }

    struct Variant {
        let url: URL
        let bandwidth: Int
        let pixels: Int
        let audio: String?
    }

    struct Rendition {
        let group: String
        let url: URL?
        let isDefault: Bool
    }

    static func isMaster(_ text: String) -> Bool { text.contains("#EXT-X-STREAM-INF") }

    private static func lines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// `KEY=VALUE,KEY="VALUE, 쉼표 포함"` 꼴 속성
    static func attributes(_ line: Substring) -> [String: String] {
        var result: [String: String] = [:]
        for m in line.matches(of: /([A-Z0-9-]+)=("[^"]*"|[^,]*)/) {
            var value = String(m.output.2)
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 { value = String(value.dropFirst().dropLast()) }
            result[String(m.output.1)] = value
        }
        return result
    }

    private static func after(_ line: String, _ tag: String) -> Substring? {
        line.hasPrefix(tag) ? line.dropFirst(tag.count) : nil
    }

    static func master(_ text: String, base: URL) -> (variants: [Variant], audio: [Rendition]) {
        var variants: [Variant] = []
        var audio: [Rendition] = []
        var pending: [String: String]?
        for line in lines(text) {
            if let rest = after(line, "#EXT-X-STREAM-INF:") {
                pending = attributes(rest)
            } else if let rest = after(line, "#EXT-X-MEDIA:") {
                let a = attributes(rest)
                guard a["TYPE"] == "AUDIO", let group = a["GROUP-ID"] else { continue }
                audio.append(Rendition(group: group, url: a["URI"].flatMap { URL(string: $0, relativeTo: base)?.absoluteURL },
                                       isDefault: a["DEFAULT"] == "YES"))
            } else if !line.hasPrefix("#"), let a = pending {
                pending = nil
                guard let url = URL(string: line, relativeTo: base)?.absoluteURL else { continue }
                let size = (a["RESOLUTION"] ?? "").split(separator: "x").compactMap { Int($0) }
                variants.append(Variant(
                    url: url, bandwidth: Int(a["BANDWIDTH"] ?? "") ?? 0,
                    pixels: size.count == 2 ? size[0] * size[1] : 0, audio: a["AUDIO"]
                ))
            }
        }
        return (variants, audio)
    }

    static func media(_ text: String, base: URL) throws -> Media {
        let all = lines(text)
        let ended = all.contains("#EXT-X-ENDLIST") || all.contains { $0.hasPrefix("#EXT-X-PLAYLIST-TYPE:VOD") }
        guard ended else { throw HLS.Failure(message: "실시간 방송은 받을 수 없습니다. 다 올라온 영상만 받을 수 있습니다.") }

        var segments: [Segment] = []
        var sequence = 0
        var key: Key?
        var map: Range?
        var mapEncrypted = false
        var range: (length: Int, offset: Int?)?
        var lastEnd: [URL: Int] = [:]

        func byteRange(_ spec: String) -> (length: Int, offset: Int?)? {
            let parts = spec.split(separator: "@")
            guard let length = Int(parts.first ?? "") else { return nil }
            return (length, parts.count > 1 ? Int(parts[1]) : nil)
        }

        for line in all {
            if let rest = after(line, "#EXT-X-MEDIA-SEQUENCE:") {
                sequence = Int(rest) ?? 0
            } else if let rest = after(line, "#EXT-X-KEY:") {
                let a = attributes(rest)
                let method = a["METHOD"] ?? "NONE"
                if method == "NONE" {
                    key = nil
                } else if method == "AES-128", (a["KEYFORMAT"] ?? "identity") == "identity",
                          let uri = a["URI"], let url = URL(string: uri, relativeTo: base)?.absoluteURL {
                    key = Key(url: url, iv: a["IV"].flatMap(hex), sequence: 0)
                } else {
                    throw HLS.Failure(message: "DRM 으로 잠긴 영상이라 받을 수 없습니다.")
                }
            } else if let rest = after(line, "#EXT-X-MAP:") {
                let a = attributes(rest)
                guard let uri = a["URI"], let url = URL(string: uri, relativeTo: base)?.absoluteURL else { continue }
                let r = a["BYTERANGE"].flatMap(byteRange)
                map = Range(url: url, bytes: r.map { ($0.offset ?? 0) ..< ($0.offset ?? 0) + $0.length })
                mapEncrypted = key != nil
            } else if let rest = after(line, "#EXT-X-BYTERANGE:") {
                range = byteRange(String(rest))
            } else if !line.hasPrefix("#") {
                guard let url = URL(string: line, relativeTo: base)?.absoluteURL else { continue }
                var bytes: Swift.Range<Int>?
                if let r = range {
                    let start = r.offset ?? lastEnd[url] ?? 0
                    bytes = start ..< start + r.length
                    lastEnd[url] = start + r.length
                }
                let segmentKey = key.map { Key(url: $0.url, iv: $0.iv, sequence: sequence) }
                segments.append(Segment(part: Range(url: url, bytes: bytes), key: segmentKey, map: map, mapEncrypted: mapEncrypted))
                sequence += 1
                range = nil
            }
        }
        return Media(segments: segments)
    }

    private static func hex(_ text: String) -> Data? {
        var s = Substring(text)
        if s.lowercased().hasPrefix("0x") { s = s.dropFirst(2) }
        var data = Data()
        var i = s.startIndex
        while i < s.endIndex {
            let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) ?? s.endIndex
            guard let byte = UInt8(s[i..<j], radix: 16) else { return nil }
            data.append(byte)
            i = j
        }
        // 짧게 적힌 IV 는 앞을 0 으로 채운다
        return data.count <= 16 ? Data(repeating: 0, count: 16 - data.count) + data : nil
    }
}

// MARK: - AES-128 풀기

/// 같은 열쇠를 여러 번 받지 않도록 기억해 둔다
private actor KeyStore {
    let referer: URL
    private var cache: [URL: Data] = [:]

    init(referer: URL) { self.referer = referer }

    func decrypt(_ data: Data, key: Playlist.Key) async throws -> Data {
        let secret: Data
        if let cached = cache[key.url] {
            secret = cached
        } else {
            let (fetched, _) = try await Collector.load(Collector.request(key.url, referer: referer))
            guard fetched.count == 16 else { throw HLS.Failure(message: "영상 잠금 열쇠를 받지 못했습니다.") }
            cache[key.url] = fetched
            secret = fetched
        }
        // IV 가 없으면 조각 번호(EXT-X-MEDIA-SEQUENCE 부터 센 값)를 16바이트 big-endian 으로 쓴다
        let iv = key.iv ?? {
            var bytes = [UInt8](repeating: 0, count: 16)
            var n = UInt64(key.sequence)
            for i in stride(from: 15, through: 8, by: -1) {
                bytes[i] = UInt8(n & 0xFF)
                n >>= 8
            }
            return Data(bytes)
        }()
        return try Self.aes128(data, key: secret, iv: iv)
    }

    private static func aes128(_ data: Data, key: Data, iv: Data) throws -> Data {
        var out = Data(count: data.count + kCCBlockSizeAES128)
        let capacity = out.count
        var moved = 0
        let status = out.withUnsafeMutableBytes { o in
            data.withUnsafeBytes { d in
                key.withUnsafeBytes { k in
                    iv.withUnsafeBytes { v in
                        CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                                k.baseAddress, key.count, v.baseAddress, d.baseAddress, data.count,
                                o.baseAddress, capacity, &moved)
                    }
                }
            }
        }
        guard status == kCCSuccess else { throw HLS.Failure(message: "잠긴 영상 조각을 풀지 못했습니다.") }
        return out.prefix(moved)
    }
}

// MARK: - 진행 상황

private actor Counter {
    let total: Int
    let report: @Sendable (Int, Int) async -> Void
    private var done = 0

    init(total: Int, report: @escaping @Sendable (Int, Int) async -> Void) {
        self.total = total
        self.report = report
    }

    func start() async { await report(0, total) }

    func tick() async {
        done += 1
        await report(done, total)
    }
}

// MARK: - MPEG-TS → fMP4 (mux.js)

/// mux.js 를 JavaScriptCore 안에서 돌린다. 웹도 같은 라이브러리를 쓴다.
/// 한 영상의 조각은 하나의 Transmuxer 에 차례대로 넣어야 시간이 이어진다.
private final class Transmuxer {
    private let context: JSContext
    private let feed: JSValue

    init() throws {
        guard let url = Bundle.main.url(forResource: "mux.min", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8),
              let context = JSContext()
        else { throw HLS.Failure(message: "영상 변환기를 불러오지 못했습니다.") }
        var failure: String?
        context.exceptionHandler = { _, error in failure = error?.toString() }
        context.evaluateScript("var window = this; var self = this;")
        context.evaluateScript(source)
        // mux.js 출력은 브라우저 재생(MSE)용이라 파일로 쓰려면 두 군데를 고쳐야 한다 (웹 lib/hls.ts 와 같은 처리):
        //  - 초기화 상자의 길이가 0xFFFFFFFF(모름) → 0(조각에서 계산)
        //  - 영상·소리 조각 번호(mfhd)가 따로 1부터 → 파일 전체에서 차례대로 (AVFoundation 이 첫 조각만 읽는 문제)
        context.evaluateScript("""
        var pending = [], wroteInit = false, sequence = 0, transmuxer = new muxjs.mp4.Transmuxer();
        function boxes(b, start, end, visit) {
          var v = new DataView(b.buffer, b.byteOffset, b.byteLength), i = start;
          while (i + 8 <= end) {
            var size = v.getUint32(i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
            if (size < 8 || i + size > end) return;
            visit(type, i, size, v);
            i += size;
          }
        }
        function zero(b, at, n) { for (var k = 0; k < n; k++) b[at + k] = 0; }
        function clearDurations(b, start, end) {
          boxes(b, start, end, function (type, i, size) {
            var ver = b[i + 8];
            if (type === 'moov' || type === 'trak' || type === 'mdia' || type === 'mvex') clearDurations(b, i + 8, i + size);
            else if (type === 'mvhd' || type === 'mdhd') zero(b, i + (ver === 1 ? 32 : 24), ver === 1 ? 8 : 4);
            else if (type === 'tkhd') zero(b, i + (ver === 1 ? 36 : 28), ver === 1 ? 8 : 4);
            else if (type === 'mehd') zero(b, i + 12, ver === 1 ? 8 : 4);
          });
          return b;
        }
        function renumber(b) {
          boxes(b, 0, b.length, function (type, i, size, v) { if (type === 'moof') v.setUint32(i + 20, ++sequence); });
          return b;
        }
        transmuxer.on('data', function (segment) {
          if (!wroteInit) { pending.push(clearDurations(segment.initSegment, 0, segment.initSegment.length)); wroteInit = true; }
          pending.push(renumber(segment.data));
        });
        function feed(bytes) {
          transmuxer.push(bytes);
          transmuxer.flush();
          var parts = pending, size = 0, offset = 0;
          pending = [];
          parts.forEach(function (p) { size += p.length; });
          var all = new Uint8Array(size);
          parts.forEach(function (p) { all.set(p, offset); offset += p.length; });
          return all;
        }
        """)
        guard failure == nil, let feed = context.objectForKeyedSubscript("feed"), !feed.isUndefined else {
            throw HLS.Failure(message: "영상 변환기를 불러오지 못했습니다.")
        }
        self.context = context
        self.feed = feed
    }

    /// TS 조각 하나를 넣고 그만큼의 fMP4 를 돌려준다 (처음에는 초기화 상자 포함)
    func push(_ data: Data) throws -> Data {
        let ref = context.jsGlobalContextRef
        let buffer = UnsafeMutableRawPointer.allocate(byteCount: max(data.count, 1), alignment: 1)
        data.copyBytes(to: buffer.assumingMemoryBound(to: UInt8.self), count: data.count)
        let input = JSObjectMakeTypedArrayWithBytesNoCopy(
            ref, kJSTypedArrayTypeUint8Array, buffer, data.count, { bytes, _ in bytes?.deallocate() }, nil, nil
        )
        guard let input, let value = JSValue(jsValueRef: input, in: context),
              let result = feed.call(withArguments: [value]),
              let object = JSValueToObject(ref, result.jsValueRef, nil)
        else { throw HLS.Failure(message: "영상 조각을 바꾸지 못했습니다.") }
        let length = JSObjectGetTypedArrayByteLength(ref, object, nil)
        guard length > 0, let pointer = JSObjectGetTypedArrayBytesPtr(ref, object, nil) else { return Data() }
        return Data(bytes: pointer.advanced(by: JSObjectGetTypedArrayByteOffset(ref, object, nil)), count: length)
    }
}
