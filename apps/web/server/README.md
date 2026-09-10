# Luke web server

## Database and auth workflow

Neon is provisioned through the Vercel integration. It supplies the pooled
`DATABASE_URL` for application traffic and `DATABASE_URL_UNPOOLED` for
migrations; the connection strings live nowhere in this repository.
`server/db/schema.ts` is the aggregate source of truth for database structure
owned by Luke. Better Auth generates its portion into `server/db/auth-schema.ts`;
do not hand-edit that generated module.

After changing Better Auth or one of its plugins, run `pnpm auth:generate`, then
run `pnpm db:generate`, review the generated migration, and commit both outputs.
Schema generation uses a local placeholder connection string when `DATABASE_URL`
is absent; `pg.Pool` is lazy, so the command never connects to that placeholder.
For a Luke-owned table, add its own schema module and export it from
`server/db/schema.ts` before running `pnpm db:generate`. Name every schema module
`*-schema.ts` so Drizzle Kit includes it.

Vercel runs `pnpm db:migrate` before every deployment build, using the direct
connection Neon supplies for that deployment. The runner holds a PostgreSQL
advisory lock for the migration session, so overlapping builds targeting one
branch cannot apply the same migration concurrently. The Neon integration creates
a database branch for each Preview deployment, so its committed schema changes
are applied to the matching branch before Vite builds the application. No package
lifecycle hook runs migrations.

The auth service also needs `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and
`GITHUB_CLIENT_SECRET`.

`vercel.json` uses a legacy `routes` entry for `/api/auth/(.*)` because Vercel's
zero-config `api/` detection treats `[...all].ts` as a single dynamic segment and
adds a hard 404 for deeper API paths. A `rewrites` entry runs after that detected
filesystem routing phase, so it cannot reach the Better Auth handler; keep this
rule in `routes`, ahead of the detected routes.

Each deployment build runs `pnpm auth:seed` after the migration and before Vite,
so every database the application reaches already carries the clients, including
the branch database Neon creates for a Preview deployment, which would otherwise
be migrated but empty. The Drizzle seed is idempotent, upserting each public
OAuth client compiled into Luke, which is what makes running it on every build
safe. To apply it by hand against production:

```sh
vercel env run --environment production --scope stage-review -- \
  pnpm --filter @luke/web auth:seed
```

Dynamic client registration stays disabled. Two public clients are compiled in:

- **`luke-desktop`** (`server/oauth-clients.ts`) — the macOS companion
  app. It accepts loopback callbacks (`http://127.0.0.1/callback`) via a local
  HTTP server during sign-in.

- **`luke-mobile`** (`server/oauth-clients.ts`) — the iOS companion app.
  It uses a custom URL scheme (`dev.tryluke.ios://oauth/callback`) because iOS
  sign-in runs through `ASWebAuthenticationSession`, which delivers the callback
  via the registered scheme rather than a local HTTP server. The scheme passes
  Better Auth's `SafeUrlSchema` validation, which explicitly allows custom
  schemes for native clients. Both clients share the same trust posture: no
  client secret, PKCE required, skip consent as a trusted first-party app,
  public client.

Google's callback is `${BETTER_AUTH_URL}/api/auth/callback/google`; GitHub's is
`${BETTER_AUTH_URL}/api/auth/callback/github`. The GitHub provider requests
`user:email`, because Luke requires an email address for its account snapshot.

`api/feedback.mjs` deliberately remains plain ESM so Vercel's builder has nothing
to transpile.

## Signing in on a Preview deployment

A Preview deployment answers on hostnames minted for the branch, so
`server/auth-deployment.ts` reads the deployment's own address rather than
assuming one: on a Preview, `VERCEL_URL` is the base URL and `VERCEL_BRANCH_URL`
joins it as a trusted origin, and `BETTER_AUTH_URL` stays what it has always
been, the production address whose callback the two providers registered.
Without this a preview refuses its own sign-in before it reaches a provider at
all — Better Auth trusts the origin of its own base URL, and the browser on a
preview sends the preview's, which is the 403 behind the admin dashboard's
"Sign-in could not start. Try again."

