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
  brackets filled in and one block beside them, the speaking policies. **Every
  other optional control from the guide's appendix is absent until listening
  shows a behavior it would change.** That block stands because the model
  paraphrases every commentary it is handed, so the spoken words are chosen
  here and nowhere else; each line is one labelled policy stating one behavior,
  the template's own shape, with no sample line.

No full persona stands here: `@sidecar/guide`'s is the brain's, and shapes
what the brain hands the voice.

## Tests

The tests here assert values and structure only. **No test reads the prose.**
