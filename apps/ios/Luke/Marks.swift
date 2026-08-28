// Provider marks and the Luke face mark, matching the geometry from the web and desktop.
// Google G keeps its four official brand colours. GitHub mark rides the view's foreground.
// Luke's face is derived from FACE_ART in @sidecar/surface.
import CoreGraphics
import SwiftUI

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
    // Rides `foregroundStyle` on dark ground per GitHub's own guidance.
    private static let path = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"

    var body: some View {
        Canvas { ctx, size in
            ctx.transform = CGAffineTransform(scaleX: size.width / 16, y: size.width / 16)
            ctx.fill(Path(cgPath(fromSVG: Self.path)), with: .foreground)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
