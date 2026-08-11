import SidecarCore
import SwiftUI

struct DevelopmentSurface: View {
    static let canvasSize = CGSize(width: 760, height: 520)

    let snapshot: DemoSnapshot

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.sidecarCanvasTop, Color.sidecarCanvasBottom],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(spacing: 22) {
                CapsuleHeader(digest: snapshot.digest)

                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Agent activity")
                                .font(.system(size: 22, weight: .semibold, design: .rounded))
                            Text("A deterministic preview — no live sessions connected")
                                .font(.system(size: 13))
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        FixtureBadge(version: snapshot.fixtureVersion)
                    }

                    VStack(spacing: 10) {
                        ForEach(snapshot.sessions) { session in
                            SessionRow(session: session)
                        }
                    }
                }
                .padding(22)
                .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 24))
                .overlay {
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                }
            }
            .padding(.horizontal, 42)
            .padding(.vertical, 30)
        }
        .ignoresSafeArea()
        .accessibilityIdentifier("sidecar-development-surface")
    }
}

private struct CapsuleHeader: View {
    let digest: SessionDigest

    var body: some View {
        HStack(spacing: 14) {
            VoiceWave()

            VStack(alignment: .leading, spacing: 2) {
                Text("Luke")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text(digest.headline)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.68))
            }

            Spacer(minLength: 8)

            Circle()
                .fill(Color.attentionAccent)
                .frame(width: 8, height: 8)
                .shadow(color: Color.attentionAccent.opacity(0.8), radius: 6)
                .accessibilityLabel("Attention available")
        }
        .padding(.horizontal, 20)
        .frame(width: 330, height: 70)
        .background(Color.black.opacity(0.92), in: Capsule())
        .overlay {
            Capsule().stroke(Color.white.opacity(0.11), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.45), radius: 24, y: 12)
        .accessibilityIdentifier("sidecar-capsule")
    }
}

private struct VoiceWave: View {
    private let heights: [CGFloat] = [10, 18, 28, 20, 34, 24, 14]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(heights.enumerated()), id: \.offset) { index, height in
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color.waveAccent, Color.waveAccent.opacity(0.45)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 3, height: height)
                    .opacity(index == heights.count - 1 ? 0.65 : 1)
            }
        }
        .frame(width: 40, height: 38)
        .accessibilityHidden(true)
    }
}

private struct FixtureBadge: View {
    let version: Int

    var body: some View {
        Text("FIXTURE  ·  V\(version)")
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(0.7)
            .foregroundStyle(Color.waveAccent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.waveAccent.opacity(0.1), in: Capsule())
            .overlay {
                Capsule().stroke(Color.waveAccent.opacity(0.24), lineWidth: 1)
            }
    }
}

private struct SessionRow: View {
    let session: DemoSession

    var body: some View {
        HStack(spacing: 14) {
            statusMark

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Text(session.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(session.provider.rawValue)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.secondary)
                }

                Text(session.detail)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.55))
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(session.status.displayName)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(statusColor)
                Text(session.repository)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.35))
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 72)
        .background(Color.black.opacity(0.19), in: RoundedRectangle(cornerRadius: 16))
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(session.status.requiresAttention ? Color.attentionAccent.opacity(0.28) : Color.white.opacity(0.04))
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("session-\(session.id)")
    }

    private var statusMark: some View {
        ZStack {
            Circle()
                .fill(statusColor.opacity(0.13))
                .frame(width: 34, height: 34)
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)
        }
    }

    private var statusColor: Color {
        switch session.status {
        case .working:
            .waveAccent
        case .waitingForUser:
            .attentionAccent
        case .completed:
            .completeAccent
        }
    }
}

private extension Color {
    static let sidecarCanvasTop = Color(red: 0.075, green: 0.086, blue: 0.12)
    static let sidecarCanvasBottom = Color(red: 0.035, green: 0.04, blue: 0.06)
    static let waveAccent = Color(red: 0.32, green: 0.82, blue: 0.98)
    static let attentionAccent = Color(red: 1.0, green: 0.59, blue: 0.25)
    static let completeAccent = Color(red: 0.42, green: 0.83, blue: 0.60)
}
