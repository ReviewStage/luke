/**
 * The Conversation sentence each action is recorded under. One entry per kind, total
 * over the vocabulary, so a new action does not compile until its sentence is
 * written and no action can be recorded as "an action" with nothing said about it.
 */

import {
  type CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryAction,
  type ObservedWorkspaceProject,
  SESSION_CONTROL_KIND,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
} from "@sidecar/session";
import {
  ACTION_KIND,
  type ActionKind,
  type CarriedAction,
  type CarriedSessionAction,
  type SessionActionKind,
} from "./action-kinds.js";

/**
 * What the narration names things by: the roster the action was admitted
 * against, and the projects a provider listed on the same pass, which is
 * where a creation's provider has a display name at all.
 */
export interface ActionNarrationContext {
  sessions: readonly Session[];
  projects: readonly ObservedWorkspaceProject[];
}

function observedProviderName(
  providerId: string,
  projects: readonly ObservedWorkspaceProject[],
): string {
  return projects.find((project) => project.providerId === providerId)?.providerName ?? providerId;
}

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
  [ACTION_KIND.MESSAGE]: (action, { sessions }) =>
    `sent a message to ${observedSessionName(action.identity, sessions)}: "${action.text}"`,
  // A control whose adapter said what it does is narrated as that act; one it
  // did not is narrated by its label, the provider's own word for it.
  [ACTION_KIND.CONTROL]: (action, { sessions }) => {
    const name = observedSessionName(action.identity, sessions);
    switch (action.control.controlKind) {
      case SESSION_CONTROL_KIND.ARCHIVE:
        return `archived ${name}`;
      case SESSION_CONTROL_KIND.STOP:
        return `stopped ${name}`;
      default:
        return `ran "${action.control.label}" on ${name}`;
    }
  },
  [ACTION_KIND.OPEN]: (action, { sessions }) => {
    const name = observedSessionName(action.identity, sessions);
    return action.applicationId
      ? `opened ${name} in ${observedApplicationName(action.identity, action.applicationId, sessions)}`
      : `opened ${name}`;
  },
  // The past tense every other kind uses: the line records the act, and the
  // reply voicing the outcome is its own line.
  [ACTION_KIND.CREATE_WORKSPACE]: (action, { projects }) =>
    `created a new workspace${action.name ? ` "${action.name}"` : ""} in ${observedProviderName(action.providerId, projects)}`,
  [ACTION_KIND.ADD_AGENT]: (action, { sessions }) =>
    `added a ${action.agent} agent to ${observedSessionName(action.identity, sessions)}`,
  [ACTION_KIND.RENAME_WORKSPACE]: (action, { sessions }) =>
    `renamed the workspace of ${observedSessionName(action.identity, sessions)} to "${action.name}"`,
  [ACTION_KIND.RENAME_SESSION]: (action, { sessions }) =>
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
  [K in ActionKind]: (action: CarriedAction<K>, context: ActionNarrationContext) => string;
};

/**
 * The act's own facts, for the panel to compose its row from: one table over
 * the session kinds, so a kind whose facts are not written down does not
 * compile. Only what the narration names rides along — never a model or an
 * effort, which the row has no words for.
 */
type ActionRecordDetails = Omit<ConversationEntryAction, "kind" | "runId">;

/** The title the roster held for the session at the time, for the row to fall back to once it is gone. */
function observedTitle(
  identity: SessionIdentity,
  sessions: readonly Session[],
): ActionRecordDetails {
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === identity.providerId &&
      candidate.providerSessionId === identity.providerSessionId,
  );
  return session ? { title: session.title } : {};
}

const ACTION_RECORD = {
  [ACTION_KIND.MESSAGE]: (action, sessions) => ({
    text: action.text,
    ...observedTitle(action.identity, sessions),
  }),
  [ACTION_KIND.CONTROL]: (action, sessions) => ({
    label: action.control.label,
    ...(action.control.controlKind !== undefined
      ? { controlKind: action.control.controlKind }
      : undefined),
    ...observedTitle(action.identity, sessions),
  }),
  [ACTION_KIND.OPEN]: (action, sessions) => ({
    ...(action.applicationId !== undefined ? { applicationId: action.applicationId } : undefined),
    ...observedTitle(action.identity, sessions),
  }),
  [ACTION_KIND.CREATE_WORKSPACE]: (action) => ({
    providerId: action.providerId,
    ...(action.name !== undefined ? { name: action.name } : undefined),
  }),
  [ACTION_KIND.ADD_AGENT]: (action, sessions) => ({
    agent: action.agent,
    ...(action.name !== undefined ? { name: action.name } : undefined),
    ...observedTitle(action.identity, sessions),
  }),
  [ACTION_KIND.RENAME_WORKSPACE]: (action, sessions) => ({
    name: action.name,
    ...observedTitle(action.identity, sessions),
  }),
  [ACTION_KIND.RENAME_SESSION]: (action, sessions) => ({
    name: action.name,
    ...observedTitle(action.identity, sessions),
  }),
} as const satisfies {
  [K in SessionActionKind]: (
    action: CarriedAction<K>,
    sessions: readonly Session[],
  ) => ActionRecordDetails;
};

function carriedActionRecord(
  action: CarriedSessionAction,
  sessions: readonly Session[],
  runId: string,
): ConversationEntryAction {
  const record = ACTION_RECORD[action.kind];
  // SAFETY: the table is keyed by the same union `action.kind` ranges over, so the
  // entry selected is the one written for this action's own shape.
  const details = (
    record as (action: CarriedSessionAction, sessions: readonly Session[]) => ActionRecordDetails
  )(action, sessions);
  return { kind: action.kind, runId, ...details };
}

/** The Conversation sentence declared by the same vocabulary that declared the action. */
export function actionNarration(action: CarriedAction, context: ActionNarrationContext): string {
  const narrate = ACTION_NARRATION[action.kind];
  // SAFETY: the record is keyed by the same union `action.kind` ranges over, so the
  // entry selected is the one written for this action's own shape.
  return (narrate as (action: CarriedAction, context: ActionNarrationContext) => string)(
    action,
    context,
  );
}

/**
 * The history line one carried action leaves behind: the ask, in the words of
 * what was asked — never the outcome, which the reply voicing it records as
 * its own line — beside the kind it was and the run that carried it, which is
 * what the panel draws the line by and folds a turn's actions together on. A
 * transcript reading is deliberately only the fact that one was read: the
 * rendering travels in the turn that asked for it and nowhere else, so the
 * record keeps the action and not a word of what it rendered.
 *
 * It is here rather than beside the rest of the conversation model because it
 * is the one line whose words are an action's narration, and the action vocabulary
 * sits above the session vocabulary the conversation model is part of.
 */
export function sessionActionConversationEntry(
  action: CarriedSessionAction,
  context: ActionNarrationContext,
  kind: typeof CONVERSATION_ENTRY_KIND.ACTION | typeof CONVERSATION_ENTRY_KIND.OWN_ACTION,
  runId: string,
): ConversationEntry {
  const words = actionNarration(action, context);
  const entry: ConversationEntry = {
    kind,
    words,
    action: carriedActionRecord(action, context.sessions, runId),
  };
  if ("identity" in action) entry.identity = action.identity;
  return entry;
}
