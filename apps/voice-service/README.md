# Luke's hosted voice service

The one process on Luke's side that holds a GPT Live project key. A desktop
with no OpenAI key of its own opens one WebSocket here per voice session; the
service creates the session at OpenAI from the desktop's WebRTC offer,
attaches the trusted sideband itself, answers the SDP, and from then on is a
pipe between the desktop and OpenAI. It keeps no conversation, reads no frame
past its `type`, and writes down status codes and counts. The desktop's side
of this contract is `live-contract.ts` in `@sidecar/hosted`; the Live grammar
both ends speak is `@sidecar/live`.

It is its own long-running container rather than a Vercel function because
whoever holds the project key must hold the sideband for the whole session,
and a function can hold neither a socket nor a call.

## Routes

Both are WebSocket upgrades; one session per socket.

| Path | Who | Authorization |
| --- | --- | --- |
| `/sessions` | A signed-in desktop | `Authorization: Bearer <account token>` on the handshake, forwarded whole to the account service's `VOICE_AUTHORIZE` route, which resolves the account and spends its allowance before any session exists |
| `/introduction` | A fresh install with no account | None; the service's own meter, per hashed caller address and shared, both per UTC day. The caller is the last `X-Forwarded-For` hop, the one the platform's proxy appended, so a client cannot name itself; the counts live in this process, so run one machine or accept a per-replica ceiling |
| `GET /healthz` | The platform's health probe | None |

The socket's first frame is the desktop's `session.create` (the SDP offer, a
voice from `LIVE_VOICE`, and the seed as `input` items). The service answers
`session.created` with the opaque session id, the SDP answer, and, on
`/sessions`, the quota the session was spent against. After that, GPT Live
events cross as themselves.

### What crosses, and what does not

- Desktop to OpenAI on `/sessions`: every frame, untouched. The desktop's host
  is the session's trusted side at one remove; its appends and close are its
  own.
- OpenAI to desktop on `/sessions`: every frame, untouched, except
  `session.input_audio.append` and `session.output_audio.delta`, which are
  dropped by type so the developer's voice and Luke's never transit this
  service. Audio stays on the WebRTC media tracks between the desktop and
  OpenAI.
- On `/introduction` the sideband is the service's alone: the caller may send
  only what a renderer's data channel may (`session.input_audio.mute`,
  `session.input_audio.unmute`, `session.close`) and is shown only what a
  renderer's data channel is shown (the lifecycle, both captions, the
  microphone acknowledgments, usage, error, info). On `session.started` the
  service sends `greetingInstruction()` as one `session.instructions.append`
  with `delegation_id: null`, once, the docs' "greet before the caller
  speaks" pattern from the trusted side. The seed is bounded to one developer
  message of at most 1,024 characters, since it is client text entering a
  prompt on Luke's key with no account behind it.

Every session is created with `liveSessionConfig` from `@sidecar/live`: the
scene's instructions, client delegation, `store: false`, and the renderer's
`client.data_channel` permissions (`RENDERER_CLIENT_EVENTS`,
`RENDERER_SERVER_EVENTS`), and nothing the API does not document for WebRTC.

### How a session ends

`session.closed` is finalization. When it arrives the service forwards it,
reports `usage.seconds` once to the account service's `VOICE_USAGE` route
(the route's own ledger answers `repeated` to a second report of the same
session, so a retry cannot bill twice), and closes both ends. A desktop that
hangs up first has `session.close` sent on its behalf and the sideband held
for `session.closed` for 15 seconds, the docs' close sequence, after which
finalization is logged as unconfirmed and the sideband released. A sideband
that ends first closes the desktop socket with code 1001 and reason
`upstream-closed`, and reports nothing, since without the final event the
usage is unconfirmed. On stop (`SIGTERM`), every desktop socket is closed the
same way and the process waits for each session to finalize before exiting.

### How a refusal looks

Two shapes, and the desktop reads both:

- Before any socket stands, an HTTP status on the upgrade: `401` for
  `/sessions` without a bearer, `403` for a handshake carrying a browser
  `Origin` header (the desktop connects from its main process and never sends
  one, so a page in a browser is not a caller this service has), `429` for an
  introduction past the meter, `503` while the service is stopping, `404` for
  any other path.
- Once a socket stands, one frame `{ "error": <reason> }` in
  `@sidecar/hosted`'s `hostedErrorSchema` vocabulary, then a close with code
  1008 and the same reason: `invalid-request` for a first frame that is not a
  valid `session.create`; `invalid-token` and `quota-exhausted` as the account
  service answered them; `unavailable` when the account service did not
  answer; `upstream-error` when OpenAI refused the creation or the sideband
  could not attach; `upstream-throttled` when OpenAI answered 429.

## Configuration

| Variable | Meaning |
| --- | --- |
| `OPENAI_API_KEY` | The GPT Live project key. Required. |
| `LUKE_LIVE_MODEL` | A pinned model; `gpt-live-1` otherwise. |
| `WEB_ORIGIN` | The account service's origin, e.g. `https://tryluke.dev`. Required. |
| `VOICE_SERVICE_SECRET` | The shared secret the account service's two internal routes accept in `x-luke-voice-service-secret`; the same value is set on the Vercel deployment. Required. |
| `PORT`, `HOST` | Where to listen; `8080` on every interface by default. |

A blank value reads as absent. A launch missing a required value names every
one it lacks on stderr and exits.

## Running locally

```sh
OPENAI_API_KEY=sk-… WEB_ORIGIN=http://localhost:3000 VOICE_SERVICE_SECRET=dev \
  pnpm --filter @luke/voice-service start
```

Tests run against a fake OpenAI and a fake account service on loopback:

```sh
pnpm --filter @luke/voice-service test
```

## Deploying

The desktop's build pins the service's origin as
`HOSTED_VOICE_SERVICE_ORIGIN` (`wss://voice.tryluke.dev`) in
`@sidecar/hosted`, so the deployment must answer on that host, or the
constant moves with it. The service and the account service's internal routes
deploy before the desktop that connects to them ships.

Build the image from the repository root:

```sh
docker build -f apps/voice-service/Dockerfile -t luke-voice-service .
```

Fly.io:

```sh
fly launch --no-deploy --name luke-voice --dockerfile apps/voice-service/Dockerfile
fly secrets set OPENAI_API_KEY=… VOICE_SERVICE_SECRET=… WEB_ORIGIN=https://tryluke.dev
fly deploy --dockerfile apps/voice-service/Dockerfile
fly certs add voice.tryluke.dev
```

Set the `internal_port` to 8080 and the health check to `GET /healthz`; keep
one machine always running, since a session holds a socket for its whole
life. Point `voice.tryluke.dev` at the app and set the same
`VOICE_SERVICE_SECRET` on the Vercel deployment so the internal routes switch
on.

Railway: create a service from this repository with the root directory `/`
and the Dockerfile path `apps/voice-service/Dockerfile`, set the four
variables, attach the custom domain `voice.tryluke.dev`, and set the health
check path to `/healthz`. Railway supplies `PORT` itself.

## What it logs

One JSON line per event on standard output: the listening address, an upgrade
refused and its status, a session refused and its reason, a session created,
a greeting sent, usage reported with its seconds and the account service's
status, and a session ended with its finalization and the frame and byte
counts in each direction, including how many frames were dropped as reflected
audio or as unpermitted on the introduction. No line carries a session id, a
bearer, an SDP, a transcript fragment, or any frame's content.
