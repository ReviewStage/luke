import { Effect } from "effect";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  ACTION_RESULT_STATUS,
  type ActionAdmissionReads,
  type ActionOutputEnvelope,
  actionOutputFromResult,
  actionTargetSnapshot,
  type CarriedActionResult,
  type CloudAgentProviderId,
  dispatchByKind,
  isCloudAgentProviderId,
  refusedActionOutput,
  type SessionActionKind,
  type ToolContext,
  type ValidatedAction,
  type WireRecord,
  type WorkspaceAgentSelection,
  workspaceAgentModels,
} from "../../core.js";
import {
  type ActionExecutionAnswer,
  type ActionRoster,
  AGENT_STARTING_ACTION_KINDS,
  actionRosterFor,
  type HostedSessionActionKind,
} from "../action-execute.js";
import type { ObservedRoster } from "../observed-roster.js";
import type { HostedWorkspaceDefaults } from "./defaults.js";
import type { HostedRoster } from "./roster.js";

/**
 * The host's half of the gauntlet every action the hosted brain asks for
 * runs. The action tool's own `execute` admits the call by `admitEffect`,
 * against the roster it reads for itself through the readers handed out here
 * — the stored snapshot, the projects that snapshot listed, the developer's
 * saved defaults — and only the validated action it mints reaches the
 * carrier below. The carrier reaches the cloud action execution for a
 * session or a workspace, which admits the action once more against a fresh
 * pass before the provider's documented endpoint sees it. Nothing here
 * reaches a machine: an open and an app action have no performer on the
 * service, the tool policy offers none of them, and one that still arrives
 * is refused with a reason the model can read.
 */

/** One session action carried to its provider through the service's own execution, admitted there again. */
export type CloudActionExecutor = (input: {
  kind: HostedSessionActionKind;
  providerId: CloudAgentProviderId;
  fields: WireRecord;
  apiKey: string;
  /** The provider's slice of the stored roster, which the execution admits the action against again. */
  roster: ActionRoster;
  /** The developer's stored agent pairing for the provider, riding a creation or a spawn that named no model. */
  agentSelection?: WorkspaceAgentSelection;
}) => Effect.Effect<ActionExecutionAnswer>;

interface HostedCarrierDependencies {
  /** The roster as the snapshot holds it now, read again for every action. */
  readonly roster: () => Effect.Effect<HostedRoster>;
  readonly defaults: () => Effect.Effect<HostedWorkspaceDefaults>;
  /** The account's stored key for a provider, decrypted; nothing where none is stored. */
  readonly apiKey: (providerId: CloudAgentProviderId) => Effect.Effect<string | undefined>;
  readonly execute: CloudActionExecutor;
}

const REFUSAL = {
  NOT_HERE: "Not run: this action reaches a machine, and the service has none.",
  NO_KEY: "No provider key is stored for that session's provider.",
  NOT_CLOUD: "Not run: that session's provider is not one the service reaches.",
} as const;

/** What the hosted carrier answers with, for the action tools' context. */
export interface HostedActionCarrier {
  /** The readers admission consults for one call; the roster is read once per call however many readers ask. */
  admission(): Effect.Effect<ActionAdmissionReads>;
  /** Carries an action admission minted, with the call's own fields for the execution that admits it again. */
  carry(
    action: ValidatedAction,
    fields: WireRecord,
    standing: ToolContext,
  ): Effect.Effect<ActionOutputEnvelope>;
}

function createdSessionOf(
  action: ValidatedAction<SessionActionKind>,
  executed: ActionExecutionAnswer,
) {
  if (
    action.kind !== ACTION_KIND.CREATE_WORKSPACE ||
    executed.result !== ACTION_RESULT_STATUS.ACCEPTED ||
    executed.providerSessionId === undefined
  ) {
    return undefined;
  }
  return {
    providerId: action.providerId,
    providerSessionId: executed.providerSessionId,
  };
}

function carriedResult(
  action: ValidatedAction<SessionActionKind>,
  executed: ActionExecutionAnswer,
): CarriedActionResult {
  switch (executed.result) {
    case ACTION_RESULT_STATUS.ACCEPTED: {
      const createdSession = createdSessionOf(action, executed);
      return {
        status: executed.result,
        ...(createdSession !== undefined ? { createdSession } : undefined),
        ...(executed.reason ? { note: executed.reason } : undefined),
      };
    }
    case ACTION_RESULT_STATUS.REJECTED:
    case ACTION_RESULT_STATUS.UNSUPPORTED:
      return { status: executed.result, reason: executed.reason ?? executed.result };
  }
}

