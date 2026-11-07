/**
 * sandbox-firewall.ts -- a sandbox session's whole firewall policy, rebuilt at every write from the credentials its writer gathered and the swaps of the launch standing in it, and the one way the service writes it.
 *
 * Vercel's network-policy write replaces a session's whole policy, and the
 * policy reads back with every header value redacted, so a write never
 * reads what stands and keeps it: each composes the session's whole policy
 * from its sources at the moment of writing and sends it whole. A writer
 * gathers what it carries itself (`FirewallSources`): the agent's
 * repository credential, minted afresh, and a clone's read token for that
 * run alone. The one source no writer can gather again is a runner's
 * launch: the placeholders it minted are in its runner's environment
 * alone, and its bearer's bytes nowhere once its digest is kept, so the
 * launch's swaps (`LAUNCH_SWAP`) are kept for its session
 * (`sandbox-firewall-store.ts`), one row per sandbox session under the
 * account whose agent the session is, sealed under the deployment's key
 * ring for that account and session alone (`provider-key-seal.ts`), and
 * every write sends them beside what it gathered. A launch keeps them before
 * it writes, and nothing else changes them; they stand on the firewall until
 * the sandbox stops, and the agent's next launch in another session deletes
 * the row. With nothing to carry, the policy is the open internet.
 *
 * Two writers that compose from the same sources send the same policy, so
 * whichever lands last is right; a GitHub credential minted twice is two
 * tokens of the same reach. Note that this holds only while the sources
 * stand still between a writer's read and its send: a writer that read the
 * launch before a relaunch kept its own may land after it and send what it
 * read until the session's next write; and a clone's token
 * stands only in its own writes, so another writer landing during a clone
 * takes it off, though the clone goes on under the agent's own credential
 * that writer carries, minted afresh, which reaches every repository the
 * agent clones. Every send reaches the session through its sandbox's
 * name (`VercelSandboxApi`'s `session`), so a write to a session its sandbox
 * no longer runs is refused, as Vercel refuses one to a session gone.
 *
 * A placeholder swap is how a secret leaves the sandbox: the process that
 * needs it is handed a random placeholder minted for its launch
 * (`newPlaceholder`), and on requests to the swap's domain that carry its
 * header at the placeholder the firewall sets the real value in its place.
 * The firewall acts for every process in the sandbox, so the match on the
 * placeholder is what keeps the swap to the processes that can read it.
 *
 * A launch that could not be kept or read, or a deployment with no key ring
 * to seal it under, fails the write as the policy write unavailable
 * (`SandboxUnavailable`), as Vercel's own refusal does; what fails names no
 * value, and nothing here logs one.
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type FirewallOwner,
  type KeyRing,
  openFirewallEntries,
  parseKeyRing,
  sealFirewallEntries,
} from "@repo/database/models/provider-key-seal";
import {
  keepFirewallLaunch,
  readFirewallLaunch,
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
  type SessionRef,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

/**
 * The credentials a runner's launch holds at the firewall behind its
 * placeholders, each its runner's alone, in the order the policy composes
 * them after what its writer gathered.
 */
export const LAUNCH_SWAP = {
  /** The Claude Code CLI's credential, swapped in on Anthropic's API for its launch's placeholder. */
  CLAUDE: "claude",
  /** The runner's bearer, swapped in on our deployment's host for the placeholder its launch holds (`./coder-host/runner-sessions.ts`). */
  RUNNER: "runner",
  /** A Codex launch's OpenAI API key, swapped in for its placeholder on OpenAI's API. */
  OPENAI_KEY: "openai-key",
} as const;

export type LaunchSwapKind = (typeof LAUNCH_SWAP)[keyof typeof LAUNCH_SWAP];

const SWAP_ORDER: readonly LaunchSwapKind[] = Object.values(LAUNCH_SWAP);

/** The random bytes a placeholder is minted from. */
const PLACEHOLDER_BYTES = 32;

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

/** Whose sandbox session a write is to: the account whose agent it is, which every read of its launch is scoped to, the sandbox by its name, and the session. */
export interface FirewallSession extends FirewallOwner {
  readonly name: string;
}

/**
 * What a write carries of its writer's own, gathered as it writes: the
 * agent's repository credential, minted afresh, and a clone's or a fetch's
 * read token for that run alone; each left out where it is not to stand.
 */
export interface FirewallSources {
  readonly github?: RepositoryCredential | undefined;
  readonly clone?: RepositoryCredential | undefined;
}

/** A launch's swaps, by the credential each holds. */
export type LaunchSwaps = ReadonlyMap<LaunchSwapKind, FirewallEntry>;

/** What a launch keeps for its session: the agent it runs, whose repository credential a write made apart from it mints, and its swaps. */
export interface FirewallLaunch {
  readonly agentId: string;
  readonly swaps: LaunchSwaps;
}

/** A launch as its session's row holds it: the agent and its swaps. */
interface KeptLaunch {
  readonly agentId: string;
  readonly swaps: LaunchSwaps;
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

export interface SandboxFirewall {
  /** The session's whole policy composed from the sources given and the swaps of the launch kept for it, and sent. */
  readonly write: (
    session: FirewallSession,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  /** A launch's swaps kept for the session in place of an earlier launch's, so every write from here on sends them; nothing is sent. */
  readonly keepLaunch: (
    session: FirewallSession,
    launch: FirewallLaunch,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
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

/** A launch's swaps as their seal holds them: each kind's rules, host by host. */
const SealedSwapsSchema = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      slot: Schema.String,
      rules: Schema.Array(Schema.Tuple([Schema.String, Schema.Array(RuleSchema)])),
    }),
  ),
);

