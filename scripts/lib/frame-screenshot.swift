// frame-screenshot.swift -- frames a macOS window capture on the Golden Gate Sunset aerial for CHANGELOG.md.
//
//   frame-screenshot <capture.png> <out.png> <wallpaper-cache.png>
//
// The capture is a window as macOS's own window capture takes it: the window
// body opaque, its shadow fading to transparent around it. The window body is
// found from the alpha channel, wallpaper is laid around it by MARGIN capture
// pixels, and the whole is scaled to OUTPUT_WIDTH. The wallpaper is the first
// frame of macOS's Golden Gate Sunset aerial (Marshall's Beach), read once from
// Apple's servers and cached, since macOS keeps the aerial as a video, not a
// still.

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The Golden Gate Sunset aerial's id in macOS's aerial manifest.
let AERIAL_ID = "4207734D-74FE-4F92-B5E1-6EC8DEE24A15"
/// Where the aerial lived when this was written, for a Mac whose manifest has not been fetched.
let AERIAL_FALLBACK_URL =
    "https://sylvan.apple.com/itunes-assets/Aerials116/v4/cb/5b/50/cb5b5035-6701-619f-9065-3d7d0e5fbef4/GG_A_SUNSET_MarshallsBeach_c28_v7_24comp_HFR_16Mbps.mov"
let AERIAL_MANIFEST =
    "Library/Application Support/com.apple.wallpaper/aerials/manifest/entries.json"
/// Wallpaper shown beyond each edge of the window body, in capture pixels.
let MARGIN = 180
let OUTPUT_WIDTH = 2400
/// A pixel this opaque belongs to the window body rather than its shadow.
let BODY_ALPHA: UInt8 = 250

struct FrameError: Error, CustomStringConvertible {
    let description: String
}

func loadImage(_ url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw FrameError(description: "cannot read an image at \(url.path)") }
    return image
}

func writePNG(_ image: CGImage, to url: URL) throws {
    guard
        let destination = CGImageDestinationCreateWithURL(
            url as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw FrameError(description: "cannot write \(url.path)") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw FrameError(description: "cannot write \(url.path)")
    }
}

/// The aerial's address as this Mac's manifest names it, else the address it had when this was written.
func aerialURL() -> URL {
    let manifest = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(AERIAL_MANIFEST)
    if let data = try? Data(contentsOf: manifest),
        let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let assets = root["assets"] as? [[String: Any]],
        let asset = assets.first(where: { $0["id"] as? String == AERIAL_ID }),
        let address = asset.first(where: { $0.key.hasPrefix("url-") })?.value as? String,
        let url = URL(string: address)
    {
        return url
    }
    return URL(string: AERIAL_FALLBACK_URL)!
}

/// The aerial's first frame, read from the cache or else from Apple's servers into it.
func wallpaper(cache: URL) async throws -> CGImage {
    if FileManager.default.fileExists(atPath: cache.path) { return try loadImage(cache) }
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: aerialURL()))
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let frame = try await generator.image(at: .zero).image
    try FileManager.default.createDirectory(
        at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
    try writePNG(frame, to: cache)
    return frame
}

/// The window body's rectangle in the capture, top-left origin: every pixel opaque enough to be the window and not its shadow.
func windowBody(_ image: CGImage) throws -> CGRect {
    let width = image.width
    let height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard
            let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }
    guard drawn else { throw FrameError(description: "cannot read the capture's pixels") }
    var minX = width, minY = height, maxX = -1, maxY = -1
    for y in 0..<height {
        let row = y * width * 4
        for x in 0..<width where pixels[row + x * 4 + 3] >= BODY_ALPHA {
            minX = min(minX, x)
            maxX = max(maxX, x)
            minY = min(minY, y)
            maxY = max(maxY, y)
        }
    }
    guard maxX >= minX, maxY >= minY else {
        throw FrameError(description: "the capture has no opaque window in it")
    }
    return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
}

/// The window on the wallpaper: the wallpaper scaled to cover the canvas and centred, the window drawn shadow and all.
func frame(capture: CGImage, wallpaper: CGImage) throws -> CGImage {
    let body = try windowBody(capture)
    let canvasWidth = body.width + CGFloat(2 * MARGIN)
    let canvasHeight = body.height + CGFloat(2 * MARGIN)
    let scale = CGFloat(OUTPUT_WIDTH) / canvasWidth
    let outputHeight = Int((canvasHeight * scale).rounded())
    guard
        let context = CGContext(
            data: nil, width: OUTPUT_WIDTH, height: outputHeight, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw FrameError(description: "cannot make the output canvas") }
    context.interpolationQuality = .high

    let cover = max(
        CGFloat(OUTPUT_WIDTH) / CGFloat(wallpaper.width), CGFloat(outputHeight) / CGFloat(wallpaper.height))
    let wallpaperSize = CGSize(width: CGFloat(wallpaper.width) * cover, height: CGFloat(wallpaper.height) * cover)
    context.draw(
        wallpaper,
        in: CGRect(
            x: (CGFloat(OUTPUT_WIDTH) - wallpaperSize.width) / 2,
            y: (CGFloat(outputHeight) - wallpaperSize.height) / 2,
            width: wallpaperSize.width, height: wallpaperSize.height))

    // Note that we place the capture from the top, because the body was measured top-down and Core Graphics draws bottom-up.
    let captureWidth = CGFloat(capture.width) * scale
    let captureHeight = CGFloat(capture.height) * scale
    let left = (CGFloat(MARGIN) - body.minX) * scale
    let top = (CGFloat(MARGIN) - body.minY) * scale
    context.draw(
        capture,
        in: CGRect(
            x: left, y: CGFloat(outputHeight) - top - captureHeight, width: captureWidth,
            height: captureHeight))
    guard let output = context.makeImage() else { throw FrameError(description: "cannot finish the image") }
    return output
}

let arguments = CommandLine.arguments
guard arguments.count == 4 else {
    FileHandle.standardError.write("usage: frame-screenshot <capture.png> <out.png> <wallpaper-cache.png>\n".data(using: .utf8)!)
    exit(2)
}
do {
    let capture = try loadImage(URL(fileURLWithPath: arguments[1]))
    let backdrop = try await wallpaper(cache: URL(fileURLWithPath: arguments[3]))
    try writePNG(try frame(capture: capture, wallpaper: backdrop), to: URL(fileURLWithPath: arguments[2]))
} catch {
    FileHandle.standardError.write("error: \(error)\n".data(using: .utf8)!)
    exit(1)
}