Better Auth's `oAuthProxy` plugin carries the rest: the preview hands the
provider production's registered redirect URI, production exchanges the code and
redirects the profile back to the preview encrypted, and the preview creates the
session in its own Neon branch database. Production keeps the plugin's callback
hooks because it is the relay that exchanges the provider code, but drops the
plugin's `/oauth-proxy-callback` endpoint. That endpoint creates a session from
any profile encrypted with the shared proxy key; leaving it on production would
turn a Preview-held credential into authority over production sessions. A
preview therefore signs in only against a production deployment that already
carries the relay hooks, while only a positively identified Preview accepts the
returned profile.

The Preview environment needs `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_PROXY_SECRET`, `GOOGLE_CLIENT_ID`, and `GITHUB_CLIENT_ID`; the two
client secrets are spent by production, which is the end that exchanges the
code. `BETTER_AUTH_PROXY_SECRET` has to hold the same dedicated value on both
ends, or the profile arrives undecryptable. A Preview without it does not expose
the profile-accepting endpoint at all: falling back to `BETTER_AUTH_SECRET`
would require putting production's session-signing and provider-token key into
Preview. The dedicated key does not make the shared credential harmless. A
profile encrypted with the proxy secret is what a Preview's
`/api/auth/oauth-proxy-callback` trusts, so a leak can hijack a proxied OAuth
flow and mint sessions on deployments that accept proxy profiles. Production
deliberately does not. Treat the proxy secret as sensitive everywhere it is
stored, especially in Preview.

Production also needs `BETTER_AUTH_PROXY_TRUSTED_ORIGINS`, a comma-separated
allowlist of this project's protected Preview origins. A single `*` may stand
for characters within one hostname label; for this Vercel project that is
`https://luke-web-*-stage-review.vercel.app`. Before production spends a
provider code, it decrypts the proxy state and requires both the profile-return
endpoint and its final page to match that allowlist. A Preview-held key therefore
cannot turn production into a token relay to an origin outside the project.

Vercel Deployment Protection sits in front of all of this. The redirect back
from production lands on the protected preview like any other request, so the
browser needs that deployment's access cookie already; without it the dashboard
reports the intercepted API call rather than the metrics.

## Hosted voice

`api/voice/mint.ts` runs Luke's voice on the deployment's own OpenAI key for a
signed-in desktop. It is an exact-path file, so Vercel's zero-config `api/`
detection routes it without a `routes` entry; only the bracketed auth
catch-all needs one. The logic lives in `server/hosted/` behind injected
seams, and each request is resolved to a user through the auth service's own
`/oauth2/userinfo` endpoint, called in process.

The mint answer's `connection` object carries both a WebRTC calls endpoint
(`callsUrl`) for the desktop renderer and a WebSocket endpoint (`wsUrl`) for
mobile clients such as the iOS/watchOS companion, which has no WebRTC. Both
point at the canonical OpenAI host and are pinned by the build rather than
composed by the client: `callsUrl` is the calls endpoint at
`https://api.openai.com/v1/realtime/calls`; `wsUrl` is the WebSocket base at
`wss://api.openai.com/v1/realtime` with the session's model appended as
`?model=<model>`. The same ephemeral client secret authenticates both
transports. Clients predating this field ignore `wsUrl`; clients predating
this server receive a connection without it and must handle its absence.

The endpoint needs one secret: `OPENAI_API_KEY`. Without it it answers 503
and the hosted tier is simply off, the same kill switch as the feedback
endpoint, which is the intended state for Preview deployments, so a preview
never spends the production key. `LUKE_REALTIME_MODEL` optionally overrides
the model, under the same name the desktop honours; a blank value is treated
as absent.

`api/account/delete.ts` erases the signed-in user on the same bearer
resolution: the desktop's Delete account confirm is the only caller. Deleting
the `user` row is the entire act: sessions, provider accounts, OAuth grants,
and usage counters all reference it with `onDelete: "cascade"`, so nothing of
the account outlives the request.

`api/events.ts` records what a signed-in desktop counted about its own use, on
the same bearer resolution. The desktop never talks to the analytics processor:
it posts an allowlisted batch here, and this is the one place a `distinct_id`
is attached, from the resolved account and never from the body, which has no
place to name one. `productEventBatchFromWire` in `@sidecar/analytics` is the whole
admission policy, and it builds each event from that event's property
allowlist, so nothing outside the vocabulary survives the read.

