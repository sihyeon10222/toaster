import Foundation

// toaster-server 응답 모델 (server의 app.py JobOut 과 맞춤)

enum JobStatus: String, Codable, Sendable {
    case pending, fetching, downloading, done, failed

    var label: String {
        switch self {
        case .pending: "대기 중"
        case .fetching: "페이지 읽는 중"
        case .downloading: "이미지 받는 중"
        case .done: "완료"
        case .failed: "실패"
        }
    }

    var isFinished: Bool { self == .done || self == .failed }
}

struct ToasterImage: Codable, Hashable, Identifiable, Sendable {
    let filename: String
    let url: URL
    let sourceUrl: String
    let contentType: String
    let size: Int

    var id: String { filename }
}

struct Job: Codable, Sendable {
    let id: String
    let url: String
    let selector: String
    let render: Bool
    let status: JobStatus
    let total: Int
    let processed: Int
    let images: [ToasterImage]
    let errors: [String]
    let error: String?
    let zipUrl: URL?
}

struct ToasterAPIError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct ToasterAPI: Sendable {
    let baseURL: URL

    static var defaultBaseURL: String {
        Bundle.main.object(forInfoDictionaryKey: "ToasterAPIURL") as? String ?? "http://127.0.0.1:8000"
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func createJob(url: String, selector: String, render: Bool) async throws -> Job {
        var request = URLRequest(url: baseURL.appending(path: "jobs"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["url": url, "selector": selector, "render": render])
        return try await send(request)
    }

    func job(id: String) async throws -> Job {
        try await send(URLRequest(url: baseURL.appending(path: "jobs/\(id)")))
    }

    /// 이미지·zip 같은 파일을 받는다.
    func data(from url: URL) async throws -> Data {
        let (data, response) = try await load(URLRequest(url: url))
        try check(response, data)
        return data
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await load(request)
        try check(response, data)
        return try Self.decoder.decode(T.self, from: data)
    }

    private func load(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await URLSession.shared.data(for: request)
        } catch {
            throw ToasterAPIError(message: "서버에 연결할 수 없어요 (\(baseURL.absoluteString))")
        }
    }

    private func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) else { return }
        // FastAPI 오류: {"detail": "..."} 또는 {"detail": [{"msg": "..."}]}
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let detail = json?["detail"] as? String {
            throw ToasterAPIError(message: detail)
        }
        if let details = json?["detail"] as? [[String: Any]] {
            throw ToasterAPIError(message: details.compactMap { $0["msg"] as? String }.joined(separator: ", "))
        }
        throw ToasterAPIError(message: "HTTP \(http.statusCode)")
    }
}
