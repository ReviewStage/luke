/**
 * sandbox-firewall.ts -- a sandbox session's whole firewall policy, composed from every credential standing for the session, and the one way the service writes it.
 *
 * Vercel's network-policy write replaces a session's whole policy, and the
 * policy reads back with every header value redacted, so no writer can read
 * what another set there and keep it. Each part of a session sets its
 * credential in a slot of its own (`FIREWALL_SLOT`): the agent's repository
 * credential, a clone's read token, and the swaps its runner launches with.
 * What stands is the store's (`sandbox-firewall-store.ts`): one row per
 * sandbox session, under the account whose agent the session is, its
 * entries sealed under the deployment's key ring for that account and
 * session alone (`provider-key-seal.ts`). A write changes its own slot
 * there by a compare-and-set on the row's version, reading it again where
 * another writer moved it first, and then sends the policy every standing
 * slot composes, in the slots' declared order, so a write never drops what
 * another part of the session still needs; with nothing standing, the
 * policy is the open internet. An entry withdrawn leaves the row at once,
 * and the row goes with its last entry. A renewal (`renew`, the sweep's for
 * a ChatGPT plan's token) changes a slot only where it still stands, so it
 * never sets back an entry a withdraw or a clear took off, and writes
 * nothing where it finds nothing new.
 *
 * Two writes at once from two functions (a message's renewal, a Terminal's,
 * a runner's end) may land at Vercel in either order, and whichever lands
 * last would stand. So a writer reads the row's version again once its send
 * is done, and where the row moved on, sends what stands now itself, until
 * what it sent is what stands: whichever send lands last, its writer finds
 * the row as it left it, or sends the latest. A clear, made ahead of a
 * stop, deletes the session's rows and sends the open internet, reading
 * nothing. Note that a write racing a clear lands as a write after it, the
 * row and the policy both its own, as a renewal racing a stop landed before
 * this record; whether to write is the caller's to read, as it was.
 *
 * A placeholder swap is how a secret leaves the sandbox: the process that
 * needs it is handed a random placeholder minted for its launch
 * (`newPlaceholder`), and on requests to the swap's domain that carry its
 * header at the placeholder the firewall sets the real value in its place.
 * The firewall acts for every process in the sandbox, so the match on the
 * placeholder is what keeps the swap to the processes that can read it.
 *
 * A record that could not be kept, or a deployment with no key ring to seal
 * it under, fails the write as the policy write unavailable
 * (`SandboxUnavailable`), as Vercel's own refusal does; what fails names no
 * value, and nothing here logs one.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type KeyRing,
  openFirewallEntries,
  parseKeyRing,
  sealFirewallEntries,
} from "@repo/database/models/provider-key-seal";
import {
  clearStandingFirewall,
  readStandingFirewall,
  replaceStandingFirewall,
} from "@repo/database/models/sandbox-firewall-store";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { DateTime, Effect, Option, Redacted, Result, Schema } from "effect";
import { HostedEnvironment } from "../environment.js";
import type { GitHubTokenAccess } from "../github/github-app.js";
import {
  type NetworkPolicy,
  type NetworkRule,
  OPEN_INTERNET_POLICY,
  SANDBOX_CALL,
  SandboxUnavailable,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

/**
 * The parts of a session that each set one credential at its firewall, in
 * the order the policy composes them: a write to one slot never drops
 * another's.
 */
export const FIREWALL_SLOT = {
  /** The agent's repository credential: an installation token on GitHub's two hosts, or a member's own on its repository's paths alone. */
  GITHUB: "github",
  /** A clone's or a fetch's read token, on the repository's git endpoint alone, for that run alone. */
  GITHUB_CLONE: "github-clone",
  /** The Claude Code CLI's credential, swapped in on Anthropic's API for its launch's placeholder. */
  CLAUDE: "claude",
  /** The runner's bearer, swapped in on our deployment's host for the placeholder its launch holds (`./coder-host/runner-sessions.ts`). */
  RUNNER: "runner",
  /** A Codex launch's OpenAI API key, swapped in for its placeholder on OpenAI's API, for that launch alone. */
  OPENAI_KEY: "openai-key",
  /** A Codex launch's ChatGPT plan access token, swapped in for its placeholder on the plan's backend (OpenAI's API, or Codex's ChatGPT backend) and renewed by the sweep while it stands. */
  OPENAI_PLAN: "openai-plan",
} as const;

export type FirewallSlot = (typeof FIREWALL_SLOT)[keyof typeof FIREWALL_SLOT];

