/**
 * automation-collections.ts -- a workspace's automations held in a TanStack DB collection: fed by the list's follow, built at the host's own instant, and changed by a write to one automation the moment it is asked.
 *
 * The list's rows are a collection of their own (`live-collection.ts`), as
 * the service answers them. The list is built from them as the held read
 * built it (`@luke/features/automation-live`), at the host's own instant,
 * because a run's agent's status moves with the clock alone and a live
 * query reads no clock. So it is built again each time the rows move, and
 * at the nearest instant the clock alone moves it (`automationsGraceEdge`).
 * Nothing is drawn until the follow first answers, so a write asked before
 * then never draws a list that holds nothing else.
 *
 * A change or a deletion is drawn over its automation's row at once and
 * stands while the service writes it: kept once the followed list carries
 * its transaction, and taken back where the service refused it; writes to
 * one automation go to the service in the order asked. A new automation is
 * drawn once the service has made it, since only the service names it.
 * Where the list hands no wait yet, the row as a write's own answer leaves
 * it is taken in the read's place, so a write never answers before the list
 * drawn shows it.
 */

import {
  type AutomationsLiveRows,
  automationsGraceEdge,
  automationsOfLiveRows,
} from "@luke/features/automation-live";
import type { AutomationChangeParams } from "@luke/features/automation-view";
import {
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { Effect, type Scope } from "effect";
import {
  answeredCollection,
  drawnAtEdges,
  type RowWrite,
  rowsOf,
  rowWrites,
} from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** An automation's row as the list's statement answers it, its newest run's columns beside it. */
export type AutomationRow = AutomationsLiveRows["automations"][number];

/** The newest run's columns of an automation that has run none. */
const NO_RUN = {
  runId: null,
  runFiring: null,
  runStatus: null,
  runReason: null,
  runFiredAt: null,
  runSettledAt: null,
  agentId: null,
  agentTitle: null,
  agentCreatedAt: null,
  ownKey: null,
  turnId: null,
  turnStatus: null,
  cancelRequested: null,
  turnQueuedAt: null,
  turnSettledAt: null,
  turnSessionEnded: null,
  awaitingLineAt: null,
  failureWord: null,
} as const satisfies Partial<AutomationRow>;

/** Where a run lands, as a row's columns hold it. */
function targetFields(
  target: NonNullable<AutomationSummary["target"]>,
): Pick<AutomationRow, "targetKind" | "targetAgentId"> {
  return target.kind === AUTOMATION_TARGET.SAME_AGENT
    ? { targetKind: target.kind, targetAgentId: target.agentId }
    : { targetKind: target.kind, targetAgentId: null };
}

/** What a change asks of an automation, laid over its row as the service will write it. */
export function changedFields({
  target,
  ...asked
}: AutomationChangeParams["change"]): Partial<AutomationRow> {
  return { ...asked, ...(target === undefined ? undefined : targetFields(target)) };
}

/** What a write's answer says of an automation's own columns; its newest run is the list's to say. */
export function writtenFields(
  automation: AutomationSummary,
): Pick<AutomationRow, "name" | "enabled" | "trigger" | "action" | "guards" | "nextRunAt"> &
  Partial<AutomationRow> {
  const { scope, repositories, target, archiveSuccessful } = automation;
  return {
    name: automation.name,
    enabled: automation.enabled,
    trigger: automation.trigger,
    action: automation.action,
    guards: automation.guards,
    nextRunAt: automation.nextRunAt,
    ...(scope === undefined ? undefined : { scope }),
    ...(repositories === undefined ? undefined : { repositories }),
    ...(target === undefined ? undefined : targetFields(target)),
    ...(archiveSuccessful === undefined ? undefined : { archiveSuccessful }),
  };
}

/** A new automation's row as the service answered it made, which has run nothing yet. */
function madeRow(automation: AutomationSummary): AutomationRow {
  return {
    ...NO_RUN,
    id: automation.id,
    userId: automation.creatorId ?? "",
    taskId: automation.planId,
    taskName: automation.planName,
    organizationId: automation.workspaceId ?? null,
    taskRepository: null,
    createdAt: automation.createdAt,
    mine: automation.mine ?? true,
    scope: AUTOMATION_SCOPE.PERSONAL,
    repositories: [],
    targetKind: AUTOMATION_TARGET.NEW_AGENT,
    targetAgentId: null,
    archiveSuccessful: false,
    ...writtenFields(automation),
  };
}

export interface AutomationListDependencies {
  /** Draws the list as it now stands. */
  readonly draw: (automations: readonly AutomationSummary[]) => void;
  /** The service's origin, which a webhook automation's address is written on. */
  readonly serviceBaseUrl: string;
  /** The followed list's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** A workspace's automations in a collection, for as long as its scope stands. */
export interface AutomationListCollections {
  /** Takes one answer of the list's follow and draws it. */
  readonly answer: (rows: AutomationsLiveRows) => Effect.Effect<void>;
  /** Whether the list holds an automation, which a write to it is drawn on. */
  readonly holds: (automationId: string) => boolean;
  /** A change to an automation's row, or its deletion: drawn at once, kept or taken back as the service answers it. */
  readonly write: RowWrite<AutomationRow>;
  /** An automation the service made, drawn once the list carries its transaction, or as the service answered it where the list hands no wait. */
  readonly made: (automation: AutomationSummary, txid: string | undefined) => Effect.Effect<void>;
}

/** A workspace's automations, drawn from the follow's first answer on. */
export function automationListCollections(
  dependencies: AutomationListDependencies,
): Effect.Effect<AutomationListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const automations = yield* answeredCollection({ getKey: (row: AutomationRow) => row.id });
    // Note that nothing is drawn before the follow first answers, nor once the scope closed, since a follow let go draws for no window.
    let answered = false;
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );

    /** Draws the list as it stands now, what every standing write drew among it, and arms its next edge. */
    const drawn = yield* drawnAtEdges((at) => {
      if (!answered || !open) return undefined;
      const rows = { automations: rowsOf(automations.collection) };
      dependencies.draw(automationsOfLiveRows(rows, at, dependencies.serviceBaseUrl));
      return automationsGraceEdge(rows, at);
    });

    return {
      answer: (rows) =>
        Effect.suspend(() => {
          automations.answer(rows.automations);
          answered = true;
          return drawn;
        }),
      holds: (automationId) => automations.collection.has(automationId),
      write: rowWrites(automations, { drawn, txWait: dependencies.txWait }),
      made: (automation, txid) =>
        Effect.suspend(() => {
          const wait = dependencies.txWait();
          if (wait !== undefined && txid !== undefined) return confirmWrite(wait, txid);
          if (!answered) return Effect.void;
          automations.confirmNew(madeRow(automation));
          return drawn;
        }),
    };
  });
}
