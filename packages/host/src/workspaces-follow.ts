import {
  type SidebarRows,
  sidebarLiveRowsSchema,
  sidebarRowsOfLive,
} from "@repo/features/sidebar-live";
import {
  type WorkspacesLiveAnswer,
  workspacesLiveRowsSchema,
  workspacesOfLiveRows,
} from "@repo/features/workspace-live";
import type { Workspace } from "@repo/features/workspace-wire";
import { Effect, Option, Schema, Stream } from "effect";
import {
  decodedLiveRows,
  LiveBroken,
  liveRows,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

type Sealed<Answer> = Answer | { readonly failure: string; readonly gone?: boolean };

export interface LiveReadDependencies<Answer> {
  readonly poll: (after: string | undefined) => Effect.Effect<Sealed<Answer>>;
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

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

export function workspacesMoves(
  dependencies: LiveReadDependencies<WorkspacesLiveAnswer>,
  first: WorkspacesLiveAnswer,
): Stream.Stream<readonly Workspace[], LiveBroken> {
  return liveMoves(dependencies, first, workspacesLiveRowsSchema, workspacesOfLiveRows);
}

type SidebarPart = "sections" | "entries" | "agentEntries" | "pins";

const decodeSidebarRows = Schema.decodeUnknownOption(sidebarLiveRowsSchema);

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

export function followSidebarRows(
  dependencies: LiveReadDependencies<SealedRead<SidebarPart>>,
  first: SealedRead<SidebarPart>,
  take: (rows: SidebarRows) => Effect.Effect<void>,
): Effect.Effect<void, LiveBroken> {
  const taken = (read: SealedRead<SidebarPart>) =>
    Effect.suspend(() => {
      const rows = sidebarRowsOf(read);
      if (rows === "undecoded") return Effect.succeed(false);
      return Option.isSome(rows) ? Effect.as(take(rows.value), true) : Effect.succeed(true);
    });
  return Effect.gen(function* () {
    if (!(yield* taken(first))) return yield* new LiveBroken({ reason: "a row did not decode" });
    const poll = (after: string | undefined) =>
      Effect.flatMap(dependencies.poll(after), (read) =>
        "failure" in read
          ? Effect.succeed(read)
          : Effect.map(taken(read), (decoded) =>
              decoded ? read : { failure: "a row did not decode" },
            ),
      );
    const { onTxWait } = dependencies;
    yield* Stream.runDrain(
      liveRows({ poll, ...(onTxWait === undefined ? undefined : { onTxWait }) }, first),
    );
  });
}
