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
     like. A standing section's bullets are each one sentence with no period
     at the end. One voice per section: feature prose and Improvements speak
     in the present tense to "you", with Luke as the actor; Fixes each read
     "Fixed <symptom you could see>"; Miscellaneous bullets read
     "Added/Updated …". "Now" only where the old behavior is the contrast —
     a new capability speaks in plain present tense. Name things concretely
     and lead with the benefit. Link pull requests where relevant.
     Screenshots live in apps/web/public/changelog/<version>/, one file per
     `###` section named by the section heading's kebab-case slug (a second
     image for a section keeps the slug as its prefix), and are written here
     repository-relative (apps/web/public/changelog/<version>/<slug>.png) so
     GitHub renders them too; the page rewrites that prefix to the site root.
     A release's screenshots are frozen with it — they show what shipped, so
     a UI change gets a new screenshot in the release that changed it, never
     an edit to an old one — and every capture uses fixture data
     (./scripts/run.sh --fixture smoke), because a real session's title or
     branch committed to history stays there. -->

Notable changes to Luke, newest first. Each heading is a released version and
the date its release was published.

## 0.1.1 — 2026-08-18

### Free daily allowance

Luke's voice runs on an included daily allowance. Want more? Connect your own
OpenAI key.
([#182](https://github.com/ReviewStage/luke/pull/182),
[#204](https://github.com/ReviewStage/luke/pull/204),
[#216](https://github.com/ReviewStage/luke/pull/216))

!["What Luke runs on" in Settings: the included daily allowance chosen over an OpenAI key, with its talking and session-check meters part-spent.](apps/web/public/changelog/0.1.1/free-daily-allowance.png)

### Google Calendar

Luke reads when your meetings start and end, and holds his updates until the
meeting is over.
([#195](https://github.com/ReviewStage/luke/pull/195))

![The Google Calendar card in Settings: a connected account with its calendars chosen and "Quiet during meetings" switched on.](apps/web/public/changelog/0.1.1/google-calendar.png)

### Improvements

- Luke checks for updates on his own
  ([#186](https://github.com/ReviewStage/luke/pull/186))
- Announcements now join a conversation you already have open, with a
  clickable chip that jumps to the session
  ([#180](https://github.com/ReviewStage/luke/pull/180),
  [#184](https://github.com/ReviewStage/luke/pull/184))
- Every Settings page marks changed rows and offers a reset to defaults
  ([#192](https://github.com/ReviewStage/luke/pull/192))
- You can delete your Luke account from Settings
  ([#222](https://github.com/ReviewStage/luke/pull/222))
- Luke can set a Conductor session's model and effort in one move
  ([#228](https://github.com/ReviewStage/luke/pull/228))
- Signing in is smoother, from first launch to the finished account
  ([#190](https://github.com/ReviewStage/luke/pull/190))
- The archive control now lives on the workspace tray header, and the
  microphone permission on the Voice page
  ([#219](https://github.com/ReviewStage/luke/pull/219),
  [#200](https://github.com/ReviewStage/luke/pull/200))

### Fixes

- Fixed Luke repeating himself across back-to-back replies
  ([#227](https://github.com/ReviewStage/luke/pull/227))
- Fixed the microphone staying open after an exchange ended
  ([#210](https://github.com/ReviewStage/luke/pull/210))
- Fixed archived Conductor workspaces still appearing in the list
  ([#198](https://github.com/ReviewStage/luke/pull/198))
- Fixed captions scrolling too fast to read
  ([#201](https://github.com/ReviewStage/luke/pull/201))
- Fixed Claude Code sessions showing the wrong time
  ([#208](https://github.com/ReviewStage/luke/pull/208))
- Fixed Luke misunderstanding questions about all your sessions at once
  ([#213](https://github.com/ReviewStage/luke/pull/213))

### Miscellaneous

- Added logo and mark variations
  ([#191](https://github.com/ReviewStage/luke/pull/191),
  [#196](https://github.com/ReviewStage/luke/pull/196))
- Updated the landing page download button to always fetch the latest build
  ([#183](https://github.com/ReviewStage/luke/pull/183))

## 0.1.0 — 2026-08-17

The first release: Luke is a voice agent that lives in the MacBook notch and
watches every local and cloud coding agent session.

### One panel for every agent

One panel shows every coding agent working for you — Claude Code, Codex,
Cursor, and OpenCode on your Mac, and Conductor, Cursor, Devin, Google Jules,
and GitHub Copilot in the cloud. Filter, sort, or search the list, and click a
session to open it where it runs.
([#18](https://github.com/ReviewStage/luke/pull/18),
[#27](https://github.com/ReviewStage/luke/pull/27),
[#59](https://github.com/ReviewStage/luke/pull/59),
[#166](https://github.com/ReviewStage/luke/pull/166))

![The panel expanded from the notch over the desktop, listing agent sessions with their status, recaps, and follow-up fields.](apps/web/public/changelog/0.1.0/one-panel-for-every-agent.png)

### Talk to Luke

Hold <kbd>⌥</kbd><kbd>S</kbd> to speak with Luke, or press <kbd>⌥</kbd><kbd>L</kbd>
to type to him from any app. He answers about sessions, changes his own
settings, opens sessions, messages agents, creates workspaces and spawns
agents, and reads and acts on Linear issues.
([#12](https://github.com/ReviewStage/luke/pull/12),
[#78](https://github.com/ReviewStage/luke/pull/78),
[#70](https://github.com/ReviewStage/luke/pull/70),
[#89](https://github.com/ReviewStage/luke/pull/89))

![The capsule beside the notch with the voice meter lit while Luke listens.](apps/web/public/changelog/0.1.0/talk-to-luke.png)

### Announcements

Luke speaks up when a session starts waiting, hits an error, or finishes —
captions on screen, Music and Spotify quieted while he talks, and a clickable
chip naming the session. Ask him to "tell me when this finishes" and he will.
([#97](https://github.com/ReviewStage/luke/pull/97),
[#149](https://github.com/ReviewStage/luke/pull/149),
[#173](https://github.com/ReviewStage/luke/pull/173))

### Miscellaneous

- Added hook observation for Claude Code and Codex, so Luke can tell a
  finished turn from one you walked away from
  ([#119](https://github.com/ReviewStage/luke/pull/119),
  [#169](https://github.com/ReviewStage/luke/pull/169))
- Added Luke's face to the menu bar and the notch
  ([#35](https://github.com/ReviewStage/luke/pull/35),
  [#51](https://github.com/ReviewStage/luke/pull/51))
- Added settings for showing Luke in the menu bar and Dock, the display he
  stands on, his voice and pace, and editable shortcuts
- Added a feedback panel — send the founders a note or a prompt straight from
  Luke ([#87](https://github.com/ReviewStage/luke/pull/87))
- Added sign-in with Google or GitHub
  ([#161](https://github.com/ReviewStage/luke/pull/161))
