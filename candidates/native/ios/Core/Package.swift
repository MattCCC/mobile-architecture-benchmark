// swift-tools-version: 6.0
// Domain core of the fully native iOS candidate: fixture parsing, state model, digests, Insights, restoration
// record, stream frames and launch configuration. Foundation + CryptoKit only, so it also builds and tests on the
// macOS host (`swift test`) without a simulator.
import PackageDescription

let package = Package(
    name: "MobileBenchCore",
    platforms: [.iOS("16.4"), .macOS(.v13)],
    products: [
        .library(name: "MobileBenchCore", targets: ["MobileBenchCore"]),
    ],
    targets: [
        .target(name: "MobileBenchCore"),
        .testTarget(name: "MobileBenchCoreTests", dependencies: ["MobileBenchCore"]),
    ]
)