It needs `POSTHOG_PROJECT_API_KEY`; without it the endpoint answers 503 and
product analytics is simply off, which is the intended state for Preview
deployments. `POSTHOG_HOST` optionally overrides the ingestion host.
`POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` are what let
`api/account/delete.ts` ask PostHog to erase the person before the account row
goes. It is a private endpoint, so it takes a personal key rather than the project
token, and `POSTHOG_API_HOST` overrides *its* host, which is not the ingestion
host. Without that pair the delete simply has no erasure seam to run. Every
forwarded event carries `$geoip_disable`, without which an event arriving with
no address resolves to the data centre's own location and the privacy claim in
`PRIVACY.md` becomes false; the project's IP-capture setting should be set to
discard as well, so the guarantee does not rest on one property in one file.

The browser half of the funnel is separate and weaker: `VITE_POSTHOG_PROJECT_API_KEY`
is a build-time variable that lets the site's own pages talk to PostHog
directly, so PostHog sees a visitor's address there. A build without it never
loads the library at all.

Use is metered per user per UTC day in the Luke-owned `hosted_usage` table:
one atomic upsert before each upstream call, checked against the ceilings in
`server/hosted/quota.ts`. The ceilings bound how often calls open, not how
long they run; a spend limit on the OpenAI project behind the key is the
backstop and should be configured with it.

## Hosted voice service

`api/voice/sessions.ts` and `api/voice/introduction.ts` are the hosted voice
service: two Vercel Functions serving WebSockets on Fluid compute, the part of
this deployment that holds the GPT Live project key and owns each hosted voice
session (`live-contract.ts` in `@sidecar/hosted` is the desktop's contract
with them). Each file exports the `http.Server` that `server/voice/service.ts`
builds, with `ws` handling the upgrade on it, exactly as Vercel's WebSocket
guide has it; the desktop opens `wss://` on this deployment's own origin,
`HOSTED_VOICE_SERVICE_ORIGIN` in `@sidecar/hosted`, at `VOICE_SERVICE_PATH`.
A plain request to either path answers 426, since the path is a socket's.

On `/api/voice/sessions` a signed-in desktop's handshake carries its account
bearer, resolved through the same in-process `/oauth2/userinfo` seam every
hosted route uses, and its daily allowance is spent by the same `hosted_usage`
meter before any session exists, so a refused account costs no session. The
socket's first frame is `session.create` (the SDP offer, a voice, the seed);
the function creates the session at OpenAI on the deployment's key, writes
down the session's `voice_sessions` row (the account, the live session id,
client delegation), attaches the trusted sideband, and
answers `session.created` with the id, the SDP answer, and the quota. From
then on it is a pipe: desktop frames to OpenAI untouched, OpenAI frames to the
desktop untouched except `session.input_audio.append` and
`session.output_audio.delta`, dropped by type so the developer's voice and
Luke's never transit the service. It keeps no conversation, reads no frame
past its `type`, and logs status codes, outcome names, and counts.

`/api/voice/introduction` takes a fresh install with no account, under the
same durable shared daily ceiling the introduction mint spends
(`spendIntroductionMeter`, the `introduction_usage` row), taken only once a
valid `session.create` has arrived, as the mint spends only after a valid
body, so the ceiling is the deployment's and an empty handshake costs it
nothing. There the sideband is
the function's alone: the caller may send only what a renderer's data channel
may, is shown only what one is shown, and `greetingInstruction()` goes up once
on `session.started`. The seed is bounded to one developer message of at most
1,024 characters.

### One connection is one invocation

A WebSocket connection to a Vercel Function closes when the function reaches
its maximum duration — `vercel.json` gives both functions 800 seconds, the
longest generally available — while the WebRTC session between the desktop
and OpenAI stands on. So a socket may also open with `session.attach` naming
a session id. The function resolves the bearer, checks that this account is
the one the session was created for (the `voice_sessions` row written at
creation, indexed over the owner and the live session id for this lookup),
attaches a fresh
sideband to OpenAI's `/v1/live/sessions/{id}/attach`, answers
`session.attached`, and pipes as before. Nothing the session said between the
two connections is replayed. The desktop's `HostedLiveSessionSource` in
`@sidecar/voice` does the reconnecting: three tries over about ten seconds,
sends made in the gap held for the next connection, and only after the last
failure does the host see the loss it already handles as `connection_lost`.
The introduction never re-attaches; one connection covers it.

### How a session ends

