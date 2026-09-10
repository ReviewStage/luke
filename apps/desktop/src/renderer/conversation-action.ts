import { ACTION_KIND, type ConversationEntry, SESSION_CONTROL_KIND } from "@sidecar/session";
import type { SessionView } from "./session-model";

/**
 * One run of an action row's words. A name is the session the action reached,
 * or the provider a creation asked, drawn as a chip under the mark its own
 * row wears — the agent's where the provider hosts agents, else the
 * provider's — so the thread names things the way the roster does.
 */
export interface ActionRowPart {
  text: string;
  name?: { markId: string };
}

function named(session: SessionView): ActionRowPart {
  return { text: session.title, name: { markId: session.agentId ?? session.providerId } };
}

/**
 * The words an action row draws, composed from the act's own record and the
 * roster as it stands now, so a session is named as it is called today and
 * the wording is the build's rather than the sentence recorded at the time.
 * Nothing here is answered when the record cannot be read back to a row — a
 * line an earlier build wrote without its facts, a session the roster has let
 * go, a creation whose provider no row stands for — and the caller draws the
 * recorded words in its place, which is what the model was read.
 */
export function actionRowParts(
  entry: ConversationEntry,
  sessions: readonly SessionView[],
): readonly ActionRowPart[] | undefined {
  const action = entry.action;
  if (action === undefined) return undefined;
  const identity = entry.identity;
  const session = identity
    ? sessions.find(
        (candidate) =>
          candidate.providerId === identity.providerId &&
          candidate.id === identity.providerSessionId,
      )
    : undefined;
  switch (action.kind) {
    case ACTION_KIND.MESSAGE:
      if (!session || action.text === undefined) return undefined;
      return [{ text: "Sent a message to " }, named(session), { text: `: "${action.text}"` }];
    case ACTION_KIND.CONTROL:
      if (!session || action.label === undefined) return undefined;
      switch (action.controlKind) {
        case SESSION_CONTROL_KIND.ARCHIVE:
          return [{ text: "Archived " }, named(session)];
        case SESSION_CONTROL_KIND.STOP:
          return [{ text: "Stopped " }, named(session)];
        default:
          return [{ text: `Ran "${action.label}" on ` }, named(session)];
      }
    case ACTION_KIND.OPEN: {
      if (!session) return undefined;
      const application =
        action.applicationId === undefined
          ? undefined
          : (session.applications.find((candidate) => candidate.id === action.applicationId)
              ?.name ?? action.applicationId);
      return [
        { text: "Opened " },
        named(session),
        ...(application === undefined ? [] : [{ text: ` in ${application}` }]),
      ];
    }
    case ACTION_KIND.CREATE_WORKSPACE: {
      const provider = sessions.find((candidate) => candidate.providerId === action.providerId);
      if (!provider) return undefined;
      const name = action.name === undefined ? "" : ` "${action.name}"`;
      return [
        { text: `Created a new workspace${name} in ` },
        { text: provider.provider, name: { markId: provider.providerId } },
      ];
    }
    case ACTION_KIND.ADD_AGENT:
      if (!session || action.agent === undefined) return undefined;
      return [{ text: `Added a ${action.agent} agent to ` }, named(session)];
    case ACTION_KIND.RENAME_WORKSPACE:
      if (!session || action.name === undefined) return undefined;
      return [
        { text: "Renamed the workspace of " },
        named(session),
        { text: ` to "${action.name}"` },
      ];
    case ACTION_KIND.RENAME_SESSION:
      // The roster already calls the session by its new name once the rename
      // has landed, so the row repeats the name only while the two differ.
      if (!session || action.name === undefined) return undefined;
      return session.title === action.name
        ? [{ text: "Renamed " }, named(session)]
        : [{ text: "Renamed " }, named(session), { text: ` to "${action.name}"` }];
  }
}
