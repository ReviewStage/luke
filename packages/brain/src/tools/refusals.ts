import { CHILD_SPAWN_REFUSAL, type ChildSpawnRefusal } from "@sidecar/runtime";

/**
 * The words a tool answers a call it will not carry with. They are the
 * model's to read and Conversation's to record, so they are fixed here once,
 * in the tools' own directory, where every module and the executor that
 * dispatches them reach the same sentence for the same refusal.
 */
export const REFUSAL_REASON = {
  UNOBSERVED_SESSION: "not an observed session",
  ANNOUNCE_IN_ASK: "reply in text: this is a developer ask, and your final text is the speech",
  NOT_ALLOWED: "not run: the tool policy does not offer this tool in this turn",
  NOT_OFFERED: "not run: no such tool in this turn",
  EMPTY_BRIEFING: "a briefing needs words",
  ACTION_FAILED: "the action did not complete",
  UNREADABLE_ANSWER: "the action answered in a shape this build cannot read",
  READ_FAILED: "the transcript could not be read",
  RUN_REVOKED: "not run: this ask was cancelled or its run ended",
  NOT_CHECKPOINTED: "not run: the action could not be recorded before running, so it was not run",
  CALL_ID_REUSED: "not run: this call id was already used with different arguments",
  NO_WORKSPACE: "not run: this agent has no workspace",
  MALFORMED_ARGUMENTS: "not run: the call's arguments are not the strings the tool takes",
  NO_CHILDREN: "not run: this conversation cannot delegate",
  NOT_OWN_CHILD: "not run: no child of this conversation has that id",
  /** A child named by id that the host does not hold for this conversation. */
  UNKNOWN_CHILD: "no child of this conversation has that id",
  EMPTY_TASK: "a task needs words",
  NO_MEMORY: "not run: this agent has no notebook index",
} as const;

/** A spawn refusal in the words the model reads; the service answers the code and this the sentence. */
export const SPAWN_REFUSAL_REASON = {
  [CHILD_SPAWN_REFUSAL.EMPTY_TASK]: "a task needs words",
  [CHILD_SPAWN_REFUSAL.DEPTH_CAP]: "not run: the delegation depth cap is reached",
  [CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT]:
    "not run: this conversation already has its limit of active children",
  [CHILD_SPAWN_REFUSAL.GLOBAL_LIMIT]: "not run: every child execution slot is taken",
  [CHILD_SPAWN_REFUSAL.BLOCKED_COMPLETIONS]:
    "not run: too many completions are blocked awaiting delivery",
  [CHILD_SPAWN_REFUSAL.FORK_OTHER_AGENT]: "not run: a fork must stay within the same agent",
  [CHILD_SPAWN_REFUSAL.PERSISTENCE]: "not run: the child's record could not be written",
  [CHILD_SPAWN_REFUSAL.STOPPED]: "not run: delegation is stopped",
} as const satisfies Record<ChildSpawnRefusal, string>;
