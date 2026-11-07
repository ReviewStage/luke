/**
 * compose-account-asks.ts -- the account's own asks of the service on the window's behalf: its provider keys, a ChatGPT login by device code, its GitHub token, a workspace's memories, its hosts and a host's pairing, when its devices last beat, and a clip dictated into a box heard as words.
 *
 * Nothing is held here but the reads the host fetches for the windows that
 * hold them (`held-fetch.ts`): the account's provider keys, its GitHub
 * token, and when its devices last beat, asked every `MAC_PRESENCE.POLL_MS`
 * while held, each told as its own event to the app state every window
 * draws; and the live follows of each workspace's memories Settings › Memory
 * holds and of the account's hosts Settings › Hosts holds, followed into the
 * sync engine's pool (`memory-follow.ts`, `hosts-follow.ts`) and told on
 * their slices (`liveTold`), a forget or a removal drawn gone over them the
 * moment it is asked. A write's answer of the keys or the token is laid where
 * they are held; the keys moving ask the models again (`modelsMoved`), and a
 * token saved or removed asks the repositories again first
 * (`repositoriesMoved`). Behind a closed account gate, or on a run that sends
 * nothing, every ask answers unanswered (`account-gate.ts`). A provider key
 * and a GitHub token pass through on their way to the service and are held
 * nowhere here; no answer carries one back.
 */

