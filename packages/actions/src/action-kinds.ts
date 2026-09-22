/**
 * The one vocabulary every action intake speaks: which family an action belongs to,
 * which kind it is, and what a carried action of that kind holds. It is declared
 * here rather than beside any one intake because a renderer press, a model's
 * tool call, and a hosted route all name the same actions, and a kind spelled one
 * way where an action is offered and another where it is admitted is the drift
 * this file exists to close.
 */

import type {
  ACTION_KIND as ADVERTISED_ACTION_KIND,
  AdvertisedControl,
  SessionIdentity,
  WorkspaceAgentSelection,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";

/** Which process an action is about: a session, which is the one family left now that nothing reaches the machine. */
export const ACTION_FAMILY = {
  SESSION: "session",
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
  CREATE_WORKSPACE: "create-workspace",
  ADD_AGENT: "add-agent",
  RENAME_WORKSPACE: "rename-workspace",
  RENAME_SESSION: "rename-session",
} as const satisfies typeof ADVERTISED_ACTION_KIND & Record<string, string>;

export type ActionKind = (typeof ACTION_KIND)[keyof typeof ACTION_KIND];

/**
 * An action payload that can never be mistaken for a refusal: the two shapes are
 * disjoint, so `kind === undefined` is the whole of the test either way.
 */
type Carried<T> = T & { status?: never; reason?: never };

/**
 * What each kind of action carries once admitted. Every field here is either the
 * developer's own bounded text or a value read back out of what the roster or
 * the projects list advertised — never a caller's copy of one.
 */
export interface ActionPayloads {
  [ACTION_KIND.MESSAGE]: { identity: SessionIdentity; text: string };
  [ACTION_KIND.CONTROL]: { identity: SessionIdentity; control: AdvertisedControl };
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
}

/** One action ready for the performer that carries it, for one kind or any of them. */
export type CarriedAction<Kind extends ActionKind = ActionKind> = {
  [K in Kind]: Carried<{ kind: K } & ActionPayloads[K]>;
}[Kind];

/** Every kind is a session's, the app's own having gone with the machine-reaching tools. */
export type SessionActionKind = ActionKind;

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
