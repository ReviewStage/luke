# Proposal: native automation triggers from any integration (Sentry first)

Status: **proposed, not built.** Sentry is the first provider. The design
is meant to let Linear, Slack, PagerDuty and others follow as one module
each, without touching the wire, the store, the sweep or the editor again.

> "We should just add more native automation triggers … but we should think
> how to build it robustly because we'll want to have all sort of
> integrations and triggers in the future not just Sentry."

## Summary

- **Today every trigger kind is wired in by hand.** An automation fires on a
  `schedule`, a `github` event or a generic `webhook`
  (`packages/features/src/automation-wire.ts`). Each kind brings its own:
  - wire schema
  - store columns and query
  - ingress endpoint
  - prompt lines (`automation-runs.ts`)
  - editor form (`automation-editor.tsx`)
  - list words (`automation-list-model.ts`)
  - run glyph

  Adding Sentry the same way would touch about 15 files. Linear would touch
  them all again.
- **The generic webhook doesn't reach Sentry.** It accepts a caller only with
  `Authorization: Bearer <secret>`, but Sentry can't set that header. Sentry
  signs the body (`Sentry-Hook-Signature`) instead, and so do GitHub, Linear,
  Stripe and Standard Webhooks. Sentry's payloads also often exceed the
  64 KB body limit. The research doc's line "the generic webhook covers
  Sentry meanwhile" (`automations-research.md` §5) is wrong.
- **Proposal: one trigger kind, `integration`, plus one module per
  provider.** The kind is `{ kind: "integration", provider, event, filters }`.
  Each provider is a **trigger source** module that declares four things:
  - its events and their filter fields (data the editor renders, not code);
  - how a delivery proves where it came from;
  - which workspace the delivery belongs to;
  - how the delivery becomes one **normalized event**: a dedupe key, a
    subject (id, title, URL) and flat attributes to filter on.

  Everything after normalization is shared: matching, guards, dedupe, the
  sweep, the prompt, run history and the editor.
- **Where deliveries come from is a detail of each source.** One route,
  `POST /api/triggers/<provider>`, sends each delivery to its source. A
  source can be fed in one of two ways:
  - **by Luke's own app with the provider**, as the GitHub App does today.
    Sentry has to work this way: its Vercel Connect connector lists no
    trigger support;
  - **by Vercel Connect triggers**, where a connector supports them (Slack
    today). Connect checks the provider's signature and forwards the event
    with a Vercel OIDC bearer, which `createConnectWebhookVerifier` from
    `@vercel/connect/chat` checks. That settles the question
    `automations-research.md` left open.
- **The size:** five stacked PRs. The framework goes first with a fake
  source in its tests, then Sentry, then the editor (§6).

## 1. What exists, and what each new kind would cost

In short:

- **Already generic:** the run row with its dedupe index
  (`automation_run_dedupe` on `(automation_id, dedupe_key)`), the guards
  (concurrency and daily cap read no kind), the sweep's start path,
  `executeAutomationRun`, expiry and stranded-run recovery.
- **Specific to each kind:**
  - `AUTOMATION_TRIGGER` and `AUTOMATION_FIRING` and their schemas
  - the store's `trigger_kind` queries (`findGithubAutomations`,
    `findWebhookAutomation`)
  - `automation-github.ts` (parsing, sender and filter matching)
  - `firingSentence`, `githubEventLines`, `subjectTitle`, `runRepository`
  - `coder-host/status.ts` `originOf` and `coder-host/title.ts`
    `originWords`
  - the editor's trigger and event choices, `automationTriggerText`,
    `FIRING_WORDS`
  - `FiringGlyph`
- **Workspace scoping:** a GitHub delivery is matched to automations by
  repository name across every workspace. The installation in the payload
  is never read, and reach is only checked when the agent starts. The new
  framework scopes every delivery to a workspace first (§2.3).

## 2. Design