/** The slots a runner's launch sets and its end takes off a place left up: each a credential its runner alone sends. */
export const RUNNER_SLOTS: readonly FirewallSlot[] = [
  FIREWALL_SLOT.CLAUDE,
  FIREWALL_SLOT.RUNNER,
  FIREWALL_SLOT.OPENAI_KEY,
  FIREWALL_SLOT.OPENAI_PLAN,
];

const SLOT_ORDER: readonly FirewallSlot[] = Object.values(FIREWALL_SLOT);

const FIREWALL_BOUNDS = {
  /** How many times a write reads the row again where another writer moved it first. */
  WRITE_ATTEMPTS: 8,
  /** How many times a writer sends what stands again where the row moved on during its send. */
  SETTLE_ROUNDS: 4,
  /** The random bytes a placeholder is minted from. */
  PLACEHOLDER_BYTES: 32,
} as const;

/** The host every policy that carries a credential leaves open, ahead of the hosts its rules name. */
const EVERY_HOST = "*";

/** GitHub's two hosts a credential is set on: git's, and the REST API's. */
const GITHUB_HOST = { GIT: "github.com", API: "api.github.com" } as const;

/** A repository's credential as the firewall carries it: the token, the repository as GitHub spells it, and whose the token is. */
export interface RepositoryCredential {
  readonly token: Redacted.Redacted;
  readonly fullName: string;
  readonly access: GitHubTokenAccess;
}

/** One host's rules in an entry. */
type HostRules = readonly [host: string, rules: readonly NetworkRule[]];

/** One credential at the firewall: the rules that carry it on each host it names, in order, kept redacted. */
export interface FirewallEntry {
  readonly rules: Redacted.Redacted<readonly HostRules[]>;
}

/** Whose sandbox session a write is to: the account whose agent it is, which every read of its record is scoped to, and the session. */
export interface FirewallSession {
  readonly userId: string;
  readonly sandboxSessionId: string;
}

/**
 * A secret swapped in at the firewall for a placeholder: on requests to
 * `domain`, under `path` alone where one is named, whose `header`, named in
 * lower case, is the placeholder's whole value (a scheme ahead of it
 * included, as `Bearer <placeholder>`), the header is set to `value`, whole
 * as well.
 */
export interface PlaceholderSwap {
  readonly domain: string;
  readonly path?: { readonly startsWith: string };
  readonly header: string;
  readonly placeholder: Redacted.Redacted;
  readonly value: Redacted.Redacted;
}

/** The entries standing at a session's firewall, by slot. */
type Standing = ReadonlyMap<FirewallSlot, FirewallEntry>;

/** What a write leaves in its slot: an entry, or none to take it off; nothing at all to leave the slot, and the record, as they stand. */
type SlotChange = Option.Option<FirewallEntry | undefined>;

/** The record as a writer read it: the version it stood at, none where no row stood, and its entries. */
interface ReadRecord {
  readonly version: string | undefined;
  readonly entries: Standing;
}

export interface SandboxFirewall {
  /** The entry set in its slot at the session's firewall, in place of the one standing there, and the whole policy sent. */
  readonly set: (
    session: FirewallSession,
    slot: FirewallSlot,
    entry: FirewallEntry,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  /** The slot's entry taken off the session's firewall, and what still stands sent. */
  readonly withdraw: (
    session: FirewallSession,
    slot: FirewallSlot,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  /** Every entry taken off the session's firewall ahead of its stop, which is left the open internet, its record deleted. */
  readonly clear: (
    sandboxSessionId: string,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  /** The slots standing at the session's firewall, as its record holds them; none where no record stands. */
  readonly standing: (
    session: FirewallSession,
  ) => Effect.Effect<ReadonlySet<FirewallSlot>, SandboxUnavailable, DatabaseServices>;
  /**
   * The slot's entry renewed where it still stands: `renewal` is handed what
   * stands and answers what stands in its place, or none to leave it; a slot
   * that stands no longer is left alone, so a renewal never sets back what a
   * withdraw or a clear took off. Answers whether it wrote.
   */
  readonly renew: <R>(
    session: FirewallSession,
    slot: FirewallSlot,
    renewal: (standing: FirewallEntry) => Effect.Effect<FirewallEntry | undefined, never, R>,
  ) => Effect.Effect<boolean, SandboxUnavailable, DatabaseServices | R>;
}

const PathMatchSchema = Schema.Union([
  Schema.Struct({ startsWith: Schema.String }),
  Schema.Struct({ exact: Schema.String }),
]);

const RuleSchema = Schema.Struct({
  match: Schema.optionalKey(
    Schema.Struct({
      path: Schema.optionalKey(PathMatchSchema),
      headers: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            key: Schema.Struct({ exact: Schema.String }),
            value: Schema.Struct({ exact: Schema.String }),
          }),
        ),
      ),
    }),
  ),
  transform: Schema.Array(Schema.Struct({ headers: Schema.Record(Schema.String, Schema.String) })),
});

