/**
 * The Conversation sentence each action is recorded under. One entry per kind, total
 * over the vocabulary, so a new action does not compile until its sentence is
 * written and no action can be recorded as "an action" with nothing said about it.
 */

import type {
  CONVERSATION_ENTRY_KIND,
  ConversationEntry,
  ConversationEntryAction,
  Session,
  SessionApplicationId,
  SessionIdentity,
} from "@sidecar/session";
import {
  ACTION_KIND,
  type ActionKind,
  type CarriedAction,
  type CarriedSessionAction,
} from "./action-kinds.js";

function observedSessionName(identity: SessionIdentity, sessions: readonly Session[]): string {
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === identity.providerId &&
      candidate.providerSessionId === identity.providerSessionId,
  );
  return session ? `"${session.title}"` : "a session";
}

function observedApplicationName(
  identity: SessionIdentity,
  applicationId: SessionApplicationId,
  sessions: readonly Session[],
): string {
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === identity.providerId &&
      candidate.providerSessionId === identity.providerSessionId,
  );
  return (
    session?.applications.find((application) => application.id === applicationId)?.displayName ??
    applicationId
  );
}

const ACTION_NARRATION = {
  [ACTION_KIND.MESSAGE]: (action, sessions) =>
    `sent a message to ${observedSessionName(action.identity, sessions)}: "${action.text}"`,
  [ACTION_KIND.CONTROL]: (action, sessions) =>
    `ran "${action.control.label}" on ${observedSessionName(action.identity, sessions)}`,
  [ACTION_KIND.OPEN]: (action, sessions) => {
    const name = observedSessionName(action.identity, sessions);
    return action.applicationId
      ? `opened ${name} in ${observedApplicationName(action.identity, action.applicationId, sessions)}`
      : `opened ${name}`;
  },
  [ACTION_KIND.CREATE_WORKSPACE]: (action) =>
    `asked ${action.providerId} to create a workspace${action.name ? ` named "${action.name}"` : ""}`,
  [ACTION_KIND.ADD_AGENT]: (action, sessions) =>
    `added a ${action.agent} agent to ${observedSessionName(action.identity, sessions)}`,
  [ACTION_KIND.RENAME_WORKSPACE]: (action, sessions) =>
    `renamed the workspace of ${observedSessionName(action.identity, sessions)} to "${action.name}"`,
  [ACTION_KIND.RENAME_SESSION]: (action, sessions) =>
    `renamed ${observedSessionName(action.identity, sessions)} to "${action.name}"`,
  [ACTION_KIND.ISSUE_STATE]: (action) =>
    `moved issue ${action.identity.identifier} to "${action.transition.name}"`,
  [ACTION_KIND.ISSUE_COMMENT]: (action) => `commented on issue ${action.identity.identifier}`,
  [ACTION_KIND.SETTING]: (action) => `changed ${action.setting.label} to ${action.value}`,
  [ACTION_KIND.PANEL]: (action) => `showed the ${action.tab} panel`,
  [ACTION_KIND.FEEDBACK]: (action) => `opened the ${action.composer} composer`,
  [ACTION_KIND.UPDATE]: (action) => `ran the Updates row's ${action.action}`,
  [ACTION_KIND.REMEMBER]: (action) =>
    action.replaces
      ? `remembered "${action.words}" in place of something remembered before`
      : `remembered "${action.words}"`,
  [ACTION_KIND.FORGET]: () => "forgot something remembered before",
} as const satisfies {
  [K in ActionKind]: (action: CarriedAction<K>, sessions: readonly Session[]) => string;
};

/** The Conversation sentence declared by the same vocabulary that declared the action. */
export function actionNarration(action: CarriedAction, sessions: readonly Session[]): string {
  const narrate = ACTION_NARRATION[action.kind];
  // SAFETY: the record is keyed by the same union `action.kind` ranges over, so the
  // entry selected is the one written for this action's own shape.
  return (narrate as (action: CarriedAction, sessions: readonly Session[]) => string)(
    action,
    sessions,
  );
}

/**
 * The history line one carried action leaves behind: the ask, in the words of
 * what was asked — never the outcome, which the reply voicing it records as
 * its own line — beside the kind it was, which is what the panel draws the
 * line by. A transcript reading is deliberately only the fact that one was read: the
 * rendering travels in the turn that asked for it and nowhere else, so the
 * record keeps the action and not a word of what it rendered.
 *
 * It is here rather than beside the rest of the conversation model because it
 * is the one line whose words are an action's narration, and the action vocabulary
 * sits above the session vocabulary the conversation model is part of.
 */
export function sessionActionConversationEntry(
  action: CarriedSessionAction,
  sessions: readonly Session[],
  kind: typeof CONVERSATION_ENTRY_KIND.ACTION | typeof CONVERSATION_ENTRY_KIND.OWN_ACTION,
): ConversationEntry {
  const words = actionNarration(action, sessions);
  const carried: ConversationEntryAction = { kind: action.kind };
  if (action.kind === ACTION_KIND.CREATE_WORKSPACE) carried.providerId = action.providerId;
  const entry: ConversationEntry = { kind, words, action: carried };
  if ("identity" in action) entry.identity = action.identity;
  return entry;
}