import type { HostedAgentClient } from "@repo/features";
import type {
  ChatGptDevicePollAnswerView,
  GitHubTokenAnswerView,
  ProviderKeysAnswerView,
} from "@repo/features/agent-view";
import { MAC_PRESENCE } from "@repo/features/agent-wire";
import { HOSTS_READ } from "@repo/features/host-live";
import type { DevicePresenceAnswer } from "@repo/features/host-wire";
import type { LIVE_READ } from "@repo/features/live-wire";
import { WORKSPACE_MEMORIES_READ } from "@repo/features/memory-live";
import { CHATGPT_DEVICE_LOGIN, type ProviderKeysAnswer } from "@repo/features/provider-key-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD } from "@repo/gateway";
import { declaredWrite, type EntityPool } from "@repo/sync";
import { Clock, Duration, Effect, Option, Schedule, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { type AccountGateDependencies, type Asked, askedOf, gateOf } from "./account-gate.js";
import {
  type AppDevicePresence,
  type AppDevicePresences,
  type AppGitHubToken,
  type AppGitHubTokens,
  type AppProviderKeyList,
  type AppProviderKeys,
  NO_KEYS_HELD,
} from "./app-state.js";
import type { Composer } from "./composer.js";
import {
  type ACCOUNT_ASK_ACTS,
  ACCOUNT_ASK_FOLLOWS,
  type AGENT_ACTS,
  AGENT_FOLLOWS,
} from "./contract/index.js";
import type { HostMethodTable } from "./gateway-door.js";
import { type AccountHeld, accountHeld, type HeldFetch, heldFetch } from "./held-fetch.js";
import { type HostActTable, liveTold } from "./host-acts.js";
import type { HostKernel } from "./host-kernel.js";
import { heldHosts, hostRemove } from "./hosts-follow.js";
import type { HeldSlice } from "./live-collection.js";
import { heldMemories, memoryForget } from "./memory-follow.js";
import type { WindowFocus } from "./window-focus.js";

/** The service's side of the account's asks, as this concern asks it. */
export type AccountAsksClient = Pick<
  HostedAgentClient,
  | "liveRead"
  | "devicePresence"
  | "removeHost"
  | "readHostPairing"
  | "approveHostPairing"
  | "denyHostPairing"
  | "readProviderKeys"
  | "saveProviderKey"
  | "removeProviderKey"
  | "setProviderKeyForAgents"
  | "startChatGptDeviceLogin"
  | "pollChatGptDeviceLogin"
  | "cancelChatGptDeviceLogin"
  | "readGitHubToken"
  | "saveGitHubToken"
  | "removeGitHubToken"
  | "forgetMemory"
  | "transcribeDictation"
>;

export interface AccountAsksDependencies extends AccountGateDependencies {
  readonly kernel: Pick<HostKernel, "emit"> & AccountGateDependencies["kernel"];
  readonly client: AccountAsksClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  readonly accountId: () => string | undefined;
  /** The windows coming forward, on which every fetched read a window holds is asked again. */
  readonly focus: WindowFocus;
  /** The sync engine's pool, which the memories and the hosts stand in and a forget or a removal is drawn over. */
  readonly pool: EntityPool;
  /** The models asked again, as the keys moving move which models no credential pays for (`AgentsComposer.modelsMoved`). */
  readonly modelsMoved: Effect.Effect<void>;
  /** Every workspace's repositories the windows hold asked again, as a token saved or removed moves them, answering once each has landed (`TasksComposer.repositoriesMoved`); none asks nothing. */
  readonly repositoriesMoved?: Effect.Effect<void>;
}

/** The agents' acts this composer answers: a host removed, and a host's pairing read, approved, or denied. */
export type AccountAsksAgentAct =
  | "HOSTS_REMOVE"
  | "HOSTS_PAIRING_READ"
  | "HOSTS_PAIRING_APPROVE"
  | "HOSTS_PAIRING_DENY";

/** The acts this composer answers: the account's own asks, the hosts' and their pairing's, and the live follows of a workspace's memories and the account's hosts. */
type AccountAsksActs = HostActTable<typeof ACCOUNT_ASK_ACTS> &
  HostActTable<typeof ACCOUNT_ASK_FOLLOWS> &
  HostActTable<Pick<typeof AGENT_ACTS, AccountAsksAgentAct>> &
  HostActTable<Pick<typeof AGENT_FOLLOWS, "HOSTS_FOLLOW">>;

export interface AccountAsksComposer extends Composer {
  /** The account's own asks and the hosts', answered directly as the panel's port asks them. */
  readonly acts: AccountAsksActs;
  /** The holds taken anew under the account signed in, as the gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every read held let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

/** The live follows' reads the windows hold (`contract/live-follow.ts`), each held through its stream's scope. */
interface LiveFollows {
  /** Every workspace's memories Settings › Memory holds, by the workspace. */
  readonly memories: HeldSlice<string>;
  /** The account's hosts Settings › Hosts holds, by the account. */
  readonly hosts: HeldSlice<string>;
  /** The windows' one hold on the hosts, under the account signed in. */
  readonly hostsHold: AccountHeld;
}

/** The reads the host fetches for the windows that hold them, and the windows' holds on them. */
interface FetchedReads {
  /** When the account's own devices last beat, by the account. */
  readonly presence: HeldFetch<string, AppDevicePresence>;
  /** The windows' hold on the beats, under the account signed in. */
  readonly presenceHold: AccountHeld;
  /** The account's own provider keys, by the account. */
  readonly keys: HeldFetch<string, AppProviderKeyList>;
  /** The windows' hold on the keys, under the account signed in. */
  readonly keysHold: AccountHeld;
  /** The account's own GitHub token, by the account. */
  readonly token: HeldFetch<string, AppGitHubToken>;
  /** The windows' hold on the token, under the account signed in. */
  readonly tokenHold: AccountHeld;
}

/** Whether a device-code login's poll ends its wait: settled one way or another, or unanswered, which the window offers to start over from. */
function deviceSettled(answer: ChatGptDevicePollAnswerView): boolean {
  return "failure" in answer || answer.outcome !== CHATGPT_DEVICE_LOGIN.PENDING;
}

/** The keys and plans an answer of the service's says the account holds, without what it says of the one write. */
function keyListOf(answer: ProviderKeysAnswer): AppProviderKeyList {
  return answer.subscriptions === undefined
    ? { keys: answer.keys }
    : { keys: answer.keys, subscriptions: answer.subscriptions };
}

/** The beats as the service answered them, each aged at `askedAt`, the host's instant as the answer landed. */
function presenceOf(answer: DevicePresenceAnswer, askedAt: number): AppDevicePresence {
  return {
    beats: answer.devices.map(({ deviceId, ageMs }) => ({ deviceId, beatAt: askedAt - ageMs })),
    askedAt,
  };
}

/** The live follows of the workspaces' memories and the account's hosts, behind the gate, each told on its slice. */
function liveFollows(
  dependencies: AccountAsksDependencies,
  asked: Asked,
): Effect.Effect<LiveFollows, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { client, kernel, accountId, pool } = dependencies;
    const gate = gateOf(dependencies);
    const memories = yield* heldMemories({
      seal: (workspaceId, userId, poll, after) =>
        asked(
          client.liveRead(
            WORKSPACE_MEMORIES_READ,
            { userId, workspaceId },
            poll ? { after } : undefined,
          ),
        ),
      accountId,
      gate,
      pool,
      tell: liveTold(kernel.emit, ACCOUNT_ASK_FOLLOWS.MEMORIES_FOLLOW),
    });
    const hosts = yield* heldHosts({
      seal: (userId, poll, after) =>
        asked(client.liveRead(HOSTS_READ, { userId }, poll ? { after } : undefined)),
      accountId,
      gate,
      pool,
      tell: liveTold(kernel.emit, AGENT_FOLLOWS.HOSTS_FOLLOW),
    });
    return { memories, hosts, hostsHold: yield* accountHeld(hosts, accountId) };
  });
}

