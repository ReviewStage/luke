import LukeKit
import SwiftUI

// MARK: - Provider keys section

/// The provider-keys section of the profile sheet's grouped list: one row per
/// provider the vault accepts, each opening an editor to enter or delete that
/// provider's key. Only presence and timestamps are drawn — the vault never
/// answers a key, nor any fragment of one. The editor selection is the
/// sheet's, because a `Section` cannot carry presentation modifiers of its
/// own inside a `List`.
struct VaultSection: View {
    @Environment(VaultStore.self) private var vault
    @Binding var editing: VaultProviderID?

    var body: some View {
        Section {
            if let error = vault.loadError {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.errorInk)
                    Button("Try again") {
                        Task { await vault.load() }
                    }
                    .font(.footnote.weight(.semibold))
                }
            }
            ForEach(VaultProviderID.allCases) { provider in
                Button {
                    editing = provider
                } label: {
                    VaultProviderRow(provider: provider, entry: vault.entry(for: provider))
                }
                .redacted(reason: vault.isLoading ? .placeholder : [])
            }
        } header: {
            Text("Provider keys")
        } footer: {
            Text("Stored encrypted in your Luke account so Luke can observe these providers' cloud sessions.")
        }
    }
}

// MARK: - Row

private struct VaultProviderRow: View {
    let provider: VaultProviderID
    let entry: VaultKeyEntry?

    var body: some View {
        HStack(spacing: 12) {
            ProviderMark(provider: provider)
                .frame(width: 18, height: 18)
            // The concrete label colors, not the hierarchical styles: inside
            // a list button the inherited foreground style is the tint, and
            // hierarchical .primary would keep the row's words accent-blue.
            Text(provider.displayName)
                .foregroundStyle(Color.primary)
            if entry != nil {
                ConnectedCheck()
                    .frame(width: 12, height: 12)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.secondary)
        }
    }
}

/// The one green thing on the line, matching the desktop's credential check
/// stroke for stroke: the same path in the palette a finished session uses,
/// so connected reads the same way complete does.
private struct ConnectedCheck: View {
    var body: some View {
        Canvas { ctx, size in
            ctx.transform = CGAffineTransform(scaleX: size.width / 24, y: size.width / 24)
            ctx.stroke(
                Path(cgPath(fromSVG: "M4.8 12.6 9.6 17.3 19.2 6.9")),
                with: .color(.stateComplete),
                style: StrokeStyle(lineWidth: 1.9, lineCap: .round, lineJoin: .round)
            )
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - Editor

/// The sheet a row opens: paste a key to store or replace, or delete the one
/// standing. The field is the one place a key ever appears, and it is never
/// echoed back after Save. Drawn with the system's own sheet vocabulary —
/// inline title, toolbar Cancel and Save, grouped form — like the profile
/// sheet that opens it.
struct VaultKeyEditor: View {
    @Environment(VaultStore.self) private var vault
    @Environment(\.dismiss) private var dismiss
    let provider: VaultProviderID

    @State private var key = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ProviderMark(provider: provider)
                        .frame(width: 44, height: 44)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }

                Section {
                    SecureField("Paste \(credentialNoun.lowercased())", text: $key)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        if let message = errorMessage ?? shapeRejection ?? formatRejection {
                            Text(message)
                                .foregroundStyle(Color.errorInk)
                        }
                        Text(hintText)
                    }
                }

                if let entry = vault.entry(for: provider) {
                    Section {
                        Button("Delete key", role: .destructive) { deleteKey() }
                            .frame(maxWidth: .infinity)
                            .disabled(busy)
                    } footer: {
                        Text("A key was saved on \(entry.updatedAt.formatted(date: .abbreviated, time: .omitted)). "
                            + "Saving a new key will replace it.")
                    }
                }
            }
            .navigationTitle(provider.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Save") { save() }
                            .disabled(!keyIsSavable)
                    }
                }
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(busy)
    }

    private var credentialNoun: String {
        provider.keyFormat?.label ?? "API key"
    }

    /// The hint with its inline key-page link underlined, so the link reads
    /// as one inside footer-grey copy rather than by colour alone.
    private var hintText: AttributedString {
        guard var text = try? AttributedString(markdown: provider.keyHint) else {
            return AttributedString(provider.keyHint)
        }
        for run in text.runs where run.link != nil {
            text[run.range].underlineStyle = .single
        }
        return text
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
