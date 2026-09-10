import {
  ACTION_KIND,
  type ConversationEntry,
  type ConversationEntryAction,
  SESSION_CONTROL_KIND,
} from "@sidecar/session";
import type { SessionView } from "./session-model";

/**
 * One run of an action row's words. A name is the chat the action reached,
 * or the workspace a creation made, drawn as a chip. The chat's chip wears
 * the mark its roster row wears — the agent having it where the provider
 * hosts agents, else the provider's — so the thread names chats the way the
 * roster does; a workspace's chip has no row yet and wears none.
 */
export interface ActionRowPart {
  text: string;
  name?: { markId?: string };
}

/**
 * The chat by its current name and mark while the roster holds it, and by
 * those the record kept once the roster has let it go — archived, or gone
 * with its provider — so an act on a chat that no longer stands still says
 * which one.
 */
function named(
  session: SessionView | undefined,
  identity: { providerId: string } | undefined,
  action: ConversationEntryAction,
): ActionRowPart | undefined {
  if (session) {
    return { text: session.title, name: { markId: session.agentId ?? session.providerId } };
  }
  if (action.title === undefined || identity === undefined) return undefined;
  return { text: action.title, name: { markId: action.agentId ?? identity.providerId } };
}

/**
 * The words an action row draws, composed from the act's own record and the
 * roster as it stands now, so a session is named as it is called today and
 * the wording is the build's rather than the sentence recorded at the time.
 * Nothing here is answered when the record cannot be read back to a row — a
 * line an earlier build wrote without its facts, or one that names a chat
 * the roster has let go and never kept a name for — and the caller draws the
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
  const chat = named(session, identity, action);
  switch (action.kind) {
    case ACTION_KIND.MESSAGE:
      if (!chat || action.text === undefined) return undefined;
      return [{ text: "Sent a message to " }, chat, { text: `: "${action.text}"` }];
    case ACTION_KIND.CONTROL:
      if (!chat || action.label === undefined) return undefined;
      switch (action.controlKind) {
        case SESSION_CONTROL_KIND.ARCHIVE:
          return [{ text: "Archived " }, chat];
        case SESSION_CONTROL_KIND.STOP:
          return [{ text: "Stopped " }, chat];
        default:
          return [{ text: `Ran "${action.label}" on ` }, chat];
      }
    case ACTION_KIND.OPEN: {
      if (!chat) return undefined;
      const application =
        action.applicationId === undefined
          ? undefined
          : (session?.applications.find((candidate) => candidate.id === action.applicationId)
              ?.name ?? action.applicationId);
      return [
        { text: "Opened " },
        chat,
        ...(application === undefined ? [] : [{ text: ` in ${application}` }]),
      ];
    }
    case ACTION_KIND.CREATE_WORKSPACE: {
      // The workspace by the roster's name once observed, else as the
      // developer named it, under the mark of the agent the creation asked
      // for — or the provider's, where the choice was left to the provider.
      const workspace = session
        ? { text: session.title, name: { markId: session.agentId ?? session.providerId } }
        : action.name === undefined
          ? undefined
          : { text: action.name, name: { markId: action.agentId ?? action.providerId } };
      return workspace
        ? [{ text: "Created a new workspace " }, workspace]
        : [{ text: "Created a new workspace" }];
    }
    case ACTION_KIND.ADD_AGENT:
      if (!chat || action.agent === undefined) return undefined;
      return [{ text: `Added a ${action.agent} agent to ` }, chat];
    case ACTION_KIND.RENAME_WORKSPACE:
      if (!chat || action.name === undefined) return undefined;
      return [{ text: "Renamed the workspace of " }, chat, { text: ` to "${action.name}"` }];
    case ACTION_KIND.RENAME_SESSION:
      // The roster already calls the session by its new name once the rename
      // has landed, so the row repeats the name only while the two differ.
      if (!chat || action.name === undefined) return undefined;
      return chat.text === action.name
        ? [{ text: "Renamed " }, chat]
        : [{ text: "Renamed " }, chat, { text: ` to "${action.name}"` }];
  }
}
