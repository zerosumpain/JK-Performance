import Foundation
import XCTest
@testable import JKPerformance

/// Loads a contract fixture (copied from docs/api/fixtures and
/// docs/api/wp4-fixtures) from beside this file, and decodes it with the
/// app's own decoder.
enum Fixture {
    static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

    static func data(_ path: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(path))
    }

    static func decode<T: Decodable>(_ type: T.Type, _ path: String) throws -> T {
        try JSONCoding.decoder().decode(T.self, from: data(path))
    }

    /// Every fixture in a folder.
    static func all(_ folder: String) throws -> [String] {
        try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(folder).path)
            .filter { $0.hasSuffix(".json") }
            .sorted()
            .map { "\(folder)/\($0)" }
    }
}
