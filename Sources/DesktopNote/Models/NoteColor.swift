import AppKit

/// Pastel note themes. Each carries both the paper color and a matching accent
/// used for carets, links and headings so text stays legible on every paper.
enum NoteColor: String, CaseIterable {
    case yellow, pink, blue, green, purple, orange, graphite

    var displayName: String { rawValue.capitalized }

    /// Paper color, as hex — the single source of truth shared with the editor.
    var hex: String {
        switch self {
        case .yellow:   return "#FFF7C2"
        case .pink:     return "#FDE2EA"
        case .blue:     return "#DCEDFB"
        case .green:    return "#DDF2E2"
        case .purple:   return "#EDE3F8"
        case .orange:   return "#FFE9CC"
        case .graphite: return "#E6E8EC"
        }
    }

    /// Accent for caret / links / heading rules on this paper.
    var accentHex: String {
        switch self {
        case .yellow:   return "#A9821B"
        case .pink:     return "#B8446C"
        case .blue:     return "#2C6FA8"
        case .green:    return "#2F7D4C"
        case .purple:   return "#6B4A9E"
        case .orange:   return "#B36B1E"
        case .graphite: return "#4A5160"
        }
    }

    var color: NSColor { NSColor(hex: hex) ?? .white }

    static func from(_ name: String) -> NoteColor { NoteColor(rawValue: name) ?? .yellow }
}

extension NSColor {
    /// Parses `#RRGGBB`. Returns nil for anything else.
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(
            srgbRed: CGFloat((v >> 16) & 0xFF) / 255.0,
            green: CGFloat((v >> 8) & 0xFF) / 255.0,
            blue: CGFloat(v & 0xFF) / 255.0,
            alpha: 1.0
        )
    }
}
