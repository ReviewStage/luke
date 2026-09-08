import { randomUUID } from "node:crypto";
import {
  APP_TOOL_KIND,
  appToolAction,
  type CarriedAppAction,
  dispatchByKind,
  issueToolAction,
  REALTIME_TOOL_FAMILY,
  type RealtimeFunctionCall,
  type RealtimeToolFamily,
  type RememberedFact,
  realtimeToolFamily,
  sessionToolAction,
} from "@sidecar/acts";
import {
  type BrainActExecution,
  type BrainActPerformer,
  settledUnlessAborted,
} from "@sidecar/brain";
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
import type { BrainAppActRequest } from "#shared/contracts";
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
  NO_SUCH_TOOL: "No such tool exists.",
  NO_EXECUTION: "Not run: an act needs the standing of a turn.",
  TURN_OVER: "Not run: the turn that asked for this act is over.",
  NO_TRACKER: "No issue tracker is connected.",
  MEMORY_NOT_SAVED: "That memory could not be saved.",
  MEMORY_NOT_REMOVED: "That memory could not be removed.",
} as const;

function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

/**
 * The gauntlet every act the brain asks for runs, in the main process: the
 * call is validated against the roster, the issue board, the offered
 * projects, the guide, or the remembered facts — the same validators the
 * voice's own tool calls once ran in the renderer — and only a validated act
 * reaches the performer that carries it. The brain is another way to ask,
 * never a wider one: a call that names a session Luke was not shown, a
 * project no adapter offers, or a setting the guide does not list is refused
 * with a reason the brain can read.
 *
 * Before any of that, the act has to arrive with a turn's standing: an
 * execution context the brain built for the turn that emitted the call,
 * naming the run and who opened it. Whether the act may run at all was the
 * tool policy's decision before the call left the brain; here the context is
 * what says the turn still stands, and it is asked again after every step
 * awaited and once more just before the effect, so an act whose turn ended
 * while the roster was refreshing is refused rather than dispatched. A call
 * with no context or a malformed one is refused before a validator runs. The
 * origin decides only how History records the act: at the developer's ask,
 * or as Luke's own judgment in a turn nobody asked him anything in.
 */
export function createBrainActPerformer(
  dependencies: BrainActPerformerDependencies,
): BrainActPerformer {
  const performSession = async (
    call: RealtimeFunctionCall,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    // The reads before the effect wait only as long as the standing does: a
    // cancel landing mid-refresh settles the act here, and the refresh's late
    // answer dispatches nothing.
    const refreshed = await settledUnlessAborted(dependencies.refreshSessions(), execution.signal);
    if (refreshed.aborted || execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    const sessions = dependencies.sessions();
    const read = await settledUnlessAborted(dependencies.workspaceDefaults(), execution.signal);
    if (read.aborted || execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    const defaults = read.value;
    const action = sessionToolAction(
      call,
      sessions,
      dependencies.workspaceProjects(),
      workspaceAgentModels,
      defaults.defaultProviderId,
      defaults.defaultProjectIds,
    );
    if (action.status === ACT_RESULT_STATUS.REJECTED) return rejection(action.reason);
    // The ask is recorded before the outcome is known: a refusal still leaves
    // the developer having asked it, and the reply voicing the outcome is
    // recorded as what Luke said.
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    dependencies.recordConversationEntry(
      sessionActConversationEntry(
        action,
        sessions,
        execution.origin === RUN_ORIGIN.USER
          ? CONVERSATION_ENTRY_KIND.ACT
          : CONVERSATION_ENTRY_KIND.OWN_ACT,
      ),
    );
    // The performer awaits once more of its own before a create or a spawn,
    // so the execution rides along to be asked again there.
    return dependencies.sessionActs.perform(action, execution);
  };

  const performIssue = async (
    call: RealtimeFunctionCall,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    const issues = dependencies.trackedIssues();
    if (!issues) return rejection(REFUSAL.NO_TRACKER);
    const action = issueToolAction(call, issues);
    if (action.status === ACT_RESULT_STATUS.REJECTED) return rejection(action.reason);
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    return dependencies.sessionActs.perform(action, execution);
  };

  const performApp = async (
    call: RealtimeFunctionCall,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    const action = appToolAction(
      call,
      dependencies.appGuide(),
      dependencies.sessions(),
      dependencies.rememberedFacts(),
    );
    if (action.status === ACT_RESULT_STATUS.REJECTED) return rejection(action.reason);
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    return carryAppAction(action);
  };

  const carryAppAction = (action: CarriedAppAction): Promise<WireRecord> =>
    dispatchByKind(action, {
      // The two memory writes are the notebook's own: the store's worker
      // writes the line and its provenance, and its answer is the whole report.
      [APP_TOOL_KIND.REMEMBER]: async (act) =>
        (await dependencies.notebook.remember({
          id: randomUUID(),
          words: act.words,
          ...(act.replaces !== undefined ? { replaces: act.replaces } : undefined),
        }))
          ? { status: ACT_RESULT_STATUS.ACCEPTED }
          : rejection(REFUSAL.MEMORY_NOT_SAVED),
      [APP_TOOL_KIND.FORGET]: async (act) =>
        (await dependencies.notebook.forget(act.id))
          ? { status: ACT_RESULT_STATUS.ACCEPTED }
          : rejection(REFUSAL.MEMORY_NOT_REMOVED),
      [APP_TOOL_KIND.SETTING]: (act) => dependencies.performAppAct(act),
      [APP_TOOL_KIND.PANEL]: (act) => dependencies.performAppAct(act),
      [APP_TOOL_KIND.FEEDBACK]: (act) => dependencies.performAppAct(act),
      [APP_TOOL_KIND.UPDATE]: (act) => dependencies.performAppAct(act),
    });

  const performers = {
    [REALTIME_TOOL_FAMILY.SESSION]: performSession,
    [REALTIME_TOOL_FAMILY.ISSUE]: performIssue,
    [REALTIME_TOOL_FAMILY.APP]: performApp,
  } as const satisfies Record<
    RealtimeToolFamily,
    (call: RealtimeFunctionCall, execution: BrainActExecution) => Promise<WireRecord>
  >;

  return {
    async perform(call: RealtimeFunctionCall, execution: BrainActExecution) {
      if (!isExecution(execution)) return rejection(REFUSAL.NO_EXECUTION);
      if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
      const family = realtimeToolFamily(call.name);
      if (family === undefined) return rejection(REFUSAL.NO_SUCH_TOOL);
      return performers[family](call, execution);
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
