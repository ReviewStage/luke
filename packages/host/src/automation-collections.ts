import {
  type AutomationsLiveRows,
  automationsGraceEdge,
  automationsOfLiveRows,
} from "@repo/features/automation-live";
import type {
  AutomationChangeParams,
  AutomationCreateParams,
} from "@repo/features/automation-view";
import {
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  type AutomationSummary,
} from "@repo/features/automation-wire";
import { type EntityPool, fieldKind, type HeldRows } from "@repo/sync";
import { Effect, type Scope } from "effect";
import { drawnAtEdges } from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

export type AutomationRow = AutomationsLiveRows["automations"][number];

export const AUTOMATION = fieldKind((row: AutomationRow) => row.id);

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

function targetFields(
  target: NonNullable<AutomationSummary["target"]>,
): Pick<AutomationRow, "targetKind" | "targetAgentId"> {
  return target.kind === AUTOMATION_TARGET.SAME_AGENT
    ? { targetKind: target.kind, targetAgentId: target.agentId }
    : { targetKind: target.kind, targetAgentId: null };
}

export function changedFields({
  target,
  ...asked
}: AutomationChangeParams["change"]): Partial<AutomationRow> {
  return { ...asked, ...(target === undefined ? undefined : targetFields(target)) };
}

export function writtenFields(
  automation: AutomationSummary,
): Pick<AutomationRow, "name" | "enabled" | "trigger" | "action" | "guards" | "nextRunAt"> &
  Partial<AutomationRow> {
  const { scope, repositories, target, archiveSuccessful, slackDelivery } = automation;
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
    ...(slackDelivery === undefined ? undefined : { slackDelivery }),
  };
}

export function askedRow(
  made: AutomationCreateParams & { readonly id: string },
  maker: { readonly userId: string; readonly at: number },
): AutomationRow {
  return {
    ...NO_RUN,
    id: made.id,
    userId: maker.userId,
    taskId: made.planId ?? null,
    taskName: null,
    name: made.name,
    enabled: true,
    trigger: made.trigger,
    action: made.action,
    guards: made.guards ?? AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    organizationId: made.workspaceId ?? null,
    scope: made.scope ?? AUTOMATION_SCOPE.PERSONAL,
    repositories: made.repositories ?? [],
    taskRepository: null,
    ...targetFields(made.target ?? { kind: AUTOMATION_TARGET.NEW_AGENT }),
    archiveSuccessful: made.archiveSuccessful ?? false,
    slackDelivery: made.slackDelivery ?? false,
    createdAt: maker.at,
    mine: true,
  };
}

export function answeredRow(automation: AutomationSummary): AutomationRow {
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
    slackDelivery: false,
    ...writtenFields(automation),
  };
}

export interface AutomationListDependencies {
  readonly pool: EntityPool;
  readonly workspaceId: string;
  readonly draw: (automations: readonly AutomationSummary[]) => void;
  readonly serviceBaseUrl: string;
  readonly txWait: () => TxWait | undefined;
}

export interface AutomationListCollections {
  readonly answer: (rows: AutomationsLiveRows) => Effect.Effect<void>;
  readonly holds: (automationId: string) => boolean;
}

export function automationListCollections(
  dependencies: AutomationListDependencies,
): Effect.Effect<AutomationListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    let answered = false;
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );
    const automations: HeldRows<AutomationRow> = yield* dependencies.pool.stand(AUTOMATION, {
      redraw: () => Effect.suspend(() => drawn),
      confirmation: () => {
        const wait = dependencies.txWait();
        return wait === undefined ? undefined : (txid) => confirmWrite(wait, txid);
      },
      adopts: (row) => row.organizationId === dependencies.workspaceId,
    });

    const drawn: Effect.Effect<void> = yield* drawnAtEdges((at) => {
      if (!answered || !open) return undefined;
      const rows = { automations: automations.rows() };
      dependencies.draw(automationsOfLiveRows(rows, at, dependencies.serviceBaseUrl));
      return automationsGraceEdge(rows, at);
    });

    return {
      answer: (rows) =>
        Effect.andThen(
          automations.answer(rows.automations),
          Effect.suspend(() => {
            answered = true;
            return drawn;
          }),
        ),
      holds: automations.holds,
    };
  });
}
