import Foundation
import CoreGraphics

/// A single sticky note. Pure value type — all window state lives here so the
/// whole app can be rebuilt from a `[Note]` array on launch.
struct Note: Identifiable, Codable, Equatable {

    static let defaultFontSize: Double = 14
    static let fontSizeRange: ClosedRange<Double> = 9...32

    let id: UUID
    var content: String
    var position: CGPoint
    var size: CGSize
    var opacity: Double
    var colorTheme: String
    var cursorPosition: Int
    var scrollTop: Double

    /// Editor text size in points. Per note, so one can be enlarged without
    /// disturbing the others.
    var fontSize: Double
    var alwaysOnTop: Bool
    let createdAt: Date
    var modifiedAt: Date

    init(
        id: UUID = UUID(),
        content: String = "",
        position: CGPoint = CGPoint(x: 120, y: 120),
        size: CGSize = CGSize(width: 340, height: 400),
        opacity: Double = 1.0,
        colorTheme: String = "yellow",
        cursorPosition: Int = 0,
        scrollTop: Double = 0,
        fontSize: Double = Note.defaultFontSize,
        alwaysOnTop: Bool = false,
        createdAt: Date = Date(),
        modifiedAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.position = position
        self.size = size
        self.opacity = opacity
        self.colorTheme = colorTheme
        self.cursorPosition = cursorPosition
        self.scrollTop = scrollTop
        self.fontSize = fontSize
        self.alwaysOnTop = alwaysOnTop
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
    }

    /// First non-empty line, stripped of markdown heading/list markers — used for window titles.
    var displayTitle: String {
        for rawLine in content.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = rawLine.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }
            while line.hasPrefix("#") { line.removeFirst() }
            for prefix in ["- [ ] ", "- [x] ", "- ", "* ", "+ ", "> "] where line.hasPrefix(prefix) {
                line.removeFirst(prefix.count)
                break
            }
            line = line.trimmingCharacters(in: .whitespaces)
            if !line.isEmpty { return String(line.prefix(40)) }
        }
        return "New Note"
    }
}

// CGPoint/CGSize encode as `[Double]` by default, which is opaque in the JSON
// file. Encode them as named dictionaries so the store stays human-readable.
extension Note {
    enum CodingKeys: String, CodingKey {
        case id, content, position, size, opacity, colorTheme
        case cursorPosition, scrollTop, fontSize, alwaysOnTop, createdAt, modifiedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        content = try c.decodeIfPresent(String.self, forKey: .content) ?? ""

        let p = try c.decodeIfPresent([String: Double].self, forKey: .position) ?? [:]
        position = CGPoint(x: p["x"] ?? 120, y: p["y"] ?? 120)

        let s = try c.decodeIfPresent([String: Double].self, forKey: .size) ?? [:]
        size = CGSize(width: s["width"] ?? 340, height: s["height"] ?? 400)

        opacity = try c.decodeIfPresent(Double.self, forKey: .opacity) ?? 1.0
        colorTheme = try c.decodeIfPresent(String.self, forKey: .colorTheme) ?? "yellow"
        cursorPosition = try c.decodeIfPresent(Int.self, forKey: .cursorPosition) ?? 0
        scrollTop = try c.decodeIfPresent(Double.self, forKey: .scrollTop) ?? 0

        // Clamped on the way in: a hand-edited store should not be able to set
        // an unreadable size.
        let storedFontSize = try c.decodeIfPresent(Double.self, forKey: .fontSize) ?? Note.defaultFontSize
        fontSize = min(max(storedFontSize, Note.fontSizeRange.lowerBound), Note.fontSizeRange.upperBound)
        alwaysOnTop = try c.decodeIfPresent(Bool.self, forKey: .alwaysOnTop) ?? false
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        modifiedAt = try c.decodeIfPresent(Date.self, forKey: .modifiedAt) ?? Date()
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(content, forKey: .content)
        try c.encode(["x": position.x, "y": position.y], forKey: .position)
        try c.encode(["width": size.width, "height": size.height], forKey: .size)
        try c.encode(opacity, forKey: .opacity)
        try c.encode(colorTheme, forKey: .colorTheme)
        try c.encode(cursorPosition, forKey: .cursorPosition)
        try c.encode(scrollTop, forKey: .scrollTop)
        try c.encode(fontSize, forKey: .fontSize)
        try c.encode(alwaysOnTop, forKey: .alwaysOnTop)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(modifiedAt, forKey: .modifiedAt)
    }
}