/** The standing entries as their seal holds them: each slot's rules, host by host. */
const SealedStandingSchema = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      slot: Schema.String,
      rules: Schema.Array(Schema.Tuple([Schema.String, Schema.Array(RuleSchema)])),
    }),
  ),
);

const encodeStanding = Schema.encodeSync(SealedStandingSchema);
const decodeStanding = Schema.decodeUnknownResult(SealedStandingSchema);

/** The policy write unavailable, in words naming no value. */
function unkept(detail: string): SandboxUnavailable {
  return new SandboxUnavailable({ call: SANDBOX_CALL.NETWORK_POLICY, detail });
}

function entryOf(rules: readonly HostRules[]): FirewallEntry {
  return { rules: Redacted.make(rules) };
}

/** A rule that sets the authorization header on every request to its host, or on those whose path matches. */
function authorizing(authorization: string, path?: { startsWith: string } | { exact: string }) {
  const transform = [{ headers: { authorization } }];
  return path === undefined ? { transform } : { match: { path }, transform };
}

/**
 * The username git over HTTPS takes beside the token: `x-access-token` for
 * an installation token
 * (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation#about-authentication-as-a-github-app-installation),
 * the member's own login for their personal access token
 * (https://docs.github.com/en/get-started/git-basics/about-remote-repositories#cloning-with-https-urls).
 */
function gitUsername(access: GitHubTokenAccess): string {
  return access.kind === GITHUB_ACCESS.TOKEN ? access.githubLogin : "x-access-token";
}

/** Git's Basic credentials for the token, as its username takes them. */
function gitBasic(token: Redacted.Redacted, access: GitHubTokenAccess): string {
  return `Basic ${Buffer.from(`${gitUsername(access)}:${Redacted.value(token)}`).toString("base64")}`;
}

/**
 * The repository's credential at the firewall. An installation token is set
 * on GitHub's two hosts, as eve's own `authenticateGitHub` sets it. A
 * member's own classic token is set on the one repository's paths alone,
 * and nothing on any other path of GitHub's, GraphQL and every other
 * repository among them: git over HTTPS takes the member's login and the
 * token as its Basic credentials
 * (https://docs.github.com/en/get-started/git-basics/about-remote-repositories#cloning-with-https-urls),
 * and the REST API the token as a bearer
 * (https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api).
 * Note that the REST rules match the repository's own path and the paths
 * under it, never the name as a prefix, so `owner/name-other` carries
 * nothing.
 */
export function githubEntry(credential: RepositoryCredential): FirewallEntry {
  const { token, fullName, access } = credential;
  if (access.kind !== GITHUB_ACCESS.TOKEN) {
    const basic = gitBasic(token, access);
    return entryOf([
      [GITHUB_HOST.GIT, [authorizing(basic)]],
      [GITHUB_HOST.API, [authorizing(basic)]],
    ]);
  }
  const bearer = `Bearer ${Redacted.value(token)}`;
  return entryOf([
    [GITHUB_HOST.GIT, [authorizing(gitBasic(token, access), { startsWith: `/${fullName}.git/` })]],
    [
      GITHUB_HOST.API,
      [
        authorizing(bearer, { exact: `/repos/${fullName}` }),
        authorizing(bearer, { startsWith: `/repos/${fullName}/` }),
      ],
    ],
  ]);
}

/**
 * A clone's or a fetch's read token at the firewall: GitHub's header on
 * requests under the one repository's git endpoint alone, so a request for
 * a neighboring repository, or for the repository's pages outside git,
 * carries nothing.
 */
export function cloneEntry(
  fullName: string,
  token: Redacted.Redacted,
  access: GitHubTokenAccess,
): FirewallEntry {
  return entryOf([
    [GITHUB_HOST.GIT, [authorizing(gitBasic(token, access), { startsWith: `/${fullName}.git/` })]],
  ]);
}

/** The swap at the firewall: a rule on its domain matching its header at the placeholder, setting the real value. */
export function placeholderSwap(swap: PlaceholderSwap): FirewallEntry {
  const placeholder = {
    key: { exact: swap.header },
    value: { exact: Redacted.value(swap.placeholder) },
  };
  return entryOf([
    [
      swap.domain,
      [
        {
          match: {
            ...(swap.path === undefined ? undefined : { path: swap.path }),
            headers: [placeholder],
          },
          transform: [{ headers: { [swap.header]: Redacted.value(swap.value) } }],
        },
      ],
    ],
  ]);
}

