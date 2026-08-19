# Changelog

<!-- Every release adds its entry here before its tag is pushed:
     .github/RELEASE.md describes the step, and scripts/repository-checks.sh
     refuses a desktop version this file does not name. The landing page
     renders this document at tryluke.dev/changelog, and each release heading
     is a contract with that page: exactly `## <version> — <YYYY-MM-DD>`, which
     becomes the release's sticky version-and-date rail. Inside a release, a
     big feature gets a `###` section of its own, named for the feature and
     described in prose — with a screenshot where one helps. Everything else
     gathers under the three standing sections, in this order: `### Improvements`
     for what got better, `### Fixes` for what got repaired, and
     `### Miscellaneous` for what fits neither — brand, packaging, and the
     like. Link pull requests where relevant.
     Screenshots live in apps/web/public/changelog/ and are written here
     repository-relative (apps/web/public/changelog/<name>.png) so GitHub
     renders them too; the page rewrites that prefix to the site root. -->

Notable changes to Luke, newest first. Each heading is a released version and
the date its release was published.

## 0.1.1 — 2026-08-18

### Voice and review on your Luke account

Sign in and Luke's voice and session review run on an included daily
allowance — no OpenAI key required. Settings shows what today's allowance
covers and lets you choose what it runs on.
([#182](https://github.com/ReviewStage/luke/pull/182),
[#204](https://github.com/ReviewStage/luke/pull/204),
[#216](https://github.com/ReviewStage/luke/pull/216))

### Google Calendar

Luke reads when your meetings start and end, holds spoken announcements while
one is running, and releases them once it ends. Connecting is Google's own
consent flow, Luke keeps only the busy intervals — an event's title cannot
even travel — and several accounts stand side by side.
([#195](https://github.com/ReviewStage/luke/pull/195))

### Improvements

- Luke checks for updates automatically and at the press of the Updates row's
  button. ([#186](https://github.com/ReviewStage/luke/pull/186))
- Announcements join a conversation you already have open instead of talking
  over it, and the pressable session notice is anchored to the spoken
  announcement. ([#180](https://github.com/ReviewStage/luke/pull/180),
  [#184](https://github.com/ReviewStage/luke/pull/184))
- Every Settings page offers reset to defaults, with changed rows marked.
  ([#192](https://github.com/ReviewStage/luke/pull/192))
- A Luke account can be deleted from Settings, behind a confirmation.
  ([#222](https://github.com/ReviewStage/luke/pull/222))
- A spoken ask can set a Conductor session's model and effort in one change.
  ([#228](https://github.com/ReviewStage/luke/pull/228))
- The signed-out experience was reworked end to end, and feedback notes are
  signed by the signed-in account.
  ([#190](https://github.com/ReviewStage/luke/pull/190),
  [#193](https://github.com/ReviewStage/luke/pull/193))
- The workspace archive control moved from each chat row to the tray header,
  and the microphone permission onto the Voice page.
  ([#219](https://github.com/ReviewStage/luke/pull/219),
  [#200](https://github.com/ReviewStage/luke/pull/200))

### Fixes

- Luke no longer repeats himself across back-to-back replies.
  ([#227](https://github.com/ReviewStage/luke/pull/227))
- The microphone is put away as soon as a spoken exchange settles.
  ([#210](https://github.com/ReviewStage/luke/pull/210))
- Archived Conductor workspaces the listing does not mark are dropped from the
  session roster. ([#198](https://github.com/ReviewStage/luke/pull/198))
- A caption spoken into a muted Mac paces itself for reading and holds until
  read. ([#201](https://github.com/ReviewStage/luke/pull/201))
- Claude Code sessions are dated by their conversation records alone.
  ([#208](https://github.com/ReviewStage/luke/pull/208))
- Whole-picture questions are answered across every session, not just the one
  under discussion. ([#213](https://github.com/ReviewStage/luke/pull/213))

### Miscellaneous

- Square, transparent, and black variants of Luke's mark, and a shareable logo
  set beside them. ([#191](https://github.com/ReviewStage/luke/pull/191),
  [#196](https://github.com/ReviewStage/luke/pull/196))
- The release workflow publishes the DMG beside the app archive, so the
  landing page's download button always reaches the newest build.
  ([#183](https://github.com/ReviewStage/luke/pull/183))

## 0.1.0 — 2026-08-17

The first release: Luke stands beside the MacBook notch and watches every
coding-agent session on the machine and in the cloud.

### One panel for every agent

A capsule beside the housing peeks on hover and expands into a panel of every
session — Claude Code, Codex, Cursor, and OpenCode read from their own records
on this machine; Conductor, Cursor, Devin, Google Jules, and GitHub Copilot
each behind an API key stored in the Keychain. Rows say what each agent is
doing — title, branch, model, current tool, failure, and the provider's
recap — with filtering, sorting, and search, and a press opens a session where
its provider keeps it. Cloud sessions take messages and their providers'
advertised controls straight from a row.
([#18](https://github.com/ReviewStage/luke/pull/18),
[#27](https://github.com/ReviewStage/luke/pull/27),
[#59](https://github.com/ReviewStage/luke/pull/59),
[#166](https://github.com/ReviewStage/luke/pull/166))

### Talk to Luke

Hold the talk key to speak with Luke, or type to him from the panel and from
any app. He answers about sessions, changes his own settings, opens sessions,
messages agents, creates workspaces and spawns agents, and reads and acts on
Linear issues. ([#12](https://github.com/ReviewStage/luke/pull/12),
[#78](https://github.com/ReviewStage/luke/pull/78),
[#70](https://github.com/ReviewStage/luke/pull/70),
[#89](https://github.com/ReviewStage/luke/pull/89))

### Announcements

Luke speaks up when a session starts waiting, stops on an error, or
finishes — captioned on screen, quieting Music and Spotify while he talks,
with a pressable notice naming the session. A standing ask — "tell me when
this finishes" — decides when a session speaks.
([#97](https://github.com/ReviewStage/luke/pull/97),
[#149](https://github.com/ReviewStage/luke/pull/149),
[#173](https://github.com/ReviewStage/luke/pull/173))

### Miscellaneous

- Hook observation for Claude Code and Codex, so a turn that just ended reads
  differently from a session walked away from, and local transcripts read
  aloud on ask. ([#119](https://github.com/ReviewStage/luke/pull/119),
  [#169](https://github.com/ReviewStage/luke/pull/169))
- Luke's face in the menu bar and the notch — still unless something is
  happening to it, with a one-shot trick on hover.
  ([#35](https://github.com/ReviewStage/luke/pull/35),
  [#51](https://github.com/ReviewStage/luke/pull/51))
- Settings for menu-bar and Dock visibility, the display Luke stands on, his
  voice and pace, and editable shortcuts.
- Feedback to the founders from the panel.
  ([#87](https://github.com/ReviewStage/luke/pull/87))
- Sign-in with Google or GitHub, and a signed, notarized macOS DMG.
  ([#161](https://github.com/ReviewStage/luke/pull/161),
  [#40](https://github.com/ReviewStage/luke/pull/40))
