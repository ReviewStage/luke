import type { HostDoneAnswerView } from "@repo/features/agent-view";
import {
  HOSTS_READ,
  type HostLiveRow,
  type HostsLiveAnswer,
  hostsOfLiveRows,
  nextHostLapse,
} from "@repo/features/host-live";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type EntityPool,
  type FieldChange,
  fieldKind,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { Effect, type Scope } from "effect";
import { type AppHosts, NO_KEYS_HELD } from "./app-state.js";
import { type HeldSlice, heldSlice } from "./live-collection.js";
import { followLiveRead } from "./live-read-follow.js";

/**
 * hosts-follow.ts -- the account's hosts the windows hold, followed over the service's held poll into the sync engine's pool by their ids, told whole on their app-state slice, and a removal drawn gone over them the moment it is asked.
 *
 * Settings › Hosts holds the account's hosts, and the host follows them
 * while any window holds them and a while after (`heldSlice`), so a host
 * enrolled, approved, renamed, removed, or moving through an update draws on
 * every open page within the service's coalesce window. Each host is one
 * row of the pool (`@repo/sync`), by its id, and the page draws them as the
 * held read answers them (`@repo/features/host-live`), beside the install
 * script's address the service answered with them, followed as every pool
 * read is (`followLiveRead`), and drawn again at the instant an uncollected
 * host's pairing lapses, so it leaves the page with no row moving. A removal is a write the pool draws over its
 * host at once (`hostRemove`), standing until the read carries its
 * transaction, so no answer from before it puts the host back, and taken
 * back where the service refused it. A read the service did not answer is
 * asked for again; one under another account's session ends unsaid, and the
 * next sign-in follows it again.
 */

/** A host as the pool holds it, by its id, the key its part declares, every write to it a change of its fields or its removal. */
const HOST = fieldKind((row: HostLiveRow) => row.id);

/** A read the service did not answer, as the client and the gate tell it. */
interface HostsUnanswered {
  readonly failure: string;
}

export interface HostsFollowDependencies {
  /** The account's hosts sealed for `userId`, their rows inline at the poll address where it polls, held past `after` where it names one. */
  readonly seal: (
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<HostsLiveAnswer | HostsUnanswered>;
  /** The account signed in, which every seal names; none while nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  /** The sync engine's pool, which the account's hosts stand in while they are followed. */
  readonly pool: EntityPool;
  readonly tell: (held: AppHosts) => void;
}

/**
 * The held lifetime over the account's hosts the windows hold
 * (`heldSlice`), keyed by the account, told whole on their slice: the
 * read as its follow last told it, kept where a later read does not answer,
 * and failed where it never answered.
 */
export function heldHosts(
  dependencies: HostsFollowDependencies,
): Effect.Effect<HeldSlice<string>, never, Scope.Scope> {
  return heldSlice<typeof LIVE_READ.HOSTS, string>({
    empty: NO_KEYS_HELD,
    path: (userId) => [userId],
    gate: dependencies.gate,
    follow: (userId, answers) =>
      followLiveRead(
        {
          seal: (poll, after) =>
            userId === dependencies.accountId()
              ? dependencies.seal(userId, poll, after)
              : Effect.succeed(LIVE_SIGNED_OUT),
          rows: HOSTS_READ.rows,
          part: "hosts",
          pool: dependencies.pool,
          kind: HOST,
          // Note that no refusal ends the follow but another account's session, which every follow ends on.
          endsFollow: () => false,
          draw: (rows, first, now) => ({
            hosts: hostsOfLiveRows(rows, now),
            installScriptUrl: first.installScriptUrl,
          }),
          // Note that a host whose pairing lapses uncollected leaves at that instant with no row moving.
          edge: nextHostLapse,
        },
        answers,
      ),
    tell: dependencies.tell,
  });
}

/**
 * One of the account's hosts removed, gone at once from its held read, sent
 * as `send` asks. Note that a removal the service took answers the
 * transaction it removed the host in, which the read is waited on; a
 * refusal puts the host back where the read still holds it.
 */
export function hostRemove(
  send: (id: string) => Effect.Effect<HostDoneAnswerView>,
): WriteDeclaration<HostLiveRow, FieldChange<HostLiveRow>, string, HostDoneAnswerView> {
  return {
    kind: HOST,
    keys: (id) => [id],
    change: () => () => ROW_GONE,
    send: (id) =>
      Effect.map(send(id), (answer) =>
        "done" in answer ? { answer, txid: answer.txid } : { refused: answer },
      ),
  };
}
