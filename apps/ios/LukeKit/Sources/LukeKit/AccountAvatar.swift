import SwiftUI

/// The account's own avatar, falling back to its initials, drawn on the
/// phone's account controls and the wrist's. A provider's avatar URL can
/// outlive the image it named, so a failed fetch draws the letters rather
/// than leaving a broken frame. The inks are the caller's, since each app
/// has its own palette.
public struct AccountAvatar: View {
    private let identity: AccountIdentity
    private let diameter: CGFloat
    private let ink: Color
    private let secondaryInk: Color

    public init(
        identity: AccountIdentity,
        diameter: CGFloat,
        ink: Color = .primary,
        secondaryInk: Color = .secondary
    ) {
        self.identity = identity
        self.diameter = diameter
        self.ink = ink
        self.secondaryInk = secondaryInk
    }

    public var body: some View {
        Group {
            if let url = identity.pictureURL {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initialsCircle
                    }
                }
            } else {
                initialsCircle
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
    }

    private var initialsCircle: some View {
        ZStack {
            Circle().fill(ink.opacity(0.12))
            if let initials = identity.initials {
                Text(initials)
                    .font(.system(size: diameter * 0.4, weight: .semibold))
                    .foregroundStyle(ink)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: diameter * 0.44))
                    .foregroundStyle(secondaryInk)
            }
        }
    }
}
