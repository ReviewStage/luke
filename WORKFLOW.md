# Workflow

1. Start from a scoped issue and an isolated workspace. Confirm non-goals and
   trust constraints before editing.
2. Bootstrap with `./scripts/bootstrap.sh`, then make the smallest change that
   satisfies the issue. Use deterministic fixtures instead of personal data or
   live provider state.
3. Run `./scripts/check.sh`. For macOS work, also run
   `./scripts/test-macos.sh`; for visible changes, run `./scripts/evidence.sh`
   and inspect the PNG.
4. Review the complete diff for secrets, machine-specific paths, generated
   files, unsupported provider behavior, and accidental scope expansion.
5. Open a focused PR. Record commands and results in the template's Evidence
   section, attach the generated screenshot, and call out physical-device checks
   that remain.

Stop and report a genuine blocker when validation requires unavailable access,
credentials, hardware, or a product decision. Agents prepare evidence and
recommendations; humans own final review, merge, release, signing, and
notarization decisions.
