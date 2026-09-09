/**
 * The one vocabulary every action intake speaks: which family an action belongs to,
 * which kind it is, and what a carried action of that kind holds. It is declared
 * here rather than beside any one intake because a renderer press, a model's
 * tool call, and a hosted route all name the same actions, and a kind spelled one
 * way where an action is offered and another where it is admitted is the drift
 * this file exists to close.
 */

import type {
  AppGuideSetting,
  AppPanelTab,
  AppUpdateAction,
  FeedbackComposerKind,
  SessionListSort,
} from "@sidecar/guide";
import type {
  ACTION_KIND as ADVERTISED_ACTION_KIND,
  AdvertisedControl,
  IssueIdentity,
  IssueTransition,
  SessionApplicationId,
  SessionIdentity,
  WorkspaceAgentSelection,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";

/**
 * One tool call as admission is handed it: the action's own name and its
 * arguments as the model wrote them. No call id — the id an answer travels
 * back under belongs to the transport, which extends this with one.
 */
export interface RealtimeFunctionCall {
  name: string;
  argumentsJson: string;
}

/** Which process an action is about: a session, an issue, or Luke himself. */
export const ACTION_FAMILY = {
  SESSION: "session",
  ISSUE: "issue",
  APP: "app",
} as const;

export type ActionFamily = (typeof ACTION_FAMILY)[keyof typeof ACTION_FAMILY];

/**
 * Every action, in one table. The session kinds are the same strings the session
 * package's advertisement vocabulary holds — the `satisfies` below is what
 * keeps them so — because an action admitted against an advertisement has to be
 * named identically on both sides of that check.
 */
export const ACTION_KIND = {
  MESSAGE: "message",
  CONTROL: "control",
  OPEN: "open",
  CREATE_WORKSPACE: "create-workspace",
  ADD_AGENT: "add-agent",
  RENAME_WORKSPACE: "rename-workspace",
  RENAME_SESSION: "rename-session",
  ISSUE_STATE: "issue-state",
  ISSUE_COMMENT: "issue-comment",
  SETTING: "setting",
  PANEL: "panel",
  FEEDBACK: "feedback",
  UPDATE: "update",
  REMEMBER: "remember",
  FORGET: "forget",
} as const satisfies typeof ADVERTISED_ACTION_KIND & Record<string, string>;

export type ActionKind = (typeof ACTION_KIND)[keyof typeof ACTION_KIND];

/** The two whole-list scopes of a spoken panel ask beyond the locations. */
export const SESSION_LIST_ALL = "all";
export const SESSION_LIST_VOICE = "voice";

/**
 * An action payload that can never be mistaken for a refusal: the two shapes are
 * disjoint, so `kind === undefined` is the whole of the test either way.
 */
export type Carried<T> = T & { status?: never; reason?: never };

/**
 * What each kind of action carries once admitted. Every field here is either the
 * developer's own bounded text or a value read back out of what the roster,
 * the projects list, the guide, or the notebook advertised — never a caller's
 * copy of one.
 */
export interface ActionPayloads {
  [ACTION_KIND.MESSAGE]: { identity: SessionIdentity; text: string };
  [ACTION_KIND.CONTROL]: { identity: SessionIdentity; control: AdvertisedControl };
  [ACTION_KIND.OPEN]: {
    identity: SessionIdentity;
    /** The one app the developer named to open it in, resolved to its id. */
    applicationId?: SessionApplicationId;
  };
  [ACTION_KIND.CREATE_WORKSPACE]: {
    providerId: string;
    providerProjectId: string;
    providerTargetId?: string;
    agent?: string;
    name?: string;
    task?: string;
    /** The model the developer named for this one creation, resolved to ids. */
    agentSelection?: WorkspaceAgentSelection;
  };
  [ACTION_KIND.ADD_AGENT]: {
    identity: SessionIdentity;
    agent: string;
    name?: string;
    task?: string;
    /** The model the developer named for this one agent, as its wire id. */
    model?: string;
    /** The effort riding that model, when the developer named both. */
    effort?: string;
  };
  /** The workspace's new name, exactly as the developer chose it. */
  [ACTION_KIND.RENAME_WORKSPACE]: { identity: SessionIdentity; name: string };
  /** The chat's new name, exactly as the developer chose it. */
  [ACTION_KIND.RENAME_SESSION]: { identity: SessionIdentity; name: string };
  [ACTION_KIND.ISSUE_STATE]: { identity: IssueIdentity; transition: IssueTransition };
  [ACTION_KIND.ISSUE_COMMENT]: { identity: IssueIdentity; body: string };
  [ACTION_KIND.SETTING]: {
    setting: AppGuideSetting;
    value: string;
    /** The effort riding the new value, when the developer named both. */
    effort?: string;
  };
  [ACTION_KIND.PANEL]: {
    tab: AppPanelTab;
    /** The validated narrowing, combined like the chips: OR within an axis, AND across. */
    filters?: readonly string[];
    sort?: SessionListSort;
    /** Words to search the list for, exactly as the developer asked them. */
    query?: string;
  };
  /**
   * Opens the composer and nothing else: `draft` is at most the developer's
   * own words, placed only into an empty note, and what the composer holds
   * leaves only by its own Send button — no action here sends.
   */
  [ACTION_KIND.FEEDBACK]: { composer: FeedbackComposerKind; draft?: string };
  [ACTION_KIND.UPDATE]: { action: AppUpdateAction };
  [ACTION_KIND.REMEMBER]: {
    /** One concise durable fact selected from the developer-opened turn. */
    words: string;
    /** The id of the fact this one stands in for, when it changes one. */
    replaces?: string;
  };
  [ACTION_KIND.FORGET]: { id: string };
}

/** One action ready for the performer that carries it, for one kind or any of them. */
export type CarriedAction<Kind extends ActionKind = ActionKind> = {
  [K in Kind]: Carried<{ kind: K } & ActionPayloads[K]>;
}[Kind];

export type SessionActionKind =
  | typeof ACTION_KIND.MESSAGE
  | typeof ACTION_KIND.CONTROL
  | typeof ACTION_KIND.OPEN
  | typeof ACTION_KIND.CREATE_WORKSPACE
  | typeof ACTION_KIND.ADD_AGENT
  | typeof ACTION_KIND.RENAME_WORKSPACE
  | typeof ACTION_KIND.RENAME_SESSION;

export type IssueActionKind = typeof ACTION_KIND.ISSUE_STATE | typeof ACTION_KIND.ISSUE_COMMENT;

export type AppActionKind =
  | typeof ACTION_KIND.SETTING
  | typeof ACTION_KIND.PANEL
  | typeof ACTION_KIND.FEEDBACK
  | typeof ACTION_KIND.UPDATE
  | typeof ACTION_KIND.REMEMBER
  | typeof ACTION_KIND.FORGET;

export type CarriedSessionAction = CarriedAction<SessionActionKind>;
export type CarriedIssueAction = CarriedAction<IssueActionKind>;
export type CarriedAppAction = CarriedAction<AppActionKind>;

/**
 * One ask at an intake, before anything about it has been read: the kind names
 * which admitter runs, and the fields are untrusted wire values keyed by the
 * action's own schema names — the same names the tool schema publishes and the
 * model emits, so admission learns one dialect rather than one per intake.
 */
export interface ActionRequest<Kind extends ActionKind = ActionKind> {
  readonly kind: Kind;
  readonly fields: WireRecord;
}
