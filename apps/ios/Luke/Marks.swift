// Provider marks and the Luke face mark, matching the geometry from the web and desktop.
// Google G keeps its four official brand colours. GitHub mark rides the view's foreground.
// Luke's face is derived from FACE_ART in @sidecar/surface.
import CoreGraphics
import LukeKit
import SwiftUI
import UIKit

// MARK: - Luke face art

/// FACE_ART constants (packages/surface/src/generated/face-art.ts), in the
/// artwork's own 240×240 canvas coordinates. A hand copy, like every mark in
/// this file: change both when the artwork moves.
enum FaceArt {
    /// The face cropped to itself (MARK_VIEW_BOX). Only for a face that never
    /// moves: it is tight enough that any motion would leave it.
    static let markBox = CGRect(x: 53.85, y: 62.67, width: 134.29, height: 122.37)
    /// The square window motions play in (VIEW_BOX), with headroom to move.
    static let motionBox = CGRect(x: 48, y: 51, width: 146, height: 146)
    static let strokeWidth: CGFloat = 16
    static let eyeY: CGFloat = 92
    static let eyeRadius: CGFloat = 12
    static let eyeXs: [CGFloat] = [78, 162]
    private static let tiltDegrees: CGFloat = -8
    private static let tiltPivot = CGPoint(x: 120, y: 124)

    /// Smile: M 104 84 V 150 Q 104 164 118 164 Q 140 164 168 142
    static let smile: Path = {
        var path = Path()
        path.move(to: CGPoint(x: 104, y: 84))
        path.addLine(to: CGPoint(x: 104, y: 150))
        path.addQuadCurve(to: CGPoint(x: 118, y: 164), control: CGPoint(x: 104, y: 164))
        path.addQuadCurve(to: CGPoint(x: 168, y: 142), control: CGPoint(x: 140, y: 164))
        return path
    }()

    /// The head's resting tilt, about the point the motions pivot on.
    static let tilt = rotation(degrees: tiltDegrees, about: tiltPivot)

    static func rotation(degrees: CGFloat, about pivot: CGPoint) -> CGAffineTransform {
        CGAffineTransform(translationX: pivot.x, y: pivot.y)
            .rotated(by: degrees * .pi / 180)
            .translatedBy(x: -pivot.x, y: -pivot.y)
    }

    /// Draws the face fitted to `box`'s crop of the canvas, with `motion`
    /// applied to the whole head in canvas coordinates outside the resting
    /// tilt — the same nesting the desktop's layer groups give the generated
    /// keyframes.
    static func draw(
        _ ctx: GraphicsContext,
        size: CGSize,
        box: CGRect,
        motion: CGAffineTransform = .identity
    ) {
        let scale = min(size.width / box.width, size.height / box.height)
        let placement = CGAffineTransform(scaleX: scale, y: scale)
            .translatedBy(x: -box.minX, y: -box.minY)
        let t = tilt.concatenating(motion).concatenating(placement)

        ctx.stroke(
            smile.applying(t), with: .foreground,
            style: StrokeStyle(lineWidth: strokeWidth * scale, lineCap: .round, lineJoin: .round)
        )
        for eyeX in eyeXs {
            let eye = CGRect(
                x: eyeX - eyeRadius, y: eyeY - eyeRadius,
                width: eyeRadius * 2, height: eyeRadius * 2
            )
            ctx.fill(Path(ellipseIn: eye).applying(t), with: .foreground)
        }
    }
}

// MARK: - Luke face mark

struct LukeMark: View {
    var body: some View {
        Canvas { ctx, size in
            FaceArt.draw(ctx, size: size, box: FaceArt.markBox)
        }
        .aspectRatio(FaceArt.markBox.width / FaceArt.markBox.height, contentMode: .fit)
    }
}

// MARK: - Google G mark (official brand geometry, viewBox 0 0 18 18)

struct GoogleMark: View {
    // Path data verbatim from apps/web/src/account-marks.tsx.
    // Do not restyle; change both copies if Google publishes an updated mark.
    private static let blue = "M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
    private static let green = "M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
    private static let yellow = "M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
    private static let red = "M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"