/**
 * The beats behind the gate, told whole on their slice, asked for the
 * account signed in now alone, since the service answers that account's.
 * Note that an ask which fails, its deadline of
 * `MAC_PRESENCE.READ_TIMEOUT_MS` among the ways, after one answered keeps
 * the beats it answered, marked stale, under the new instant, so a window
 * says it cannot check rather than that a device left.
 */
function fetchedPresence(
  dependencies: AccountAsksDependencies,
  asked: Asked,
): Effect.Effect<HeldFetch<string, AppDevicePresence>, never, Scope.Scope> {
  const { client, kernel, focus, accountId } = dependencies;
  return heldFetch<typeof LIVE_READ.DEVICE_PRESENCE, string>({
    empty: NO_KEYS_HELD,
    path: (userId) => [userId],
    gate: gateOf(dependencies),
    focus,
    every: Duration.millis(MAC_PRESENCE.POLL_MS),
    fetch: (userId, held) =>
      Effect.gen(function* () {
        if (userId !== accountId()) return Option.none();
        // Note that a read past its deadline fails like any other, so a window says it cannot check rather than letting every device age away while it hangs.
        const answer = yield* asked(client.devicePresence());
        const askedAt = yield* Clock.currentTimeMillis;
        if (!("failure" in answer)) return Option.some(presenceOf(answer, askedAt));
        return held === undefined
          ? Option.none()
          : Option.some({ beats: held.beats, askedAt, stale: true as const });
      }),
    tell: (held: AppDevicePresences) =>
      kernel.emit(GATEWAY_EVENT.DEVICE_PRESENCE_CHANGED, carried(held)),
  });
}

/**
 * The fetched reads behind the gate, each told whole on its slice. Note
 * that the beats, the keys, and the GitHub token are asked for the account
 * signed in now alone, since the service answers that account's, and that
 * the models are asked again as the keys move, since a key, a plan, or a
 * plan's default moves which models no credential pays for.
 */
function fetchedReads(
  dependencies: AccountAsksDependencies,
  asked: Asked,
): Effect.Effect<FetchedReads, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { client, kernel, focus, accountId } = dependencies;
    const gate = gateOf(dependencies);
    const presence = yield* fetchedPresence(dependencies, asked);
    const keys = yield* heldFetch<typeof LIVE_READ.PROVIDER_KEYS, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId, held) =>
        userId === accountId()
          ? Effect.flatMap(asked(client.readProviderKeys()), (answer) => {
              if ("failure" in answer) return Effect.succeed(Option.none());
              const list = keyListOf(answer);
              // Note that the first answer asks nothing of the models, which are asked as a window holds them.
              const moved = held !== undefined && JSON.stringify(held) !== JSON.stringify(list);
              return Effect.as(moved ? dependencies.modelsMoved : Effect.void, Option.some(list));
            })
          : Effect.succeed(Option.none()),
      tell: (held: AppProviderKeys) =>
        kernel.emit(GATEWAY_EVENT.PROVIDER_KEYS_CHANGED, carried(held)),
    });
    const token = yield* heldFetch<typeof LIVE_READ.GITHUB_TOKEN, string>({
      empty: NO_KEYS_HELD,
      path: (userId) => [userId],
      gate,
      focus,
      fetch: (userId) =>
        userId === accountId()
          ? Effect.map(asked(client.readGitHubToken()), (answer) =>
              "failure" in answer ? Option.none() : Option.some({ token: answer.token }),
            )
          : Effect.succeed(Option.none()),
      tell: (held: AppGitHubTokens) =>
        kernel.emit(GATEWAY_EVENT.GITHUB_TOKEN_CHANGED, carried(held)),
    });
    return {
      presence,
      presenceHold: yield* accountHeld(presence, accountId),
      keys,
      keysHold: yield* accountHeld(keys, accountId),
      token,
      tokenHold: yield* accountHeld(token, accountId),
    };
  });
}

