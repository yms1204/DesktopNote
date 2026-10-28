#!/usr/bin/env swift
//
// Renders the app icon and writes it as .icns.
// Usage: ./make-icon.swift <output.icns>

import AppKit
import Foundation

let output = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "AppIcon.icns"

/// Draws a sticky note with a folded corner and three ruled lines.
func drawIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    defer { image.unlockFocus() }

    let s = size / 1024.0
    let inset = 96.0 * s
    let body = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let fold = 220.0 * s
    let radius = 72.0 * s

    NSGraphicsContext.current?.imageInterpolation = .high

    // Drop shadow.
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
    shadow.shadowBlurRadius = 48 * s
    shadow.shadowOffset = NSSize(width: 0, height: -20 * s)
    shadow.set()

    // Note body: a rounded rect with the bottom-right corner cut away.
    let page = NSBezierPath()
    page.move(to: NSPoint(x: body.minX, y: body.minY + radius))
    page.appendArc(withCenter: NSPoint(x: body.minX + radius, y: body.maxY - radius),
                   radius: radius, startAngle: 180, endAngle: 90, clockwise: true)
    page.appendArc(withCenter: NSPoint(x: body.maxX - radius, y: body.maxY - radius),
                   radius: radius, startAngle: 90, endAngle: 0, clockwise: true)
    page.line(to: NSPoint(x: body.maxX, y: body.minY + fold))
    page.line(to: NSPoint(x: body.minX + fold, y: body.minY))
    page.appendArc(withCenter: NSPoint(x: body.minX + radius, y: body.minY + radius),
                   radius: radius, startAngle: 270, endAngle: 180, clockwise: true)
    page.close()

    NSColor(srgbRed: 1.0, green: 0.93, blue: 0.48, alpha: 1.0).setFill()
    page.fill()

    NSShadow().set()

    // Folded corner.
    let corner = NSBezierPath()
    corner.move(to: NSPoint(x: body.maxX, y: body.minY + fold))
    corner.line(to: NSPoint(x: body.minX + fold, y: body.minY))
    corner.line(to: NSPoint(x: body.minX + fold, y: body.minY + fold))
    corner.close()
    NSColor(srgbRed: 0.90, green: 0.79, blue: 0.29, alpha: 1.0).setFill()
    corner.fill()

    // A checked task and two ruled lines, hinting at markdown task lists.
    let ink = NSColor(srgbRed: 0.42, green: 0.34, blue: 0.06, alpha: 1.0)
    let boxSide = 92.0 * s
    let left = body.minX + 108 * s
    var y = body.maxY - 200 * s

    let box = NSBezierPath(roundedRect: NSRect(x: left, y: y - boxSide, width: boxSide, height: boxSide),
                           xRadius: 22 * s, yRadius: 22 * s)
    box.lineWidth = 26 * s
    ink.setStroke()
    box.stroke()

    let tick = NSBezierPath()
    tick.move(to: NSPoint(x: left + boxSide * 0.24, y: y - boxSide * 0.52))
    tick.line(to: NSPoint(x: left + boxSide * 0.45, y: y - boxSide * 0.74))
    tick.line(to: NSPoint(x: left + boxSide * 0.80, y: y - boxSide * 0.24))
    tick.lineWidth = 30 * s
    tick.lineCapStyle = .round
    tick.lineJoinStyle = .round
    ink.setStroke()
    tick.stroke()

    let textLeft = left + boxSide + 52 * s
    let rule = NSBezierPath()
    rule.move(to: NSPoint(x: textLeft, y: y - boxSide * 0.5))
    rule.line(to: NSPoint(x: body.maxX - 120 * s, y: y - boxSide * 0.5))
    rule.lineWidth = 34 * s
    rule.lineCapStyle = .round
    ink.withAlphaComponent(0.85).setStroke()
    rule.stroke()

    y -= 210 * s
    for width in [0.78, 0.54] {
        let line = NSBezierPath()
        line.move(to: NSPoint(x: left, y: y))
        line.line(to: NSPoint(x: left + (body.width - 228 * s) * width, y: y))
        line.lineWidth = 34 * s
        line.lineCapStyle = .round
        ink.withAlphaComponent(0.42).setStroke()
        line.stroke()
        y -= 180 * s
    }

    return image
}

func png(size: CGFloat) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size), pixelsHigh: Int(size),
        bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { return nil }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    drawIcon(size: size).draw(in: NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()

    return rep.representation(using: .png, properties: [:])
}

let workDir = NSTemporaryDirectory() + "desktopnote-icon-\(UUID().uuidString)/AppIcon.iconset"
try FileManager.default.createDirectory(atPath: workDir, withIntermediateDirectories: true)

// iconutil expects this exact set of names.
let variants: [(String, CGFloat)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

for (name, size) in variants {
    guard let data = png(size: size) else { continue }
    try data.write(to: URL(fileURLWithPath: "\(workDir)/\(name).png"))
}

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", workDir, "-o", output]
try task.run()
task.waitUntilExit()

try? FileManager.default.removeItem(atPath: (workDir as NSString).deletingLastPathComponent)

guard task.terminationStatus == 0 else {
    FileHandle.standardError.write("iconutil failed\n".data(using: .utf8)!)
    exit(1)
}
print("wrote \(output)")
