import SwiftUI
import UIKit

// MARK: - Appearance-resolved colour

extension Color {
    /// One colour per appearance, resolved where the view draws it, so every
    /// surface follows the system's light/dark setting with no scheme
    /// override anywhere.
    init(dark: UIColor, light: UIColor) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        })
    }
}

// MARK: - Surface palette

/// The surface colours, one name per role. Every dark value is what the app
/// drew before it had a light form — the desktop panel's dark-only palette
/// (apps/desktop/src/renderer/styles/base.css) — so dark mode still matches
/// the desktop exactly. The desktop offers no light values to copy, so each
/// light value is chosen here as its dark value's mirror: the same role at
/// the same weight on a light ground, with the two accents deepened because
/// the desktop's read on near-black and would wash out on white.
extension Color {
    static let ground = Color(
        dark: UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1),
        light: UIColor(red: 0.95, green: 0.95, blue: 0.96, alpha: 1)
    )
    static let cardFill = Color(
        dark: UIColor(red: 0.12, green: 0.12, blue: 0.13, alpha: 1),
        light: UIColor.white
    )
    static let cardStroke = Color(
        dark: UIColor(white: 1, alpha: 0.08),
        light: UIColor(white: 0, alpha: 0.08)
    )
    static let controlStroke = Color(
        dark: UIColor(white: 1, alpha: 0.10),
        light: UIColor(white: 0, alpha: 0.10)
    )
    static let pressedFill = Color(
        dark: UIColor(white: 1, alpha: 0.06),
        light: UIColor(white: 0, alpha: 0.06)
    )
    static let cardShadow = Color(
        dark: UIColor(white: 0, alpha: 0.42),
        light: UIColor(white: 0, alpha: 0.12)
    )

    static let ink = Color(
        dark: UIColor.white,
        light: UIColor(red: 0.09, green: 0.09, blue: 0.10, alpha: 1)
    )
    static let inkSecondary = Color(
        dark: UIColor(white: 1, alpha: 0.5),
        light: UIColor(white: 0, alpha: 0.5)
    )
    static let inkTertiary = Color(
        dark: UIColor(white: 1, alpha: 0.3),
        light: UIColor(white: 0, alpha: 0.3)
    )
    static let inkLink = Color(
        dark: UIColor(white: 1, alpha: 0.85),
        light: UIColor(white: 0, alpha: 0.85)
    )

    static let errorInk = Color(
        dark: UIColor(red: 0.95, green: 0.4, blue: 0.4, alpha: 1),
        light: UIColor(red: 0.72, green: 0.15, blue: 0.15, alpha: 1)
    )
    static let warningInk = Color(
        dark: UIColor(red: 0.95, green: 0.75, blue: 0.4, alpha: 1),
        light: UIColor(red: 0.62, green: 0.42, blue: 0.05, alpha: 1)
    )
    /// The desktop's --state-complete, the green a finished session wears.
    static let stateComplete = Color(
        dark: UIColor(red: 0x6F / 255, green: 0xDC / 255, blue: 0xA4 / 255, alpha: 1),
        light: UIColor(red: 0x1F / 255, green: 0x8F / 255, blue: 0x5C / 255, alpha: 1)
    )
}
