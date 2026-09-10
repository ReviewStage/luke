import {
  type ConversationEntry,
  conversationLinesText,
  type RememberedFact,
  recentConversationEntries,
  rememberedFactsText,
  type Session,
  workspaceProjectContextText,
} from "../../core.js";
import type { HostedRoster } from "./roster.js";

/** The developer's saved creation tie-breaks, as the projects context narrates them. */
export interface HostedWorkspaceDefaults {
  readonly defaultProviderId?: string;
  readonly defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
}

export interface StandingContextInput {
  readonly roster: HostedRoster;
  readonly defaults: HostedWorkspaceDefaults;
  readonly facts: readonly RememberedFact[];
  readonly lines: readonly ConversationEntry[];
}

/**
 * What the hosted brain is handed beside the roster, in the shape the
 * desktop composes for the conversation the developer holds: the projects a
 * workspace could be created in, the facts Luke remembers, and the recent
 * exchange. The app guide the desktop adds is the panel's own, and the
 * service draws no panel, so it is absent here rather than invented.
 */
export function hostedStandingContext(input: StandingContextInput): string {
  const sessions: readonly Session[] = input.roster.sessions;
  return [
    workspaceProjectContextText(
      input.roster.projects,
      input.defaults.defaultProviderId,
      input.defaults.defaultProjectIds,
    ),
    rememberedFactsText(input.facts),
    conversationLinesText(recentConversationEntries(input.lines), sessions),
  ]
    .filter((part): part is string => part !== undefined && part.trim().length > 0)
    .join("\n\n");
}