/**
 * The swap `placeholderSwap` made, renewed to set `value` in place of the
 * one it sets, its domain, header, and placeholder kept; none where it sets
 * `value` already, so a renewal that finds nothing new writes nothing.
 */
export function renewedSwap(
  entry: FirewallEntry,
  value: Redacted.Redacted,
): FirewallEntry | undefined {
  const next = Redacted.value(value);
  const standing = Redacted.value(entry.rules);
  const sets = (headers: Readonly<Record<string, string>>) =>
    Object.values(headers).every((held) => held === next);
  if (
    standing.every(([, rules]) =>
      rules.every((rule) => rule.transform.every((each) => sets(each.headers))),
    )
  ) {
    return undefined;
  }
  return entryOf(
    standing.map(
      ([host, rules]): HostRules => [
        host,
        rules.map((rule) => ({
          ...rule,
          transform: rule.transform.map((each) => ({
            headers: Object.fromEntries(Object.keys(each.headers).map((name) => [name, next])),
          })),
        })),
      ],
    ),
  );
}

/** A placeholder minted for one launch: random, and named nowhere but where its process reads it. */
export function newPlaceholder(): Redacted.Redacted {
  return Redacted.make(randomBytes(FIREWALL_BOUNDS.PLACEHOLDER_BYTES).toString("base64url"));
}

/**
 * The whole policy the standing entries compose: the open internet with
 * none; otherwise every host left open, and on each host an entry names,
 * its rules in the slots' declared order.
 */
export function composePolicy(standing: Standing): NetworkPolicy {
  const entries = SLOT_ORDER.flatMap((slot) => {
    const entry = standing.get(slot);
    return entry === undefined ? [] : [entry];
  });
  if (entries.length === 0) return OPEN_INTERNET_POLICY;
  const allow = new Map<string, readonly NetworkRule[]>([[EVERY_HOST, []]]);
  for (const entry of entries) {
    for (const [host, rules] of Redacted.value(entry.rules)) {
      allow.set(host, [...(allow.get(host) ?? []), ...rules]);
    }
  }
  return { allow: Object.fromEntries(allow) };
}

/** The entries with the slot's set to the entry given, or taken off for none. */
function withSlot(standing: Standing, slot: FirewallSlot, entry: FirewallEntry | undefined) {
  const next = new Map(standing);
  if (entry === undefined) next.delete(slot);
  else next.set(slot, entry);
  return next;
}

/** The entries sealed for the session's row. */
function sealed(ring: KeyRing, session: FirewallSession, standing: Standing): string {
  const slots = [...standing].map(([slot, entry]) => ({
    slot,
    rules: Redacted.value(entry.rules),
  }));
  return sealFirewallEntries(ring, session, Redacted.make(encodeStanding(slots)));
}

/** The entries a row seals, opened; none where it does not open for the session or holds no entries this service knows. */
function opened(ring: KeyRing, session: FirewallSession, column: string): Standing | undefined {
  const secret = openFirewallEntries(ring, session, column);
  if (Result.isFailure(secret)) return undefined;
  const read = decodeStanding(Redacted.value(secret.success));
  if (Result.isFailure(read)) return undefined;
  const known = (slot: string): slot is FirewallSlot => SLOT_ORDER.some((each) => each === slot);
  return new Map(
    read.success.flatMap(({ slot, rules }) =>
      known(slot) ? [[slot, entryOf(rules)] as const] : [],
    ),
  );
}

/** The deployment's key ring the record is sealed under; the write unavailable where it has none. */
const keyRing = Effect.gen(function* () {
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const ring = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
  const parsed = ring === undefined ? undefined : parseKeyRing(ring);
  if (parsed === undefined || Result.isFailure(parsed)) {
    return yield* unkept("the deployment has no key ring to seal the firewall's record under");
  }
  return parsed.success;
});

/** The session's record as it stands, opened; a row that will not open reads as nothing standing, which the next write replaces. */
const readRecord = (ring: KeyRing, session: FirewallSession) =>
  Effect.gen(function* () {
    const row = yield* readStandingFirewall(session);
    if (row === undefined) return { version: undefined, entries: new Map() } satisfies ReadRecord;
    const entries = opened(ring, session, row.sealedEntries);
    if (entries === undefined) {
      yield* Effect.logWarning("a sandbox firewall's record would not open, and is written anew");
    }
    return { version: row.version, entries: entries ?? new Map() } satisfies ReadRecord;
  });

