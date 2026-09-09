import type { Admitted } from "@sidecar/wire";
import type { AdvertisedControl } from "./advertised-actions.js";
import type { WorkspaceAgentSelection } from "./workspace-agents.js";

/**
 * What each action is asked with. Every one is an `Admitted` request, which only
 * `admit()` in `@sidecar/actions` stands behind: the session or project was one
 * the roster that pass reported, the action was one it advertised, and the
 * developer's text was bounded, before a provider saw any of it. What a
 * provider answers for is its own route — the advertised control, spawn
 * target, rename target, or listed project it reads back from its own latest
 * pass — and the provider's documented shape, and nothing about whether the
 * action may run.
 */

/** A provider-local request for a control that was previously exposed by observation. */
export type ProviderControlRequest = Admitted<{
  providerSessionId: string;
  control: AdvertisedControl;
}>;

/** A user-authored message for one session the latest pass already observed. */
export type ProviderSessionMessage = Admitted<{
  providerSessionId: string;
  text: string;
}>;

/**
 * A user-asked read of one observed session's conversation, positioned the
 * way a chat screen reads: opened with neither cursor, it answers the latest
 * page; handed `beforeOffset`, it answers the page of older history ending
 * there; handed `afterMessageId`, it answers only what is newer. The two
 * cursors are different asks — a scroll up and a poll — so a request naming
 * both is refused rather than guessed at.
 */
export interface ProviderConversationRequest {
  providerSessionId: string;
  /**
   * The last provider message id an earlier page answered with, so a polling
   * screen reads only what is newer.
   */
  afterMessageId?: string;
  /**
   * The stored-transcript offset an earlier page said it began at
   * (`firstOffset`), so a scroll to the top reads the history just before
   * what the screen already holds.
   */
  beforeOffset?: number;
}

/** A user-asked request for a new workspace in one reported project. */
export type ProviderWorkspaceRequest = Admitted<{
  providerProjectId: string;
  providerTargetId?: string;
  agent?: string;
  /** The name the user chose, when they chose one; the provider names it otherwise. */
  name?: string;
  /**
   * The opening task for the workspace's agent, in the user's own words —
   * present only when the user gave one, and only for a project whose
   * `taskSupport` takes it. It is the same class of content as a message to
   * an existing session, and it travels under the same rules.
   */
  task?: string;
  /**
   * The agent kind and model the user chose for new workspaces, present only
   * when they chose one and only from the build's documented table for this
   * provider. Absent, the provider's own defaults decide — the adapter sends
   * nothing at all rather than a guess.
   */
  agentSelection?: WorkspaceAgentSelection;
}>;

/**
 * A user-asked request for another agent in the workspace an observed session
 * already runs in. The session names the workspace; the agent must be one that
 * session's latest observation listed as spawnable.
 */
export type ProviderWorkspaceAgentRequest = Admitted<{
  providerSessionId: string;
  /** The kind of agent, exactly as the observation listed it. */
  agent: string;
  /** The name the user chose, when they chose one. */
  name?: string;
  /** The new agent's opening task, in the user's own words, when they gave one. */
  task?: string;
  /**
   * The model the user's stored choice names for exactly this agent kind,
   * present only when the kinds match and the pairing is in the build's
   * documented table. The asked-for agent always wins over a stored pairing:
   * a preference rides along with the user's ask, never against it.
   */
  model?: string;
  /** The effort level riding with that model, under exactly the same rules. */
  effort?: string;
}>;

/**
 * A user-asked request to rename the workspace an observed session already
 * runs in. The session names the workspace — the adapter resolves the target
 * from its own latest observation, never from the request — and the name is
 * the user's own choice, bounded like the one a creation carries.
 */
export type ProviderWorkspaceRenameRequest = Admitted<{
  providerSessionId: string;
  /** The new name, exactly as the user chose it. */
  name: string;
}>;

/**
 * A user-asked request to rename one observed session itself — the chat,
 * where `ProviderWorkspaceRenameRequest` renames the workspace around it —
 * under the same rules.
 */
export type ProviderSessionRenameRequest = Admitted<{
  providerSessionId: string;
  /** The new name, exactly as the user chose it. */
  name: string;
}>;
