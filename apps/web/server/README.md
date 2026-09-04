# Database and auth workflow

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

- **`luke-desktop`** (`server/desktop-oauth-client.ts`) — the macOS companion
  app. It accepts loopback callbacks (`http://127.0.0.1/callback`) via a local
  HTTP server during sign-in.

- **`luke-mobile`** (`server/mobile-oauth-client.ts`) — the iOS companion app.
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

# Signing in on a Preview deployment

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

# Hosted voice and attention

`api/voice/mint.ts` and `api/attention/review.ts` run Luke's voice and
attention review on the deployment's own OpenAI key for a signed-in desktop.
Both are exact-path files, so Vercel's zero-config `api/` detection routes
them without a `routes` entry; only the bracketed auth catch-all needs one.
The logic lives in `server/hosted/` behind injected seams, and each request is
resolved to a user through the auth service's own `/oauth2/userinfo` endpoint,
called in process.

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

The endpoints need one secret: `OPENAI_API_KEY`. Without it both answer 503
and the hosted tier is simply off, the same kill switch as the feedback
endpoint, which is the intended state for Preview deployments, so a preview
never spends the production key. `LUKE_REALTIME_MODEL` and
`LUKE_ATTENTION_MODEL` optionally override the models, under the same names
the desktop honours; a blank value is treated as absent.

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

# Provider key vault

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

# Phone push tokens

`api/devices/token.ts` registers (POST) and forgets (DELETE) the push token of
a phone signed into Luke. A token names one app installation and nothing else:
it is not a credential, and the row moves to whichever account the phone last
signed in under, so a notification for one account can never reach a phone now
signed in as another. Rows go with the account, at sign-out, and when Apple
answers that the token is gone.

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
credential stores registrations and sends nothing. Each token records which
of Apple's two gateways issued it, so a build run from Xcode and one from
TestFlight are addressed at the right host.
