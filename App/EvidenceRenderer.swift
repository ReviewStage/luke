import AppKit
import SidecarCore
import SwiftUI

enum EvidenceRendererError: Error {
    case bitmapCreationFailed
    case pngEncodingFailed
}

enum EvidenceRenderer {
    @MainActor
    static func render(snapshot: DemoSnapshot, to outputURL: URL) throws {
        let size = DevelopmentSurface.canvasSize
        let scale: CGFloat = 2
        let rootView = DevelopmentSurface(snapshot: snapshot)
            .frame(width: size.width, height: size.height)
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: rootView)
        renderer.scale = scale

        guard let image = renderer.nsImage,
            let tiffData = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiffData)
        else {
            throw EvidenceRendererError.bitmapCreationFailed
        }

        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw EvidenceRendererError.pngEncodingFailed
        }

        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: outputURL, options: .atomic)
    }
}