While a signed-in session runs, every `session.usage.updated` overwrites the
row's `usage` with `{ seconds, confirmed: false }`, a snapshot and never a
sum. `session.closed` is finalization. Whichever connection sees it forwards
it, writes the row's `closed_at`, `close_reason`, and
`usage { seconds, confirmed: true }`, records `usage.seconds` through
`recordVoiceSeconds` in `server/hosted/quota.ts`
— the session row is the idempotency ledger: the seconds land only where none
stand yet, and only then does the day's `voice_seconds` on `hosted_usage`
move, in one transaction, so a report seen by two connections adds nothing —
and closes both ends. A desktop that hangs up first has `session.close` sent
on its behalf and the sideband held for `session.closed` for 15 seconds, the
docs' close sequence. A sideband that ends first closes the desktop socket
with code 1001 and reason `upstream-closed` and records nothing: the last
unconfirmed snapshot standing with `closed_at` null is the honest record, and
a re-attached connection's `session.closed` later confirms it. Only these
functions write `voice_sessions`; the seconds ledger and it both cascade with
the user row. The seconds column stands beside the call count
rather than replacing it: a session still spends one call when it opens, and
the mint routes and their meter stay as they are for installed desktops until
the seconds are what the allowance is measured in.

### How a refusal looks

Before any socket stands, an HTTP status on the upgrade: `401` for
`/api/voice/sessions` without a bearer, `403` for a handshake carrying a
browser `Origin` header (the desktop connects from its main process and never
sends one), `503` while `OPENAI_API_KEY` is absent. Once a socket stands, one frame `{ "error": <reason> }`
in `hostedErrorSchema`'s vocabulary, then a close with code 1008 and the same
reason: `invalid-request` for a first frame that is not a valid `session.create`
or `session.attach`, or an attach on the introduction; `invalid-token` for a
bearer no account stands behind, and for an attach to a session this account
did not create; `quota-exhausted` for a spent allowance, or an introduction
past the shared ceiling; `upstream-error` when OpenAI refused the
creation or the sideband could not attach; `upstream-throttled` when OpenAI
answered 429.

### Deploying

Enable the WebSockets feature on the Vercel team, make sure Fluid compute is
on for the project, and set `OPENAI_API_KEY`; `LUKE_LIVE_MODEL` optionally pins
the model. Nothing else: no separate service, secret, or origin. Tests run against a fake OpenAI on loopback and an in-memory account side
(`tests/voice-service.test.ts`, `tests/support/voice-fakes.ts`).

## Hosted brain inference

`api/brain/capabilities.ts` and the three routes under `api/brain/v2/` run
Luke's brain on the deployment's own OpenAI key for a signed-in client that
carries none of its own. They are exact-path files like the voice route,
resolved to a user through the same bearer seam, and the three POST routes are
the only hosted routes with a raised function duration: `vercel.json` gives
the inference and the token count 120 seconds so the 90-second upstream
ceiling the brain shares with its keyed client can pass, and the embedding 60.

One HTTP request is one model call and nothing more. A client GETs the
capabilities first — the model, the operations, the registered tool names, the
bounds, the reasoning efforts — and fails on a service that lacks them rather
than falling back. It then POSTs one operation with the prompt it prepared and
the tool names it means to offer. The readers in `brain-contract.ts` of
`@sidecar/hosted` are the whole admission policy — the body is read as it
streams and cut at 2 MiB whatever its `Content-Length` says, the prompt is
bounded to its own 200,000-character envelope and refused past it rather than
cut, the input array is capped at 2,000 items each of which must take one of
the forms the brain replays, and every tool name must be one this service
registers a schema for, so a caller can never upload a schema. The service
then fixes the model, the upstream, its credential, the output budget's
ceiling, and the reasoning summary from its own build and posts once, leaving
OpenAI's `store` at its default so the response stands with OpenAI under its
own retention, named back by the id the desktop keeps on the run. An inference's
answer is handed down as it came, once it is known to be a Responses payload
every item of which the same admission would replay next turn; an answer this
route could not replay is a 502, because the client would keep it verbatim and
every later turn of that memory would fail here. The service compacts
nothing: a client folds its own context behind a summary it asks for as an
ordinary inference. The service runs no tool, holds no memory, reaches no
provider, and stores and logs nothing of the request, the reply, or the
encrypted items that travel in them.

