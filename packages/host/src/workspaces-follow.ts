import {
  type WorkspacesLiveAnswer,
  workspacesLiveRowsSchema,
  workspacesOfLiveRows,
} from "@luke/features/workspace-live";
import type { Workspace } from "@luke/features/workspace-wire";
import { Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * workspaces-follow.ts -- the account's workspaces, followed by the host over a Neon Realtime subscription for as long as the account stands signed in.
 *
 * The service seals two statements (`workspacesLiveStatements` in the
 * database's workspace store): the workspaces the account is a member of,
 * and the GitHub installations connected to them. The host subscribes to
 * them (`live-follow.ts`), polled while Realtime fails them, and answers
 * each delivery as the workspaces the held read would list, in its order.
 * The sealed statements stay here, beside the account's own bearer; only
 * the workspaces built from their rows leave.
 */

export interface WorkspacesFollowDependencies {
  /** The workspaces sealed again, for renewing; a failure where the service sealed none. */
  readonly seal: () => Effect.Effect<
    WorkspacesLiveAnswer | { readonly failure: string; readonly gone?: boolean }
  >;
  /** The workspaces' rows inline, polled while Realtime fails or is off, held until they move past `after`; failures as `seal`'s. */
  readonly poll: (
    after: string | undefined,
  ) => Effect.Effect<WorkspacesLiveAnswer | { readonly failure: string; readonly gone?: boolean }>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/**
 * The account's workspaces each time their rows change, for as long as the
 * caller's scope stands. It fails where the subscription stops for good or a
 * row does not decode, which the caller answers by sealing it again.
 */
export function workspacesMoves(
  dependencies: WorkspacesFollowDependencies,
  first: WorkspacesLiveAnswer,
): Stream.Stream<readonly Workspace[], LiveBroken> {
  const decode = Schema.decodeUnknownOption(workspacesLiveRowsSchema);
  return liveRows(
    {
      openLive: dependencies.openLive,
      reseal: dependencies.seal,
      poll: dependencies.poll,
      now: dependencies.now,
    },
    first,
  ).pipe(
    Stream.mapEffect((read) =>
      Option.match(decode(read), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: (rows) => Effect.succeed(workspacesOfLiveRows(rows)),
      }),
    ),
  );
}
