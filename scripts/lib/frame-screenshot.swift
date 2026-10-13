// frame-screenshot.swift -- frames a macOS window capture on the Golden Gate Sunset aerial for CHANGELOG.md.
//
//   frame-screenshot <capture.png> <out.png> <wallpaper-cache.png> [x,y,width,height [zoom]]
//
// The capture is a window as macOS's own window capture takes it: the window
// body opaque, its shadow fading to transparent around it. The window body is
// found from the alpha channel, wallpaper is laid around it by MARGIN capture
// pixels, and the whole is scaled to OUTPUT_WIDTH. Given a crop, in the
// window's points from its top-left corner (negative, or past the window, to
// take in wallpaper), the same picture is cut to that part and scaled to the
// height the whole one would have, so a close-up stands beside the full
// windows at their height, narrower and nearer. It is composed at the
// capture's own resolution, so a crop at least 800 points tall is never
// enlarged past its pixels, and a capture taken zoomed (the window that many
// times larger, its page zoomed to match) holds that many times the pixels
// for a crop of the same points. The wallpaper is the first
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
/// The largest zoom a capture is taken at; past it the window's pixels outgrow what a Mac will draw.
let MAX_ZOOM: CGFloat = 4
/// The resolution macOS records for a point when it does not say, as on a Retina display.
let DEFAULT_DPI: CGFloat = 144

struct FrameError: Error, CustomStringConvertible {
    let description: String
}

func loadImage(_ url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { throw FrameError(description: "cannot read an image at \(url.path)") }
    return image
}

/// Capture pixels per window point, from the resolution macOS wrote into the capture.
func pixelsPerPoint(_ url: URL) -> CGFloat {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let dpi = properties[kCGImagePropertyDPIWidth] as? NSNumber
    else { return DEFAULT_DPI / 72 }
    return CGFloat(dpi.doubleValue) / 72
}

/// A crop as `x,y,width,height` in window points: exactly four finite numbers, its size positive.
func parseCrop(_ text: String) throws -> CGRect {
    let fields = text.split(separator: ",", omittingEmptySubsequences: false)
    let parts = fields.compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard fields.count == 4, parts.count == 4, parts.allSatisfy({ $0.isFinite }), parts[2] > 0, parts[3] > 0
    else {
        throw FrameError(description: "a crop is x,y,width,height in points, got \(text)")
    }
    return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
}

/// A canvas with the wallpaper scaled to cover it and centred.
func wallpaperCanvas(width: Int, height: Int, wallpaper: CGImage) throws -> CGContext {
    guard
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw FrameError(description: "cannot make the output canvas") }
    context.interpolationQuality = .high
    let cover = max(CGFloat(width) / CGFloat(wallpaper.width), CGFloat(height) / CGFloat(wallpaper.height))
    let size = CGSize(width: CGFloat(wallpaper.width) * cover, height: CGFloat(wallpaper.height) * cover)
    context.draw(
        wallpaper,
        in: CGRect(
            x: (CGFloat(width) - size.width) / 2, y: (CGFloat(height) - size.height) / 2,
            width: size.width, height: size.height))
    return context
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
///
/// Note that we write the cache beside itself and move it into place, because
/// a write cut short must not leave a file that every later run trusts, and
/// we read an unreadable cache as a miss for the same reason.
func wallpaper(cache: URL) async throws -> CGImage {
    if let cached = try? loadImage(cache) { return cached }
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: aerialURL()))
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    let frame = try await generator.image(at: .zero).image
    let files = FileManager.default
    try files.createDirectory(at: cache.deletingLastPathComponent(), withIntermediateDirectories: true)
    let partial = cache.deletingLastPathComponent()
        .appendingPathComponent(".\(cache.lastPathComponent).\(ProcessInfo.processInfo.processIdentifier)")
    defer { try? files.removeItem(at: partial) }
    try writePNG(frame, to: partial)
    if files.fileExists(atPath: cache.path) {
        _ = try files.replaceItemAt(cache, withItemAt: partial)
    } else {
        try files.moveItem(at: partial, to: cache)
    }
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
func frame(
    capture: CGImage, wallpaper: CGImage, width outputWidth: Int = OUTPUT_WIDTH, margin: Int = MARGIN
) throws -> CGImage {
    let body = try windowBody(capture)
    let canvasWidth = body.width + CGFloat(2 * margin)
    let canvasHeight = body.height + CGFloat(2 * margin)
    let scale = CGFloat(outputWidth) / canvasWidth
    let outputHeight = Int((canvasHeight * scale).rounded())
    let context = try wallpaperCanvas(width: outputWidth, height: outputHeight, wallpaper: wallpaper)

    // Note that we place the capture from the top, because the body was measured top-down and Core Graphics draws bottom-up.
    let captureWidth = CGFloat(capture.width) * scale
    let captureHeight = CGFloat(capture.height) * scale
    let left = (CGFloat(margin) - body.minX) * scale
    let top = (CGFloat(margin) - body.minY) * scale
    context.draw(
        capture,
        in: CGRect(
            x: left, y: CGFloat(outputHeight) - top - captureHeight, width: captureWidth,
            height: captureHeight))
    guard let output = context.makeImage() else { throw FrameError(description: "cannot finish the image") }
    return output
}