const encodeSwaps = Schema.encodeSync(SealedSwapsSchema);
const decodeSwaps = Schema.decodeUnknownResult(SealedSwapsSchema);

/** No launch's swaps. */
const NO_SWAPS: LaunchSwaps = new Map();

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
 * on GitHub's two hosts. A
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
function githubEntry(credential: RepositoryCredential): FirewallEntry {
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
function cloneEntry({ fullName, token, access }: RepositoryCredential): FirewallEntry {
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

/** A placeholder minted for one launch: random, and named nowhere but where its process reads it. */
export function newPlaceholder(): Redacted.Redacted {
  return Redacted.make(randomBytes(PLACEHOLDER_BYTES).toString("base64url"));
}

/**
 * The whole policy the sources and the launch's swaps compose: the open
 * internet with none; otherwise every host left open, and on each host a
 * credential names, its rules in order, the repository's credential first,
 * then the clone's, then the swaps in their declared order.
 */
export function composePolicy(sources: FirewallSources, swaps: LaunchSwaps): NetworkPolicy {
  const entries = [
    ...(sources.github === undefined ? [] : [githubEntry(sources.github)]),
    ...(sources.clone === undefined ? [] : [cloneEntry(sources.clone)]),
    ...SWAP_ORDER.flatMap((kind) => {
      const entry = swaps.get(kind);
      return entry === undefined ? [] : [entry];
    }),
  ];
  if (entries.length === 0) return OPEN_INTERNET_POLICY;
  const allow = new Map<string, readonly NetworkRule[]>([[EVERY_HOST, []]]);
  for (const entry of entries) {
    for (const [host, rules] of Redacted.value(entry.rules)) {
      allow.set(host, [...(allow.get(host) ?? []), ...rules]);
    }
  }
  return { allow: Object.fromEntries(allow) };
}

/** The swaps sealed for the session's row. */
function sealed(ring: KeyRing, session: FirewallOwner, swaps: LaunchSwaps): string {
  const kinds = [...swaps].map(([slot, entry]) => ({ slot, rules: Redacted.value(entry.rules) }));
  return sealFirewallEntries(ring, session, Redacted.make(encodeSwaps(kinds)));
}

/**
 * The swaps a row seals, opened; none where it does not open for the
 * session. A kind this service does not know is passed over, so a row
 * sealed when each writer kept its own credential there opens as its
 * launch's swaps alone.
 */
function opened(ring: KeyRing, session: FirewallOwner, column: string): LaunchSwaps | undefined {
  const secret = openFirewallEntries(ring, session, column);
  if (Result.isFailure(secret)) return undefined;
  const read = decodeSwaps(Redacted.value(secret.success));
  if (Result.isFailure(read)) return undefined;
  const known = (kind: string): kind is LaunchSwapKind => SWAP_ORDER.some((each) => each === kind);
  return new Map(
    read.success.flatMap(({ slot, rules }) =>
      known(slot) ? [[slot, entryOf(rules)] as const] : [],
    ),
  );
}

/** The deployment's key ring a launch is sealed under; the write unavailable where it has none. */
const keyRing = Effect.gen(function* () {
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const ring = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
  const parsed = ring === undefined ? undefined : parseKeyRing(ring);
  if (parsed === undefined || Result.isFailure(parsed)) {
    return yield* unkept("the deployment has no key ring to seal the firewall's launch under");
  }
  return parsed.success;
});

/** The launch kept for the account's session, opened; a row that will not open reads as none, which the next launch replaces. */
const launchKept = (session: FirewallOwner) =>
  Effect.gen(function* () {
    const row = yield* readFirewallLaunch(session);
    if (row === undefined) return undefined;
    const swaps = opened(yield* keyRing, session, row.sealedEntries);
    if (swaps === undefined) {
      yield* Effect.logWarning("a sandbox firewall's launch would not open, and is sent as none");
      return undefined;
    }
    return { agentId: row.agentId, swaps } satisfies KeptLaunch;
  });

/** A store failure as the policy write unavailable, in words naming no value. */
const storeUnavailable = (detail: string) =>
  Effect.mapError((failure: SandboxUnavailable | { readonly _tag: string }) =>
    failure instanceof SandboxUnavailable ? failure : unkept(detail),
  );

/** The firewall over the API given: every write composed whole from its sources and the launch kept for its session. */
export function sandboxFirewall(api: VercelSandboxApi): SandboxFirewall {
  /** The policy given sent to the session, looked up by its sandbox's name for this one write. */
  const policySent = (session: SessionRef, policy: NetworkPolicy) =>
    Effect.flatMap(api.session(session), (running) => running.updateNetworkPolicy(policy));
  const sent = (session: FirewallSession, sources: FirewallSources, swaps: LaunchSwaps) =>
    policySent(
      { name: session.name, sessionId: session.sandboxSessionId },
      composePolicy(sources, swaps),
    );

  return {
    write: (session, sources) =>
      Effect.gen(function* () {
        const launch = yield* launchKept(session).pipe(
          storeUnavailable("the firewall's launch could not be read"),
        );
        yield* sent(session, sources, launch?.swaps ?? NO_SWAPS);
      }),
    keepLaunch: (session, launch) =>
      Effect.gen(function* () {
        const ring = yield* keyRing;
        yield* keepFirewallLaunch(
          session,
          {
            version: randomUUID(),
            agentId: launch.agentId,
            sealedEntries: sealed(ring, session, launch.swaps),
          },
          yield* DateTime.nowAsDate,
        );
      }).pipe(storeUnavailable("the firewall's launch could not be kept")),
  };
}
