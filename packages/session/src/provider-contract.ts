import { ACT_RESULT_STATUS } from "@sidecar/wire";
import type {
  ProviderActResult,
  ProviderControlResult,
  ProviderConversationResult,
  ProviderMessageResult,
  ProviderTranscriptResult,
  ProviderTranscriptSinceResult,
  ProviderWorkspaceResult,
} from "./act-results.js";
import type { SessionControl } from "./advertised-acts.js";
import type { SessionProvider } from "./session-identity.js";
import type { ProviderSessionObservation } from "./session-shape.js";
import type { WorkspaceAgentSelection } from "./workspace-agents.js";
import type { WorkspaceProject } from "./workspace-projects.js";

/**
 * A provider adapter has no dependency on Electron, a renderer, or live UI
 * state. Every adapter answers every act, because unsupported is already an
 * answer rather than a failure: one whose provider documents no way to do a
 * thing inherits that answer from `SessionProviderAdapterBase` and says so,
 * where a missing method would leave each caller asking whether the question
 * could be put at all. Overriding one is what taking on its constraint means.
 */
export interface SessionProviderAdapter {
  readonly provider: SessionProvider;
  observe(): Promise<readonly ProviderSessionObservation[]>;

  /**
   * Runs a control against a session the adapter has already observed.
   * Adapters must reject any request whose control that session's latest
   * observation did not advertise.
   */
  executeControl(request: ProviderControlRequest): Promise<ProviderControlResult>;

  /**
   * Hands a message to an already-observed session through the provider's own
   * documented endpoint. It is one of the three places an adapter may change
   * provider state, and only ever with text a user chose to send: adapters
   * must refuse any session that did not advertise `canReceiveMessage` on its
   * latest observation, and nothing that decides on the user's behalf may
   * reach it.
   */
  sendMessage(message: ProviderSessionMessage): Promise<ProviderMessageResult>;

  /** The projects the latest observation pass reported, or none. */
  workspaceProjects(): readonly WorkspaceProject[];

  /**
   * Creates a workspace in a project the latest observation pass reported. The
   * same rules bind it that bind a message: it acts only on what a user just
   * asked for, through the provider's own documented endpoint, and nothing
   * that decides on the user's behalf may reach it.
   */
  createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult>;

  /**
   * Starts another agent in the workspace an observed session already runs in,
   * under the same rules and one more: the agent must be one of the kinds that
   * session's latest observation listed.
   */
  spawnWorkspaceAgent(request: ProviderWorkspaceAgentRequest): Promise<ProviderWorkspaceResult>;

  /**
   * Renames the workspace an observed session already runs in, under the same
   * rules and one more: the session's latest observation must have advertised
   * a rename target, so a rename only ever lands on a workspace its provider
   * documents renaming.
   */
  renameWorkspace(request: ProviderWorkspaceRenameRequest): Promise<ProviderActResult>;

  /**
   * Renames an observed session itself — the chat, where `renameWorkspace`
   * renames the workspace around it — only for a session whose latest
   * observation advertised `canRename`.
   */
  renameSession(request: ProviderSessionRenameRequest): Promise<ProviderActResult>;

  /**
   * Renders one observed session's own transcript, read from the provider's
   * file on this machine, into a bounded conversation kept nowhere. The read
   * performs nothing and reaches no provider; an adapter whose stored shape
   * this build cannot render faithfully reports nothing rather than guessing.
   */
  readTranscript(providerSessionId: string): Promise<ProviderTranscriptResult>;

  /**
   * Renders what one observed session's transcript has gained since the
   * cursor a previous read handed back, under the same bounds and the same
   * rules as `readTranscript`: read from the provider's own record, kept
   * nowhere, performing nothing. Without a cursor, or with one the record no
   * longer reaches, it renders the transcript's recent tail and says so
   * through `truncated`. The cursor is opaque to callers and meaningful only
   * to the adapter that minted it.
   */
  readTranscriptSince(
    providerSessionId: string,
    cursor?: string,
  ): Promise<ProviderTranscriptSinceResult>;

  /**
   * Reads one observed session's conversation from the provider's documented
   * transcript-read endpoint, as bounded pages of attributed messages kept
   * nowhere. It exists only for a caller a user just opened a conversation
   * screen for: it never rides an observation pass, it can express nothing
   * but a read, and a message whose author the stored shape does not name is
   * dropped rather than guessed at. An adapter whose provider documents no
   * such read inherits the unsupported answer.
   */
  readConversation(request: ProviderConversationRequest): Promise<ProviderConversationResult>;
}

/** A provider-local request for a control that was previously exposed by observation. */
export interface ProviderControlRequest {
  providerSessionId: string;
  control: SessionControl;
}

/** A user-authored message for one session the adapter has already observed. */
export interface ProviderSessionMessage {
  providerSessionId: string;
  text: string;
}

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
export interface ProviderWorkspaceRequest {
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
}

/**
 * A user-asked request for another agent in the workspace an observed session
 * already runs in. The session names the workspace; the agent must be one that
 * session's latest observation listed as spawnable.
 */
export interface ProviderWorkspaceAgentRequest {
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
}

/**
 * A user-asked request to rename the workspace an observed session already
 * runs in. The session names the workspace — the adapter resolves the target
 * from its own latest observation, never from the request — and the name is
 * the user's own choice, bounded like the one a creation carries.
 */
export interface ProviderWorkspaceRenameRequest {
  providerSessionId: string;
  /** The new name, exactly as the user chose it. */
  name: string;
}

/**
 * A user-asked request to rename one observed session itself — the chat,
 * where `ProviderWorkspaceRenameRequest` renames the workspace around it —
 * under the same rules.
 */
export interface ProviderSessionRenameRequest {
  providerSessionId: string;
  /** The new name, exactly as the user chose it. */
  name: string;
}

/**
 * The explicit answers an adapter gives for acts its provider does not
 * document: unsupported for every write, no projects, and no transcript.
 * Concrete adapters override only the acts their provider routes, and an
 * override takes on that act's constraint above along with it.
 */
export abstract class SessionProviderAdapterBase implements SessionProviderAdapter {
  abstract readonly provider: SessionProvider;
  abstract observe(): Promise<readonly ProviderSessionObservation[]>;

  async executeControl(_request: ProviderControlRequest): Promise<ProviderControlResult> {
    return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "This provider has no such control." };
  }

  async sendMessage(_message: ProviderSessionMessage): Promise<ProviderMessageResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider does not take messages.",
    };
  }

  workspaceProjects(): readonly WorkspaceProject[] {
    return [];
  }

  async createWorkspace(_request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider cannot create workspaces.",
    };
  }

  async spawnWorkspaceAgent(
    _request: ProviderWorkspaceAgentRequest,
  ): Promise<ProviderWorkspaceResult> {
    return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "This provider cannot add agents." };
  }

  async renameWorkspace(_request: ProviderWorkspaceRenameRequest): Promise<ProviderActResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider cannot rename workspaces.",
    };
  }

  async renameSession(_request: ProviderSessionRenameRequest): Promise<ProviderActResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider cannot rename sessions.",
    };
  }

  async readTranscript(_providerSessionId: string): Promise<ProviderTranscriptResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider keeps no transcript this build can read.",
    };
  }

  async readTranscriptSince(
    _providerSessionId: string,
    _cursor?: string,
  ): Promise<ProviderTranscriptSinceResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider keeps no transcript this build can read.",
    };
  }

  async readConversation(
    _request: ProviderConversationRequest,
  ): Promise<ProviderConversationResult> {
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "This provider documents no conversation read this build carries.",
    };
  }
}