/// Part of the framed picture: the window on the wallpaper composed at the capture's resolution, cut to the crop, and scaled to the height a whole unzoomed picture has.
///
/// Note that the margin grows with the zoom, because it is wallpaper in the window's points, not the capture's pixels.
func frameCrop(capture: CGImage, crop: CGRect, scale: CGFloat, zoom: CGFloat, wallpaper: CGImage) throws -> CGImage {
    let body = try windowBody(capture)
    let margin = Int((CGFloat(MARGIN) * zoom).rounded())
    let nativeWidth = Int(body.width) + 2 * margin
    let whole = try frame(capture: capture, wallpaper: wallpaper, width: nativeWidth, margin: margin)
    let outputHeight = Int(
        ((body.height / zoom + CGFloat(2 * MARGIN)) * CGFloat(OUTPUT_WIDTH) / (body.width / zoom + CGFloat(2 * MARGIN)))
            .rounded())
    let cut = CGRect(
        x: CGFloat(margin) + crop.minX * scale, y: CGFloat(margin) + crop.minY * scale,
        width: crop.width * scale, height: crop.height * scale
    ).integral
    let scaledWidth = (cut.width * CGFloat(outputHeight) / cut.height).rounded()
    guard scaledWidth <= CGFloat(OUTPUT_WIDTH) else {
        throw FrameError(description: "the crop \(crop) is wider than a whole picture at its height; make it taller")
    }
    let outputWidth = Int(scaledWidth)
    guard CGRect(x: 0, y: 0, width: whole.width, height: whole.height).contains(cut),
        let piece = whole.cropping(to: cut)
    else {
        throw FrameError(description: "the crop \(crop) reaches past the wallpaper around the window")
    }
    guard
        let context = CGContext(
            data: nil, width: outputWidth, height: outputHeight, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw FrameError(description: "cannot make the output canvas") }
    context.interpolationQuality = .high
    context.draw(piece, in: CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight))
    guard let output = context.makeImage() else { throw FrameError(description: "cannot finish the image") }
    return output
}

let arguments = CommandLine.arguments
guard (4...6).contains(arguments.count) else {
    FileHandle.standardError.write(
        "usage: frame-screenshot <capture.png> <out.png> <wallpaper-cache.png> [x,y,width,height [zoom]]\n".data(
            using: .utf8)!)
    exit(2)
}
do {
    let captureURL = URL(fileURLWithPath: arguments[1])
    let capture = try loadImage(captureURL)
    let backdrop = try await wallpaper(cache: URL(fileURLWithPath: arguments[3]))
    let zoom = arguments.count == 6 ? CGFloat(Double(arguments[5]) ?? 0) : 1
    guard zoom.isFinite, zoom >= 1, zoom <= MAX_ZOOM else {
        throw FrameError(description: "a zoom is a number from 1 to \(Int(MAX_ZOOM))")
    }
    let framed =
        arguments.count >= 5
        ? try frameCrop(
            capture: capture, crop: try parseCrop(arguments[4]), scale: pixelsPerPoint(captureURL) * zoom,
            zoom: zoom, wallpaper: backdrop)
        : try frame(capture: capture, wallpaper: backdrop)
    try writePNG(framed, to: URL(fileURLWithPath: arguments[2]))
} catch {
    FileHandle.standardError.write("error: \(error)\n".data(using: .utf8)!)
    exit(1)
}
