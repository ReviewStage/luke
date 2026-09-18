import ImageIO
import SwiftUI

/// The account's own avatar, falling back to its initials, drawn on the
/// phone's account controls and the wrist's. A provider's avatar URL can
/// outlive the image it named, so a failed fetch draws the letters rather
/// than leaving a broken frame. The inks are the caller's, since each app
/// has its own palette, and so is the URLSession the picture travels on:
/// the wrist hands over the one that waits for a path (`WatchNetwork`),
/// which `AsyncImage`'s shared session would not.
public struct AccountAvatar: View {
    private let identity: AccountIdentity
    private let diameter: CGFloat
    private let ink: Color
    private let secondaryInk: Color
    private let http: URLSession
    @State private var picture: CGImage?

    public init(
        identity: AccountIdentity,
        diameter: CGFloat,
        ink: Color = .primary,
        secondaryInk: Color = .secondary,
        http: URLSession = .shared
    ) {
        self.identity = identity
        self.diameter = diameter
        self.ink = ink
        self.secondaryInk = secondaryInk
        self.http = http
    }

    public var body: some View {
        Group {
            if let picture {
                Image(picture, scale: 1, label: Text(identity.name ?? identity.email))
                    .resizable()
                    .scaledToFill()
            } else {
                initialsCircle
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
        .task(id: identity.pictureURL) {
            guard let url = identity.pictureURL else { return picture = nil }
            // A load the view's disappearance cancelled says nothing about
            // the picture, so it leaves whatever is drawn standing.
            guard let loaded = await Self.fetchPicture(url, http: http), !Task.isCancelled
            else { return }
            picture = loaded
        }
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

    /// The picture, or nothing: a refused fetch or bytes that decode to no
    /// image both leave the letters standing.
    private static func fetchPicture(_ url: URL, http: URLSession) async -> CGImage? {
        guard let (data, _) = try? await http.data(from: url),
              let source = CGImageSourceCreateWithData(data as CFData, nil)
        else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}
