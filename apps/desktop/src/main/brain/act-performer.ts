import { randomUUID } from "node:crypto";
import {
  ACT_KIND,
  ACT_REFUSAL,
  type AdmitContext,
  dispatchByKind,
  type RealtimeFunctionCall,
  type RememberedFact,
  type SessionActKind,
  toolAction,
  type ValidatedAct,
} from "@sidecar/acts";
import type { BrainActExecution, BrainActPerformer } from "@sidecar/brain";
import type { AppGuideSnapshot } from "@sidecar/guide";
import type { TrackedIssue } from "@sidecar/issues";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  sessionActConversationEntry,
} from "@sidecar/realtime";
import { isRunOrigin, RUN_ORIGIN } from "@sidecar/runtime-contracts";
import {
  type ObservedWorkspaceProject,
  type Session,
  workspaceAgentModels,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, isWireString, type WireRecord } from "@sidecar/wire";
import type { BrainAppActRequest } from "#shared/messages/brain";
import type { SessionActPerformer } from "../ipc/session-acts";

/** The developer's saved creation tie-breaks, as the projects context narrates them. */
export interface WorkspaceCreationDefaults {
  defaultProviderId?: string;
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
}

/** The notebook as an act reaches it: remember answers whether the words now stand, forget whether the entry is gone. */
export interface BrainNotebookWriter {
  remember(ask: { id: string; words: string; replaces?: string }): Promise<boolean>;
  forget(id: string): Promise<boolean>;
}

export interface BrainActPerformerDependencies {
  sessionActs: SessionActPerformer;
  /** The roster as the brain was shown it: every observed session still worth a row. */
  sessions: () => readonly Session[];
  /**
   * Triggers a fresh observation pass so the session registry is current before
   * validation and perform. Called before every session act.
   */
  refreshSessions: () => Promise<void>;
  workspaceProjects: () => readonly ObservedWorkspaceProject[];
  workspaceDefaults: () => Promise<WorkspaceCreationDefaults>;
  trackedIssues: () => readonly TrackedIssue[] | undefined;
  /** The guide as the renderer last reported it; empty before it has. */
  appGuide: () => AppGuideSnapshot;
  /** The notebook's entries as the validators read them: what the model may name by id. */
  rememberedFacts: () => readonly RememberedFact[];
  /**
   * The notebook's two writes, each carried whole by the store's worker,
   * which serializes every mutation of the workspace and reconciles a hand
   * edit before writing, so two conversations remembering at once cannot
   * drop each other's entry.
   */
  notebook: BrainNotebookWriter;
  /** Carries an app act only a renderer can perform, and answers what became of it. */
  performAppAct: (action: BrainAppActRequest["action"]) => Promise<WireRecord>;
  /** Records the ask a carried session act was, so the thread holds it. */
  recordConversationEntry: (entry: ConversationEntry) => void;
}

const REFUSAL = {
  NO_EXECUTION: "Not run: an act needs the standing of a turn.",
  // One sentence for a turn that ended, wherever it is noticed: here before
  // admission runs, inside admission after each read of its own, and in the
  // performer at the last boundary before an effect.
  TURN_OVER: ACT_REFUSAL.TURN_OVER,
  MEMORY_NOT_SAVED: "That memory could not be saved.",
  MEMORY_NOT_REMOVED: "That memory could not be removed.",
} as const;

function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

/**
 * The gauntlet every act the brain asks for runs, in the main process: the
 * call is admitted by `admit`, against the roster it reads for itself, the
 * issue board, the offered projects, the guide, or the remembered facts, and
 * only the validated act it mints reaches the performer that carries it. The
 * brain is another way to ask, never a wider one: a call that names a session
 * Luke was not shown, a project no adapter offers, or a setting the guide does
 * not list is refused with a reason the brain can read.
 *
 * Before any of that, the act has to arrive with a turn's standing: an
 * execution context the brain built for the turn that emitted the call, naming
 * the run and who opened it. Whether the act may run at all was the tool
 * policy's decision before the call left the brain; here the context is what
 * says the turn still stands, and admission asks it again after every read of
 * its own, so an act whose turn ended while the roster was refreshing is
 * refused rather than dispatched. A call with no context or a malformed one is
 * refused before admission runs. The origin decides only how History records
 * the act: at the developer's ask, or as Luke's own judgment in a turn nobody
 * asked him anything in.
 */