Each request spends the attention review meter before the upstream call, so a
refused upstream still counts; an upstream that rate limits answers a bounded
`Retry-After` the client cools down for, and the allowance was still spent.
`LUKE_BRAIN_MODEL` optionally overrides the model, under the name the
desktop's keyed client honours; a blank value is treated as absent, and
nothing in a request can name one. Without `OPENAI_API_KEY` the routes answer
503 like the rest of the hosted tier. The existing mint and device routes are
untouched by these routes and keep their contracts for released clients.

## Provider key vault

`api/vault/key.ts` and `api/vault/keys.ts` store, list, and delete the provider
API keys a signed-in user syncs for server-side observation. Keys are encrypted
at rest using AES-256-GCM before they touch the database; the plaintext never
reaches a database column and there is no endpoint that reads it back.

The three endpoints require `PROVIDER_KEY_ENCRYPTION_SECRET`, a 64-character
hex string (32 bytes). Generate one with:

```sh
openssl rand -hex 32
```

All three vault endpoints answer 503 if the variable is absent or blank — the
same kill switch as the OpenAI endpoints — so a Preview deployment with no
secret simply has no working vault, and no plaintext key can be stored
accidentally. Set this variable in the Vercel project environment (production
and any Preview that needs a working vault) alongside `DATABASE_URL`.

## Hosted conversation store

The tables under `server/db/conversation-schema.ts`, `workspace-schema.ts`,
`roster-schema.ts`, and `briefing-schema.ts` hold the hosted brain's
conversation per account: the conversation directory, the standing generation
with its checkpoint items, cursors, inbox, runs, and action receipts, the
conversation lines, the retained transcript and its compaction boundaries, the
identity workspace and daily notes, the remembered facts, the latest roster
snapshot with its diffs and pass record, and the briefings. Every row is
keyed by `user_id` and cascades with the user row, so `api/account/delete.ts`
erases them with the account. The roster tables are read and written by the
scheduled observation below and the routes that serve it; nothing reads the
conversation tables yet. `server/hosted/store/` is the store the brain host
will compose against, implementing the storage contracts the desktop's SQLite
store implements under `packages/brain/src/store`.

Every user-derived column is a `sealed_*` column: the payload envelope in
`server/hosted/encryption.ts`, AES-256-GCM under the vault's
`PROVIDER_KEY_ENCRYPTION_SECRET`, written as `<keyId>:base64(nonce || ciphertext
|| tag)` and bound to the row's user id as authenticated data. The key id is
what makes a rotation possible: the ring names the current key and every key
an envelope on record may still name, and the vault's own key format is left
exactly as it was. Ids, keys, sequences, instants, states, and fixed vocabulary
words stand clear so they can be indexed; a line's idempotency key is the
SHA-256 of its identity, since a value-keyed line's identity is its words.

The store keeps the SQLite store's invariants: a save is a compare-and-set on
the standing generation and a stale handle is refused whole; the transcript is
written in the same transaction as the checkpoint and never cascades with a
generation; conversation lines carry their own retention and cutoff; a
generation whose rows cannot be opened or read is reported unreadable and is
repaired by the store that observed it. Clear is a hard delete of the
conversation's lines, transcript, and boundaries at or before its instant,
with no recovery archive and no maintenance ladder.

Beside those v1 tables stand the storage rework's, under
`server/db/storage-schema.ts`: `conversations`, `messages`, `turns`,
`conversation_lease`, `events`, `prompts`, `tool_sets`, and
`provider_cursors`, the shape `plan/storage-plan.md` on the
`orchestration/storage-plan` branch settles on. A conversation row names its
kind (main, observed, child, or thread), the provider session it observes,
the parent and spawning message a child came from, the runtime's own session
id, its soft-delete instant, and the two counters that number its messages
and events. A message is one AI SDK `UIMessage`, its parts and metadata as
plain `jsonb`, unique on `(conversation_id, client_id)` as its idempotency
key; a turn is one run's origin, status, model, prompt and tool-set hashes,
response ids, usage, timings, and failure. An event is one thing that
happened to a message after it was written, numbered by the conversation's
own event sequence, unique on `(conversation_id, seq)` like a message: a
briefing's `speech.offered`, `speech.claimed`, `speech.spoken`,
`speech.pushed`, `speech.expired`, or `speech.held`, or a `rating`. The
partial unique index over `message_id` where the kind is `speech.claimed` is
the reply-grant ledger's guarantee of at most one authorization to speak per
briefing, carried by the schema alone: two devices claiming at once both
insert and exactly one insert lands. A prompt and a tool set are
content-addressed, the hash of the text or the schemas as the key, so the same
prompt written by every turn is one row a turn's hash names without a foreign
key. A provider cursor is where the observation of one provider session last
reached, one row per session per account, advanced in the same transaction as
the observation message it produced and referenced by no message. Nothing in
these tables is sealed, and nothing reads them yet: the v1 tables are dropped
only after every reader has moved.

