import { randomUUID } from "node:crypto";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  ACTION_RESULT_STATUS,
  type ActionAdmissionReads,
  type ActionOutputEnvelope,
  acceptedActionOutput,
  actionOutputFromResult,
  actionTargetSnapshot,
  type CarriedActionResult,
  type CloudAgentProviderId,
  dispatchByKind,
  isCloudAgentProviderId,
  maximumRememberedFacts,
  type RememberedFact,
  refusedActionOutput,
  rememberedFactText,
  type SessionActionKind,
  type ToolContext,
  type ValidatedAction,
  type WireRecord,
  workspaceAgentModels,
} from "../../core.js";
import {
  type ActionExecutionAnswer,
  type ActionRoster,
  actionRosterFor,
  type HostedSessionActionKind,
} from "../action-execute.js";
import type { ObservedRoster } from "../observed-roster.js";
import type { HostedStoreRun } from "../store/database.js";
import type { HostedStore } from "../store/index.js";
import type { HostedWorkspaceDefaults } from "./defaults.js";
import type { HostedRoster } from "./roster.js";

/**
 * The host's half of the gauntlet every action the hosted brain asks for
 * runs. The action tool's own `execute` admits the call by `admit`, against
 * the roster it reads for itself through the readers handed out here — the
 * stored snapshot, the projects that snapshot listed, the developer's saved
 * defaults, the facts Luke remembers — and only the validated action it
 * mints reaches the carrier below. The carrier reaches the facts table for
 * a memory and the cloud action execution for a session or a workspace,
 * which admits the action once more against a fresh pass before the
 * provider's documented endpoint sees it. Nothing here reaches a machine:
 * an open and an app action have no performer on the
 * service, the tool policy offers none of them, and one that still arrives
 * is refused with a reason the model can read.
 */

/** The facts as an action reaches them: remember answers whether the words now stand, forget whether the entry is gone. */
export interface HostedFactsWriter {
  list(): Promise<readonly RememberedFact[]>;
  remember(ask: { id: string; words: string; replaces?: string }): Promise<boolean>;
  forget(id: string): Promise<boolean>;
}

/** One session action carried to its provider through the service's own execution, admitted there again. */
export type CloudActionExecutor = (input: {
  kind: HostedSessionActionKind;
  providerId: CloudAgentProviderId;
  fields: WireRecord;
  apiKey: string;
  /** The provider's slice of the stored roster, which the execution admits the action against again. */
  roster: ActionRoster;
}) => Promise<ActionExecutionAnswer>;

export interface HostedCarrierDependencies {
  /** The roster as the snapshot holds it now, read again for every action. */
  readonly roster: () => Promise<HostedRoster>;
  readonly defaults: () => Promise<HostedWorkspaceDefaults>;
  readonly facts: HostedFactsWriter;
  /** The account's stored key for a provider, decrypted; nothing where none is stored. */
  readonly apiKey: (providerId: CloudAgentProviderId) => Promise<string | undefined>;
  readonly execute: CloudActionExecutor;
}

const REFUSAL = {
  MEMORY_NOT_SAVED: "That memory could not be saved.",
  MEMORY_NOT_REMOVED: "That memory could not be removed.",
  NOT_HERE: "Not run: this action reaches a machine, and the service has none.",
  NO_KEY: "No provider key is stored for that session's provider.",
  NOT_CLOUD: "Not run: that session's provider is not one the service reaches.",
} as const;

/** What the hosted carrier answers with, for the action tools' context. */
export interface HostedActionCarrier {
  /** The readers admission consults for one call; the roster is read once per call however many readers ask. */
  admission(): Promise<ActionAdmissionReads>;
  /** Carries an action admission minted, with the call's own fields for the execution that admits it again. */
  carry(
    action: ValidatedAction,
    fields: WireRecord,
    standing: ToolContext,
  ): Promise<ActionOutputEnvelope>;
}

