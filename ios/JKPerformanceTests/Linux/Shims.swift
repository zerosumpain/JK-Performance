import Foundation

// Linux only (not in the Xcode target): the two design-layer names the
// Foundation-only model files mention. Fmt and IconKey live in SwiftUI files
// (Design/Format.swift, Design/Icons.swift) that only compile on a Mac.

enum IconKey: String, Codable {
    case custom
    init(stored: String?) { self = .custom }
}

enum Fmt {
    static func planName(_ id: String?) -> String { id ?? "" }
    static func initials(_ name: String) -> String { String(name.prefix(1)) }
    static func duration(_ minutes: Double) -> String { "\(Int(minutes)) min" }
    static func number(_ value: Double, digits: Int = 1) -> String { "\(value)" }
    static func dayMonth(_ s: String?) -> String { s ?? "" }
}
