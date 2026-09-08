import type { AdvertisedAct, SessionControl } from "./advertised-acts.js";
import type {
  SessionApplication,
  SessionIdentity,
  SessionLocation,
  SessionProvider,
} from "./session-identity.js";
import type { SessionCompletionCause, SessionStatus } from "./session-status.js";

/** The label a session takes when Luke cannot name the folder or repository it belongs to. */
export const UNKNOWN_WORKSPACE_LABEL = "workspace";

/**
 * The context that makes one session tellable from another. Every field is
 * optional because no provider reports all of them, and every field is bounded
 * so a row stays a row. Adapters fill in whatever their provider actually
 * knows rather than composing a sentence, which leaves the wording to the
 * surface that renders it.
 */
export interface SessionDetail {
  /** What the session is doing right now, such as the tool it is running. */
  activity?: string;
  repository?: string;
  branch?: string;
  model?: string;
  /** Why the session stopped, when it stopped on something it cannot pass. */
  error?: string;
  /**
   * A provider-owned address that opens this session where it lives. Only a
   * provider that can address the session itself reports one: an address that
   * lands near a session rather than on it — its folder, or a fresh chat in the
   * same place — is worse than no address at all, because pressing a row would
   * then do something other than what it said.
   */
  link?: string;
  /** The work the session has published, such as a pull request. */
  change?: string;
  /** The size of the change the session holds, as its provider counts it. */
  diff?: SessionDiffSummary;
}

/**
 * A provider's own counts for a session's change: files touched, lines added,
 * lines removed. Counts rather than words, because the surface words them —
 * an adapter reports the numbers its provider actually returned and composes
 * nothing.
 */
export interface SessionDiffSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * The place a provider groups several sessions under — a workspace holding
 * more than one chat. It is identity plus a name, nothing else: the id is what
 * a surface groups rows by and the name is what it titles the group, and a
 * session without one is simply ungrouped. Only an adapter whose provider
 * actually nests chats inside a shared workspace reports it; inventing a
 * group around a provider's lone sessions would draw structure that is not
 * there.
 */
export interface SessionWorkspace {
  providerWorkspaceId: string;
  /**
   * The namespace that owns the workspace identity. It is normally the
   * session provider, but an orchestrator may group sessions from several
   * providers under one workspace of its own.
   */
  scopeId?: string;
  /** The bounded product name shown when an orchestrator owns this workspace. */
  managerName?: string;
  name?: string;
}

/**
 * Everything a session is, declared once. An observation and a normalized
 * session are the same facts at two moments — what a provider reported, and
 * what survived normalization — so they are one declaration with two
 * derivations rather than two lists that drift apart a field at a time.
 * Every field is optional here because no provider reports all of them, and
 * the fields normalization always answers are made required on `Session`
 * below.
 */