export function createBrainActPerformer(
  dependencies: BrainActPerformerDependencies,
): BrainActPerformer {
  const admissionContext = (execution: BrainActExecution): AdmitContext => {
    const issues = dependencies.trackedIssues();
    return {
      origin: execution.origin,
      guard: execution,
      // The reads before an effect wait only as long as the standing does: a
      // cancel landing mid-refresh settles the act inside admission, and the
      // refresh's late answer dispatches nothing.
      roster: {
        read: async () => {
          await dependencies.refreshSessions();
          return dependencies.sessions();
        },
      },
      projects: {
        read: async () => dependencies.workspaceProjects(),
        defaults: () => dependencies.workspaceDefaults(),
        agentModels: workspaceAgentModels,
      },
      guide: dependencies.appGuide(),
      ...(issues ? { issues } : undefined),
      rememberedFacts: dependencies.rememberedFacts(),
    };
  };

  const carrySessionAct = (
    act: ValidatedAct<SessionActKind>,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    // The ask is recorded before the outcome is known: a refusal still leaves
    // the developer having asked it, and the reply voicing the outcome is
    // recorded as what Luke said.
    dependencies.recordConversationEntry(
      sessionActConversationEntry(
        act,
        dependencies.sessions(),
        execution.origin === RUN_ORIGIN.USER
          ? CONVERSATION_ENTRY_KIND.ACT
          : CONVERSATION_ENTRY_KIND.OWN_ACT,
      ),
    );
    // The performer awaits once more of its own before a create or a spawn,
    // so the execution rides along to be asked again there.
    return dependencies.sessionActs.perform(act, execution);
  };

  return {
    async perform(call: RealtimeFunctionCall, execution: BrainActExecution) {
      if (!isExecution(execution)) return rejection(REFUSAL.NO_EXECUTION);
      if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
      const admitted = await toolAction(call, admissionContext(execution));
      if (admitted.kind === undefined) return rejection(admitted.reason);
      if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
      // Where each admitted act goes, named kind by kind: the two notebook
      // writes are carried here, an app act is the renderer's to perform, an
      // issue act reaches its tracker without a History line, and a session
      // act is recorded as it is carried.
      return dispatchByKind(admitted, {
        [ACT_KIND.REMEMBER]: async (act) =>
          (await dependencies.notebook.remember({
            id: randomUUID(),
            words: act.words,
            ...(act.replaces !== undefined ? { replaces: act.replaces } : undefined),
          }))
            ? { status: ACT_RESULT_STATUS.ACCEPTED }
            : rejection(REFUSAL.MEMORY_NOT_SAVED),
        [ACT_KIND.FORGET]: async (act) =>
          (await dependencies.notebook.forget(act.id))
            ? { status: ACT_RESULT_STATUS.ACCEPTED }
            : rejection(REFUSAL.MEMORY_NOT_REMOVED),
        [ACT_KIND.SETTING]: (act) => dependencies.performAppAct(act),
        [ACT_KIND.PANEL]: (act) => dependencies.performAppAct(act),
        [ACT_KIND.FEEDBACK]: (act) => dependencies.performAppAct(act),
        [ACT_KIND.UPDATE]: (act) => dependencies.performAppAct(act),
        [ACT_KIND.ISSUE_STATE]: (act) => dependencies.sessionActs.perform(act, execution),
        [ACT_KIND.ISSUE_COMMENT]: (act) => dependencies.sessionActs.perform(act, execution),
        [ACT_KIND.MESSAGE]: (act) => carrySessionAct(act, execution),
        [ACT_KIND.CONTROL]: (act) => carrySessionAct(act, execution),
        [ACT_KIND.OPEN]: (act) => carrySessionAct(act, execution),
        [ACT_KIND.CREATE_WORKSPACE]: (act) => carrySessionAct(act, execution),
        [ACT_KIND.ADD_AGENT]: (act) => carrySessionAct(act, execution),
        [ACT_KIND.RENAME_WORKSPACE]: (act) => carrySessionAct(act, execution),
        [ACT_KIND.RENAME_SESSION]: (act) => carrySessionAct(act, execution),
      });
    },
  };
}

/**
 * Read as untrusted even though the type says otherwise: the main process is
 * the last gate before an effect, and a context missing or mis-shaped must
 * refuse here rather than trust its type.
 */
function isExecution(execution: BrainActExecution | undefined): execution is BrainActExecution {
  return (
    execution !== undefined &&
    execution !== null &&
    isWireString(execution.runId) &&
    execution.runId.length > 0 &&
    isRunOrigin(execution.origin) &&
    execution.isRevoked instanceof Function &&
    execution.signal instanceof AbortSignal
  );
}