/** What a write of the keys, a device-code login, or the token answers, each laid where its read is held before it answers the window that asked. */
function writesAnswered(
  dependencies: AccountAsksDependencies,
  { keys, token }: Pick<FetchedReads, "keys" | "token">,
) {
  /** The keys as an answer of the service's leaves them, laid for the account signed in where it carries them, and the models asked again, whose marks they move. */
  const keysAnswered = (answer: ProviderKeysAnswerView) =>
    Effect.suspend(() => {
      const userId = dependencies.accountId();
      return userId === undefined || !("keys" in answer)
        ? Effect.void
        : Effect.andThen(keys.answered(userId, keyListOf(answer)), dependencies.modelsMoved);
    });
  return {
    /** A write's answer of the account's keys, laid as the keys stand where it carries them, and answered whole to the window that asked. */
    keysWritten: (answer: ProviderKeysAnswerView) => Effect.as(keysAnswered(answer), answer),
    /** A device-code login's wait or cancel answered whole to the window that asked; once it connected, the keys it carries laid as a write's are. */
    deviceAnswered: (answer: ChatGptDevicePollAnswerView) =>
      Effect.as(
        "keys" in answer && answer.keys !== undefined ? keysAnswered(answer.keys) : Effect.void,
        answer,
      ),
    /**
     * A token's write answered whole to the window that asked; where the
     * service took it, the repositories every list holds asked again, since
     * what the token reaches moved, and then its answer laid on the held token
     * for the account signed in. Note that the lists land before the token,
     * because a surface the token draws, setup's Add repository, would
     * otherwise offer the list read before it, with none of its repositories;
     * the write's press stays busy meanwhile.
     */
    tokenWritten: (answer: GitHubTokenAnswerView) =>
      Effect.as(
        Effect.suspend(() => {
          if ("failure" in answer) return Effect.void;
          const userId = dependencies.accountId();
          return Effect.andThen(
            dependencies.repositoriesMoved ?? Effect.void,
            userId === undefined ? Effect.void : token.answered(userId, { token: answer.token }),
          );
        }),
        answer,
      ),
  };
}

/** The account's own asks (`ACCOUNT_ASK_ACTS`), the hosts' (`AGENT_ACTS`), and the live follows of the memories and the hosts, answered as the panel's port asks them. */
function actsOf(
  dependencies: AccountAsksDependencies,
  asked: Asked,
  { memories, hosts, hostsHold }: LiveFollows,
  fetched: FetchedReads,
): AccountAsksActs {
  const { client, pool } = dependencies;
  const { keysWritten, deviceAnswered, tokenWritten } = writesAnswered(dependencies, fetched);
  return {
    PROVIDER_KEYS_SAVE: (save) => Effect.flatMap(asked(client.saveProviderKey(save)), keysWritten),
    PROVIDER_KEYS_REMOVE: (removal) =>
      Effect.flatMap(asked(client.removeProviderKey(removal)), keysWritten),
    PROVIDER_KEYS_FOR_AGENTS: (change) =>
      Effect.flatMap(asked(client.setProviderKeyForAgents(change)), keysWritten),
    CHATGPT_DEVICE_START: () => asked(client.startChatGptDeviceLogin()),
    // Note that the login is asked after here, on the interval its start named, so a window waits on one answer rather than asking again on a timer of its own.
    CHATGPT_DEVICE_WAIT: ({ loginId, intervalSeconds }) => {
      const interval = Duration.seconds(intervalSeconds);
      const poll = Effect.suspend(() => asked(client.pollChatGptDeviceLogin({ loginId })));
      return Effect.andThen(
        Effect.sleep(interval),
        Effect.repeat(poll, { schedule: Schedule.spaced(interval), until: deviceSettled }),
      ).pipe(Effect.flatMap(deviceAnswered));
    },
    CHATGPT_DEVICE_CANCEL: (login) =>
      Effect.flatMap(asked(client.cancelChatGptDeviceLogin(login)), deviceAnswered),
    GITHUB_TOKEN_SAVE: (save) => Effect.flatMap(asked(client.saveGitHubToken(save)), tokenWritten),
    GITHUB_TOKEN_REMOVE: () => Effect.flatMap(asked(client.removeGitHubToken()), tokenWritten),
    MEMORIES_FORGET: declaredWrite(
      pool,
      memoryForget((forget) => asked(client.forgetMemory(forget))),
    ),
    // Note that the clip passes through once and is noted nowhere, because its words are the developer's voice.
    DICTATION_TRANSCRIBE: (clip) => asked(client.transcribeDictation(clip)),
    // A removal is drawn gone over the held hosts the moment it is asked.
    HOSTS_REMOVE: declaredWrite(
      pool,
      hostRemove((id) => asked(client.removeHost(id))),
      { read: ({ id }) => Effect.succeed(id) },
    ),
    HOSTS_PAIRING_READ: ({ code }) => asked(client.readHostPairing(code)),
    HOSTS_PAIRING_APPROVE: ({ code }) => asked(client.approveHostPairing(code)),
    HOSTS_PAIRING_DENY: ({ code }) => asked(client.denyHostPairing(code)),
    // The hosts are held for the windows while Settings › Hosts draws them, under the account signed in; a removal is drawn gone over them the moment it is asked.
    HOSTS_FOLLOW: {
      hold: () => hostsHold.hold,
      retry: () =>
        Effect.suspend(() => {
          const userId = dependencies.accountId();
          return userId === undefined ? Effect.void : hosts.retry(userId);
        }),
    },
    // A workspace's memories are held for the windows while Settings › Memory shows them; a forget is drawn gone over them the moment it is asked.
    MEMORIES_FOLLOW: {
      hold: ({ workspaceId }) => memories.hold(workspaceId),
      retry: ({ workspaceId }) => memories.retry(workspaceId),
    },
  };
}

