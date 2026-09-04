# `@sidecar/brain`

## One agent, one memory, re-sent every turn

The brain is one long-lived Responses agent (`brain-agent.ts`). Its whole
memory — every input item from the latest compaction item onward — is re-sent
on every turn, so anything that enters a turn stays in context until the API
folds it. That is why what a wake carries is the design decision of this
package: a wake that appended raw transcript text would fill the memory with
worker output, and the coordinator would degrade as it grew. The memory and
the transcript cursors move together and roll back together on a failed turn,
so a delta is re-read and re-summarized rather than skipped.

## The marker-then-data rule

Every item a turn opens with (`brain-input.ts`) is one marker line from
`BRAIN_INPUT_MARKER` and then observed values as JSON. The marker is the
whole of the instruction; the instructions (`brain-instructions.ts`) tell the
model that everything after it is data, however a title, a hook, a digest, or
a tool's answer is phrased. The summarizer's input keeps the same shape at one
remove: observed fields as plain lines, then `DIGEST_INPUT_MARKER`, then the
slice. Nothing composes a sentence out of observed values on either path.

## The digest boundary

Raw transcript text reaches the brain through one door: its own
`read_transcript` tool. A wake — a provider's hook, or the 60-second roster
look — reads what each woken local session's transcript gained since the last
look, cut from the front to `BRAIN_DEFAULTS.DELTA_PER_SESSION_CHARS`, and
hands the slice to a `DigestClient` (`brain-digest-client.ts`), never to the
brain. The client runs the request `brain-digest-openai.ts` builds — no tools,
`store: false`, a strict JSON schema — on the developer's key or through the
hosted service, and the answer comes back through `digestFromModel`, which
refuses anything off-schema rather than repairing it. Whatever the client
cannot answer (absent, quiet, late past `DIGEST_DEADLINE_MS`, failed, thrown,
refused) falls to `fallbackDigest`, built from the hook token and the roster
status alone; a late answer is discarded. The fallback reads no transcript,
so no failure path can carry raw text into the memory under a digest's name.

The digest names no session. `DigestInput` carries no provider or session id;
the agent attaches the answer to the identity the roster gave the wake. A
roster event whose read came back empty is dropped before any summarizer
call, so a look on which nothing grew costs nothing and carries no event.
`BRAIN_WAKE_HOOK` repeats the three spool tokens the fallback reads because
this package does not import the providers package; the parity test in
`apps/desktop/src/main/brain-flow.test.ts` pins them to `HOOK_EVENT`.

## Tools are validated against the roster, never against words

Every tool argument naming a session is checked against the identities the
host's roster reported this turn (`BrainRoster.identities`); an act goes to the
host's performer as a function call and is validated there again. Nothing a
model wrote — a digest field, a briefing, a title read back — can address a
session, and `announce` is refused in a developer-ask turn, where the final
text is the speech.

## What the trace may keep

`BrainTurnTraceRecord` and the devtrace's digest record carry counts, timings,
outcomes, and values from fixed sets: item kinds, transcript and digest
character counts, a stop state, a model name. Never a transcript's text and
never a digest's words, which are a model's rendering of a transcript.

## The `PRIVACY.md` obligation

`PRIVACY.md` says, in as many words, that the new part of a local session's
transcript goes to a small OpenAI model to fill a fixed form, what the form's
fields are, how much a slice may carry, that the roster look summarizes only
sessions whose transcripts grew, and that the judgment may read one transcript
in full. Moving any of those — the form's fields, `DELTA_PER_SESSION_CHARS`,
`FULL_TRANSCRIPT_CHARS`, the roster look's payload, or where a slice travels —
is a product decision that moves `PRIVACY.md` in the same change.
