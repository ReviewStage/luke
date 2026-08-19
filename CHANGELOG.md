# Changelog

<!-- Every release adds its entry here before its tag is pushed:
     .github/RELEASE.md describes the step, and scripts/repository-checks.sh
     refuses a desktop version this file does not name. The landing page
     renders this document at tryluke.dev/changelog. -->

Notable changes to Luke, newest first. Each heading is a released version and
the date its release was published.

## 0.1.1 — 2026-08-18

### Added

- A Luke account now carries voice and session review on an included daily
  allowance — no OpenAI key required — with the allowance and what it runs on
  shown in Settings.
- Google Calendar: Luke reads when your meetings start and end, holds spoken
  announcements while one is running, and releases them once it ends.
- Update checks, automatic and on request, from the panel's Updates row.
- Announcements now join a conversation you already have open instead of
  talking over it, and the pressable session notice is anchored to the spoken
  announcement.
- Per-page reset to defaults in Settings, with changed rows marked.
- Deleting a Luke account, behind a confirmation.
- A spoken ask can set a Conductor session's model and effort in one change.

### Changed

- The signed-out experience was reworked end to end, and feedback notes are
  signed by the signed-in account.
- The workspace archive control moved from each chat row to the tray header,
  and the microphone permission onto the Voice page.
- The automatic-update-check switch was retired; checking is simply on.

### Fixed

- Luke no longer repeats himself across back-to-back replies.
- The microphone is put away as soon as a spoken exchange settles.
- Archived Conductor workspaces the listing does not mark are dropped from the
  session roster.
- A caption spoken into a muted Mac paces itself for reading and holds until
  read.
- Claude Code sessions are dated by their conversation records alone.
- Whole-picture questions are answered across every session, not just the one
  under discussion.

## 0.1.0 — 2026-08-17

The first release.

- A notch-side surface: a capsule beside the MacBook housing that peeks on
  hover and expands into a panel of every coding-agent session on the machine
  and in the cloud.
- Local observation of Claude Code, Codex, Cursor, and OpenCode sessions, read
  from the providers' own records on disk.
- Cloud observation of Conductor, Cursor, Devin, Google Jules, and GitHub
  Copilot sessions, each behind an API key entered in Settings and stored in
  the Keychain.
- Session rows that say what each agent is doing — title, branch, model,
  current tool, failure, and the provider's recap — with filtering, sorting,
  search, and a press that opens the session where its provider keeps it.
- Messages and provider-advertised controls on cloud sessions, straight from a
  row.
- Voice: hold the talk key to speak with Luke, or type to him from the panel
  and from any app. He answers about sessions, changes his own settings, opens
  sessions, messages agents, creates workspaces and spawns agents, and reads
  and acts on Linear issues.
- Spoken announcements when a session starts waiting, stops on an error, or
  finishes — captioned on screen, quieting Music and Spotify while Luke talks,
  with a pressable notice naming the session — and a standing ask ("tell me
  when this finishes") deciding when a session speaks.
- Hook observation for Claude Code and Codex, so a turn that just ended reads
  differently from a session walked away from, and local transcripts read
  aloud on ask.
- Luke's face in the menu bar and the notch — still unless something is
  happening to it, with a one-shot trick on hover.
- Settings for menu-bar and Dock visibility, the display Luke stands on, his
  voice and pace, and editable shortcuts; feedback to the founders from the
  panel.
- Sign-in with Google or GitHub, and a signed, notarized macOS DMG.
