// Converts an SVG `d` attribute string to a CGPath.
// Handles: M m L l H h V v C c S s Q q A a Z z
// Enough to draw the Google G, GitHub mark, and Luke face.
import CoreGraphics

func cgPath(fromSVG d: String) -> CGPath {
    let p = CGMutablePath()
    var tok = SVGTokenizer(d)
    var cur = CGPoint.zero
    var sub = CGPoint.zero
    var lastCtrl: CGPoint? = nil
    var lastCmd: Character = "M"

    while !tok.isDone {
        let cmd: Character
        if let c = tok.nextCommand() {
            cmd = c
            lastCmd = c
        } else if tok.hasNumber {
            switch lastCmd {
            case "M": cmd = "L"
            case "m": cmd = "l"
            default: cmd = lastCmd
            }
        } else {
            break
        }

        let rel = cmd.isLowercase

        func abs(_ dx: CGFloat, _ dy: CGFloat) -> CGPoint {
            rel ? CGPoint(x: cur.x + dx, y: cur.y + dy) : CGPoint(x: dx, y: dy)
        }

        switch cmd.lowercased() {
        case "m":
            let (x, y) = tok.nextPair()
            cur = abs(x, y)
            p.move(to: cur)
            sub = cur
            lastCmd = rel ? "l" : "L"
            lastCtrl = nil

        case "l":
            let (x, y) = tok.nextPair()
            cur = abs(x, y)
            p.addLine(to: cur)
            lastCtrl = nil

        case "h":
            let x = tok.nextNumber()
            cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y)
            p.addLine(to: cur)
            lastCtrl = nil

        case "v":
            let y = tok.nextNumber()
            cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y)
            p.addLine(to: cur)
            lastCtrl = nil

        case "c":
            let (x1, y1) = tok.nextPair()
            let (x2, y2) = tok.nextPair()
            let (x, y) = tok.nextPair()
            let c1 = abs(x1, y1), c2 = abs(x2, y2), end = abs(x, y)
            p.addCurve(to: end, control1: c1, control2: c2)
            lastCtrl = c2
            cur = end

        case "s":
            let (x2, y2) = tok.nextPair()
            let (x, y) = tok.nextPair()
            let c1 = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
            let c2 = abs(x2, y2), end = abs(x, y)
            p.addCurve(to: end, control1: c1, control2: c2)
            lastCtrl = c2
            cur = end

        case "q":
            let (x1, y1) = tok.nextPair()
            let (x, y) = tok.nextPair()
            let c = abs(x1, y1), end = abs(x, y)
            p.addQuadCurve(to: end, control: c)
            lastCtrl = nil
            cur = end

        case "a":
            let rx = tok.nextNumber(), ry = tok.nextNumber(), xRot = tok.nextNumber()
            let la = tok.nextFlag(), sw = tok.nextFlag()
            let (x, y) = tok.nextPair()
            let end = abs(x, y)
            addSVGArc(to: p, from: cur, rx: rx, ry: ry, xRot: xRot, la: la, sw: sw, end: end)
            cur = end
            lastCtrl = nil

        case "z":
            p.closeSubpath()
            cur = sub
            lastCtrl = nil

        default: break
        }
    }
    return p
}

