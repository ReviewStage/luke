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
  clearStandingFirewall,
  keepFirewallLaunch,
  letGoFirewallLaunch,
  readFirewallLaunch,
  renewFirewallLaunch,
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

export const LAUNCH_SWAP = {
  CLAUDE: "claude",
  RUNNER: "runner",
  OPENAI_KEY: "openai-key",
  OPENAI_PLAN: "openai-plan",
} as const;

export type LaunchSwapKind = (typeof LAUNCH_SWAP)[keyof typeof LAUNCH_SWAP];

const SWAP_ORDER: readonly LaunchSwapKind[] = Object.values(LAUNCH_SWAP);

const PLACEHOLDER_BYTES = 32;

const EVERY_HOST = "*";

const GITHUB_HOST = { GIT: "github.com", API: "api.github.com" } as const;

export interface RepositoryCredential {
  readonly token: Redacted.Redacted;
  readonly fullName: string;
  readonly access: GitHubTokenAccess;
}

type HostRules = readonly [host: string, rules: readonly NetworkRule[]];

export interface FirewallEntry {
  readonly rules: Redacted.Redacted<readonly HostRules[]>;
}

export interface FirewallSession extends FirewallOwner {
  readonly name: string;
}

export interface FirewallSources {
  readonly github?: RepositoryCredential | undefined;
  readonly clone?: RepositoryCredential | undefined;
}

export type LaunchSwaps = ReadonlyMap<LaunchSwapKind, FirewallEntry>;

export interface FirewallLaunch {
  readonly agentId: string;
  readonly swaps: LaunchSwaps;
}

export interface KeptLaunch {
  readonly agentId: string | undefined;
  readonly swaps: LaunchSwaps;
}

export interface PlaceholderSwap {
  readonly domain: string;
  readonly path?: { readonly startsWith: string };
  readonly header: string;
  readonly placeholder: Redacted.Redacted;
  readonly value: Redacted.Redacted;
}

export interface SandboxFirewall {
  readonly write: (
    session: FirewallSession,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly keepLaunch: (
    session: FirewallSession,
    launch: FirewallLaunch,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly endLaunch: (
    session: FirewallSession,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly launchOf: (
    owner: FirewallOwner,
  ) => Effect.Effect<KeptLaunch | undefined, SandboxUnavailable, DatabaseServices>;
  readonly renew: (
    session: FirewallSession,
    launch: KeptLaunch,
    kind: LaunchSwapKind,
    entry: FirewallEntry,
    sources: FirewallSources,
  ) => Effect.Effect<void, SandboxUnavailable, DatabaseServices>;
  readonly clear: (
    session: SessionRef,
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

const NO_SWAPS: LaunchSwaps = new Map();

function unkept(detail: string): SandboxUnavailable {
  return new SandboxUnavailable({ call: SANDBOX_CALL.NETWORK_POLICY, detail });
}

function entryOf(rules: readonly HostRules[]): FirewallEntry {
  return { rules: Redacted.make(rules) };
}

function authorizing(authorization: string, path?: { startsWith: string } | { exact: string }) {
  const transform = [{ headers: { authorization } }];
  return path === undefined ? { transform } : { match: { path }, transform };
}

function gitUsername(access: GitHubTokenAccess): string {
  return access.kind === GITHUB_ACCESS.TOKEN ? access.githubLogin : "x-access-token";
}

function gitBasic(token: Redacted.Redacted, access: GitHubTokenAccess): string {
  return `Basic ${Buffer.from(`${gitUsername(access)}:${Redacted.value(token)}`).toString("base64")}`;
}

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

function cloneEntry({ fullName, token, access }: RepositoryCredential): FirewallEntry {
  return entryOf([
    [GITHUB_HOST.GIT, [authorizing(gitBasic(token, access), { startsWith: `/${fullName}.git/` })]],
  ]);
}

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

export function newPlaceholder(): Redacted.Redacted {
  return Redacted.make(randomBytes(PLACEHOLDER_BYTES).toString("base64url"));
}

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

function sealed(ring: KeyRing, session: FirewallOwner, swaps: LaunchSwaps): string {
  const kinds = [...swaps].map(([slot, entry]) => ({ slot, rules: Redacted.value(entry.rules) }));
  return sealFirewallEntries(ring, session, Redacted.make(encodeSwaps(kinds)));
}

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

const keyRing = Effect.gen(function* () {
  const environment = yield* Effect.serviceOption(HostedEnvironment);
  const ring = Option.getOrUndefined(environment)?.providerKeyEncryptionKeys;
  const parsed = ring === undefined ? undefined : parseKeyRing(ring);
  if (parsed === undefined || Result.isFailure(parsed)) {
    return yield* unkept("the deployment has no key ring to seal the firewall's launch under");
  }
  return parsed.success;
});

const launchKept = (session: FirewallOwner) =>
  Effect.gen(function* () {
    const row = yield* readFirewallLaunch(session);
    if (row === undefined) return undefined;
    const swaps = opened(yield* keyRing, session, row.sealedEntries);
    if (swaps === undefined) {
      yield* Effect.logWarning("a sandbox firewall's launch would not open, and is sent as none");
      return undefined;
    }
    return { agentId: row.agentId ?? undefined, swaps } satisfies KeptLaunch;
  });

const storeUnavailable = (detail: string) =>
  Effect.mapError((failure: SandboxUnavailable | { readonly _tag: string }) =>
    failure instanceof SandboxUnavailable ? failure : unkept(detail),
  );

export function sandboxFirewall(api: VercelSandboxApi): SandboxFirewall {
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
    endLaunch: (session, sources) =>
      Effect.andThen(
        sent(session, sources, NO_SWAPS),
        letGoFirewallLaunch(session).pipe(
          storeUnavailable("the firewall's launch could not be let go"),
        ),
      ),
    launchOf: (session) =>
      launchKept(session).pipe(storeUnavailable("the firewall's launch could not be read")),
    renew: (session, launch, kind, entry, sources) =>
      Effect.gen(function* () {
        const swaps = new Map(launch.swaps).set(kind, entry);
        yield* renewFirewallLaunch(
          session,
          sealed(yield* keyRing, session, swaps),
          yield* DateTime.nowAsDate,
        ).pipe(storeUnavailable("the firewall's launch could not be renewed"));
        yield* sent(session, sources, swaps);
      }),
    clear: (session) =>
      Effect.andThen(
        clearStandingFirewall(session.sessionId).pipe(
          Effect.catch(() => Effect.logWarning("a sandbox firewall's launch was not deleted")),
        ),
        policySent(session, OPEN_INTERNET_POLICY),
      ),
  };
}
