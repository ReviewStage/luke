# Workflow

1. Start from a scoped issue and an isolated workspace. Confirm non-goals and
   trust constraints before editing.
2. Bootstrap with `./scripts/bootstrap.sh`, then make the smallest change that
   satisfies the issue. Use deterministic fixtures instead of personal data or
   live provider state. Put regression coverage at the cheapest layer that
   would have caught a behavior bug; use visual evidence for appearance-only
   changes.
3. Run `./scripts/check.sh` for portable-only work. For a macOS, Electron-window,
   native-adapter, microphone, or desktop UI change, run `./scripts/verify.sh`;
   it packages the desktop app and generates visual evidence. Inspect all PNGs.
   For a web UI change, run `npm run dev --workspace @luke/web` and inspect the
   page in a browser. For desktop motion changes, run `npm run evidence:record`
   on a physical Mac and inspect the generated MP4 or GIF before publishing it.
4. Review the complete diff for secrets, machine-specific paths, generated
   files, unsafe IPC, unsupported provider behavior, and accidental scope
   expansion.
5. Open a focused PR. Record commands and results in the template's Evidence
   section. For every UI change, upload an inspected verification screenshot to
   the PR description's Evidence section through GitHub's PR editor. For desktop
   UI, use a PNG from `./scripts/verify.sh` in `artifacts/evidence/`; for web UI,
   capture the page after running `npm run dev --workspace @luke/web`. CI
   maintains the automated-evidence link there. Attach physical-device
   screenshots or recordings through GitHub's PR editor and call out
   physical-notch checks that remain.

Stop and report a genuine blocker when validation requires unavailable access,
credentials, hardware, or a product decision. Agents prepare evidence and
recommendations; humans own final review, merge, release signing, and
notarization decisions.
