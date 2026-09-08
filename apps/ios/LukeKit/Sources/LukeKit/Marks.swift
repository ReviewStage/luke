import CoreGraphics
import SwiftUI

/// FACE_ART constants (packages/surface/src/generated/face-art.ts), in the
/// artwork's own 240×240 canvas coordinates. A hand copy: change both when
/// the artwork moves.
public enum FaceArt {
    /// The face cropped to itself (MARK_VIEW_BOX). Only for a face that never
    /// moves: it is tight enough that any motion would leave it.
    public static let markBox = CGRect(x: 53.85, y: 62.67, width: 134.29, height: 122.37)
    /// The square window motions play in (VIEW_BOX), with headroom to move.
    public static let motionBox = CGRect(x: 48, y: 51, width: 146, height: 146)
    public static let strokeWidth: CGFloat = 16
    public static let eyeY: CGFloat = 92
    public static let eyeRadius: CGFloat = 12
    public static let eyeXs: [CGFloat] = [78, 162]
    private static let tiltDegrees: CGFloat = -8
    private static let tiltPivot = CGPoint(x: 120, y: 124)

    /// Smile: M 104 84 V 150 Q 104 164 118 164 Q 140 164 168 142
    public static let smile: Path = {
        var path = Path()
        path.move(to: CGPoint(x: 104, y: 84))
        path.addLine(to: CGPoint(x: 104, y: 150))
        path.addQuadCurve(to: CGPoint(x: 118, y: 164), control: CGPoint(x: 104, y: 164))
        path.addQuadCurve(to: CGPoint(x: 168, y: 142), control: CGPoint(x: 140, y: 164))
        return path
    }()

    /// The head's resting tilt, about the point the motions pivot on.
    public static let tilt = rotation(degrees: tiltDegrees, about: tiltPivot)

    public static func rotation(degrees: CGFloat, about pivot: CGPoint) -> CGAffineTransform {
        CGAffineTransform(translationX: pivot.x, y: pivot.y)
            .rotated(by: degrees * .pi / 180)
            .translatedBy(x: -pivot.x, y: -pivot.y)
    }

    /// Draws the face fitted to `box`'s crop of the canvas, with `motion`
    /// applied to the whole head in canvas coordinates outside the resting
    /// tilt — the same nesting the desktop's layer groups give the generated
    /// keyframes.
    public static func draw(
        _ context: GraphicsContext,
        size: CGSize,
        box: CGRect,
        motion: CGAffineTransform = .identity
    ) {
        let scale = min(size.width / box.width, size.height / box.height)
        let placement = CGAffineTransform(scaleX: scale, y: scale)
            .translatedBy(x: -box.minX, y: -box.minY)
        let transform = tilt.concatenating(motion).concatenating(placement)

        context.stroke(
            smile.applying(transform), with: .foreground,
            style: StrokeStyle(lineWidth: strokeWidth * scale, lineCap: .round, lineJoin: .round)
        )
        for eyeX in eyeXs {
            let eye = CGRect(
                x: eyeX - eyeRadius, y: eyeY - eyeRadius,
                width: eyeRadius * 2, height: eyeRadius * 2
            )
            context.fill(Path(ellipseIn: eye).applying(transform), with: .foreground)
        }
    }
}

/// Luke's face, drawn from the artwork above and inked by the view's
/// foreground. Both apps draw this one; the watch's own copy of it is what
/// this file replaced.
public struct LukeMark: View {
    public init() {}

    public var body: some View {
        Canvas { context, size in
            FaceArt.draw(context, size: size, box: FaceArt.markBox)
        }
        .aspectRatio(FaceArt.markBox.width / FaceArt.markBox.height, contentMode: .fit)
    }
}
