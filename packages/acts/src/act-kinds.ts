/**
 * The one vocabulary every act intake speaks: which family an act belongs to,
 * which kind it is, and what a carried act of that kind holds. It is declared
 * here rather than beside any one intake because a renderer press, a model's
 * tool call, and a hosted route all name the same acts, and a kind spelled one
 * way where an act is offered and another where it is admitted is the drift
 * this file exists to close.
 */

import type {
  AppGuideSetting,
  AppPanelTab,
  AppUpdateAct,
  FeedbackComposerKind,
  SessionListSort,
} from "@sidecar/guide";
import type {
  ACT_KIND as ADVERTISED_ACT_KIND,
  AdvertisedControl,
  IssueIdentity,
  IssueTransition,
  SessionApplicationId,
  SessionIdentity,
  WorkspaceAgentSelection,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";

/**
 * One tool call as admission is handed it: the act's own name and its
 * arguments as the model wrote them. No call id — the id an answer travels
 * back under belongs to the transport, which extends this with one.
 */
export interface RealtimeFunctionCall {
  name: string;
  argumentsJson: string;
}

/** Which process an act is about: a session, an issue, or Luke himself. */
export const ACT_FAMILY = {
  SESSION: "session",
  ISSUE: "issue",
  APP: "app",
} as const;

export type ActFamily = (typeof ACT_FAMILY)[keyof typeof ACT_FAMILY];

/**
 * Every act, in one table. The session kinds are the same strings the session
 * package's advertisement vocabulary holds — the `satisfies` below is what
 * keeps them so — because an act admitted against an advertisement has to be
 * named identically on both sides of that check.
 */
export const ACT_KIND = {
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
} as const satisfies typeof ADVERTISED_ACT_KIND & Record<string, string>;

export type ActKind = (typeof ACT_KIND)[keyof typeof ACT_KIND];

/** The two whole-list scopes of a spoken panel ask beyond the locations. */
export const SESSION_LIST_ALL = "all";
export const SESSION_LIST_VOICE = "voice";

/**
 * An act payload that can never be mistaken for a refusal: the two shapes are
 * disjoint, so `kind === undefined` is the whole of the test either way.
 */
export type Carried<T> = T & { status?: never; reason?: never };

/**
 * What each kind of act carries once admitted. Every field here is either the
 * developer's own bounded text or a value read back out of what the roster,
 * the projects list, the guide, or the notebook advertised — never a caller's
 * copy of one.
 */
export interface ActPayloads {
  [ACT_KIND.MESSAGE]: { identity: SessionIdentity; text: string };
  [ACT_KIND.CONTROL]: { identity: SessionIdentity; control: AdvertisedControl };
  [ACT_KIND.OPEN]: {
    identity: SessionIdentity;
    /** The one app the developer named to open it in, resolved to its id. */
    applicationId?: SessionApplicationId;
  };
  [ACT_KIND.CREATE_WORKSPACE]: {
    providerId: string;
    providerProjectId: string;
    providerTargetId?: string;
    agent?: string;
    name?: string;
    task?: string;
    /** The model the developer named for this one creation, resolved to ids. */
    agentSelection?: WorkspaceAgentSelection;
  };
  [ACT_KIND.ADD_AGENT]: {
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
  [ACT_KIND.RENAME_WORKSPACE]: { identity: SessionIdentity; name: string };
  /** The chat's new name, exactly as the developer chose it. */
  [ACT_KIND.RENAME_SESSION]: { identity: SessionIdentity; name: string };
  [ACT_KIND.ISSUE_STATE]: { identity: IssueIdentity; transition: IssueTransition };
  [ACT_KIND.ISSUE_COMMENT]: { identity: IssueIdentity; body: string };
  [ACT_KIND.SETTING]: {
    setting: AppGuideSetting;
    value: string;
    /** The effort riding the new value, when the developer named both. */
    effort?: string;
  };
  [ACT_KIND.PANEL]: {
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
   * leaves only by its own Send button — no act here sends.
   */
  [ACT_KIND.FEEDBACK]: { composer: FeedbackComposerKind; draft?: string };
  [ACT_KIND.UPDATE]: { act: AppUpdateAct };
  [ACT_KIND.REMEMBER]: {
    /** One concise durable fact selected from the developer-opened turn. */
    words: string;
    /** The id of the fact this one stands in for, when it changes one. */
    replaces?: string;
  };
  [ACT_KIND.FORGET]: { id: string };
}

/** One act ready for the performer that carries it, for one kind or any of them. */
export type CarriedAct<Kind extends ActKind = ActKind> = {
  [K in Kind]: Carried<{ kind: K } & ActPayloads[K]>;
}[Kind];

export type SessionActKind =
  | typeof ACT_KIND.MESSAGE
  | typeof ACT_KIND.CONTROL
  | typeof ACT_KIND.OPEN
  | typeof ACT_KIND.CREATE_WORKSPACE
  | typeof ACT_KIND.ADD_AGENT
  | typeof ACT_KIND.RENAME_WORKSPACE
  | typeof ACT_KIND.RENAME_SESSION;

export type IssueActKind = typeof ACT_KIND.ISSUE_STATE | typeof ACT_KIND.ISSUE_COMMENT;

export type AppActKind =
  | typeof ACT_KIND.SETTING
  | typeof ACT_KIND.PANEL
  | typeof ACT_KIND.FEEDBACK
  | typeof ACT_KIND.UPDATE
  | typeof ACT_KIND.REMEMBER
  | typeof ACT_KIND.FORGET;

export type CarriedSessionAct = CarriedAct<SessionActKind>;
export type CarriedIssueAct = CarriedAct<IssueActKind>;
export type CarriedAppAct = CarriedAct<AppActKind>;

/**
 * One ask at an intake, before anything about it has been read: the kind names
 * which admitter runs, and the fields are untrusted wire values keyed by the
 * act's own schema names — the same names the tool schema publishes and the
 * model emits, so admission learns one dialect rather than one per intake.
 */
export interface ActRequest<Kind extends ActKind = ActKind> {
  readonly kind: Kind;
  readonly fields: WireRecord;
}
