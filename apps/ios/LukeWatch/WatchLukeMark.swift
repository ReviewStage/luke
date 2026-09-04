import CoreGraphics
import SwiftUI

// Luke face mark for watchOS. Hand copy of FaceArt + LukeMark from
// apps/ios/Luke/Marks.swift — change both when the artwork moves.
// The UIKit import and motion/animation paths are omitted; the watch
// mark is static and UIKit is unavailable on watchOS.

private enum FaceArt {
    static let markBox = CGRect(x: 53.85, y: 62.67, width: 134.29, height: 122.37)
    static let strokeWidth: CGFloat = 16
    static let eyeY: CGFloat = 92
    static let eyeRadius: CGFloat = 12
    static let eyeXs: [CGFloat] = [78, 162]
    private static let tiltDegrees: CGFloat = -8
    private static let tiltPivot = CGPoint(x: 120, y: 124)

    static let smile: Path = {
        var path = Path()
        path.move(to: CGPoint(x: 104, y: 84))
        path.addLine(to: CGPoint(x: 104, y: 150))
        path.addQuadCurve(to: CGPoint(x: 118, y: 164), control: CGPoint(x: 104, y: 164))
        path.addQuadCurve(to: CGPoint(x: 168, y: 142), control: CGPoint(x: 140, y: 164))
        return path
    }()

    static let tilt = CGAffineTransform(translationX: tiltPivot.x, y: tiltPivot.y)
        .rotated(by: tiltDegrees * .pi / 180)
        .translatedBy(x: -tiltPivot.x, y: -tiltPivot.y)

    static func draw(_ ctx: GraphicsContext, size: CGSize) {
        let box = markBox
        let scale = min(size.width / box.width, size.height / box.height)
        let placement = CGAffineTransform(scaleX: scale, y: scale)
            .translatedBy(x: -box.minX, y: -box.minY)
        let t = tilt.concatenating(placement)
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

struct WatchLukeMark: View {
    var body: some View {
        Canvas { ctx, size in
            FaceArt.draw(ctx, size: size)
        }
        .aspectRatio(FaceArt.markBox.width / FaceArt.markBox.height, contentMode: .fit)
    }
}
