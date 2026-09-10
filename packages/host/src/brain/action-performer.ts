import { randomUUID } from "node:crypto";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  type ActionOutputEnvelope,
  type AdmitContext,
  acceptedActionOutput,
  actionOutputFromResult,
  actionTargetSnapshot,
  dispatchByKind,
  type RealtimeFunctionCall,
  type RememberedFact,
  refusedActionOutput,
  type SessionActionKind,
  sessionActionConversationEntry,
  toolAction,
  type ValidatedAction,
} from "@sidecar/actions";
import type { BrainActionExecution, BrainActionPerformer } from "@sidecar/brain";
import type { BrainAppActionRequest } from "@sidecar/brain/requests-wire";
import type { AppGuideSnapshot } from "@sidecar/guide";
import { isRunOrigin, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { TrackedIssue } from "@sidecar/session";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  isSessionWriteResult,
  type ObservedWorkspaceProject,
  type Session,
  workspaceAgentModels,
} from "@sidecar/session";
import { isWireString, type WireRecord } from "@sidecar/wire";
import type { SessionActionPerformer } from "../session-action-performer.js";

/** The developer's saved creation tie-breaks, as the projects context narrates them. */
export interface WorkspaceCreationDefaults {
  defaultProviderId?: string;
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
}

/** The notebook as an action reaches it: remember answers whether the words now stand, forget whether the entry is gone. */
interface BrainNotebookWriter {
  remember(ask: { id: string; words: string; replaces?: string }): Promise<boolean>;
  forget(id: string): Promise<boolean>;
}

export interface BrainActionPerformerDependencies {
  sessionActions: SessionActionPerformer;
  /** The roster as the brain was shown it: every observed session still worth a row. */
  sessions: () => readonly Session[];
  /**
   * Triggers a fresh observation pass so the session registry is current before
   * validation and perform. Called before every session action.
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
  /** Carries an app action only a renderer can perform, and answers what became of it. */
  performAppAction: (action: BrainAppActionRequest["action"]) => Promise<WireRecord>;
  /** Records the ask a carried session action was, so the thread holds it. */
  recordConversationEntry: (entry: ConversationEntry) => void;
}

const REFUSAL = {
  NO_EXECUTION: "Not run: an action needs the standing of a turn.",
  // One sentence for a turn that ended, wherever it is noticed: here before
  // admission runs, inside admission after each read of its own, and in the
  // performer at the last boundary before an effect.
  TURN_OVER: ACTION_REFUSAL.TURN_OVER,
  MEMORY_NOT_SAVED: "That memory could not be saved.",
  MEMORY_NOT_REMOVED: "That memory could not be removed.",
  UNREADABLE_PANEL_ANSWER: "The panel answered in a shape this build cannot read.",
} as const;

/**
 * The gauntlet every action the brain asks for runs, in the main process: the
 * call is admitted by `admit`, against the roster it reads for itself, the
 * issue board, the offered projects, the guide, or the remembered facts, and
 * only the validated action it mints reaches the performer that carries it. The
 * brain is another way to ask, never a wider one: a call that names a session
 * Luke was not shown, a project no adapter offers, or a setting the guide does
 * not list is refused with a reason the brain can read.
 *
 * Before any of that, the action has to arrive with a turn's standing: an
 * execution context the brain built for the turn that emitted the call, naming
 * the run and who opened it. Whether the action may run at all was the tool
 * policy's decision before the call left the brain; here the context is what
 * says the turn still stands, and admission asks it again after every read of
 * its own, so an action whose turn ended while the roster was refreshing is
 * refused rather than dispatched. A call with no context or a malformed one is
 * refused before admission runs. The origin decides only how Conversation records
 * the action: at the developer's ask, or as Luke's own judgment in a turn nobody
 * asked him anything in.
 */