/** The holds of the beats, the keys, and the token, each told only on the app state. */
function methodsOf(
  accountId: () => string | undefined,
  { presence, presenceHold, keys, keysHold, token, tokenHold }: FetchedReads,
): HostMethodTable {
  /** `read` asked again for the account signed in now, as Try again asks; nothing while nobody is. */
  const retried = (read: Pick<HeldFetch<string, unknown>, "retry">) =>
    Effect.suspend(() => {
      const userId = accountId();
      return Effect.as(userId === undefined ? Effect.void : read.retry(userId), {});
    });
  return {
    // The beats are held for the windows while any draws a device's standing, under the account signed in, and told only on the app state (`DEVICE_PRESENCE_CHANGED`).
    [GATEWAY_METHOD.HOSTS_PRESENCE_FOLLOW]: () => Effect.as(presenceHold.follow, {}),
    [GATEWAY_METHOD.HOSTS_PRESENCE_UNFOLLOW]: () => Effect.as(presenceHold.unfollow, {}),
    // Note that the beats are asked again only where a window holds them, as a window coming forward asks them.
    [GATEWAY_METHOD.HOSTS_PRESENCE_REFRESH]: () =>
      Effect.gen(function* () {
        yield* presence.wake(() => true);
        return {};
      }),
    // The keys are held for the windows while any draws them, under the account signed in, and told only on the app state (`PROVIDER_KEYS_CHANGED`); each write's own answer is laid there too.
    [GATEWAY_METHOD.PROVIDER_KEYS_FOLLOW]: () => Effect.as(keysHold.follow, {}),
    [GATEWAY_METHOD.PROVIDER_KEYS_UNFOLLOW]: () => Effect.as(keysHold.unfollow, {}),
    [GATEWAY_METHOD.PROVIDER_KEYS_RETRY]: () => retried(keys),
    // The token is held for the windows while any draws it, under the account signed in, and told only on the app state (`GITHUB_TOKEN_CHANGED`); a save's and a removal's own answer is laid there too.
    [GATEWAY_METHOD.GITHUB_TOKEN_FOLLOW]: () => Effect.as(tokenHold.follow, {}),
    [GATEWAY_METHOD.GITHUB_TOKEN_UNFOLLOW]: () => Effect.as(tokenHold.unfollow, {}),
    [GATEWAY_METHOD.GITHUB_TOKEN_RETRY]: () => retried(token),
  };
}

export function composeAccountAsks(
  dependencies: AccountAsksDependencies,
): Effect.Effect<AccountAsksComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const asked = askedOf(dependencies, yield* HttpClient.HttpClient);
    const follows = yield* liveFollows(dependencies, asked);
    const fetched = yield* fetchedReads(dependencies, asked);
    const { memories, hosts, hostsHold } = follows;
    const { presence, presenceHold, keys, keysHold, token, tokenHold } = fetched;
    return {
      methods: methodsOf(dependencies.accountId, fetched),
      acts: actsOf(dependencies, asked, follows, fetched),
      lifetime: Effect.void,
      // Note that the beats, the hosts, the keys, and the token are held anew under whoever signed in, in place of the hold before, rather than followed again under the account they were held for.
      open: Effect.gen(function* () {
        yield* memories.open;
        yield* presenceHold.open;
        yield* hostsHold.open;
        yield* keysHold.open;
        yield* tokenHold.open;
      }),
      // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
      reset: Effect.gen(function* () {
        yield* memories.end;
        yield* hosts.end;
        yield* presence.end;
        yield* keys.end;
        yield* token.end;
      }),
    };
  });
}
