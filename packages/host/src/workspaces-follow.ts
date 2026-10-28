import {
  type SidebarRows,
  sidebarLiveRowsSchema,
  sidebarRowsOfLive,
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
import { Effect, Option, Schema, Stream } from "effect";
import {
  decodedLiveRows,
  LiveBroken,
  liveRows,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

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

/** The sidebar read's parts: its sections, the tasks and the agents in them, and its pinned repositories. */
type SidebarPart = "sections" | "entries" | "agentEntries" | "pins";

const decodeSidebarRows = Schema.decodeUnknownOption(sidebarLiveRowsSchema);

/** An answer's rows decoded, every part's; none where it carries none inline, and failed where a row does not decode. */
function sidebarRowsOf(read: SealedRead<SidebarPart>): Option.Option<SidebarRows> | "undecoded" {
  const { sections, entries, agentEntries, pins } = read.queries;
  if ([sections, entries, agentEntries, pins].some((part) => part.rows === undefined)) {
    return Option.none();
  }
  const rows = decodeSidebarRows({
    sections: sections.rows,
    entries: entries.rows,
    agentEntries: agentEntries.rows,
    pins: pins.rows,
  });
  return Option.isSome(rows) ? Option.some(sidebarRowsOfLive(rows.value)) : "undecoded";
}

/**
 * The account's sidebar followed until it is gone, each answer's rows,
 * every part's, decoded and handed to `take` the moment its poll answers,
 * before the follow carries the answer's txids on to a write waiting for
 * them. So a write confirmed on the sidebar finds its rows already taken
 * (`sidebar-collections.ts`), where a reader of the follow's stream may
 * not have taken them yet. An answer whose rows do not decode is a failed
 * poll, asked again; a first one fails the follow, which the caller seals
 * again.
 */
export function followSidebarRows(
  dependencies: LiveReadDependencies<SealedRead<SidebarPart>>,
  first: SealedRead<SidebarPart>,
  take: (rows: SidebarRows) => void,
): Effect.Effect<void, LiveBroken> {
  const taken = (read: SealedRead<SidebarPart>) => {
    const rows = sidebarRowsOf(read);
    if (rows === "undecoded") return false;
    if (Option.isSome(rows)) take(rows.value);
    return true;
  };
  return Effect.gen(function* () {
    if (!taken(first)) return yield* new LiveBroken({ reason: "a row did not decode" });
    const poll = (after: string | undefined) =>
      Effect.map(dependencies.poll(after), (read) =>
        "failure" in read || taken(read) ? read : { failure: "a row did not decode" },
      );
    const { onTxWait } = dependencies;
    yield* Stream.runDrain(
      liveRows({ poll, ...(onTxWait === undefined ? undefined : { onTxWait }) }, first),
    );
  });
}
