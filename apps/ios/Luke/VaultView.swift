import LukeKit
import SwiftUI

// MARK: - Provider keys section

/// The vault card on the signed-in screen: one row per provider the vault
/// accepts, each opening an editor to enter or delete that provider's key.
/// Only presence and timestamps are drawn — the vault never answers a key,
/// nor any fragment of one.
struct VaultSection: View {
    @Environment(VaultStore.self) private var vault
    @State private var editing: VaultProviderID?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Provider keys")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.white)
            Text("Stored encrypted in your Luke account so Luke can observe these providers' cloud sessions.")
                .font(.caption)
                .foregroundStyle(Color(white: 1, opacity: 0.5))
                .padding(.top, 4)

            if let error = vault.loadError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                    .padding(.top, 12)
                Button("Try again") {
                    Task { await vault.load() }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.white)
                .padding(.top, 8)
            }

            VStack(spacing: 0) {
                ForEach(VaultProviderID.allCases) { provider in
                    Button {
                        editing = provider
                    } label: {
                        VaultProviderRow(provider: provider, entry: vault.entry(for: provider))
                    }
                    .buttonStyle(.plain)
                    if provider != VaultProviderID.allCases.last {
                        Divider().overlay(Color(white: 1, opacity: 0.08))
                    }
                }
            }
            .padding(.top, 16)
            .redacted(reason: vault.isLoading ? .placeholder : [])
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(red: 0.12, green: 0.12, blue: 0.13))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(white: 1, opacity: 0.08), lineWidth: 1)
                )
        )
        .task { await vault.load() }
        .sheet(item: $editing) { provider in
            VaultKeyEditor(provider: provider)
        }
    }
}

// MARK: - Row

private struct VaultProviderRow: View {
    let provider: VaultProviderID
    let entry: VaultKeyEntry?

    var body: some View {
        HStack(spacing: 8) {
            ProviderMark(provider: provider)
                .frame(width: 18, height: 18)
            Text(provider.displayName)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.white)
            if entry != nil {
                ConnectedCheck()
                    .frame(width: 12, height: 12)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color(white: 1, opacity: 0.3))
        }
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

/// The one green thing on the line, matching the desktop's credential check
/// stroke for stroke: the same path in the palette a finished session uses,
/// so connected reads the same way complete does.
private struct ConnectedCheck: View {
    private static let stateComplete = Color(
        red: 0x6F / 255, green: 0xDC / 255, blue: 0xA4 / 255
    )

    var body: some View {
        Canvas { ctx, size in
            ctx.transform = CGAffineTransform(scaleX: size.width / 24, y: size.width / 24)
            ctx.stroke(
                Path(cgPath(fromSVG: "M4.8 12.6 9.6 17.3 19.2 6.9")),
                with: .color(Self.stateComplete),
                style: StrokeStyle(lineWidth: 1.9, lineCap: .round, lineJoin: .round)
            )
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - Editor

/// The sheet a row opens: paste a key to store or replace, or delete the one
/// standing. The field is the one place a key ever appears, and it is never
/// echoed back after Save.
private struct VaultKeyEditor: View {
    @Environment(VaultStore.self) private var vault
    @Environment(\.dismiss) private var dismiss
    let provider: VaultProviderID

    @State private var key = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Color(red: 0.09, green: 0.09, blue: 0.10).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    ProviderMark(provider: provider)
                        .frame(width: 24, height: 24)
                    Text(provider.displayName)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.white)
                }

                if let entry = vault.entry(for: provider) {
                    Text("A key stored \(entry.updatedAt.formatted(date: .abbreviated, time: .omitted)) "
                        + "stands. Saving replaces it.")
                        .font(.caption)
                        .foregroundStyle(Color(white: 1, opacity: 0.5))
                }

                Text(hintText)
                    .font(.caption)
                    .foregroundStyle(Color(white: 1, opacity: 0.5))
                    .tint(Color(white: 1, opacity: 0.85))

                SecureField("", text: $key, prompt: promptText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 15))
                    .foregroundStyle(Color.white)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color(red: 0.12, green: 0.12, blue: 0.13))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color(white: 1, opacity: 0.10), lineWidth: 1)
                            )
                    )
                    .padding(.top, 8)

                if let message = errorMessage ?? shapeRejection ?? formatRejection {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                }

                HStack(spacing: 12) {
                    Button(busy ? "Saving…" : "Save") { save() }
                        .buttonStyle(EditorButtonStyle())
                        .disabled(!keyIsSavable || busy)

                    if vault.entry(for: provider) != nil {
                        Button("Delete key", role: .destructive) { deleteKey() }
                            .buttonStyle(EditorButtonStyle(destructive: true))
                            .disabled(busy)
                    }

                    Spacer()

                    Button("Cancel") { dismiss() }
                        .buttonStyle(EditorButtonStyle())
                        .disabled(busy)
                }
                .padding(.top, 8)

                Spacer()
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium])
    }

    private var credentialNoun: String {
        provider.keyFormat?.label ?? "API key"
    }

    /// The hint with its inline key-page link underlined, so the link reads
    /// as one inside caption-grey copy rather than by colour alone.
    private var hintText: AttributedString {
        guard var text = try? AttributedString(markdown: provider.keyHint) else {
            return AttributedString(provider.keyHint)
        }
        for run in text.runs where run.link != nil {
            text[run.range].underlineStyle = .single
        }
        return text
    }

    private var promptText: Text {
        Text("Paste \(credentialNoun.lowercased())")
            .foregroundStyle(Color(white: 1, opacity: 0.3))
    }

    /// Says why Save is disabled for a malformed key; a silently dead button
    /// explains nothing.
    private var shapeRejection: String? {
        guard !key.isEmpty, !VaultClient.isValidKey(key) else { return nil }
        return VaultStore.message(for: VaultClientError.invalidKey)
    }

    private var formatRejection: String? {
        guard let format = provider.keyFormat, !key.isEmpty, !key.hasPrefix(format.prefix) else {
            return nil
        }
        return format.rejection
    }

    private var keyIsSavable: Bool {
        VaultClient.isValidKey(key) && formatRejection == nil
    }

    private func save() {
        busy = true
        errorMessage = nil
        Task {
            do {
                try await vault.store(key: key, for: provider)
                dismiss()
            } catch {
                errorMessage = VaultStore.message(for: error)
            }
            busy = false
        }
    }

    private func deleteKey() {
        busy = true
        errorMessage = nil
        Task {
            do {
                try await vault.delete(provider)
                dismiss()
            } catch {
                errorMessage = VaultStore.message(for: error)
            }
            busy = false
        }
    }
}

private struct EditorButtonStyle: ButtonStyle {
    var destructive = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(destructive ? Color(red: 0.95, green: 0.4, blue: 0.4) : Color.white)
            .frame(height: 40)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(configuration.isPressed
                        ? Color(white: 1, opacity: 0.06)
                        : Color(red: 0.12, green: 0.12, blue: 0.13))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color(white: 1, opacity: 0.10), lineWidth: 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