### 2.1 The trigger source contract

The contract lives in two halves, so the desktop can read the catalog
without importing service code.

**`packages/features/src/trigger-catalog.ts`** (wire, shared with the
desktop) declares data only:

```ts
interface TriggerSourceSpec {
  provider: IntegrationProvider;          // reuses INTEGRATION_PROVIDER ids
  events: readonly TriggerEventSpec[];
}
interface TriggerEventSpec {
  id: string;                             // "issue-created"
  words: string;                          // "A new issue is created"
  sentence: string;                       // "a new Sentry issue was created", for the prompt
  filters: readonly TriggerFilterSpec[];
}
interface TriggerFilterSpec {
  field: string;                          // "project", "level", "environment"
  words: string;                          // "Project"
  values: "free" | readonly string[];     // free text, or a fixed list (levels)
  options?: "remote";                     // the editor asks the service for choices (projects)
}
```

**`packages/service/src/triggers/<provider>/source.ts`** holds the
behaviour:

```ts
interface TriggerSource {
  spec: TriggerSourceSpec;
  /** Check the delivery is genuine: an HMAC, a Connect OIDC token, ... Fails closed. */
  verify(request: Request, body: Uint8Array): Effect<void, TriggerRefusal>;
  /** Housekeeping deliveries (install, uninstall) handled by the source itself. */
  lifecycle?(delivery): Effect<"handled" | "event", ...>;
  /** The workspace(s) this delivery belongs to, read from its installation id. */
  tenantOf(delivery): Effect<Option<OrganizationId>, ...>;
  /** Zero or more normalized events; anything unknown is ignored, never an error. */
  normalize(delivery): readonly NormalizedEvent[];
  /** Choices for a filter marked `options: "remote"`, e.g. Sentry projects. */
  options?(organizationId, field): Effect<readonly string[], ...>;
}

interface NormalizedEvent {
  event: string;                          // one of spec.events[].id
  dedupeKey: string;                      // the provider's delivery id (Sentry Request-ID)
  subject: { id: string; title?: string; url?: string };
  attributes: Record<string, string | readonly string[]>;  // what filters match on
  summary: string;                        // bounded text for the agent, built by the source
}
```

Sources are listed in a single registry, `TRIGGER_SOURCES`. A
compile-time check makes sure every `spec.provider` is an
`INTEGRATION_PROVIDER`, so a trigger provider is always also an
integration the agent can use to read more.

### 2.2 One trigger kind and one firing kind

```ts
{ kind: "integration", provider: "sentry", event: "issue-created",
  filters: { project: ["web", "api"], level: ["error", "fatal"] } }
```

- **Filters:** each field allows any one of its values; fields must all
  match; an empty field filters nothing. This is how GitHub's labels and
  branches already behave, made general. The wire checks `event` and
  filter fields against the catalog, so a stale desktop can't save a field
  the service doesn't know.
- **Firing:** `{ kind: "integration", provider, event, subject }`. The
  source's `summary` goes in the existing `automation_run.payload` column,
  already bounded by the source. So the webhook's handling of the body
  (fenced as untrusted data and trimmed to fit) is reused unchanged.
- **Store:** add two nullable columns, `trigger_provider` and
  `trigger_event`, filled from the trigger by `triggerColumns`, and an
  index on `(trigger_kind, trigger_provider, trigger_event,
  organization_id)`. Matching is one indexed query per normalized event,
  limited to the delivery's workspace, followed by the filter check in
  memory. That mirrors `triggerMatches` and fits under the 100-row limit.

### 2.3 Ingress: one route, the source decides

`POST /api/triggers/<provider>` → `packages/service/src/triggers/trigger-ingress-app.ts`:

1. Find the source, or answer 404.
2. Read the body up to the source's limit (Sentry: 1 MB).
3. `verify`. On failure answer 401 and log nothing of the body.
4. `lifecycle` (install, uninstall, or a provider ping), handled and
   answered.
