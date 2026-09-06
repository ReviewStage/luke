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
  SESSION_TOOL_KIND,
  sessionToolAction,
} from "@sidecar/acts";
import {
  BRAIN_TURN_AUTHORITY,
  type BrainActExecution,
  type BrainActPerformer,
} from "@sidecar/brain";
import type { AppGuideSnapshot } from "@sidecar/guide";
import type { TrackedIssue } from "@sidecar/issues";
import { type ConversationEntry, sessionActConversationEntry } from "@sidecar/realtime";
import {
  type ObservedWorkspaceProject,
  type Session,
  workspaceAgentModels,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import type { BrainAppActRequest } from "#shared/contracts";
import { forgetRememberedFact, type SessionActPerformer, saveRememberedFact } from "./session-acts";

/** The developer's saved creation tie-breaks, as the projects context narrates them. */
export interface WorkspaceCreationDefaults {
  defaultProviderId?: string;
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
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
  rememberedFacts: () => readonly RememberedFact[];
  writeRememberedFacts: (facts: readonly RememberedFact[]) => boolean;
  /** Carries an app act only a renderer can perform, and answers what became of it. */
  performAppAct: (action: BrainAppActRequest["action"]) => Promise<WireRecord>;
  /** Records the ask a carried session act was, so the thread holds it. */
  recordConversationEntry: (entry: ConversationEntry) => void;
}

const REFUSAL = {
  NO_SUCH_TOOL: "No such tool exists.",
  NO_AUTHORITY: "Not run: an act needs a turn the developer opened.",
  TURN_OVER: "Not run: the turn that asked for this act is over.",
  NO_TRACKER: "No issue tracker is connected.",
  BRAIN_READS_ITSELF: "Read the transcript with read_transcript; nothing is spoken from this act.",
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
 * Before any of that, the act has to arrive with the developer's own standing:
 * an execution context the brain built for a turn the developer opened, and
 * only for such a turn. A call with no context, a malformed one, or one whose
 * authority is anything but the developer's is refused before a validator
 * runs, so the shape of the context, not the words of the call, is what opens
 * the gate. The context is asked again after every step awaited here and once
 * more just before the effect, so an act whose turn ended while the roster
 * was refreshing is refused rather than dispatched.
 */
export function createBrainActPerformer(
  dependencies: BrainActPerformerDependencies,
): BrainActPerformer {
  const performSession = async (
    call: RealtimeFunctionCall,
    execution: BrainActExecution,
  ): Promise<WireRecord> => {
    await dependencies.refreshSessions();
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    const sessions = dependencies.sessions();
    const defaults = await dependencies.workspaceDefaults();
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    const action = sessionToolAction(
      call,
      sessions,
      dependencies.workspaceProjects(),
      workspaceAgentModels,
      defaults.defaultProviderId,
      defaults.defaultProjectIds,
    );
    if (action.status === ACT_RESULT_STATUS.REJECTED) return rejection(action.reason);
    if (action.kind === SESSION_TOOL_KIND.READ_TRANSCRIPT) {
      return rejection(REFUSAL.BRAIN_READS_ITSELF);
    }
    // The ask is recorded before the outcome is known: a refusal still leaves
    // the developer having asked it, and the reply voicing the outcome is
    // recorded as what Luke said.
    if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
    dependencies.recordConversationEntry(sessionActConversationEntry(action, sessions));
    return dependencies.sessionActs.perform(action);
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
    return dependencies.sessionActs.perform(action);
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
      // The two memory writes are the main process's own: the list lives
      // here, and the store's answer is the whole report.
      [APP_TOOL_KIND.REMEMBER]: async (act) => {
        const facts = saveRememberedFact(
          dependencies.rememberedFacts(),
          act.words,
          act.replaces,
          randomUUID(),
          dependencies.writeRememberedFacts,
        );
        return facts.some((fact) => fact.words === act.words)
          ? { status: ACT_RESULT_STATUS.ACCEPTED }
          : rejection(REFUSAL.MEMORY_NOT_SAVED);
      },
      [APP_TOOL_KIND.FORGET]: async (act) => {
        const facts = forgetRememberedFact(
          dependencies.rememberedFacts(),
          act.id,
          dependencies.writeRememberedFacts,
        );
        return facts.some((fact) => fact.id === act.id)
          ? rejection(REFUSAL.MEMORY_NOT_REMOVED)
          : { status: ACT_RESULT_STATUS.ACCEPTED };
      },
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
      if (!isDeveloperExecution(execution)) return rejection(REFUSAL.NO_AUTHORITY);
      if (execution.isRevoked()) return rejection(REFUSAL.TURN_OVER);
      const family = realtimeToolFamily(call.name);
      if (family === undefined) return rejection(REFUSAL.NO_SUCH_TOOL);
      return performers[family](call, execution);
    },
  };
}

/**
 * Read as untrusted even though the type says otherwise: the main process is
 * the last gate before an effect, and a context missing, mis-shaped, or of any
 * authority but the developer's must refuse here rather than trust its type.
 */
function isDeveloperExecution(
  execution: BrainActExecution | undefined,
): execution is BrainActExecution {
  return (
    execution?.authority === BRAIN_TURN_AUTHORITY.DEVELOPER &&
    execution.isRevoked instanceof Function
  );
}
