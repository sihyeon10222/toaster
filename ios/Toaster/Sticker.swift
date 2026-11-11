import Foundation

/// 텔레그램 스티커 변환. VP9 WEBM 은 애플 기기에서 만들 수 없어서(인코더가 없음)
/// 웹을 올려 둔 서버(Vercel)의 `/api/telegram` 에 맡긴다. 맥북이 꺼져 있어도 된다.
/// 팩 썸네일도 같이 만든다: 첫 번째 이미지(GIF 포함, 없으면 첫 파일) → thumbnail.png 또는 움직이면 thumbnail.webm
enum Sticker {
    static var server: URL {
        #if DEBUG
        // 개발용: `-stickerServer http://localhost:3000` 으로 로컬 웹 서버에 붙는다 (출시 빌드에는 없음)
        if let raw = UserDefaults.standard.string(forKey: "stickerServer"), let url = URL(string: raw) { return url }
        #endif
        return URL(string: "https://toaster-six.vercel.app")!
    }
    private static let concurrency = 3

    /// 파일들을 순서대로 변환해 임시 폴더에 `1.webm`, `2.png` … 로 쓴다 (형식과 상관없이 성공한 것만 1부터).
    /// 마지막에 팩 썸네일 `thumbnail.png` / `thumbnail.webm` 을 붙인다. progress 는 썸네일까지 files.count + 1 단계.
    static func convert(
        _ files: [CollectedFile], referer: String, server: URL,
        progress: @MainActor @Sendable (Int) -> Void
    ) async -> (files: [(name: String, source: URL)], errors: [String]) {
        let folder = FileManager.default.temporaryDirectory.appending(path: "sticker-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        var results = [(data: Data, ext: String)?](repeating: nil, count: files.count)
        var errors: [String] = []
        var done = 0

        await withTaskGroup(of: (Int, Result<(Data, String), Error>).self) { group in
            var next = 0
            func addNext() {
                guard next < files.count else { return }
                let index = next, file = files[index]
                next += 1
                group.addTask { (index, await Result { try await convertOne(file, referer: referer, server: server, thumb: false) }) }
            }
            for _ in 0..<concurrency { addNext() }
            for await (index, result) in group {
                switch result {
                case .success(let (data, ext)): results[index] = (data, ext)
                case .failure(let error): errors.append("\(files[index].filename): \(error.localizedDescription)")
                }
                done += 1
                await progress(done)
                addNext()
            }
        }

        var out: [(name: String, source: URL)] = []
        for item in results.compactMap({ $0 }) {
            let name = "\(out.count + 1).\(item.ext)"
            let file = folder.appending(path: name)
            if (try? item.data.write(to: file)) != nil { out.append((name, file)) }
        }

        // 썸네일: 스티커로 바뀐 것 중 첫 번째 이미지(GIF 포함). 이미지가 하나도 없으면 첫 파일(영상)
        let usable = files.indices.filter { results[$0] != nil }.map { files[$0] }
        if let source = usable.first(where: { !$0.isVideo }) ?? usable.first {
            do {
                let (data, ext) = try await convertOne(source, referer: referer, server: server, thumb: true)
                let file = folder.appending(path: "thumbnail.\(ext)")
                try data.write(to: file)
                out.append(("thumbnail.\(ext)", file))
            } catch {
                errors.append("썸네일(\(source.filename)): \(error.localizedDescription)")
            }
        }
        await progress(files.count + 1)
        return (out, errors)
    }

    private static func convertOne(
        _ file: CollectedFile, referer: String, server: URL, thumb: Bool
    ) async throws -> (Data, String) {
        var components = URLComponents(url: server.appending(path: "api/telegram"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "url", value: file.sourceURL.absoluteString),
            URLQueryItem(name: "referer", value: referer),
        ] + (thumb ? [URLQueryItem(name: "thumb", value: "1")] : [])
        guard let url = components.url else { throw CollectError(message: "서버 주소가 잘못됐습니다") }
        let data: Data, response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 150))
        } catch {
            throw CollectError(message: "변환 서버에 연결하지 못했습니다")
        }
        guard let http = response as? HTTPURLResponse else { throw CollectError(message: "응답이 없습니다") }
        guard http.statusCode == 200 else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw CollectError(message: message ?? "HTTP \(http.statusCode)")
        }
        guard let ext = http.value(forHTTPHeaderField: "X-Sticker-Ext"), ["png", "webp", "webm"].contains(ext) else {
            throw CollectError(message: "변환 서버 주소가 맞는지 확인해 주세요")
        }
        // 썸네일을 모르는 예전 서버는 512px 스티커를 돌려주므로 받지 않는다
        if thumb, http.value(forHTTPHeaderField: "X-Sticker-Kind") != "thumbnail" {
            throw CollectError(message: "변환 서버가 썸네일을 지원하지 않습니다. 웹을 다시 배포해 주세요")
        }
        return (data, ext)
    }
}