    var body: some View {
        Canvas { ctx, size in
            ctx.transform = CGAffineTransform(scaleX: size.width / 18, y: size.width / 18)
            ctx.fill(Path(cgPath(fromSVG: Self.blue)), with: .color(.googleBlue))
            ctx.fill(Path(cgPath(fromSVG: Self.green)), with: .color(.googleGreen))
            ctx.fill(Path(cgPath(fromSVG: Self.yellow)), with: .color(.googleYellow))
            ctx.fill(Path(cgPath(fromSVG: Self.red)), with: .color(.googleRed))
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

extension Color {
    static let googleBlue = Color(red: 0.259, green: 0.522, blue: 0.957)
    static let googleGreen = Color(red: 0.204, green: 0.659, blue: 0.325)
    static let googleYellow = Color(red: 0.984, green: 0.737, blue: 0.020)
    static let googleRed = Color(red: 0.918, green: 0.263, blue: 0.208)
}

// MARK: - GitHub mark (currentColor, viewBox 0 0 16 16)

struct GitHubMark: View {
    // Path data verbatim from apps/web/src/account-marks.tsx.
    // Rides `foregroundStyle` per GitHub's own guidance for its one-colour
    // mark: light on a dark ground, dark on a light one.
    private static let path = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"

    var body: some View {
        Canvas { ctx, size in
            ctx.transform = CGAffineTransform(scaleX: size.width / 16, y: size.width / 16)
            ctx.fill(Path(cgPath(fromSVG: Self.path)), with: .foreground)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - Provider marks (brand colours, traced from @sidecar/surface)

/// The official mark of a provider the vault holds keys for. Path data
/// verbatim from packages/surface/src/generated/provider-mark-paths.ts, drawn
/// in the viewBox packages/panel/src/provider-marks.tsx declares for each,
/// in the brand colour and at the optical scale the desktop's base.css gives
/// its `--mark-*` variable and `.provider-mark` rule; change both copies when
/// a brand moves.
struct ProviderMark: View {
    let provider: VaultProviderID

    var body: some View {
        let art = Self.art(for: provider)
        Canvas { ctx, size in
            let scale = min(size.width / art.width, size.height / art.height)
            ctx.translateBy(
                x: (size.width - art.width * scale) / 2,
                y: (size.height - art.height * scale) / 2
            )
            ctx.scaleBy(x: scale, y: scale)
            for path in art.paths {
                ctx.fill(Path(cgPath(fromSVG: path)), with: .color(art.color))
            }
        }
        .aspectRatio(art.width / art.height, contentMode: .fit)
        .scaleEffect(art.opticalScale)
    }

    /// The mark rasterized for a menu row. A `Menu` builds a `UIMenu`, which
    /// draws only an image beside each title and drops a custom label view,
    /// so the Canvas above can never appear there. The template rendering
    /// lets the menu ink it like an SF Symbol rather than in brand colour,
    /// which is how a menu row's icon reads beside the system's own.
    static func menuIcon(for provider: VaultProviderID) -> UIImage {
        let art = art(for: provider)
        let side: CGFloat = 20
        let size = CGSize(width: side, height: side)
        let image = UIGraphicsImageRenderer(size: size).image { rendererContext in
            let ctx = rendererContext.cgContext
            let scale = min(side / art.width, side / art.height) * art.opticalScale
            ctx.translateBy(
                x: (side - art.width * scale) / 2,
                y: (side - art.height * scale) / 2
            )
            ctx.scaleBy(x: scale, y: scale)
            for path in art.paths {
                ctx.addPath(cgPath(fromSVG: path))
            }
            ctx.fillPath()
        }
        return image.withRenderingMode(.alwaysTemplate)
    }

    private struct MarkArt {
        let width: CGFloat
        let height: CGFloat
        let color: Color
        /// The desktop normalises the marks to one optical weight — Conductor's
        /// letter mark is taller than it is wide — with a uniform scale per
        /// mark. Proportions are untouched.
        let opticalScale: CGFloat
        let paths: [String]
    }

    // The desktop's --mark-conductor value: the light half of Conductor's
    // published two-colour palette, invisible on a light ground, so there the
    // mark takes the same warm hue deepened to near-black instead.
    private static let conductorInk = Color(
        dark: UIColor(red: 0xEA / 255, green: 0xE8 / 255, blue: 0xE6 / 255, alpha: 1),
        light: UIColor(red: 0x2B / 255, green: 0x29 / 255, blue: 0x27 / 255, alpha: 1)
    )

    private static func art(for provider: VaultProviderID) -> MarkArt {
        switch provider {
        case .conductor:
            MarkArt(width: 115, height: 174, color: Self.conductorInk, opticalScale: 0.93, paths: [
                "M4.57422 63.6992H22.373V37.251H4.57422C3.58785 37.2511 2.78711 38.0517 2.78711 39.0381V61.9121C2.78725 62.8984 3.58794 63.6991 4.57422 63.6992Z",
                "M36.5977 63.6992H18.7988V37.251H36.5977C37.584 37.2511 38.3848 38.0517 38.3848 39.0381V61.9121C38.3846 62.8984 37.5839 63.6991 36.5977 63.6992Z",
                "M4.57422 100.297H22.373V73.8486H4.57422C3.58785 73.8488 2.78711 74.6493 2.78711 75.6357V98.5098C2.78725 99.496 3.58794 100.297 4.57422 100.297Z",
                "M36.5977 100.297H18.7988V73.8486H36.5977C37.584 73.8488 38.3848 74.6493 38.3848 75.6357V98.5098C38.3846 99.496 37.5839 100.297 36.5977 100.297Z",
                "M4.57422 136.896H22.373V110.447H4.57422C3.58785 110.447 2.78711 111.248 2.78711 112.234V135.108C2.78725 136.095 3.58794 136.895 4.57422 136.896Z",
                "M36.5977 136.896H18.7988V110.447H36.5977C37.584 110.447 38.3848 111.248 38.3848 112.234V135.108C38.3846 136.095 37.5839 136.895 36.5977 136.896Z",
                "M22.873 173.493H40.6719V147.045H22.873C21.8867 147.045 21.0859 147.846 21.0859 148.832V171.706C21.0861 172.692 21.8868 173.493 22.873 173.493Z",
                "M37.0967 173.493V147.045H58.9707V173.493H37.0967Z",
                "M55.3955 173.493V147.045H77.2695V173.493H55.3955Z",
                "M91.4941 173.493H73.6953V147.045H91.4941C92.4805 147.045 93.2812 147.846 93.2812 148.832V171.706C93.2811 172.692 92.4804 173.493 91.4941 173.493Z",
                "M77.7695 136.896H95.5684V110.447H77.7695C76.7832 110.447 75.9824 111.248 75.9824 112.234V135.108C75.9826 136.095 76.7833 136.895 77.7695 136.896Z",
                "M109.793 136.896H91.9941V110.447H109.793C110.779 110.447 111.58 111.248 111.58 112.234V135.108C111.58 136.095 110.779 136.895 109.793 136.896Z",
                "M22.873 27.1006H40.6719V0.652344H22.873C21.8867 0.652488 21.0859 1.45305 21.0859 2.43945V25.3135C21.0861 26.2998 21.8868 27.1004 22.873 27.1006Z",
                "M37.0967 27.1006V0.652344H58.9707V27.1006H37.0967Z",
                "M55.3955 27.1006V0.652344H77.2695V27.1006H55.3955Z",
                "M73.6963 27.1006V0.652344H95.5703V27.1006H73.6963Z",
                "M109.793 27.1006H91.9941V0.652344H109.793C110.779 0.652488 111.58 1.45305 111.58 2.43945V25.3135C111.58 26.2998 110.779 27.1004 109.793 27.1006Z",
                "M77.7695 63.6992H95.5684V37.251H77.7695C76.7832 37.2511 75.9824 38.0517 75.9824 39.0381V61.9121C75.9826 62.8984 76.7833 63.6991 77.7695 63.6992Z",
                "M109.793 63.6992H91.9941V37.251H109.793C110.779 37.2511 111.58 38.0517 111.58 39.0381V61.9121C111.58 62.8984 110.779 63.6991 109.793 63.6992Z",
            ])
        }
    }
}
