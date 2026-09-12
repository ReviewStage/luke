# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `./scripts/check.sh` | Portable repository, type, test, and build checks |
| `./scripts/verify.sh` | Complete macOS validation plus visual evidence |
| `./scripts/run.sh` | Launch against live sessions, replacing any running instance (`--fixture smoke`, `--keep-running`, `--no-trace`) |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm evidence:record` | Record the fixture transition on a physical Mac |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |

`./scripts/verify.sh` is the completion invariant for any macOS or UI change. CI
runs the portable check on Linux alone, and no macOS job is coming back: Dean
ruled on 2026-09-11 that the release rehearsal (`release.yml`'s `macos-15` job,
run on a `v*` tag push or a manual dispatch) is the only Mac gate, recorded on
`orchestration/storage-plan` at `e7b57a9a` in `plan/decisions.md`. A pull
request builds nothing for the Mac and produces no visual evidence, so a green
PR says nothing about the Mac and there is no macOS check to wait for. A UI
PR's evidence is the developer's own `verify.sh` run, its body must say CI could
not verify it, and a Mac break that lands anyway is caught at the rehearsal on a
tag, not at review. LUKE-159 is the manual `verify.sh` pass on a Mac that stands
in for the missing job before the first release.

## Never

- Never let a credential or account secret enter a Gateway answer or event, the
  voice window, a counted event, a trace, or a fixture. Nothing in this repository
  scans for secrets, so this rule is the whole of the check.
- Session replay records the rendered panel with no allowlist in front of it, so
  drawing something new on the panel decides what leaves the machine.

## The scheduled pass and the briefing push

- The one observation that runs on a clock of Luke's own is the service's
  scheduled pass, and it is bounded on every side. Vercel's cron calls
  `/api/observation/tick` once a minute (`apps/web/vercel.json`;
  `apps/web/server/hosted/observation-tick.ts`) under the deployment's own
  `CRON_SECRET`, compared in constant time, and a deployment missing that secret
  or the key-encryption secret answers unavailable and observes nothing, since a
  pass that could read no key would be written down as an account with nothing.
  It runs only for an account that holds a synced cloud provider key and has a
  device row seen within the last 7 days
  (`OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS`; `listEligibleAccounts` in
  `apps/web/server/observation-app.ts`), at most 200 accounts a tick, least
  recently attempted first, four at a time inside a 50-second budget with a
  25-second deadline per account; and every tick begins by dropping the
  snapshot, the waiting diffs, the brain's bookmark, and the pass record of
  every account no longer eligible, so a deleted key or a week's silence ends
  the observation and empties what it kept. One account's pass is the same
  read-only fan-out the on-demand endpoint runs, on a plugin built for that
  pass alone under the account's decrypted key (`observation-pass.ts` over
  `cloud-observe.ts`): the workspaces, the chats, each chat's status, the agent
  kinds, and the projects the provider reports, and no chat's messages. A pass
  every provider answered whole replaces the account's one `roster_snapshot`
  row, sealed under the same server-only secret as the keys and stamped with a
  fingerprint of the key it was observed under, so a snapshot observed under
  another key is neither served, admitted against, nor diffed from; a pass any
  provider refused, rate limited, or failed leaves the previous snapshot
  standing and is recorded as failed. Nothing in the pass decides anything: no
  model runs in it, and nothing leaves it. What the snapshot is kept for is the
  opener (`apps/web/server/hosted/brain-host/opener.ts`), which runs for the
  same account right after its pass and under the same deadline: it derives
  what changed by diffing the snapshot the pass just wrote against the bookmark
  it last kept level with a snapshot (`roster_consumed`), and hands the hosted
  brain one observation turn per session the diff named, at most eight turns an
  account a tick with a hold's releases counted among them, as the deployment
  acting for that one account under the tick's own secret
  (`EVE_CALLER.DEPLOYMENT`), so the account named to the brain is only ever one
  this tick enumerated, and nothing but such a diff or a hold's release opens a
  scheduled turn. A visit that could not hand its change over leaves the
  bookmark where it was, and the next visit derives the same change again,
  wider by whatever moved since, until the two rows stand more than five
  minutes apart on their own instants (`OBSERVATION_TICK.STALE_GAP_MS`), which
  means no visit has caught the brain up for that long (a paused cron, a deploy
  gap, a rotated secret, a provider refusing every pass, or the brain refusing
  every turn): the visit then reseeds the bookmark from the snapshot as it
  stands, wakes nothing from the gap, and counts the reseed in the tick's
  answer as `turns.reseeded`, because what changed in between is history the
  roster already shows and not news. A visit with nothing to wake keeps the
  bookmark level with the snapshot all the same, so an idle roster never reads
  as a gap, and the next change under a reseeded bookmark wakes as usual. The
  wake carries the session as the snapshot holds it and its change in words
  rendered as data, and, for a chat the diff named, what its transcript gained
  since the cursor kept for it, read through the provider's documented
  incremental read (Conductor's `transcriptSince`) under the same synced key,
  cut from the front to 20,000 characters (`BRAIN_HOST.TRANSCRIPT_DELTA_CHARS`),
  its cursor advanced only past one the provider handed back and only once the
  brain has accepted the turn. That read is the one place a scheduled turn
  reads a message; the pass itself never does. Widening what the pass reads,
  who it runs for, how long a snapshot stands, how wide a gap still wakes, or
  what a wake carries is a product decision, not an implementation detail, and
  `PRIVACY.md` discloses the pass under "Scheduled observation of your
  Conductor sessions".
- Luke's words leave his own service unbidden in one place, and it is the
  service rather than this Mac they leave from: the briefing push to a phone
  (`apps/web/server/hosted/speech-push.ts`), run on the scheduled tick after the
  speech sweep and by nothing else. What it may carry is only a briefing the
  brain has already decided, the settled `announce` call's own words read back
  from the announcing row under the tool's 600-character bound
  (`briefing-words.ts`; `maximumBriefingLength`), and it decides from two things
  it reads and nothing it infers: how the offer stands, and what the account's
  devices last reported of themselves. No Mac reporting itself active means the
  words are pushed now; a Mac active but not claiming within two minutes of the
  offer (`SPEECH_PUSH.GRACE_MS`) means they are pushed anyway; a claim means a
  device is saying them and the offer is never pushed, whatever became of the
  claim; a quiet instant standing on any device of the account, a meeting its
  calendar hold observes, means nothing is pushed and nothing expires until it
  lifts; and an offer past its own instant is the sweep's to end, never pushed
  stale. A phone or watch reporting itself present is no reason to wait, since
  neither can say a briefing (`SPEAKING_PLATFORMS`). The mark precedes the send:
  `markSpeechPushed` settles the offer under the conversation's lock, only a
  mark that landed is sent, and the next tick finds it settled, so what is
  guaranteed is at most one push per briefing, never that it arrived; a send
  Apple refused or the network dropped is counted, ends the pass, and is retried
  nowhere, and a token Apple reports gone deletes that device's row. One device
  is addressed, the account's most recently seen device holding a push token,
  because a phone forwards to its paired watch itself and two pushes would be
  one briefing told twice. The notification (`briefingNotification`) is the
  words as the alert body, the default sound, the ordinary interruption level
  that breaks through no Focus, and one custom key, the pushed message's id
  (`BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID` in
  `packages/hosted/src/device-wire.ts`), an opaque UUID of Luke's own that the
  phone's tap opens the Conversation at; no title, subtitle, thread, or collapse
  key, and no session title, branch, path, error line, or identity beyond what
  the words themselves contain. It is readable on a locked screen and Apple
  carries it under its own terms, which is why the words and that id are the
  whole payload. A deployment without the Apple credential (`APNS_ENVIRONMENT`)
  constructs no sender and pushes nothing, the same kill switch every hosted
  endpoint keeps. Widening what a push carries, when it is sent, or which
  platforms it waits for is a product decision, not an implementation detail,
  and `PRIVACY.md` says each in as many words under "Briefing notifications" and
  the Apple line of "Who we send it to".

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
