import {
  type SidebarRead,
  sidebarLiveRowsSchema,
  sidebarOfLiveRows,
} from "@luke/features/sidebar-live";
import type {
  TasksWorkspaceInvitationsAnswer,
  TasksWorkspaceMembersAnswer,
} from "@luke/features/tasks-view";
import {
  type WorkspaceInvitationsLiveAnswer,
  type WorkspaceMembersLiveAnswer,
  type WorkspacesLiveAnswer,
  workspaceInvitationsLiveRowsSchema,
  workspaceInvitationsOfLiveRows,
  workspaceMembersLiveRowsSchema,
  workspaceMembersOfLiveRows,
  workspacesLiveRowsSchema,
  workspacesOfLiveRows,
} from "@luke/features/workspace-live";
import type { Workspace } from "@luke/features/workspace-wire";
import { type Effect, type Schema, Stream } from "effect";
import { decodedLiveRows, type LiveBroken, type SealedRead, type TxWait } from "./live-follow.js";

/**
 * workspaces-follow.ts -- the account's workspaces and sidebar, and one workspace's people and pending invitations, followed by the host over the service's held poll.
 *
 * The service answers each read's statements (`workspacesLiveStatements` in
 * the database's workspace store, `workspaceMembersLiveStatements` in the
 * service's accounts) with their rows inline. The host follows them
 * (`live-follow.ts`) and answers each delivery as the held read would, in
 * its order. Only what is built from their rows leaves.
 */

/** A read answered, or why the service answered none, `gone` where it names nothing the account reaches any more. */
type Sealed<Answer> = Answer | { readonly failure: string; readonly gone?: boolean };

export interface LiveReadDependencies<Answer> {
  /** The read's rows inline, held until they move past `after`; a failure where the service answered none. */
  readonly poll: (after: string | undefined) => Effect.Effect<Sealed<Answer>>;
  /** Now, by the host's own clock, which an invitation's expiry is read against. */
  readonly now: () => number;
  /** Hears the read's wait for a write's transaction where it has one, and none once let go (`live-follow.ts`). */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/**
 * What one live read answers each time its rows change, decoded under
 * `schema` at this boundary and built by `build`, for as long as the
 * caller's scope stands. It fails where the read is gone or a row does not
 * decode, which the caller answers by reading it again.
 */
function liveMoves<Part extends string, Rows, Built>(
  dependencies: LiveReadDependencies<SealedRead<Part>>,
  first: SealedRead<Part>,
  schema: Schema.Decoder<Rows>,
  build: (rows: Rows) => Built,
): Stream.Stream<Built, LiveBroken> {
  return decodedLiveRows(
    { poll: dependencies.poll, onTxWait: dependencies.onTxWait },
    first,
    schema,
  ).pipe(Stream.map(build));
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

/**
 * One workspace's pending invitations each time their rows change, as the
 * held read would answer them at the host's own `now`, each accept link on
 * the origin the service answered them with. Note that an invitation past its
 * expiry is left out as each change lands, since the statement keeps no
 * clock.
 */
export function invitationsMoves(
  dependencies: LiveReadDependencies<WorkspaceInvitationsLiveAnswer>,
  first: WorkspaceInvitationsLiveAnswer,
): Stream.Stream<TasksWorkspaceInvitationsAnswer, LiveBroken> {
  return liveMoves(dependencies, first, workspaceInvitationsLiveRowsSchema, (rows) => ({
    invitations: workspaceInvitationsOfLiveRows(rows, first.origin, dependencies.now()),
  }));
}

/** The account's sidebar sections, the tasks and agents in them, and its pins each time their rows change, as the held reads would answer them. */
export function sidebarMoves(
  dependencies: LiveReadDependencies<SealedRead<"sections" | "entries" | "agentEntries" | "pins">>,
  first: SealedRead<"sections" | "entries" | "agentEntries" | "pins">,
): Stream.Stream<SidebarRead, LiveBroken> {
  return liveMoves(dependencies, first, sidebarLiveRowsSchema, sidebarOfLiveRows);
}