5. `tenantOf`. If no workspace is linked, answer 202 and queue nothing.
6. `normalize`, then for each event: matching automations →
   `recordAutomationRun(automation, { dedupeKey, firing, payload: summary })`.
7. Answer 202. The minute sweep starts the agent, exactly as for GitHub
   today.

This stays quick (verify, one indexed read, one insert), which matters for
Sentry: its webhooks time out after 1 second. Deliveries never start an
agent inline.

**Tenancy is generic.** A new table, `integration_installation(provider,
external_id, organization_id, status, linked_by_user_id, created_at,
updated_at)`, primary key `(provider, external_id)`, maps a provider's
installation (Sentry's installation UUID, a Slack team id, a Linear
organization id) to a workspace. `github_installation` stays as it is.
Each source's install flow writes this row through a shared
`integration_install_intent` (state hash, PKCE, expiry), modelled on
`github_install_intent`.

**Two kinds of verifier, written once and shared by sources:**

- `hmacVerifier({ header, prefix?, encoding, covers })` for provider apps.
  Covers Sentry, Linear, GitHub, Standard Webhooks and Stripe-style
  timestamped signatures.
- `connectVerifier()` for Connect-fed sources, wrapping
  `createConnectWebhookVerifier`.

### 2.4 Prompt, titles and history

- `firingSentence` gets one generic branch that uses the catalog's
  `sentence`, e.g. *"because a new Sentry issue was created"*.
- The summary is fenced as `<sentry-event>…</sentry-event>` (the tag named
  from the provider), marked as data. The prompt then says the agent can
  read more through its `<provider>` connection. The owner's own MCP grant
  is what makes that work, so creating an integration automation warns
  when the owner hasn't connected that provider.
- `subjectTitle`, `originOf` and `originWords` read the generic `subject`,
  so a run's agent is titled after the Sentry issue as it is after a PR
  today.
- `FIRING_WORDS`, `FiringGlyph` and `automationTriggerText` get one
  generic branch, using `ProviderMark` and the catalog's `words`.

### 2.5 Editor

`automation-editor.tsx` gets one generic **integration** branch,
rendered from the catalog: a provider picker (only providers with a source
whose workspace is installed), an event picker, and one field per filter.
Free text uses the existing chip input. A fixed list uses toggles. A
remote list uses a combobox filled from
`GET /api/automations/trigger-options?provider&field`. A provider whose
workspace has no installation shows **Install in Sentry** in place of the
form.

Adding a provider later needs no editor code.

### 2.6 Guards that every source needs

These are all generic and built once.

- **Subject cooldown.** One Sentry issue may fire many times (regressions,
  alerts on every event). A run is skipped as `same-subject` when the
  automation already ran for that `subject.id` within its cooldown. The
  default is 24 h; it lives in the existing `guards`.
- **Workspace-scoped matching** (§2.3), so a delivery reaches only the
  workspace that installed the source.
- **Unknown events and fields are ignored**, never an error, so a provider
  adding a field never breaks a delivery.
- **Per-source fixture contract tests.** Each source ships recorded,
  scrubbed real payloads under `__fixtures__/`, and one shared test runs
  every source through them: verify accepts a signed one and refuses a
  tampered one, `normalize` gives the expected events, and an unknown
  event normalizes to nothing.
- The existing **concurrency and daily cap** apply unchanged.

## 3. Sentry, the first source

- **Ingress:** Luke's own **Sentry public integration**, published
  unlisted, so any org can install it from Luke's link. Its webhook URL is
  `/api/triggers/sentry`. The integration's **client secret** checks the
  `Sentry-Hook-Signature` header. `Request-ID` is the dedupe key.
- **Environment:** `SENTRY_APP_SLUG`, `SENTRY_APP_CLIENT_ID` and
  `SENTRY_APP_CLIENT_SECRET`, read as optional with `Config.option` like
  `GITHUB_APP_*`. While they're unset, the source reports "not configured"
  and the editor hides it.
