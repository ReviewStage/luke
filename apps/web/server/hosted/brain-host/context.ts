import { isTextUIPart, isToolUIPart, type ToolSet } from "ai";
import {
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  type RememberedFact,
  rememberedFactsText,
  type StoredUIMessage,
  standingContextText,
  workspaceProjectContextText,
} from "../../core.js";
import type { HostedStoreRun } from "../store/database.js";
import { type ConversationTarget, listRecentMessages } from "../store/index.js";
import { BRAIN_HOST } from "./bounds.js";
import type { HostedWorkspaceDefaults } from "./defaults.js";
import type { HostedRoster } from "./roster.js";

/**
 * What the hosted brain is handed beside its prompt every turn, rebuilt from
 * the rows and never remembered: the roster as the last pass left it, the
 * projects a workspace could be created in, the facts Luke remembers, and
 * the recent exchange read back from the conversation's own messages. It
 * rides as the turn's system-role instruction, replaced each turn, so the
 * history the model keeps is the words that were said and never a stale
 * roster.
 */

export interface StandingContextInput {
  readonly roster: HostedRoster;
  readonly rosterText: string;
  readonly defaults: HostedWorkspaceDefaults;
  readonly facts: readonly RememberedFact[];
  readonly recent: readonly StoredUIMessage[];
  readonly now: number;
}

/** Who a stored message's words are attributed to when the recent exchange is rendered. */
const SPEAKER = {
  DEVELOPER: "Developer",
  LUKE: "Luke",
  NOTE: "Luke's own note",
} as const;

function speakerOf(message: StoredUIMessage): string {
  if (message.role === MESSAGE_ROLE.ASSISTANT) return SPEAKER.LUKE;
  if (message.role === MESSAGE_ROLE.USER) {
    return message.metadata.author === MESSAGE_AUTHOR.DEVELOPER ? SPEAKER.DEVELOPER : SPEAKER.NOTE;
  }
  return SPEAKER.NOTE;
}

/** One stored message as a line: its speaker, its words, and the tools it called by name. */
export function storedMessageLine(message: StoredUIMessage, maximumChars: number): string {
  const words = message.parts
    .filter((part) => isTextUIPart(part))
    .map((part) => part.text.trim())
    .filter((text) => text.length > 0)
    .join(" ");
  const tools = message.parts
    .filter((part) => isToolUIPart(part))
    .map((part) => part.type.slice("tool-".length));
  const body = [
    words.length > maximumChars ? `${words.slice(0, maximumChars)}…` : words,
    ...(tools.length > 0 ? [`(called ${tools.join(", ")})`] : []),
  ]
    .filter((piece) => piece.length > 0)
    .join(" ");
  return `${speakerOf(message)}: ${body}`;
}

/** The recent exchange as lines, oldest first; nothing where nothing has been said. */
function recentMessagesText(recent: readonly StoredUIMessage[]): string | undefined {
  if (recent.length === 0) return undefined;
  return [
    "Recent conversation, oldest first:",
    ...recent.map((message) => storedMessageLine(message, BRAIN_HOST.RECENT_MESSAGE_CHARS)),
  ].join("\n");
}

export function hostedStandingContext(input: StandingContextInput): string {
  const rest = [
    workspaceProjectContextText(
      input.roster.projects,
      input.defaults.defaultProviderId,
      input.defaults.defaultProjectIds,
    ),
    rememberedFactsText(input.facts),
    recentMessagesText(input.recent),
  ]
    .filter((part): part is string => part !== undefined && part.trim().length > 0)
    .join("\n\n");
  return standingContextText(input.rosterText, rest, input.now);
}

/**
 * The newest finished messages of a conversation, oldest first, read back
 * through the store's own reader so a row outside the vocabulary refuses the
 * page whole rather than being rendered. The limit is on rows, not words:
 * each line is bounded again when rendered.
 */
export async function readRecentMessages(
  run: HostedStoreRun,
  target: ConversationTarget,
  tools: ToolSet,
  limit: number,
): Promise<readonly StoredUIMessage[]> {
  const read = await run(listRecentMessages(target.userId, target.conversationId, tools, limit));
  return read.ok ? read.value.map((record) => record.message) : [];
}
