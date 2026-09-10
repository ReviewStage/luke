import { ACTION_KIND, type ConversationEntry } from "@sidecar/session";
import type { SessionView } from "./session-model";

/** One run of an action row's words; a name is a session's title, set apart from the rest. */
export interface ActionRowPart {
  text: string;
  name?: true;
}

function named(title: string): ActionRowPart {
  return { text: title, name: true };
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
      return [{ text: "Sent a message to " }, named(session.title), { text: `: "${action.text}"` }];
    case ACTION_KIND.CONTROL:
      if (!session || action.label === undefined) return undefined;
      return [{ text: `Ran "${action.label}" on ` }, named(session.title)];
    case ACTION_KIND.OPEN: {
      if (!session) return undefined;
      const application =
        action.applicationId === undefined
          ? undefined
          : (session.applications.find((candidate) => candidate.id === action.applicationId)
              ?.name ?? action.applicationId);
      return [
        { text: "Opened " },
        named(session.title),
        ...(application === undefined ? [] : [{ text: ` in ${application}` }]),
      ];
    }
    case ACTION_KIND.CREATE_WORKSPACE: {
      const provider = sessions.find((candidate) => candidate.providerId === action.providerId);
      if (!provider) return undefined;
      const name = action.name === undefined ? "" : ` "${action.name}"`;
      return [{ text: `Created a new workspace${name} in ${provider.provider}` }];
    }
    case ACTION_KIND.ADD_AGENT:
      if (!session || action.agent === undefined) return undefined;
      return [{ text: `Added a ${action.agent} agent to ` }, named(session.title)];
    case ACTION_KIND.RENAME_WORKSPACE:
      if (!session || action.name === undefined) return undefined;
      return [
        { text: "Renamed the workspace of " },
        named(session.title),
        { text: ` to "${action.name}"` },
      ];
    case ACTION_KIND.RENAME_SESSION:
      // The roster already calls the session by its new name once the rename
      // has landed, so the row repeats the name only while the two differ.
      if (!session || action.name === undefined) return undefined;
      return session.title === action.name
        ? [{ text: "Renamed " }, named(session.title)]
        : [{ text: "Renamed " }, named(session.title), { text: ` to "${action.name}"` }];
  }
}
