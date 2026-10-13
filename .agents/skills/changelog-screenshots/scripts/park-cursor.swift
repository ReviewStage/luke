// park-cursor.swift -- moves the pointer onto the menu bar, where it hovers nothing in a window.
import CoreGraphics

let bounds = CGDisplayBounds(CGMainDisplayID())
let spot = CGPoint(x: bounds.midX, y: bounds.minY + 1)
CGWarpMouseCursorPosition(spot)
// Note that we also post a move, because a warp alone sends no event and the page keeps its last hover.
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: spot, mouseButton: .left)?.post(tap: .cghidEventTap)