export interface SessionFields {
  /**
   * The provider-owned id of the session that directly spawned this one,
   * when the provider persists that relationship. It is identity only: the
   * child remains its own session with its own status and row.
   */
  parentProviderSessionId?: string;
  title: string;
  status: SessionStatus;
  /** Why a completed row became complete, when the provider can distinguish it. */
  completionCause?: SessionCompletionCause;
  /**
   * When the provider last wrote anything about this session, in Unix
   * milliseconds: a record's own timestamp, a transcript file's mtime, a row's
   * recency columns, an API `updatedAt`, or the observation hook's spool
   * entry where it stands past the provider's clock. It is never composed by
   * Luke — a pass adopts the provider's own moment, never the clock it ran
   * at — and where a provider gives none for a chat it may be the enclosing
   * workspace's, which its siblings share. No provider records when a status
   * was entered, and nothing here pretends to: the sort, the age chip, and
   * the decay of a quiet waiting or working session to unknown all read this
   * one moment for what it is.
   */
  lastActivityAt: number;
  /** Whether this session is a realtime voice/delegation chat. */
  realtimeVoice?: boolean;
  /**
   * Whether a realtime voice conversation is live over this session right now,
   * read from the provider's own persisted state. Where `realtimeVoice` names
   * what the chat is, this names what is happening to it, and it ends when the
   * conversation does. Absent means none observed.
   */
  realtimeVoiceLive?: boolean;
  /**
   * Whether this row reports a thing that currently stands rather than a
   * conversation that happened: the adapter re-reports it on every pass for as
   * long as it exists and drops it the pass after it is gone. `lastActivityAt`
   * then carries the provider's own timestamp for the thing itself, however
   * old. Absent means the row is history like any other.
   */
  standing?: boolean;
  /**
   * Whether a waiting session is holding for the developer to act — a
   * permission, an approval, or a question the provider itself reported.
   * Absent means the adapter could not tell, and nothing reads the wait as
   * an ask for it: idle-after-a-turn is the panel's to show as waiting, not
   * a banner's to read as an ask.
   */
  holdingForDeveloper?: boolean;
  /**
   * The agent having the conversation, when the session's provider hosts
   * agents rather than being one — a Conductor chat is a Claude Code or Codex
   * conversation before it is a Conductor one. Identity only: the provider
   * stays the thing observed, credentialed, and written through, and a host
   * that did not say which agent runs a chat reports none rather than a guess.
   */
  agent?: SessionProvider;
  /** The workspace this session is one chat of, when its provider nests them. */
  workspace?: SessionWorkspace;
  /** Omitted by an adapter that reads sessions off this machine. */
  location?: SessionLocation;
  detail?: SessionDetail;
  /** Apps on this machine that independently associate themselves with the session. */
  applications?: readonly SessionApplication[];
  /**
   * The acts this session's provider documents for it right now, exactly as
   * its latest observation advertised them. Absent means none: an act nothing
   * advertised is one that would have to be improvised. The list is replaced
   * whole by every observation, so nothing an adapter promised can outlive
   * the snapshot that promised it.
   */
  advertises?: readonly AdvertisedAct[];
  controls?: readonly SessionControl[];
  /**
   * Set only by an adapter whose provider documents taking a message for this
   * session in its current state, through the provider's own API. Absent means
   * no: a session that cannot be messaged is reported as such rather than
   * offered a control that would have to be improvised.
   */
  canReceiveMessage?: boolean;
  /**
   * Set only by an adapter whose provider documents renaming this session
   * itself, through the provider's own API, under the same absent-means-no
   * rule. The chat's own name is what this renames; the workspace around it
   * advertises its rename separately, as `renameTarget`.
   */
  canRename?: boolean;
  /**
   * The kinds of agent this session's provider documents starting alongside it
   * — in the same workspace — named exactly as the provider's creation
   * endpoint takes them. Absent means none: only an adapter whose provider
   * documents such an endpoint lists anything, and an ask can only name an
   * agent from this list.
   */
  spawnableAgents?: readonly string[];
  /**
   * The provider-owned identifier of the place a new agent lands — the
   * workspace around this session — when that is narrower than the session
   * itself. Like a control's `target`, it rides the advertisement so it is
   * replaced with every observation and can never outlive the snapshot that
   * promised it, the way state an adapter kept on the side could.
   */
  spawnTarget?: string;
  /**
   * The provider-owned identifier of the workspace a rename lands on, present
   * only when the provider documents renaming the workspace around this
   * session. Like `spawnTarget`, it rides the advertisement so it is replaced
   * with every observation and can never outlive the snapshot that promised
   * it, the way state an adapter kept on the side could.
   */
  renameTarget?: string;
}

/**
 * The fields normalization always answers, so a reader never has to ask
 * whether a normalized session merely left one out.
 */
type NormalizedSessionField =
  | "location"
  | "detail"
  | "applications"
  | "advertises"
  | "controls"
  | "canReceiveMessage"
  | "canRename"
  | "spawnableAgents";

/**
 * Provider-owned data observed for a session. Provider adapters are responsible
 * for observing without writing provider files, and for bounding every field
 * they report so one session cannot crowd out the rest of the panel.
 */
export interface ProviderSessionObservation extends SessionFields {
  providerSessionId: string;
  /**
   * The working directory the provider itself recorded for a local session,
   * as the absolute path it wrote. Identity for grouping only: a workspace
   * manager that recorded no session id for a chat (Superset's OpenCode
   * terminals today) can still claim the chat by the worktree both sides
   * named independently. Never reported for a cloud session, and never
   * drawn — the bounded `detail.repository` label is what a surface shows.
   */
  directory?: string;
}

/**
 * The normalized model shared by observers, the UI, and any future
 * capability-gated controls.
 */
export type Session = SessionIdentity &
  Omit<SessionFields, NormalizedSessionField> &
  Required<Pick<SessionFields, NormalizedSessionField>> & { provider: SessionProvider };
