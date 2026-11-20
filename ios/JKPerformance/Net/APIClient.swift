import Foundation
import Security

/// A failure worth showing to a person: the server's own `{"error": …}`
/// sentence when there is one.
enum APIError: LocalizedError {
    case server(status: Int, message: String)
    case unauthorized
    case transport(String)
    case decoding(String)
    case config(String)

    var errorDescription: String? {
        switch self {
        case .server(_, let message): return message
        case .unauthorized: return "Your session has ended. Sign in again."
        case .transport(let message): return message
        case .decoding(let message): return message
        case .config(let message): return message
        }
    }

    var status: Int? {
        if case .server(let status, _) = self { return status }
        if case .unauthorized = self { return 401 }
        return nil
    }
}

extension Error {
    /// The sentence to put on screen.
    var readable: String {
        if let api = self as? APIError { return api.errorDescription ?? "Something went wrong." }
        if let url = self as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost: return "You're offline. Check your connection and try again."
            case .timedOut: return "The server took too long to answer. Try again."
            default: return "Couldn't reach JK Performance (\(url.code.rawValue))."
            }
        }
        return localizedDescription
    }

    var isCancellation: Bool {
        self is CancellationError || (self as? URLError)?.code == .cancelled
    }
}

/// The bearer token lives in the Keychain, never in UserDefaults.
enum Keychain {
    private static let service = "com.jkperformance.app.session"
    private static let account = "token"

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String?) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let token else { return }
        var values = query
        values[kSecValueData as String] = Data(token.utf8)
        values[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(values as CFDictionary, nil)
    }
}

/// Async/await client for docs/API.md. One instance for the app's life.
/// Base URL from Info.plist `JKAPIBaseURL`.
@MainActor
final class APIClient {
    static let shared = APIClient()

    let baseURL: URL
    private(set) var token: String?
    /// Called once when an authenticated request comes back 401.
    var onUnauthorized: (@MainActor () -> Void)?

    private let session: URLSession

    init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "JKAPIBaseURL") as? String
        baseURL = URL(string: configured ?? "") ?? URL(string: "https://jk.strangeramblings.com")!
        token = Keychain.read()
        let config = URLSessionConfiguration.default
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    var privacyURL: URL { baseURL.appendingPathComponent("privacy") }

    func setToken(_ value: String?) {
        token = value
        Keychain.save(value)
    }

    // MARK: Coding

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(ISO.fractional.string(from: date))
        }
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let text = try c.decode(String.self)
            if let date = ISO.fractional.date(from: text) ?? ISO.plain.date(from: text) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not an ISO 8601 instant: \(text)")
        }
        return d
    }()

    // MARK: Requests

    /// GET and decode.
    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        let data = try await raw("GET", path, query: query)
        return try decode(T.self, data, path: path)
    }

    /// A request with a JSON body.
    func send<T: Decodable, Body: Encodable>(_ method: String, _ path: String, body: Body,
                                              query: [String: String?] = [:]) async throws -> T {
        let encoded = try Self.encoder.encode(body)
        let data = try await raw(method, path, query: query, body: encoded, contentType: "application/json")
        return try decode(T.self, data, path: path)
    }

    /// A request with no body (DELETE, publish, join…).
    func send<T: Decodable>(_ method: String, _ path: String, query: [String: String?] = [:]) async throws -> T {
        let data = try await raw(method, path, query: query)
        return try decode(T.self, data, path: path)
    }

    /// Raw bytes in (`image/jpeg` upload) and JSON out.
    func upload<T: Decodable>(_ path: String, data: Data, contentType: String,
                              query: [String: String?] = [:]) async throws -> T {
        let out = try await raw("POST", path, query: query, body: data, contentType: contentType, timeout: 120)
        return try decode(T.self, out, path: path)
    }

    /// Raw bytes out (photos, export). Sends the bearer token, unlike AsyncImage.
    func data(_ path: String, query: [String: String?] = [:]) async throws -> Data {
        try await raw("GET", path, query: query, timeout: 60)
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data, path: String) throws -> T {
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw APIError.decoding("Unexpected reply from \(path): \(Self.describe(error))")
        }
    }

    private func raw(_ method: String, _ path: String, query: [String: String?] = [:], body: Data? = nil,
                     contentType: String? = nil, timeout: TimeInterval = 30) async throws -> Data {
        guard var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.config("The server address is not valid.")
        }
        parts.percentEncodedPath = path
        let items = query.compactMap { key, value in value.map { URLQueryItem(name: key, value: $0) } }
        if !items.isEmpty { parts.queryItems = items.sorted { $0.name < $1.name } }
        guard let url = parts.url else { throw APIError.config("Bad request path \(path).") }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let sentToken = token
        if let sentToken { request.setValue("Bearer \(sentToken)", forHTTPHeaderField: "Authorization") }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No reply from the server.") }
        if (200..<300).contains(http.statusCode) { return data }

        let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
        if http.statusCode == 401, sentToken != nil, !path.hasPrefix("/api/auth/") {
            // Only the token we sent: a newer sign-in may have replaced it meanwhile.
            if token == sentToken {
                setToken(nil)
                onUnauthorized?()
            }
            throw APIError.unauthorized
        }
        throw APIError.server(status: http.statusCode, message: Self.humanize(message, status: http.statusCode))
    }

    private struct ErrorBody: Decodable { let error: String }

    private static func humanize(_ message: String?, status: Int) -> String {
        switch message {
        case "membership_required"?: return "This needs an active membership. Choose a plan under Account."
        case let text? where !text.isEmpty: return text
        default:
            switch status {
            case 403: return "You don't have access to that."
            case 404: return "Not found."
            case 500...: return "The server had a problem (\(status)). Try again shortly."
            default: return "Request failed (\(status))."
            }
        }
    }

    private static func describe(_ error: DecodingError) -> String {
        switch error {
        case .keyNotFound(let key, let ctx):
            return "missing \(path(ctx.codingPath + [key]))"
        case .typeMismatch(_, let ctx), .valueNotFound(_, let ctx), .dataCorrupted(let ctx):
            return "bad value at \(path(ctx.codingPath))"
        @unknown default:
            return "could not read it"
        }
    }

    private static func path(_ keys: [CodingKey]) -> String {
        keys.map { $0.intValue.map { "[\($0)]" } ?? $0.stringValue }.joined(separator: ".")
    }
}

/// Percent-encodes one path segment (an opaque id).
func seg(_ value: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?#")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}

enum ISO {
    static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
}
