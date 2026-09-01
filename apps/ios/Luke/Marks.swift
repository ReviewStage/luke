// Provider marks and the Luke face mark, matching the geometry from the web and desktop.
// Google G keeps its four official brand colours. GitHub mark rides the view's foreground.
// Luke's face is derived from FACE_ART in @sidecar/surface.
import CoreGraphics
import LukeKit
import SwiftUI
import UIKit

// MARK: - Luke face mark

struct LukeMark: View {
    // FACE_ART constants (packages/surface/src/generated/face-art.ts)
    private static let vbX: CGFloat = 53.85, vbY: CGFloat = 62.67
    private static let vbW: CGFloat = 134.29, vbH: CGFloat = 122.37
    private static let tiltDeg: CGFloat = -8
    private static let pivotX: CGFloat = 120, pivotY: CGFloat = 124
    private static let eyeY: CGFloat = 92, eyeR: CGFloat = 12
    private static let leftEyeX: CGFloat = 78, rightEyeX: CGFloat = 162
    private static let strokeW: CGFloat = 16

    var body: some View {
        Canvas { ctx, size in
            let scale = min(size.width / Self.vbW, size.height / Self.vbH)
            let t = faceTransform(scale: scale)

            // Smile: M 104 84 V 150 Q 104 164 118 164 Q 140 164 168 142
            let smile = CGMutablePath()
            smile.move(to: CGPoint(x: 104, y: 84), transform: t)
            smile.addLine(to: CGPoint(x: 104, y: 150), transform: t)
            smile.addQuadCurve(
                to: CGPoint(x: 118, y: 164), control: CGPoint(x: 104, y: 164), transform: t
            )
            smile.addQuadCurve(
                to: CGPoint(x: 168, y: 142), control: CGPoint(x: 140, y: 164), transform: t
            )
            ctx.stroke(
                Path(smile), with: .foreground,
                style: StrokeStyle(lineWidth: Self.strokeW * scale, lineCap: .round, lineJoin: .round)
            )

            let r = Self.eyeR * scale
            let lc = CGPoint(x: Self.leftEyeX, y: Self.eyeY).applying(t)
            let rc = CGPoint(x: Self.rightEyeX, y: Self.eyeY).applying(t)
            ctx.fill(Path(ellipseIn: CGRect(cx: lc, r: r)), with: .foreground)
            ctx.fill(Path(ellipseIn: CGRect(cx: rc, r: r)), with: .foreground)
        }
        .aspectRatio(Self.vbW / Self.vbH, contentMode: .fit)
    }

    private func faceTransform(scale: CGFloat) -> CGAffineTransform {
        let angle = Self.tiltDeg * .pi / 180
        let cx = Self.pivotX, cy = Self.pivotY
        return CGAffineTransform(translationX: -cx, y: -cy)
            .concatenating(.init(rotationAngle: angle))
            .concatenating(.init(translationX: cx - Self.vbX, y: cy - Self.vbY))
            .concatenating(.init(scaleX: scale, y: scale))
    }
}

