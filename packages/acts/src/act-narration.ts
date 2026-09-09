/**
 * The History sentence each act is recorded under. One entry per kind, total
 * over the vocabulary, so a new act does not compile until its sentence is
 * written and no act can be recorded as "an act" with nothing said about it.
 */

import type {
  CONVERSATION_ENTRY_KIND,
  ConversationEntry,
  Session,
  SessionApplicationId,
  SessionIdentity,
} from "@sidecar/session";
import { ACT_KIND, type ActKind, type CarriedAct, type CarriedSessionAct } from "./act-kinds.js";

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

const ACT_NARRATION = {
  [ACT_KIND.MESSAGE]: (act, sessions) =>
    `sent a message to ${observedSessionName(act.identity, sessions)}: "${act.text}"`,
  [ACT_KIND.CONTROL]: (act, sessions) =>
    `ran "${act.control.label}" on ${observedSessionName(act.identity, sessions)}`,
  [ACT_KIND.OPEN]: (act, sessions) => {
    const name = observedSessionName(act.identity, sessions);
    return act.applicationId
      ? `opened ${name} in ${observedApplicationName(act.identity, act.applicationId, sessions)}`
      : `opened ${name}`;
  },
  [ACT_KIND.CREATE_WORKSPACE]: (act) =>
    `asked ${act.providerId} to create a workspace${act.name ? ` named "${act.name}"` : ""}`,
  [ACT_KIND.ADD_AGENT]: (act, sessions) =>
    `added a ${act.agent} agent to ${observedSessionName(act.identity, sessions)}`,
  [ACT_KIND.RENAME_WORKSPACE]: (act, sessions) =>
    `renamed the workspace of ${observedSessionName(act.identity, sessions)} to "${act.name}"`,
  [ACT_KIND.RENAME_SESSION]: (act, sessions) =>
    `renamed ${observedSessionName(act.identity, sessions)} to "${act.name}"`,
  [ACT_KIND.ISSUE_STATE]: (act) =>
    `moved issue ${act.identity.identifier} to "${act.transition.name}"`,
  [ACT_KIND.ISSUE_COMMENT]: (act) => `commented on issue ${act.identity.identifier}`,
  [ACT_KIND.SETTING]: (act) => `changed ${act.setting.label} to ${act.value}`,
  [ACT_KIND.PANEL]: (act) => `showed the ${act.tab} panel`,
  [ACT_KIND.FEEDBACK]: (act) => `opened the ${act.composer} composer`,
  [ACT_KIND.UPDATE]: (act) => `ran the Updates row's ${act.act}`,
  [ACT_KIND.REMEMBER]: (act) =>
    act.replaces
      ? `remembered "${act.words}" in place of something remembered before`
      : `remembered "${act.words}"`,
  [ACT_KIND.FORGET]: () => "forgot something remembered before",
} as const satisfies {
  [K in ActKind]: (act: CarriedAct<K>, sessions: readonly Session[]) => string;
};

/** The History sentence declared by the same vocabulary that declared the act. */
export function actNarration(act: CarriedAct, sessions: readonly Session[]): string {
  const narrate = ACT_NARRATION[act.kind];
  // SAFETY: the record is keyed by the same union `act.kind` ranges over, so the
  // entry selected is the one written for this act's own shape.
  return (narrate as (act: CarriedAct, sessions: readonly Session[]) => string)(act, sessions);
}

/**
 * The history line one carried act leaves behind: the ask, in the words of
 * what was asked — never the outcome, which the reply voicing it records as
 * its own line. A transcript reading is deliberately only the fact that one
 * was read: the rendering travels in the turn that asked for it and nowhere
 * else, so the record keeps the act and not a word of what it rendered.
 *
 * It is here rather than beside the rest of the conversation model because it
 * is the one line whose words are an act's narration, and the act vocabulary
 * sits above the session vocabulary the conversation model is part of.
 */
export function sessionActConversationEntry(
  action: CarriedSessionAct,
  sessions: readonly Session[],
  kind: typeof CONVERSATION_ENTRY_KIND.ACT | typeof CONVERSATION_ENTRY_KIND.OWN_ACT,
): ConversationEntry {
  const words = actNarration(action, sessions);
  const entry: ConversationEntry = { kind, words };
  if ("identity" in action) entry.identity = action.identity;
  return entry;
}
