// Luke humming along while the wait lasts.
//
// The motion is the artwork's monitoring sway — "quiet work, made visible",
// which is what a wait is — ported from the same table
// design/generate-brand-assets.mjs cuts the brand SVGs and the desktop's
// keyframes from. A hand copy, like the geometry in Marks.swift: change both
// when the artwork moves. The face only ever marks time already being spent;
// it never holds a load open to finish a cycle.
import SwiftUI

// MARK: - Loading face

struct LukeLoadingFace: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var born = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: reduceMotion)) { context in
            let motion = reduceMotion
                ? CGAffineTransform.identity
                : LoadingSway.motion(at: context.date.timeIntervalSince(born))
            Canvas { ctx, size in
                FaceArt.draw(ctx, size: size, box: FaceArt.motionBox, motion: motion)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel("Loading")
    }
}

// MARK: - Sway

/// luke-monitoring's cycle, evaluated from the artwork's keyframes rather
/// than played by a compositor, so a frame is a pure function of elapsed
/// time and Reduce Motion can hold the rest pose. It begins and ends
/// upright, so the first drawn frame is the resting face.
private enum LoadingSway {
    private static let cycleSeconds = 3.6
    private static let pivot = CGPoint(x: 120, y: 196)
    private static let degrees = KeyframeTrack(
        times: [0, 0.25, 0.5, 0.75, 1],
        values: [0, 3.5, 0, -3.5, 0],
        easing: artworkEase.value
    )

    static func motion(at elapsed: TimeInterval) -> CGAffineTransform {
        let cycle = max(elapsed, 0).truncatingRemainder(dividingBy: cycleSeconds)
        return FaceArt.rotation(
            degrees: CGFloat(degrees.value(at: cycle / cycleSeconds)),
            about: pivot
        )
    }
}

// MARK: - Timing

/// A generated face-motion.css rule's shape: values at fractions of the
/// cycle, one easing curve applied to every interval.
private struct KeyframeTrack {
    let times: [Double]
    let values: [Double]
    let easing: (Double) -> Double

    func value(at progress: Double) -> Double {
        if progress <= times[0] { return values[0] }
        guard let last = times.last, progress < last else { return values[values.count - 1] }
        var index = 1
        while times[index] <= progress { index += 1 }
        let span = times[index] - times[index - 1]
        let local = span > 0 ? (progress - times[index - 1]) / span : 1
        return values[index - 1] + (values[index] - values[index - 1]) * easing(local)
    }
}

/// The artwork's shared curve: every generated layer rule plays
/// cubic-bezier(0.4, 0, 0.6, 1).
private let artworkEase = UnitBezier(0.4, 0, 0.6, 1)

/// cubic-bezier(x1, y1, x2, y2), solved the way a compositor solves it:
/// x(t) inverted by Newton with a bisection fallback, then y at that t.
private struct UnitBezier {
    private let ax, bx, cx, ay, by, cy: Double

    init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
        cx = 3 * x1
        bx = 3 * (x2 - x1) - cx
        ax = 1 - cx - bx
        cy = 3 * y1
        by = 3 * (y2 - y1) - cy
        ay = 1 - cy - by
    }

    func value(_ x: Double) -> Double {
        sampleY(solveX(min(max(x, 0), 1)))
    }

    private func sampleX(_ t: Double) -> Double { ((ax * t + bx) * t + cx) * t }
    private func sampleY(_ t: Double) -> Double { ((ay * t + by) * t + cy) * t }
    private func sampleDerivativeX(_ t: Double) -> Double { (3 * ax * t + 2 * bx) * t + cx }

    private func solveX(_ x: Double) -> Double {
        var t = x
        for _ in 0..<8 {
            let error = sampleX(t) - x
            if abs(error) < 1e-6 { return t }
            let slope = sampleDerivativeX(t)
            if abs(slope) < 1e-6 { break }
            t -= error / slope
        }
        var low = 0.0, high = 1.0
        t = x
        while high - low > 1e-6 {
            if sampleX(t) < x { low = t } else { high = t }
            t = (low + high) / 2
        }
        return t
    }
}