extension CGRect {
    init(cx: CGPoint, r: CGFloat) {
        self.init(x: cx.x - r, y: cx.y - r, width: 2 * r, height: 2 * r)
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
/// a brand moves. Copilot, Cursor, and Devin publish silhouettes rather than
/// a colour, so like GitHub they take the surface's own ink: light on a dark
/// ground, dark on a light one.
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

    private struct MarkArt {
        let width: CGFloat
        let height: CGFloat
        let color: Color
        /// The desktop normalises the marks to one optical weight — Devin's
        /// glyph leaves a fifth of its box empty on every side, Conductor's
        /// letter mark is taller than it is wide — with a uniform scale per
        /// mark. Proportions are untouched.
        let opticalScale: CGFloat
        let paths: [String]
    }

    // The desktop's --mark-conductor, --mark-jules, and --mark-replicas
    // values. Conductor's is the light half of its published two-colour
    // palette, invisible on a light ground, so there the mark takes the same
    // warm hue deepened to near-black instead.
    private static let conductorInk = Color(
        dark: UIColor(red: 0xEA / 255, green: 0xE8 / 255, blue: 0xE6 / 255, alpha: 1),
        light: UIColor(red: 0x2B / 255, green: 0x29 / 255, blue: 0x27 / 255, alpha: 1)
    )
    private static let julesInk = Color(red: 0x71 / 255, green: 0x5C / 255, blue: 0xD7 / 255)
    private static let replicasInk = Color(red: 0x3E / 255, green: 0xEB / 255, blue: 0xA3 / 255)

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
        case .copilot:
            MarkArt(width: 24, height: 24, color: .ink, opticalScale: 0.94, paths: [
                "M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z",
            ])
        case .cursor:
            MarkArt(width: 24, height: 24, color: .ink, opticalScale: 0.94, paths: [
                "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
            ])
        case .devin:
            MarkArt(width: 425, height: 425, color: .ink, opticalScale: 1.22, paths: [
                "M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205C135.631 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044C202.856 85.5983 204.45 88.3592 204.45 91.3471V126.068C204.708 137.606 210.806 148.734 221.531 154.926C232.256 161.117 244.942 160.834 255.063 155.289L285.132 137.929C287.719 136.435 290.907 136.435 293.495 137.929L352.357 171.913C354.944 173.406 356.538 176.167 356.538 179.155V247.123C356.538 250.111 354.944 252.872 352.357 254.366L293.495 288.35C290.907 289.844 287.719 289.844 285.132 288.35L255.306 271.13C245.146 265.456 232.344 265.117 221.534 271.358C210.809 277.55 204.711 288.678 204.453 300.215V334.926C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153C138.822 377.647 135.634 377.647 133.046 376.153L74.1845 342.169C71.5969 340.675 70.0028 337.914 70.0028 334.926V266.959C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732C135.634 224.238 138.822 224.238 141.41 225.732L171.547 243.132C181.656 248.638 194.306 248.906 205.005 242.729C215.815 236.488 221.922 225.231 222.088 213.595C221.83 202.057 215.732 189.737 205.008 183.545C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72C138.67 202.229 135.461 202.228 132.864 200.716L74.1576 166.562C71.5835 165.065 70 162.311 70 159.333Z",
            ])
        case .jules:
            MarkArt(width: 24, height: 24, color: Self.julesInk, opticalScale: 0.94, paths: [
                "M4.2 24q-1.26 0-2.13-.87T1.2 21v-.6q0-.51.345-.855T2.4 19.2t.855.345.345.855v.6q0 .24.18.42t.42.18.42-.18.18-.42V7.2q0-3 2.1-5.1T12 0t5.1 2.1 2.1 5.1V21q0 .24.18.42t.42.18.42-.18.18-.42v-.6q0-.51.345-.855t.855-.345.855.345.345.855v.6q0 1.26-.87 2.13T19.8 24t-2.13-.87T16.8 21v-5.4h-1.62v4.8q0 .51-.345.855t-.855.345-.855-.345-.345-.855v-4.8h-1.59v4.8q0 .51-.345.855t-.855.345-.855-.345-.345-.855v-4.8H7.2V21q0 1.26-.87 2.13T4.2 24m4.2-11.4q.54 0 .87-.45t.33-1.05-.33-1.05-.87-.45-.87.45-.33 1.05.33 1.05.87.45m7.2 0q.54 0 .87-.45t.33-1.05-.33-1.05-.87-.45-.87.45-.33 1.05.33 1.05.87.45",
            ])
        case .replicas:
            MarkArt(width: 225, height: 300, color: Self.replicasInk, opticalScale: 0.94, paths: [
                "M0 0H150V75H0ZM150 75H225V150H150ZM0 150H150V225H0ZM0 225H75V300H0ZM150 225H225V300H150Z",
            ])
        }
    }
}
