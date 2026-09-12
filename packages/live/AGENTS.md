# `@sidecar/live`

The vocabulary a GPT Live session is created, driven, and read with, declared once
so no consumer re-encodes it, and Node-free so it rides into the renderer bundle,
the host, and a web function alike.

**Nothing here opens a socket, creates a session, or holds one.**

## Rules that are not visible in the types

- An append carries a required `delegation_id`, `null` included, because the API
  requires the field and a builder that defaulted it would hide the one decision
  an append turns on: whether it answers a delegation or speaks session-wide.
- A transcript delta is admitted untrimmed and may be whitespace — the captions
  recipe forbids trimming a fragment.
- `RENDERER_CLIENT_EVENTS` and `RENDERER_SERVER_EVENTS` are what an untrusted
  window may send and is shown. **Every append and every delegation stays with the
  trusted side.**
- `liveSessionConfig` sets **no field the API does not document for WebRTC** — no
  `audio.format`, no tools, no speed, no truncation.
- `instructions.ts` is the Live prompting guide's starter template with its
  brackets filled in and nothing beside them. **Every optional control from the
  guide's appendix is absent until listening shows a behavior it would change.**
  `INTRODUCTION` names no delegation capability and says never, because the
  accountless endpoint wires no carrier.

No persona stands here — `@sidecar/guide`'s is the brain's, whose words the voice
says — and the backend preamble is a prompt section of `@sidecar/brain`.

## What the voice knows of the desk, and what it must not

`roster-seed.ts` is the one thing of the desk the voice knows, and **it is a
summary, not a roster**, so a session can answer which agents run, wait, finished,
or failed without a delegation. The brain's own roster — its identities, transcript
reads, and everything an action names — is not here and never reaches the voice.

`RosterSeedSession` is a narrow input the host maps its own `Session` onto, so
this package reaches no registry and **the fields a line may not carry — the
error, branch, repository, model, address, workspace — are absent from the type
rather than dropped in the rendering.**

The age bucket comes off `lastActivityAt`, the only timestamp any provider
reports, so it says how long since the session was *written about* and never how
long it has been working.

`RosterTold` is what a session was actually given, held by identity, and never the
roster it was meant to have. That is what keeps a diff honest under everything
that can go wrong between deciding a refresh and delivering it — a refusal, a
summary the append bound cut short, a change arriving mid-flight — since each
leaves the rows it never carried exactly as they stood, to be said again. A
departure leads an update, because a line the voice never hears leaves it
uninformed where a withdrawal it never hears leaves it offering something gone.

A refresh whose every line reads the same produces nothing, which is what keeps a
conversation's cached prefix warm across a pass that observed no change.

## Tests

The tests here assert values and structure only. **No test reads the prose.**