/** The firewall over the API given: every write through the session's record, and its policy composed whole. */
export function sandboxFirewall(api: VercelSandboxApi): SandboxFirewall {
  /**
   * The slot changed in the session's record as `next` decides on what
   * stands there, read again for as long as another writer moves it first:
   * what stands after, at the version this write minted; none where `next`
   * leaves the slot as it stands, which writes and sends nothing.
   */
  const written = <R>(
    ring: KeyRing,
    session: FirewallSession,
    slot: FirewallSlot,
    next: (standing: FirewallEntry | undefined) => Effect.Effect<SlotChange, never, R>,
  ) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < FIREWALL_BOUNDS.WRITE_ATTEMPTS; attempt += 1) {
        const standing = yield* readRecord(ring, session);
        const decided = yield* next(standing.entries.get(slot));
        if (Option.isNone(decided)) return undefined;
        const entries = withSlot(standing.entries, slot, decided.value);
        const row =
          entries.size === 0
            ? undefined
            : { version: randomUUID(), sealedEntries: sealed(ring, session, entries) };
        const now = yield* DateTime.nowAsDate;
        if (yield* replaceStandingFirewall(session, standing.version, row, now)) {
          return { version: row?.version, entries } satisfies ReadRecord;
        }
      }
      return yield* unkept("the firewall's record kept moving under this write");
    });

  /** What the write left sent, and sent again for as long as the record moved on during the send, so the policy standing is the record's latest. */
  const settled = (ring: KeyRing, session: FirewallSession, wrote: ReadRecord) =>
    Effect.gen(function* () {
      let sent = wrote;
      yield* api.updateNetworkPolicy(session.sandboxSessionId, composePolicy(sent.entries));
      for (let round = 0; round < FIREWALL_BOUNDS.SETTLE_ROUNDS; round += 1) {
        const standing = yield* readRecord(ring, session);
        if (standing.version === sent.version) return;
        sent = standing;
        yield* api.updateNetworkPolicy(session.sandboxSessionId, composePolicy(sent.entries));
      }
      yield* Effect.logWarning(
        "a sandbox firewall's record moved on through every resend; its next write sends what stands",
      );
    });

  /**
   * The slot changed as `next` decides, and the whole policy sent; nothing
   * written or sent where it left the slot as it stands. Answers whether it
   * wrote; a record the store could not keep is the write unavailable.
   */
  const change = <R>(
    session: FirewallSession,
    slot: FirewallSlot,
    next: (standing: FirewallEntry | undefined) => Effect.Effect<SlotChange, never, R>,
  ) =>
    Effect.gen(function* () {
      const ring = yield* keyRing;
      const wrote = yield* written(ring, session, slot, next);
      if (wrote === undefined) return false;
      yield* settled(ring, session, wrote);
      return true;
    }).pipe(
      Effect.mapError((failure) =>
        failure instanceof SandboxUnavailable
          ? failure
          : unkept("the firewall's record could not be kept"),
      ),
    );

  return {
    set: (session, slot, entry) =>
      Effect.asVoid(change(session, slot, () => Effect.succeed(Option.some(entry)))),
    // Note that a withdraw writes and sends even where its slot stands no longer, so one made again after a send
    // that failed sends what stands.
    withdraw: (session, slot) =>
      Effect.asVoid(change(session, slot, () => Effect.succeed(Option.some(undefined)))),
    standing: (session) =>
      Effect.gen(function* () {
        const record = yield* readRecord(yield* keyRing, session);
        return new Set(record.entries.keys());
      }).pipe(
        Effect.mapError((failure) =>
          failure instanceof SandboxUnavailable
            ? failure
            : unkept("the firewall's record could not be read"),
        ),
      ),
    renew: (session, slot, renewal) =>
      change(session, slot, (standing) =>
        standing === undefined
          ? Effect.succeed(Option.none())
          : Effect.map(renewal(standing), Option.fromUndefinedOr),
      ),
    // Note that a record that would not go is logged and the open internet sent anyway, because the
    // stop it goes ahead of must not wait on the store, and the sweep drops the row once its session is gone.
    clear: (sandboxSessionId) =>
      Effect.andThen(
        clearStandingFirewall(sandboxSessionId).pipe(
          Effect.catch(() => Effect.logWarning("a sandbox firewall's record was not deleted")),
        ),
        api.updateNetworkPolicy(sandboxSessionId, OPEN_INTERNET_POLICY),
      ),
  };
}
