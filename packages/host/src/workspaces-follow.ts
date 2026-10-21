import type { TasksWorkspaceMembersAnswer } from "@luke/features/tasks-view";
import {
  type WorkspaceMembersLiveAnswer,
  type WorkspacesLiveAnswer,
  workspaceMembersLiveRowsSchema,
  workspaceMembersOfLiveRows,
  workspacesLiveRowsSchema,
  workspacesOfLiveRows,
} from "@luke/features/workspace-live";
import type { Workspace } from "@luke/features/workspace-wire";
import { Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows, type SealedRead } from "./live-follow.js";

/**
 * workspaces-follow.ts -- the account's workspaces, and one workspace's people, followed by the host over Neon Realtime subscriptions.
 *
 * The service seals each read's statements (`workspacesLiveStatements` in
 * the database's workspace store, `workspaceMembersLiveStatements` in the
 * service's accounts). The host subscribes to them (`live-follow.ts`),
 * polled while Realtime fails them, and answers each delivery as the held
 * read would, in its order. The sealed statements stay here, beside the
 * account's own bearer; only what is built from their rows leaves.
 */

/** A sealed read, or why the service sealed none, `gone` where it names nothing the account reaches any more. */
type Sealed<Answer> = Answer | { readonly failure: string; readonly gone?: boolean };

export interface LiveReadDependencies<Answer> {
  /** The read sealed again, for renewing; a failure where the service sealed none. */
  readonly seal: () => Effect.Effect<Sealed<Answer>>;
  /** The read's rows inline, polled while Realtime fails or is off, held until they move past `after`; failures as `seal`'s. */
  readonly poll: (after: string | undefined) => Effect.Effect<Sealed<Answer>>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/**
 * What one live read answers each time its rows change, decoded under
 * `schema` at this boundary and built by `build`, for as long as the
 * caller's scope stands. It fails where the subscription stops for good or
 * a row does not decode, which the caller answers by sealing it again.
 */
function liveMoves<Part extends string, Rows, Built>(
  dependencies: LiveReadDependencies<SealedRead<Part>>,
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
  build: (rows: Rows) => Built,
): Stream.Stream<Built, LiveBroken> {
  const decode = Schema.decodeUnknownOption(schema);
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
        onSome: (rows) => Effect.succeed(build(rows)),
      }),
    ),
  );
}

/** The account's workspaces each time their rows change, as the held read would list them. */
export function workspacesMoves(
  dependencies: LiveReadDependencies<WorkspacesLiveAnswer>,
  first: WorkspacesLiveAnswer,
): Stream.Stream<readonly Workspace[], LiveBroken> {
  return liveMoves(dependencies, first, workspacesLiveRowsSchema, workspacesOfLiveRows);
}

/** One workspace's people each time their rows change, as the held read would answer them. */
export function peopleMoves(
  dependencies: LiveReadDependencies<WorkspaceMembersLiveAnswer>,
  first: WorkspaceMembersLiveAnswer,
): Stream.Stream<TasksWorkspaceMembersAnswer, LiveBroken> {
  return liveMoves(dependencies, first, workspaceMembersLiveRowsSchema, workspaceMembersOfLiveRows);
}