// SVG endpoint-to-center arc conversion (W3C spec §B.2.4).
private func addSVGArc(
    to path: CGMutablePath,
    from p1: CGPoint, rx: CGFloat, ry: CGFloat,
    xRot: CGFloat, la: Bool, sw: Bool, end p2: CGPoint
) {
    guard p1 != p2 else { return }
    var rx = abs(rx), ry = abs(ry)
    guard rx > 1e-6, ry > 1e-6 else { path.addLine(to: p2); return }

    let phi = xRot * .pi / 180
    let cp = cos(phi), sp = sin(phi)
    let dx2 = (p1.x - p2.x) / 2, dy2 = (p1.y - p2.y) / 2
    let x1p = cp * dx2 + sp * dy2
    let y1p = -sp * dx2 + cp * dy2
    let x1p2 = x1p * x1p, y1p2 = y1p * y1p

    // Scale radii if needed.
    var rx2 = rx * rx, ry2 = ry * ry
    let lam = x1p2 / rx2 + y1p2 / ry2
    if lam > 1 { let s = sqrt(lam); rx *= s; ry *= s; rx2 = rx * rx; ry2 = ry * ry }

    let num = max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2)
    let den = rx2 * y1p2 + ry2 * x1p2
    let sq = (la != sw ? 1.0 : -1.0) * sqrt(num / max(den, 1e-10))
    let cxp = sq * rx * y1p / ry
    let cyp = -sq * ry * x1p / rx
    let cx = cp * cxp - sp * cyp + (p1.x + p2.x) / 2
    let cy = sp * cxp + cp * cyp + (p1.y + p2.y) / 2

    func vecAngle(ux: CGFloat, uy: CGFloat, vx: CGFloat, vy: CGFloat) -> CGFloat {
        let n = sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
        var a = acos(max(-1, min(1, (ux * vx + uy * vy) / max(n, 1e-10))))
        if ux * vy - uy * vx < 0 { a = -a }
        return a
    }

    let start = vecAngle(ux: 1, uy: 0, vx: (x1p - cxp) / rx, vy: (y1p - cyp) / ry)
    var dAngle = vecAngle(
        ux: (x1p - cxp) / rx, uy: (y1p - cyp) / ry,
        vx: (-x1p - cxp) / rx, vy: (-y1p - cyp) / ry
    )
    if !sw && dAngle > 0 { dAngle -= 2 * .pi }
    else if sw && dAngle < 0 { dAngle += 2 * .pi }

    // In SwiftUI Canvas (Y increases down), CGPath `clockwise: true` means
    // counterclockwise on screen. SVG sweep=true = clockwise on screen → clockwise: false.
    path.addArc(
        center: CGPoint(x: cx, y: cy), radius: rx,
        startAngle: start, endAngle: start + dAngle,
        clockwise: !sw
    )
}

// MARK: - Tokenizer

private struct SVGTokenizer {
    private let chars: [Character]
    private var pos: Int = 0

    init(_ s: String) { chars = Array(s) }

    var isDone: Bool { pos >= chars.count }

    var hasNumber: Bool {
        var p = pos
        while p < chars.count, chars[p].isWhitespace || chars[p] == "," { p += 1 }
        guard p < chars.count else { return false }
        return chars[p].isNumber || chars[p] == "-" || chars[p] == "+" || chars[p] == "."
    }

    mutating func nextCommand() -> Character? {
        skipSep()
        guard pos < chars.count, chars[pos].isLetter else { return nil }
        defer { pos += 1 }
        return chars[pos]
    }

    mutating func nextNumber() -> CGFloat {
        skipSep()
        var s = ""
        if pos < chars.count, chars[pos] == "-" || chars[pos] == "+" {
            s.append(chars[pos]); pos += 1
        }
        while pos < chars.count, chars[pos].isNumber { s.append(chars[pos]); pos += 1 }
        if pos < chars.count, chars[pos] == "." {
            s.append(chars[pos]); pos += 1
            while pos < chars.count, chars[pos].isNumber { s.append(chars[pos]); pos += 1 }
        }
        if pos < chars.count, chars[pos] == "e" || chars[pos] == "E" {
            s.append(chars[pos]); pos += 1
            if pos < chars.count, chars[pos] == "-" || chars[pos] == "+" {
                s.append(chars[pos]); pos += 1
            }
            while pos < chars.count, chars[pos].isNumber { s.append(chars[pos]); pos += 1 }
        }
        return CGFloat(Double(s) ?? 0)
    }

    mutating func nextPair() -> (CGFloat, CGFloat) { (nextNumber(), nextNumber()) }

    mutating func nextFlag() -> Bool {
        skipSep()
        guard pos < chars.count, chars[pos] == "0" || chars[pos] == "1" else { return false }
        let v = chars[pos] == "1"; pos += 1
        if pos < chars.count, chars[pos] == "," { pos += 1 }
        return v
    }

    private mutating func skipSep() {
        while pos < chars.count, chars[pos].isWhitespace || chars[pos] == "," { pos += 1 }
    }
}
