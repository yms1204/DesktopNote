// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DesktopNote",
    platforms: [.macOS(.v12)],
    products: [
        .executable(name: "DesktopNote", targets: ["DesktopNote"])
    ],
    targets: [
        .executableTarget(
            name: "DesktopNote",
            path: "Sources/DesktopNote",
            resources: [.copy("Resources")],
            swiftSettings: [.unsafeFlags(["-parse-as-library"])]
        )
    ]
)
