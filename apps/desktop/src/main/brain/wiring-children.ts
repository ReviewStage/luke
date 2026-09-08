import type { BrainAgent, BrainChildAccess } from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import { ChildRunService, type ChildStore, type ScheduledTimer } from "@sidecar/runtime";
import {
  CHILD_RUN_STATUS,
  type ChildRunRecord,
  type ConversationRecord,
  childIdOf,
  DEFAULT_AGENT_ID,
  type ModelAdapter,
  observedSessionRefOf,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import type { SessionIdentity } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";

/**
 * Delegation as the main process composes it. The service owns the records
 * and the completion schedule; this wiring runs a child as one more
 * conversation of the same agent, on the child lane, and hands each
 * completion to the conversation that asked, whichever kind it is — steered
 * into its run under way or opened as a turn of its own — so no conversation
 * ever polls for a result. The conversations themselves belong to the brain
 * wiring, reached here only through the host it lends.
 */

export interface ChildWiringDependencies {
  /** Lists a child's conversation in the directory, creating its row when none stands. */
  ensureChildConversation: (sessionKey: SessionKey, name: string) => Promise<void>;
  /** Archives a conversation in the directory, its history kept; a completed child's, on its clock. */
  archiveConversation: (sessionKey: SessionKey) => Promise<boolean>;
  /** The directory as it stands, for `sessions_list`. */
  conversationDirectory: () => readonly ConversationRecord[];
  /** One conversation's thread as it stands, for `sessions_history` over a child. */
  historyLines: (sessionKey: SessionKey) => readonly ConversationEntry[];
  /** Where child records and completions stand between launches. */
  childStore: () => ChildStore;
  /** The clock the child service's delivery retries and archive delays run on; absent means the process's own timers. */
  childTimers?: {
    schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
    cancel: (timer: ScheduledTimer) => void;
  };
  createId: () => string;
  report: (message: string) => void;
  /** The model adapter the credential policy built, or nothing when it built none. */
  model: () => ModelAdapter | undefined;
}

/** What the brain wiring lends delegation: its conversations, opened and closed only through it. */
export interface ChildWiringHost {
  /** The brain standing for a conversation now, if any. */
  current: (sessionKey: SessionKey) => BrainAgent | undefined;
  /** The model the policy chose, or nothing when no brain may stand. */
  liveModel: () => ModelAdapter | undefined;
  /** Opens a conversation's store and, on the model given, its brain; a fork is the child's opening history. */
  open: (
    sessionKey: SessionKey,
    model: ModelAdapter,
    fork?: readonly WireRecord[],
  ) => Promise<BrainAgent | undefined>;
  /** Opens an observed session's conversation, serialized with any closing of the same key. */
  openObserved: (identity: SessionIdentity) => Promise<BrainAgent | undefined>;
  /** Retires a conversation's brain and lets its store go. */
  closeConversation: (sessionKey: SessionKey) => Promise<void>;
}

export interface ChildWiring {
  /** The child records, completions, and their lifecycle, for inspection and tests. */
  readonly service: ChildRunService;
  /** The session tools of one conversation: a child named through them must be its own. */
  accessFor: (sessionKey: SessionKey) => BrainChildAccess;
}

/** The record of the child whose conversation this is, or nothing for any other kind of key. */
export function childRecordOf(
  service: ChildRunService,
  sessionKey: SessionKey,
): ChildRunRecord | undefined {
  const childId = childIdOf(sessionKey);
  return childId === undefined ? undefined : service.child(childId);
}

function childName(record: ChildRunRecord): string {
  return record.label ?? `Child ${record.childId}`;
}

export function wireChildren(
  dependencies: ChildWiringDependencies,
  host: ChildWiringHost,
): ChildWiring {
  const openChild = async (
    record: ChildRunRecord,
    fork?: readonly WireRecord[],
  ): Promise<BrainAgent | undefined> => {
    const model = host.liveModel();
    if (!model) return undefined;
    await dependencies.ensureChildConversation(record.childSessionKey, childName(record));
    return host.open(record.childSessionKey, model, fork);
  };

  /**
   * The conversation a completion is for, opened again if it was stood down:
   * an observed session's conversation whose session left the roster, a
   * child requester already archived, or a thread with no brain yet. The
   * completion is owed to that conversation and no other, so main is never
   * handed a sibling's result.
   */
  const openDestination = async (destination: SessionKey): Promise<BrainAgent | undefined> => {
    const standing = host.current(destination);
    if (standing) return standing;
    const model = host.liveModel();
    if (!model) return undefined;
    const observed = observedSessionRefOf(destination);
    if (observed) return host.openObserved(observed);
    const child = childRecordOf(service, destination);
    if (child) return openChild(child);
    return host.open(destination, model);
  };

  const service = new ChildRunService({
    store: dependencies.childStore(),
    createId: dependencies.createId,
    report: dependencies.report,
    ...(dependencies.childTimers ?? undefined),
    executor: {
      start: async (record, fork) => {
        const agent = await openChild(record, fork);
        if (!agent) return { started: false, reason: "no model stands to run the child" };
        const run = await agent.runChildTask(record.task, record.childRunId);
        if (!run) return { started: false, reason: "the child's run was refused" };
        return { started: true, done: run.done };
      },
      resume: async (record) => {
        const agent = await openChild(record);
        if (!agent) return { started: false, reason: "no model stands to recover the child" };
        // Nothing is run again: the child's own record, marked interrupted
        // at its conversation's load, is the end the runtime can vouch for;
        // a child whose run was never recorded ends unknown on the strength
        // of its requester's receipt alone.
        const adopted = await agent.adoptChildRun(record.childRunId);
        return {
          started: true,
          done: Promise.resolve(
            adopted ?? {
              status: CHILD_RUN_STATUS.UNKNOWN,
              failureDetail: "the child's run was never recorded before the relaunch",
            },
          ),
        };
      },
      cancel: async (record) => {
        const agent = host.current(record.childSessionKey);
        if (!agent) return true;
        return agent.cancelChildRun(record.childRunId);
      },
      archive: async (record) => {
        await host.closeConversation(record.childSessionKey);
        return dependencies.archiveConversation(record.childSessionKey);
      },
      history: async (record, limit) =>
        dependencies
          .historyLines(record.childSessionKey)
          .slice(-limit)
          .map((entry) => `${entry.kind}: ${entry.words}`),
    },
    deliverer: {
      deliver: async (completion, record) => {
        const agent = await openDestination(completion.destination);
        if (!agent) return { delivered: false, reason: "no brain stands for the requester" };
        return agent.deliverChildCompletion(completion, record);
      },
    },
  });

  const accessFor = (sessionKey: SessionKey): BrainChildAccess => {
    const own = (childId: string): ChildRunRecord | undefined => {
      const record = service.child(childId);
      return record && record.requesterSessionKey === sessionKey ? record : undefined;
    };
    return {
      sessionKey,
      spawn: (ask) => {
        const model = dependencies.model()?.model;
        return service.spawn({
          ...ask,
          agentId: DEFAULT_AGENT_ID,
          requesterSessionKey: sessionKey,
          requesterDepth: childRecordOf(service, sessionKey)?.depth ?? 0,
          ...(model ? { model } : undefined),
          sameAgent: true,
        });
      },
      list: async () =>
        service.childrenOf(sessionKey).map((record) => ({
          record,
          completion: service.completion(record.childId),
        })),
      cancel: async (childId) => (own(childId) ? service.cancel(childId) : undefined),
      conversations: async () => dependencies.conversationDirectory(),
      history: async (childId, limit) =>
        own(childId) ? ((await service.history(childId, limit)) ?? []) : undefined,
    };
  };

  return { service, accessFor };
}