The store writer, `server/hosted/store/writer.ts`, is the one path by which a
`messages`, `turns`, or `events` row is written, and
`tests/store-writer-boundary.test.ts` holds the server's import graph to that:
the writer is the one server module that imports any of the three tables. It
consumes the brain's run event stream (`BrainRunEvent`, every kind of turn)
for a conversation the caller names by its row id and account. A turn row
goes from queued (written ahead of the stream by `enqueueTurn`, or at the
turn's start where nothing queued it) through running to settled, cancelled,
or failed, carrying the origin it was queued under, its usage split four ways,
its response ids where the runtime has them, and its failure word. Each user
message the turn opened with lands as its own row by the message's id. The
turn's answer is one assistant message keyed by the turn's id, and while the
turn runs that row is its journal: a tool call is written in `input-available`
before it executes and moved to `output-available` or `output-error` as its
result lands, a reasoning summary is written as it completes, and the turn's
completed message replaces the journal's parts whole and sets `finished_at`
once, after which the row is immutable and a late event for it is refused. A
turn that ends with a call still unanswered settles the call as an error,
since nothing will answer it now, and closes the row; a writer that dies
between the call and its result leaves the part in `input-available`, which
is what a resume reads. A compaction is written by its owner through
`recordCompaction`, because the stream's compaction event names neither the
first kept message nor, under eve, the summary's text; an event about a
message goes through `recordEvent`, numbered by the conversation's event
sequence, and a second `speech.claimed` on one message is answered as already
claimed rather than left to the partial unique index. Every write is
idempotent — a message by `(conversation_id, client_id)`, a turn by its id, a
tool part by its call id, a reasoning part by its item's id — so an event
delivered twice writes one row and a replayed stream changes nothing, and
every message is held to the vocabulary before it lands, through the same
`readStoredUIMessages` a read goes through, so no row can carry a tool the
catalog does not register, an input its schema refuses, or metadata outside
the set; a message the reader would refuse is refused whole and reported,
never cut down to the parts that would pass. Every write runs under a lock on
the conversation row, which no write reaches once Clear has stamped it; the
sequences come from the row's counters, each allocation landing on the first
position no row holds, so the unique `(conversation_id, seq)` constraint is
the backstop for a writer outside the lock and nothing the writer retries.

Voice is stored beside them the way a call platform stores a call, under
`server/db/voice-schema.ts`: `voice_sessions` and `voice_transcript_segments`.
A session row is one live session — the Live API's own session id, unique so
a re-attach on a fresh function instance finds the row it had rather than
forking it, and indexed with the user so an ownership check is one lookup —
with the device that opened it, its delegation mode, when it started and
closed, the API's own close reason, and a `usage` payload of billed seconds
with a flag saying whether the API confirmed them or a lost connection left
them estimated. A segment is one span of what was actually said, by whom, in
milliseconds on the session's clock. Nothing spoken is ever a message: the
brain's reply is the assistant message, and what the voice said of it lives
here as segments alone. No audio is ever stored, and nothing reads or writes
these tables yet.

The store tests run the generated migrations on PGlite in process, so
`check.sh` needs no service; the `postgres` CI job runs the same migrations
and tests against a Postgres service container. To run them against a
Postgres of your own:

```sh
DATABASE_URL_UNPOOLED=postgresql://... pnpm --filter @luke/web db:migrate
LUKE_STORE_TEST_DATABASE_URL=postgresql://... pnpm --filter @luke/web test:store
```

## Scheduled Conductor observation

`api/observation/tick.ts` is what Vercel's cron calls: `vercel.json` schedules
it every minute (`* * * * *`) and gives it a 60-second function duration. The
logic lives in `server/hosted/observation-tick.ts` and
`server/hosted/observation-pass.ts`; the route hands them the deployment's
seams and the account query. Vercel crons run only on production deployments.

The tick needs `CRON_SECRET`, which Vercel sends as the bearer on every
scheduled call once it is set in the project. Without it the route answers
503 and the schedule is simply off, the same kill switch every other hosted
endpoint keeps; a wrong bearer is 401, compared in constant time. It also
needs `PROVIDER_KEY_ENCRYPTION_SECRET`, because a tick that cannot read a key
must not run at all: a pass that read nothing would be written down as an
account with nothing.

Each tick first drops the snapshot, diffs, and pass record of every account
that no longer holds a cloud provider key or has not been seen within the
last 7 days, then lists up to 200 accounts that hold one and were seen —
seen meaning one of the account's `devices` rows has a `last_seen_at` inside
the window, which every registration and heartbeat moves along; the Mac
registers no device yet, so until it does the schedule runs for accounts a
phone or watch has signed into — in order of their last attempted pass, never
attempted first, so a provider that keeps refusing one account cannot starve
the rest. It observes four accounts at a time inside a 50-second budget,
starting a batch only while a whole 25-second pass deadline still fits, and
counts a pass that outruns that deadline as failed rather than waiting on it;
it answers `exhausted: true` when accounts remained, leaving them for the
next minute.

One account's pass is the same read-only Conductor fan-out the on-demand
endpoint ran before — identity, projects, the user's open workspaces, each
workspace's lifecycle and chats, each chat's status, one fixed query for agent
kinds — on a plugin built for that pass alone under the account's decrypted
key. The adapter retries a 429 on a doubling wait (500 ms, then 1, 2, 4
seconds, or the provider's own `Retry-After` up to 8 seconds) out of one
20-second budget per pass; past it the pass is rate limited and ends. A pass
every provider answered whole replaces the account's `roster_snapshot` — the
observations as reported, advertisements and projects included, sealed — and
records the diff against the snapshot it replaced in `roster_diff`, sealed,
where up to 20 wait for the brain host to consume; a pass any provider
refused, rate limited, or failed leaves the previous snapshot standing and is
recorded as failed in `observation_pass`. Nothing here decides anything: no
model runs on the tick, no notification leaves, and the diff is written and
left. Message cursors are not recorded by the pass, because observation never
reads a chat's messages; the brain host's own reads will write them.

`api/observe.ts` and the action routes under `api/actions/` still run their
own live pass per request for now; serving the stored snapshot and admitting
actions against it lands in a follow-up once the schedule has run in
production. `api/sessions/messages.ts` keeps its own fresh pass before the
read either way.

## Devices

`api/devices.ts` keeps one `devices` row per app installation on every
platform Luke runs on — `macos`, `ios`, and `watchos` — registered (POST) at
sign-in, moved along (PUT) by a heartbeat that carries the row's last-seen
instant and optionally a presence window or a push token change, and
forgotten (DELETE) at sign-out. The row is keyed by an installation id the
client minted once and keeps in its own state, so a device that signs into a
different account moves its one row to that account rather than leaving a
second, and a notification for one account can never reach a device now
signed in as another. A push token is unique across rows because Apple issues
one per installation; a registration or heartbeat that presents a token
another row holds takes it off that row in the same transaction. The
installation id and a push token are not credentials. Rows go with the
account, at sign-out, and when Apple answers that the token is gone. The
handler is `server/hosted/devices.ts` and the writes `server/hosted/device-store.ts`;
`active_until` is written by nothing today, and the push token reaches the
sender below in a later change.

`server/hosted/apns.ts` is the sender behind those rows. It needs the
deployment's Apple push credential, an APNs auth key from the developer
account, as four variables:

| Variable | Value |
| --- | --- |
| `APNS_TEAM_ID` | The Apple Developer team id |
| `APNS_KEY_ID` | The auth key's id |
| `APNS_PRIVATE_KEY` | The `.p8` file's PEM contents; escaped `\n` line breaks are accepted |
| `APNS_BUNDLE_ID` | The iOS app's bundle id, sent as the `apns-topic` |

Any one absent or blank means no sender is constructed, the same kill switch
the OpenAI and vault endpoints keep: a Preview deployment without the
credential stores registrations and sends nothing. Each row records which
of Apple's two gateways issued its token, so a build run from Xcode and one
from TestFlight are addressed at the right host.