- **Install:** Workspace settings › Integrations › Sentry › **Install for
  workspace**. Luke mints an intent and Sentry's install page redirects
  back with `code`, `installationId` and `orgSlug`. Luke exchanges the code,
  which also proves the installation is real, and writes
  `integration_installation('sentry', installationId, workspace)`. Only an
  owner or admin can install. The `installation.deleted` webhook marks the
  row `deleted`.
- **Events (v1):**

  | Event id | Sentry resource / action | Filters |
  | --- | --- | --- |
  | `issue-created` | `issue` / `created` | project, level, environment |
  | `issue-regressed` | `issue` / `unresolved` (to confirm against a recorded payload that a regression arrives this way) | project, level, environment |
  | `alert-triggered` | `event_alert` / `triggered` (an issue alert rule whose action is the Luke integration) | project, rule |
  | `metric-alert` | `metric_alert` / `critical` | project, rule |

  `alert-triggered` is the one we recommend in the editor. People already
  tune alert rules in Sentry, so Luke doesn't have to rebuild Sentry's
  rule engine, and the alert rule caps how often it fires.
- **Summary handed to the agent:** title, culprit, level, project, short
  id, permalink, first and last seen, event count and user count,
  environment, release, plus the top in-app stack frames, all within
  4 KB. The agent reads the full event through its Sentry connection.
- **Repository:** the automation's first repository, as for schedules and
  webhooks today. A later step can map Sentry projects to repositories.

## 4. Later sources and how they're fed

| Provider | Ingress | Tenant id | Likely first events |
| --- | --- | --- | --- |
| Linear | Luke's Linear OAuth app webhook (`Linear-Signature`), or Connect if the workspace connector gains triggers | organization id | issue created, labelled, assigned to Luke |
| Slack | Connect triggers (documented) | team id | message in channel, mention of Luke, reaction |
| PagerDuty | Luke's app webhook (v3 signature) | account subdomain | incident triggered |
| GitHub | Stays on its own path. It can move behind the contract once the generic path has proven itself, keeping its stored triggers through a migration. | installation id | as today |

The generic `webhook` trigger stays, for CI jobs and scripts.

## 5. Decisions

1. **Register Luke's own Sentry integration (recommended)**, or wait for
   Connect to add Sentry triggers? Waiting has no date. Registering is a
   one-time admin step in Sentry and three environment variables.
2. **Move GitHub behind the contract now or later?** We recommend later:
   it works, and moving it first doubles the risk of the first PRs.
3. **Default subject cooldown:** 24 h, configurable 1 h to 7 d.
4. **A provider value in the payload, such as an error message, reaches the
   agent's transcript and traces.** This is the same carve-out Dean approved
   for webhook bodies (automations D10). AGENTS.md needs that line widened
   from "a webhook body" to "an integration trigger's event", with
   approval.

## 6. Build plan (stacked PRs)

1. **Framework:**
   - catalog wire, the `integration` trigger and firing kinds
   - `trigger_provider` and `trigger_event` columns, the index, and the
     `integration_installation` table (one migration)
   - generic matching, the subject cooldown, and the prompt, title and
     history branches
   - tests with a fake source and PGlite store tests
2. **Ingress:** the `/api/triggers/<provider>` route, the shared HMAC and
   Connect verifiers, the install-intent flow, and the fixture contract
   test.
3. **Sentry source:** install and uninstall, verify, normalize the four
   events, project options through Sentry's API on the installation's
   token, recorded fixtures, environment variables, and the
   `packages/service/README.md` provisioning steps.
4. **Desktop:** the integration branch of the editor driven by the catalog,
   install prompts, the integration settings row, and run history glyphs.
5. **Docs:** `CHANGELOG.md`, and an update to the line in
   `automations-research.md`.