export function createBrainActionPerformer(
  dependencies: BrainActionPerformerDependencies,
): BrainActionPerformer {
  const admissionContext = (execution: BrainActionExecution): AdmitContext => {
    const issues = dependencies.trackedIssues();
    // The roster and the projects an action is admitted against are two readings
    // of one observation pass, so the pass runs once per action however many of
    // them admission asks for. An action that asks for neither — an issue action, a
    // setting — observes nothing at all.
    let pass: Promise<void> | undefined;
    const observed = () => (pass ??= dependencies.refreshSessions());
    return {
      origin: execution.origin,
      guard: execution,
      // The reads before an effect wait only as long as the standing does: a
      // cancel landing mid-refresh settles the action inside admission, and the
      // refresh's late answer dispatches nothing.
      roster: {
        read: async () => {
          await observed();
          return dependencies.sessions();
        },
      },
      projects: {
        read: async () => {
          await observed();
          return dependencies.workspaceProjects();
        },
        defaults: () => dependencies.workspaceDefaults(),
        agentModels: workspaceAgentModels,
      },
      guide: dependencies.appGuide(),
      ...(issues ? { issues } : undefined),
      rememberedFacts: dependencies.rememberedFacts(),
    };
  };

  const carrySessionAction = async (
    action: ValidatedAction<SessionActionKind>,
    execution: BrainActionExecution,
  ): Promise<ActionOutputEnvelope> => {
    // The roster as admission just refreshed it is the snapshot the envelope
    // carries: the title and agent the target wore when the action ran, read
    // now rather than at render, when the session may be renamed or gone.
    const sessions = dependencies.sessions();
    const target = actionTargetSnapshot(action, sessions);
    // The ask is recorded before the outcome is known: a refusal still leaves
    // the developer having asked it, and the reply voicing the outcome is
    // recorded as what Luke said.
    dependencies.recordConversationEntry(
      sessionActionConversationEntry(
        action,
        sessions,
        execution.origin === RUN_ORIGIN.USER
          ? CONVERSATION_ENTRY_KIND.ACTION
          : CONVERSATION_ENTRY_KIND.OWN_ACTION,
      ),
    );
    // The performer awaits once more of its own before a create or a spawn,
    // so the execution rides along to be asked again there.
    return actionOutputFromResult(
      await dependencies.sessionActions.perform(action, execution),
      target,
    );
  };

  /** The panel's answer, read as untrusted: a shape this build cannot read is a refusal, never an acceptance. */
  const carryAppAction = async (
    action: BrainAppActionRequest["action"],
  ): Promise<ActionOutputEnvelope> => {
    const answered = await dependencies.performAppAction(action);
    return isSessionWriteResult(answered)
      ? actionOutputFromResult(answered)
      : refusedActionOutput(REFUSAL.UNREADABLE_PANEL_ANSWER);
  };

  return {
    async perform(call: RealtimeFunctionCall, execution: BrainActionExecution) {
      if (!isExecution(execution)) return refusedActionOutput(REFUSAL.NO_EXECUTION);
      if (execution.isRevoked()) return refusedActionOutput(REFUSAL.TURN_OVER);
      const admitted = await toolAction(call, admissionContext(execution));
      if (admitted.kind === undefined) return refusedActionOutput(admitted.reason);
      if (execution.isRevoked()) return refusedActionOutput(REFUSAL.TURN_OVER);
      // Where each admitted action goes, named kind by kind: the two notebook
      // writes are carried here, an app action is the renderer's to perform, an
      // issue action reaches its tracker without a Conversation line, and a session
      // action is recorded as it is carried. Every answer is the one envelope.
      return dispatchByKind(admitted, {
        [ACTION_KIND.REMEMBER]: async (action) =>
          (await dependencies.notebook.remember({
            id: randomUUID(),
            words: action.words,
            ...(action.replaces !== undefined ? { replaces: action.replaces } : undefined),
          }))
            ? acceptedActionOutput()
            : refusedActionOutput(REFUSAL.MEMORY_NOT_SAVED),
        [ACTION_KIND.FORGET]: async (action) =>
          (await dependencies.notebook.forget(action.id))
            ? acceptedActionOutput()
            : refusedActionOutput(REFUSAL.MEMORY_NOT_REMOVED),
        [ACTION_KIND.SETTING]: carryAppAction,
        [ACTION_KIND.PANEL]: carryAppAction,
        [ACTION_KIND.FEEDBACK]: carryAppAction,
        [ACTION_KIND.UPDATE]: carryAppAction,
        [ACTION_KIND.ISSUE_STATE]: async (action) =>
          actionOutputFromResult(await dependencies.sessionActions.perform(action, execution)),
        [ACTION_KIND.ISSUE_COMMENT]: async (action) =>
          actionOutputFromResult(await dependencies.sessionActions.perform(action, execution)),
        [ACTION_KIND.MESSAGE]: (action) => carrySessionAction(action, execution),
        [ACTION_KIND.CONTROL]: (action) => carrySessionAction(action, execution),
        [ACTION_KIND.OPEN]: (action) => carrySessionAction(action, execution),
        [ACTION_KIND.CREATE_WORKSPACE]: (action) => carrySessionAction(action, execution),
        [ACTION_KIND.ADD_AGENT]: (action) => carrySessionAction(action, execution),
        [ACTION_KIND.RENAME_WORKSPACE]: (action) => carrySessionAction(action, execution),
        [ACTION_KIND.RENAME_SESSION]: (action) => carrySessionAction(action, execution),
      });
    },
  };
}

/**
 * Read as untrusted even though the type says otherwise: the main process is
 * the last gate before an effect, and a context missing or mis-shaped must
 * refuse here rather than trust its type.
 */
function isExecution(
  execution: BrainActionExecution | undefined,
): execution is BrainActionExecution {
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
