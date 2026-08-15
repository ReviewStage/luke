import AppKit
import Foundation

private struct ScreenGeometry: Codable {
    let displayId: UInt32
    let safeAreaTop: Double
    let menuBarHeight: Double
    let notchWidth: Double
    let hasNotch: Bool
}

@main
@MainActor
private struct ScreenGeometryCommand {
    static func main() throws {
        let screens = NSScreen.screens.compactMap { screen -> ScreenGeometry? in
            guard let displayNumber = screen.deviceDescription[
                NSDeviceDescriptionKey("NSScreenNumber")
            ] as? NSNumber else {
                return nil
            }

            let leftArea = screen.auxiliaryTopLeftArea
            let rightArea = screen.auxiliaryTopRightArea
            let hasNotch = leftArea != nil && rightArea != nil && screen.safeAreaInsets.top > 0
            let notchWidth: Double
            if let leftArea, let rightArea, hasNotch {
                notchWidth = max(0, rightArea.minX - leftArea.maxX)
            } else {
                notchWidth = 0
            }

            return ScreenGeometry(
                displayId: displayNumber.uint32Value,
                safeAreaTop: screen.safeAreaInsets.top,
                menuBarHeight: screen.frame.maxY - screen.visibleFrame.maxY,
                notchWidth: notchWidth,
                hasNotch: hasNotch
            )
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(screens))
    }
}
