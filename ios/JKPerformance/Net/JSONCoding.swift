import Foundation

/// The API's JSON conventions (docs/API.md): camelCase keys as-is, instants as
/// ISO 8601 with or without fractional seconds. Foundation-only, so the Linux
/// decoder check decodes the contract fixtures exactly as the app does.
enum JSONCoding {
    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(ISO.fractional.string(from: date))
        }
        return e
    }

    static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let text = try c.decode(String.self)
            if let date = ISO.fractional.date(from: text) ?? ISO.plain.date(from: text) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not an ISO 8601 instant: \(text)")
        }
        return d
    }
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