/** The kinds the service carries to a provider: every session action but the open, which reaches a machine. */
function hostedSessionKind(kind: SessionActionKind): HostedSessionActionKind | undefined {
  return kind === ACTION_KIND.OPEN ? undefined : kind;
}

/** The stored snapshot as the execution admits against it, named only when one stands. */
function storedRosterOf(roster: HostedRoster): { roster?: ObservedRoster } {
  return roster.stored !== undefined ? { roster: roster.stored } : {};
}

export function hostedActionCarrier(dependencies: HostedCarrierDependencies): HostedActionCarrier {
  const carrySessionAction = (
    action: ValidatedAction<SessionActionKind>,
    fields: WireRecord,
    standing: ToolContext,
  ): Effect.Effect<ActionOutputEnvelope> =>
    Effect.gen(function* () {
      const roster = yield* dependencies.roster();
      const target = actionTargetSnapshot(action, roster.sessions);
      const kind = hostedSessionKind(action.kind);
      if (kind === undefined) return refusedActionOutput(REFUSAL.NOT_HERE, target);
      const providerId = "identity" in action ? action.identity.providerId : action.providerId;
      if (!isCloudAgentProviderId(providerId))
        return refusedActionOutput(REFUSAL.NOT_CLOUD, target);
      const apiKey = yield* dependencies.apiKey(providerId);
      if (standing.isRevoked()) return refusedActionOutput(ACTION_REFUSAL.TURN_OVER, target);
      if (!apiKey) return refusedActionOutput(REFUSAL.NO_KEY, target);
      // The developer's stored agent pairing is read only for an action that
      // starts an agent. The brain's creation and spawn declare no model, so on
      // this path the pairing always rides; the execution's rule that a named
      // model outranks it serves the device routes, whose pickers may name one.
      const agentSelection = AGENT_STARTING_ACTION_KINDS.has(kind)
        ? (yield* dependencies.defaults()).agentDefaults?.[providerId]
        : undefined;
      const stored = yield* dependencies.roster();
      const executed = yield* dependencies.execute({
        kind,
        providerId,
        fields,
        apiKey,
        roster: actionRosterFor(providerId, storedRosterOf(stored)),
        ...(agentSelection === undefined ? undefined : { agentSelection }),
      });
      return actionOutputFromResult(carriedResult(action, executed), target);
    });

  const notHere = (): Effect.Effect<ActionOutputEnvelope> =>
    Effect.sync(() => refusedActionOutput(REFUSAL.NOT_HERE));

  return {
    admission: () =>
      Effect.gen(function* () {
        const roster = yield* Effect.cached(dependencies.roster());
        return {
          roster: { read: () => Effect.map(roster, (held) => held.sessions) },
          projects: {
            read: () => Effect.map(roster, (held) => held.projects),
            defaults: () => dependencies.defaults(),
            agentModels: workspaceAgentModels,
          },
        };
      }),
    carry(action, fields, standing) {
      return Effect.suspend(() => {
        if (standing.isRevoked())
          return Effect.succeed(refusedActionOutput(ACTION_REFUSAL.TURN_OVER));
        return dispatchByKind(action, {
          [ACTION_KIND.MESSAGE]: (carried) => carrySessionAction(carried, fields, standing),
          [ACTION_KIND.CONTROL]: (carried) => carrySessionAction(carried, fields, standing),
          [ACTION_KIND.CREATE_WORKSPACE]: (carried) =>
            carrySessionAction(carried, fields, standing),
          [ACTION_KIND.ADD_AGENT]: (carried) => carrySessionAction(carried, fields, standing),
          [ACTION_KIND.RENAME_WORKSPACE]: (carried) =>
            carrySessionAction(carried, fields, standing),
          [ACTION_KIND.RENAME_SESSION]: (carried) => carrySessionAction(carried, fields, standing),
          [ACTION_KIND.OPEN]: notHere,
          [ACTION_KIND.SETTING]: notHere,
          [ACTION_KIND.PANEL]: notHere,
          [ACTION_KIND.FEEDBACK]: notHere,
          [ACTION_KIND.UPDATE]: notHere,
        });
      });
    },
  };
}