function carriedResult(executed: ActionExecutionAnswer): CarriedActionResult {
  switch (executed.result) {
    case ACTION_RESULT_STATUS.ACCEPTED:
      return {
        status: executed.result,
        ...(executed.reason ? { note: executed.reason } : undefined),
      };
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
  const carrySessionAction = async (
    action: ValidatedAction<SessionActionKind>,
    fields: WireRecord,
    standing: ToolContext,
  ): Promise<ActionOutputEnvelope> => {
    const roster = await dependencies.roster();
    const target = actionTargetSnapshot(action, roster.sessions);
    const kind = hostedSessionKind(action.kind);
    if (kind === undefined) return refusedActionOutput(REFUSAL.NOT_HERE, target);
    const providerId = "identity" in action ? action.identity.providerId : action.providerId;
    if (!isCloudAgentProviderId(providerId)) return refusedActionOutput(REFUSAL.NOT_CLOUD, target);
    const apiKey = await dependencies.apiKey(providerId);
    if (standing.isRevoked()) return refusedActionOutput(ACTION_REFUSAL.TURN_OVER, target);
    if (!apiKey) return refusedActionOutput(REFUSAL.NO_KEY, target);
    return actionOutputFromResult(
      carriedResult(
        await dependencies.execute({
          kind,
          providerId,
          fields,
          apiKey,
          roster: actionRosterFor(providerId, storedRosterOf(await dependencies.roster())),
        }),
      ),
      target,
    );
  };

  return {
    async admission() {
      let read: Promise<HostedRoster> | undefined;
      const roster = () => (read ??= dependencies.roster());
      return {
        roster: { read: async () => (await roster()).sessions },
        projects: {
          read: async () => (await roster()).projects,
          defaults: () => dependencies.defaults(),
          agentModels: workspaceAgentModels,
        },
        rememberedFacts: await dependencies.facts.list(),
      };
    },
    carry(action, fields, standing) {
      if (standing.isRevoked())
        return Promise.resolve(refusedActionOutput(ACTION_REFUSAL.TURN_OVER));
      return dispatchByKind(action, {
        [ACTION_KIND.REMEMBER]: async (remember) =>
          (await dependencies.facts.remember({
            id: randomUUID(),
            words: remember.words,
            ...(remember.replaces !== undefined ? { replaces: remember.replaces } : undefined),
          }))
            ? acceptedActionOutput()
            : refusedActionOutput(REFUSAL.MEMORY_NOT_SAVED),
        [ACTION_KIND.FORGET]: async (forget) =>
          (await dependencies.facts.forget(forget.id))
            ? acceptedActionOutput()
            : refusedActionOutput(REFUSAL.MEMORY_NOT_REMOVED),
        [ACTION_KIND.MESSAGE]: (carried) => carrySessionAction(carried, fields, standing),
        [ACTION_KIND.CONTROL]: (carried) => carrySessionAction(carried, fields, standing),
        [ACTION_KIND.CREATE_WORKSPACE]: (carried) => carrySessionAction(carried, fields, standing),
        [ACTION_KIND.ADD_AGENT]: (carried) => carrySessionAction(carried, fields, standing),
        [ACTION_KIND.RENAME_WORKSPACE]: (carried) => carrySessionAction(carried, fields, standing),
        [ACTION_KIND.RENAME_SESSION]: (carried) => carrySessionAction(carried, fields, standing),
        [ACTION_KIND.OPEN]: async () => refusedActionOutput(REFUSAL.NOT_HERE),
        [ACTION_KIND.SETTING]: async () => refusedActionOutput(REFUSAL.NOT_HERE),
        [ACTION_KIND.PANEL]: async () => refusedActionOutput(REFUSAL.NOT_HERE),
        [ACTION_KIND.FEEDBACK]: async () => refusedActionOutput(REFUSAL.NOT_HERE),
        [ACTION_KIND.UPDATE]: async () => refusedActionOutput(REFUSAL.NOT_HERE),
      });
    },
  };
}

/**
 * One account's fact writes, one at a time: every mutation reads the list
 * again before it writes, and the next waits for the last, so two calls
 * remembering at once cannot each replace the list from a stale reading and
 * drop the other's entry. The chain is per account and per process, which is
 * where concurrent calls of one turn run.
 */
const FACT_WRITES = new Map<string, Promise<unknown>>();

function serially<Value>(userId: string, write: () => Promise<Value>): Promise<Value> {
  const last = FACT_WRITES.get(userId) ?? Promise.resolve();
  const next = last.then(write, write);
  FACT_WRITES.set(
    userId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** The facts table as the carrier writes it: the same bounds the desktop's notebook keeps, one account's rows. */
export function hostedFactsWriter(
  run: HostedStoreRun,
  store: Pick<HostedStore, "facts">,
  userId: string,
  now: () => number,
): HostedFactsWriter {
  return {
    list: () => run(store.facts.list(userId)),
    remember: (ask) =>
      serially(userId, async () => {
        const words = rememberedFactText(ask.words);
        if (!words) return false;
        const standing = await run(store.facts.list(userId));
        const kept = standing.filter((fact) => fact.id !== ask.replaces);
        const next = kept.some((fact) => fact.words === words)
          ? kept
          : [...kept, { id: ask.id, words }];
        if (next.length > maximumRememberedFacts) return false;
        if (next.length !== standing.length || next !== kept) {
          await run(store.facts.replace(userId, next, now()));
        }
        return true;
      }),
    forget: (id) =>
      serially(userId, async () => {
        const standing = await run(store.facts.list(userId));
        if (!standing.some((fact) => fact.id === id)) return false;
        await run(
          store.facts.replace(
            userId,
            standing.filter((fact) => fact.id !== id),
            now(),
          ),
        );
        return true;
      }),
  };
}
