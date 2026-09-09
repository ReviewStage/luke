/**
 * The validators every intake ran before `admit` existed, kept for exactly as
 * long as it takes to prove `admit` answers what they answered. Nothing in the
 * product calls them: each is exercised only by `admit.test.ts`, which runs the
 * pair on the same input and asserts the two agree. The PR that deletes this
 * file is the one that deletes the redundant layers beneath it.
 */

import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  APP_UPDATE_ACT,
  APP_UPDATE_WAIT,
  type AppGuideSetting,
  type AppGuideSnapshot,
  type AppGuideUpdate,
  type AppPanelTab,
  type AppUpdateAct,
  appGuideSetting,
  appToggleValue,
  type FeedbackComposerKind,
  isAppPanelTab,
  isAppUpdateAct,
  isFeedbackComposerKind,
  isSessionListSort,
  type SessionListSort,
} from "@sidecar/guide";
import {
  ACT_RESULT_STATUS,
  type IssueIdentity,
  type IssueTransition,
  issueCommentText,
  type TrackedIssue,
} from "@sidecar/issues";
import {
  ACT_KIND,
  type AdvertisedControl,
  advertisedActFor,
  advertisedControl,
  isSessionApplicationId,
  matchesFilterSelection,
  maximumSessionMessageLength,
  maximumWorkspaceNameLength,
  type ObservedWorkspaceProject,
  SESSION_LOCATION,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
  sessionMessageText,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
  workspaceNameText,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  text as wireText,
} from "@sidecar/wire";
import { type RealtimeFunctionCall, SESSION_LIST_ALL, SESSION_LIST_VOICE } from "./act-kinds.js";
import { SESSION_LIST_FILTER_VALUES } from "./act-schemas.js";
import {
  holdsRememberedFact,
  maximumRememberedFactLength,
  maximumRememberedFacts,
  type RememberedFact,
  rememberedFactText,
} from "./memory.js";

const SESSION_TOOL_KIND = ACT_KIND;
const ISSUE_TOOL_KIND = { ISSUE_STATE: "issue-state", ISSUE_COMMENT: "issue-comment" } as const;
const APP_TOOL_KIND = {
  SETTING: "setting",
  PANEL: "panel",
  FEEDBACK: "feedback",
  UPDATE: "update",
  REMEMBER: "remember",
  FORGET: "forget",
} as const;

type CarriedSessionActionFields =
  | { kind: typeof SESSION_TOOL_KIND.MESSAGE; identity: SessionIdentity; text: string }
  | {
      kind: typeof SESSION_TOOL_KIND.CONTROL;
      identity: SessionIdentity;
      control: AdvertisedControl;
    }
  | {
      kind: typeof SESSION_TOOL_KIND.OPEN;
      identity: SessionIdentity;
      /** The one app the developer named to open it in, resolved to its id. */
      applicationId?: SessionApplicationId;
    }
  | {
      kind: typeof SESSION_TOOL_KIND.CREATE_WORKSPACE;
      providerId: string;
      providerProjectId: string;
      providerTargetId?: string;
      agent?: string;
      name?: string;
      task?: string;
      /** The model the developer named for this one creation, resolved to ids. */
      agentSelection?: WorkspaceAgentSelection;
    }
  | {
      kind: typeof SESSION_TOOL_KIND.ADD_AGENT;
      identity: SessionIdentity;
      agent: string;
      name?: string;
      task?: string;
      /** The model the developer named for this one agent, as its wire id. */
      model?: string;
      /** The effort riding that model, when the developer named both. */
      effort?: string;
    }
  | {
      kind: typeof SESSION_TOOL_KIND.RENAME_WORKSPACE;
      identity: SessionIdentity;
      /** The workspace's new name, exactly as the developer chose it. */
      name: string;
    }
  | {
      kind: typeof SESSION_TOOL_KIND.RENAME_SESSION;
      identity: SessionIdentity;
      /** The chat's new name, exactly as the developer chose it. */
      name: string;
    };

export type CarriedSessionAction = CarriedSessionActionFields & {
  status?: never;
  reason?: never;
};

type ActRejection = {
  status: typeof ACT_RESULT_STATUS.REJECTED;
  reason: string;
  kind?: never;
};
export type SessionToolAction = CarriedSessionAction | ActRejection;

/** What one validated issue tool call asks for, ready for the bridge that carries it. */
type CarriedIssueActionFields =
  | {
      kind: typeof ISSUE_TOOL_KIND.ISSUE_STATE;
      identity: IssueIdentity;
      transition: IssueTransition;
    }
  | { kind: typeof ISSUE_TOOL_KIND.ISSUE_COMMENT; identity: IssueIdentity; body: string };

export type CarriedIssueAction = CarriedIssueActionFields & {
  status?: never;
  reason?: never;
};
export type IssueToolAction = CarriedIssueAction | ActRejection;

/**
 * What one validated app tool call asks for, ready for the app to perform.
 * The feedback action opens the composer and nothing else: `draft` is at most
 * the developer's own words, placed only into an empty note, and what the
 * composer holds leaves only by its own Send button — no action here sends.
 */
type CarriedAppActionFields =
  | {
      kind: typeof APP_TOOL_KIND.SETTING;
      setting: AppGuideSetting;
      value: string;
      /** The effort riding the new value, when the developer named both. */
      effort?: string;
    }
  | {
      kind: typeof APP_TOOL_KIND.PANEL;
      tab: AppPanelTab;
      /** The validated narrowing, combined like the chips: OR within an axis, AND across. */
      filters?: readonly string[];
      sort?: SessionListSort;
      /** Words to search the list for, exactly as the developer asked them. */
      query?: string;
    }
  | { kind: typeof APP_TOOL_KIND.FEEDBACK; composer: FeedbackComposerKind; draft?: string }
  | { kind: typeof APP_TOOL_KIND.UPDATE; act: AppUpdateAct }
  | {
      kind: typeof APP_TOOL_KIND.REMEMBER;
      /** One concise durable fact selected from the developer-opened turn. */
      words: string;
      /** The id of the fact this one stands in for, when it changes one. */
      replaces?: string;
    }
  | { kind: typeof APP_TOOL_KIND.FORGET; id: string };

export type CarriedAppAction = CarriedAppActionFields & {
  status?: never;
  reason?: never;
};
export type AppToolAction = CarriedAppAction | ActRejection;

export type CarriedAct = CarriedSessionAction | CarriedIssueAction | CarriedAppAction;

export interface SessionToolContext {
  sessions: readonly Session[];
  workspaceProjects: readonly ObservedWorkspaceProject[];
  agentModels: (providerId: string) => readonly WorkspaceAgentModels[];
  /**
   * The developer's saved tie-breaks for a creation ask, the same ones the
   * projects context narrates: the provider a nameless ask goes to, and each
   * provider's chosen project. Both only ever narrow within the listed
   * projects — a default can settle an ambiguous ask, never widen where one
   * can land or override a provider or project the ask actually named.
   */
  defaultProviderId?: string;
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
}

export interface IssueToolContext {
  issues: readonly TrackedIssue[];
}

export interface AppToolContext {
  guide: AppGuideSnapshot;
  sessions: readonly Session[];
  /**
   * The facts standing right now, which a replacement or a removal is
   * validated against — the same discipline a session act keeps against the
   * roster. An id the conversation was never shown names nothing.
   */
  rememberedFacts: readonly RememberedFact[];
}
type SessionToolValidate = (parsed: WireRecord, context: SessionToolContext) => SessionToolAction;

type IssueToolValidate = (parsed: WireRecord, context: IssueToolContext) => IssueToolAction;

type AppToolValidate = (parsed: WireRecord, context: AppToolContext) => AppToolAction;

function textArgument(record: WireRecord, key: string): string | undefined {
  return wireText(record[key]);
}

function parseToolArguments(
  call: RealtimeFunctionCall,
): { ok: true; value: WireRecord } | { ok: false; reason: string } {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a runtime value; isRecord validates the object contract.
    parsed = JSON.parse(call.argumentsJson) as UnparsedWireValue;
  } catch {
    return { ok: false, reason: "The tool call's arguments were not readable." };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "The tool call's arguments were not readable." };
  }
  return { ok: true, value: parsed };
}

function sessionFromArguments(
  parsed: WireRecord,
  sessions: readonly Session[],
): { session: Session; identity: SessionIdentity } | ActRejection {
  const providerId = textArgument(parsed, "provider_id");
  const providerSessionId = textArgument(parsed, "provider_session_id");
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === providerId && candidate.providerSessionId === providerSessionId,
  );
  if (!session) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "No observed session matches that identity.",
    };
  }
  return {
    session,
    identity: {
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    },
  };
}

function issueFromArguments(
  parsed: WireRecord,
  issues: readonly TrackedIssue[],
): { issue: TrackedIssue; identity: IssueIdentity } | ActRejection {
  const trackerId = textArgument(parsed, "tracker_id");
  const issueId = textArgument(parsed, "issue_id");
  const issue = issues.find(
    (candidate) => candidate.trackerId === trackerId && candidate.identifier === issueId,
  );
  if (!issue) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "No tracked issue matches that identity.",
    };
  }
  return {
    issue,
    identity: {
      trackerId: issue.trackerId,
      identifier: issue.identifier,
    },
  };
}

/**
 * Resolves a model the developer named — by the label the guide lists it
 * under, or its id — to the wire pairing an endpoint takes, held to the
 * build's documented entries for the provider. The effort, when named, must
 * be one the resolved model's own agent documents: the pairing is validated
 * as the whole it will be sent as.
 */
function resolveWorkspaceAgentModel(
  entries: readonly WorkspaceAgentModels[],
  modelWord: string,
  effortWord: string | undefined,
): { selection: WorkspaceAgentSelection } | { refusal: string } {
  const normalizedModel = modelWord.trim().toLowerCase();
  const named = entries
    .flatMap((entry) => entry.models.map((model) => ({ entry, model })))
    .find(
      ({ model }) =>
        model.label.toLowerCase() === normalizedModel || model.id.toLowerCase() === normalizedModel,
    );
  if (!named) return { refusal: "No documented model goes by that name here." };
  let effort: string | undefined;
  if (effortWord !== undefined) {
    const normalizedEffort = effortWord.trim().toLowerCase();
    effort = named.entry.efforts.find((candidate) => candidate.toLowerCase() === normalizedEffort);
    if (!effort) {
      return {
        refusal:
          named.entry.efforts.length > 0
            ? `That model's effort is one of ${named.entry.efforts.join(", ")}.`
            : "That model takes no effort level.",
      };
    }
  }
  const selection: WorkspaceAgentSelection = {
    agent: named.entry.agent,
    model: named.model.id,
  };
  if (effort) selection.effort = effort;
  return { selection };
}

function validateSendSessionMessage(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("status" in found) return found;
  const { session, identity } = found;
  if (!advertisedActFor(session, ACT_KIND.MESSAGE)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That session does not take messages right now.",
    };
  }
  const messageText = sessionMessageText(parsed.text);
  if (!messageText) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That message is empty or too long.",
    };
  }
  return { kind: SESSION_TOOL_KIND.MESSAGE, identity, text: messageText };
}

function validateRunSessionControl(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("status" in found) return found;
  const { session, identity } = found;
  const controlId = textArgument(parsed, "control_id");
  const control = controlId ? advertisedControl(session, controlId) : undefined;
  if (!control) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That session advertises no such control.",
    };
  }
  return { kind: SESSION_TOOL_KIND.CONTROL, identity, control };
}

function validateOpenSession(parsed: WireRecord, context: SessionToolContext): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("status" in found) return found;
  const { session, identity } = found;
  // The action carries the identity — and, when the developer named an app,
  // that app's id — never the address: the main process reads the link back
  // out of its own registry, the same as a pressed row or a pressed app mark.
  const applicationWord = textArgument(parsed, "application");
  if (applicationWord !== undefined) {
    const normalized = applicationWord.trim().toLowerCase();
    const application = session.applications.find(
      (candidate) =>
        candidate.displayName.toLowerCase() === normalized || candidate.id === normalized,
    );
    // An association without an exact address identifies the app but opens
    // nothing, so it refuses like an app the roster never listed — and the
    // refusal names the apps that can open, which the roster already carries.
    // The id must be one the build fixed: the bridge takes no other, and the
    // main process would refuse it again.
    const applicationId = application?.link ? application.id : undefined;
    if (applicationId === undefined || !isSessionApplicationId(applicationId)) {
      const openable = session.applications.filter((candidate) => candidate.link);
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason:
          openable.length > 0
            ? `That session opens in ${openable
                .map((candidate) => candidate.displayName)
                .join(" or ")}, not there.`
            : "No app carries an exact address for that session.",
      };
    }
    return { kind: SESSION_TOOL_KIND.OPEN, identity, applicationId };
  }
  if (!session.detail.link) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "That session has no address to open." };
  }
  return { kind: SESSION_TOOL_KIND.OPEN, identity };
}

function validateCreateWorkspace(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  // A creation ask names a project rather than a session, so it is validated
  // against the projects the conversation was shown — the same discipline,
  // against the list that actually offered it.
  const providerId = textArgument(parsed, "provider_id");
  const projectId = textArgument(parsed, "project_id");
  const targetId = textArgument(parsed, "target_id");
  let matchingProjects = context.workspaceProjects.filter(
    (candidate) =>
      (!providerId || candidate.providerId === providerId) &&
      (!projectId || candidate.providerProjectId === projectId) &&
      (!targetId || candidate.providerTargetId === targetId),
  );
  // The saved defaults settle only what the ask left unnamed: no provider
  // named sends a still-ambiguous ask to the default provider while it is
  // offering, and no project named sends it on to that provider's chosen
  // project. Neither step can leave the listed set, and an ask that named
  // its own provider or project is never overridden.
  if (!providerId && context.defaultProviderId && matchingProjects.length > 1) {
    const offeredByDefault = matchingProjects.filter(
      (candidate) => candidate.providerId === context.defaultProviderId,
    );
    if (offeredByDefault.length > 0) matchingProjects = offeredByDefault;
  }
  // A provider's chosen project settles which project, never which provider:
  // while candidates still span providers, one provider's saved project must
  // not quietly decide an ask the developer left open between them.
  const [firstMatch] = matchingProjects;
  const oneProviderMatches =
    firstMatch !== undefined &&
    matchingProjects.every((candidate) => candidate.providerId === firstMatch.providerId);
  if (!projectId && oneProviderMatches && matchingProjects.length > 1) {
    const chosenProjects = matchingProjects.filter(
      (candidate) =>
        context.defaultProjectIds?.[candidate.providerId] ===
        workspaceProjectSelectionId(candidate),
    );
    if (chosenProjects.length === 1) matchingProjects = chosenProjects;
  }
  if (matchingProjects.length !== 1) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason:
        matchingProjects.length === 0
          ? "No listed project matches that identity."
          : "More than one listed project matches; name the project and host.",
    };
  }
  const project = matchingProjects[0];
  if (!project)
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "No listed project matches that identity.",
    };
  const requestedAgent = textArgument(parsed, "agent");
  const matchingAgents = requestedAgent
    ? project.spawnableAgents?.filter(
        (candidate) => candidate.toLocaleLowerCase() === requestedAgent.toLocaleLowerCase(),
      )
    : undefined;
  const agent =
    (requestedAgent && project.spawnableAgents?.includes(requestedAgent)
      ? requestedAgent
      : matchingAgents?.length === 1
        ? matchingAgents[0]
        : undefined) ?? project.defaultAgent;
  if (project.spawnableAgents && (!agent || !project.spawnableAgents.includes(agent))) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: agent
        ? "That project lists no such agent to start."
        : "Name one of the agents that project lists for a new workspace.",
    };
  }
  let name: string | undefined;
  if (parsed.name !== undefined) {
    if (project.namesItself) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That project names its own workspaces.",
      };
    }
    name = workspaceNameText(parsed.name);
    if (!name) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: `A workspace name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
      };
    }
  }
  // The task is held to the project's own word for it: a project that takes
  // none cannot be handed one, a project that needs one cannot be created
  // without it, and the text itself is bounded like the message it is.
  let task: string | undefined;
  if (parsed.task !== undefined) {
    if (project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That project takes no opening task." };
    }
    task = sessionMessageText(parsed.task);
    if (!task) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That task is empty or too long.",
      };
    }
  } else if (project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That project needs an opening task to create a workspace.",
    };
  }
  // A model named for this one creation resolves against the provider's own
  // documented table, and the effort only ever rides a model: alone it has
  // nothing documented to attach to.
  const spokenModel = textArgument(parsed, "model");
  const spokenEffort = textArgument(parsed, "effort");
  if (spokenEffort !== undefined && spokenModel === undefined) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "An effort rides a model; name the model too.",
    };
  }
  let agentSelection: WorkspaceAgentSelection | undefined;
  if (spokenModel !== undefined) {
    const resolved = resolveWorkspaceAgentModel(
      context.agentModels(project.providerId),
      spokenModel,
      spokenEffort,
    );
    if ("refusal" in resolved)
      return { status: ACT_RESULT_STATUS.REJECTED, reason: resolved.refusal };
    agentSelection = resolved.selection;
  }
  const action: CarriedSessionAction = {
    kind: SESSION_TOOL_KIND.CREATE_WORKSPACE,
    providerId: project.providerId,
    providerProjectId: project.providerProjectId,
  };
  if (project.providerTargetId) action.providerTargetId = project.providerTargetId;
  if (agent) action.agent = agent;
  if (name) action.name = name;
  if (task) action.task = task;
  if (agentSelection) action.agentSelection = agentSelection;
  return action;
}

function validateAddWorkspaceAgent(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("status" in found) return found;
  const { session, identity } = found;
  // The agent must be one this session's own roster entry listed: the list
  // is the provider's word for what its endpoint takes, so an ask outside it
  // is refused rather than forwarded to be refused.
  const agent = textArgument(parsed, "agent");
  if (!agent || !advertisedActFor(session, ACT_KIND.ADD_AGENT)?.agents.includes(agent)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That session lists no such agent to add.",
    };
  }
  let name: string | undefined;
  if (parsed.name !== undefined) {
    name = workspaceNameText(parsed.name);
    if (!name) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: `A session name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
      };
    }
  }
  let task: string | undefined;
  if (parsed.task !== undefined) {
    task = sessionMessageText(parsed.task);
    if (!task) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That task is empty or too long.",
      };
    }
  }
  // A model named for this one agent resolves within the asked-for kind
  // alone: the developer's chosen agent is never re-decided by the model
  // they named beside it, so a mismatch is a refusal rather than a swap.
  const spokenModel = textArgument(parsed, "model");
  const spokenEffort = textArgument(parsed, "effort");
  if (spokenEffort !== undefined && spokenModel === undefined) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "An effort rides a model; name the model too.",
    };
  }
  let selection: WorkspaceAgentSelection | undefined;
  if (spokenModel !== undefined) {
    const entries = context
      .agentModels(session.providerId)
      .filter((candidate) => candidate.agent === agent);
    const resolved = resolveWorkspaceAgentModel(entries, spokenModel, spokenEffort);
    if ("refusal" in resolved) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: resolved.refusal.startsWith("No documented model")
          ? `A ${agent} agent runs no model by that name.`
          : resolved.refusal,
      };
    }
    selection = resolved.selection;
  }
  const action: CarriedSessionAction = {
    kind: SESSION_TOOL_KIND.ADD_AGENT,
    identity,
    agent,
  };
  if (name) action.name = name;
  if (task) action.task = task;
  if (selection) action.model = selection.model;
  if (selection?.effort) action.effort = selection.effort;
  return action;
}

function validateRenameWorkspace(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("status" in found) return found;
  const { session, identity } = found;
  // Only a session whose roster entry advertised renaming has a workspace a
  // rename can land on. The action carries the identity and the name, never
  // the target: the main process resolves the workspace from its own
  // registry, the same way an open never carries an address.
  if (!advertisedActFor(session, ACT_KIND.RENAME_WORKSPACE)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That session's workspace cannot be renamed.",
    };
  }
  const name = workspaceNameText(parsed.name);
  if (!name) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `A workspace name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
    };
  }
  return { kind: SESSION_TOOL_KIND.RENAME_WORKSPACE, identity, name };
}

function validateRenameSession(parsed: WireRecord, context: SessionToolContext): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("status" in found) return found;
  const { session, identity } = found;
  if (!advertisedActFor(session, ACT_KIND.RENAME_SESSION)) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "That chat cannot be renamed." };
  }
  const name = workspaceNameText(parsed.name);
  if (!name) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `A chat name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
    };
  }
  return { kind: SESSION_TOOL_KIND.RENAME_SESSION, identity, name };
}

function validateUpdateIssueState(parsed: WireRecord, context: IssueToolContext): IssueToolAction {
  const found = issueFromArguments(parsed, context.issues);
  if ("status" in found) return found;
  const { issue, identity } = found;
  const state = textArgument(parsed, "state");
  // Spoken names arrive with their case retold rather than copied, so the
  // match forgives case alone — never spelling — and only while it stays
  // unambiguous. Two advertised states apart only in case are not a guess
  // Luke gets to make.
  const named = state
    ? issue.transitions.filter((candidate) => candidate.name.toLowerCase() === state.toLowerCase())
    : [];
  const transition =
    named.find((candidate) => candidate.name === state) ??
    (named.length === 1 ? named[0] : undefined);
  if (!transition) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "That issue lists no such state." };
  }
  return { kind: ISSUE_TOOL_KIND.ISSUE_STATE, identity, transition };
}

function validateCommentOnIssue(parsed: WireRecord, context: IssueToolContext): IssueToolAction {
  const found = issueFromArguments(parsed, context.issues);
  if ("status" in found) return found;
  const { issue, identity } = found;
  if (!issue.canComment) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "That issue does not take comments." };
  }
  const body = issueCommentText(parsed.body);
  if (!body) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "That comment is empty or too long.",
    };
  }
  return { kind: ISSUE_TOOL_KIND.ISSUE_COMMENT, identity, body };
}

/**
 * Validates the value a spoken change carries against the setting it names.
 * A toggle takes the guide's own two words (and their unambiguous synonyms);
 * a choice takes exactly one of the values the guide listed. Anything else is
 * refused with the accepted set, so the refusal is also the correction.
 */
function appSettingValue(setting: AppGuideSetting, value: UnparsedWireValue): string | undefined {
  if (setting.kind === APP_SETTING_KIND.TOGGLE) return appToggleValue(value);
  if (!isWireString(value)) return undefined;
  const normalized = value.trim().toLowerCase();
  return setting.choices?.find((choice) => choice.toLowerCase() === normalized);
}

/**
 * Whether one observed session answers one spoken filter value. Every
 * identity a row carries is a filter on the same terms as its provider id —
 * the agent behind a hosted chat, an app associated with it, and a workspace
 * manager's scope id — so a spoken ask reaches exactly the rows the matching
 * chip would keep.
 */
function sessionAnswersFilter(session: Session, filter: string): boolean {
  if (filter === SESSION_LOCATION.LOCAL || filter === SESSION_LOCATION.CLOUD) {
    return session.location === filter;
  }
  if (filter === SESSION_LIST_VOICE) return session.realtimeVoice === true;
  return (
    session.providerId === filter ||
    session.agent?.id === filter ||
    session.workspace?.scopeId === filter ||
    session.applications.some((application) => application.id === filter)
  );
}

/**
 * Validates a spoken session-list narrowing against the sessions actually
 * being observed. A narrowing that would show nothing is refused rather than
 * applied: the panel would quietly fall back to showing everything, and Luke
 * would have reported a narrowing that never happened. Each value is checked
 * on its own first, so the refusal can name the value that is wrong rather
 * than only the combination — and then the combination is checked whole, on
 * the same axis terms the chips combine on, because two values a roster
 * answers separately can still name an intersection nothing occupies.
 */
function panelFiltersAction(
  filters: readonly string[],
  sessions: readonly Session[],
): { filters: readonly string[] } | { reason: string } {
  // The enum on the tool's own schema already binds a compliant model to
  // these tokens; this is the backstop for a call composed past it.
  for (const filter of filters) {
    if (!SESSION_LIST_FILTER_VALUES.includes(filter)) {
      return { reason: `"${filter}" is not one of the filter values the tool lists.` };
    }
  }
  const chosen = [...new Set(filters)];
  if (chosen.includes(SESSION_LIST_ALL)) {
    if (chosen.length > 1) {
      return { reason: `${SESSION_LIST_ALL} is the whole list, so it combines with nothing.` };
    }
    return { filters: chosen };
  }
  for (const filter of chosen) {
    if (sessions.some((session) => sessionAnswersFilter(session, filter))) continue;
    if (filter === SESSION_LOCATION.LOCAL || filter === SESSION_LOCATION.CLOUD) {
      return { reason: `No ${filter} sessions are observed right now.` };
    }
    if (filter === SESSION_LIST_VOICE) {
      return { reason: "No voice sessions are observed right now." };
    }
    return {
      reason: `No observed session belongs to an agent, app, or workspace manager "${filter}".`,
    };
  }
  if (
    chosen.length > 1 &&
    !sessions.some((session) =>
      matchesFilterSelection(chosen, (filter) => sessionAnswersFilter(session, filter)),
    )
  ) {
    return { reason: "No observed session matches that combination of filters." };
  }
  return { filters: chosen };
}

function validateChangeAppSetting(parsed: WireRecord, context: AppToolContext): AppToolAction {
  const setting = appGuideSetting(context.guide, textArgument(parsed, "setting_id"));
  if (!setting) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "The app guide lists no such setting." };
  }
  if (!setting.adjustable) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `${setting.label} can only be changed by hand: ${setting.manual}`,
    };
  }
  const value = appSettingValue(setting, parsed.value);
  if (value === undefined) {
    const accepted =
      setting.kind === APP_SETTING_KIND.TOGGLE ? "on or off" : (setting.choices ?? []).join(", ");
    return { status: ACT_RESULT_STATUS.REJECTED, reason: `${setting.label} takes ${accepted}.` };
  }
  // An effort may ride only a value the guide lists levels for, so both
  // halves of one stored pairing can be asked for in one change — matched
  // like the value: case retold rather than copied, answered in the guide's
  // own casing.
  const effortWord = textArgument(parsed, "effort");
  if (effortWord === undefined) return { kind: APP_TOOL_KIND.SETTING, setting, value };
  const levels = setting.efforts?.[value] ?? [];
  if (levels.length === 0) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason:
        setting.efforts === undefined
          ? `${setting.label} takes no effort level.`
          : `${value} takes no effort level.`,
    };
  }
  const normalizedEffort = effortWord.trim().toLowerCase();
  const effort = levels.find((candidate) => candidate.toLowerCase() === normalizedEffort);
  if (effort === undefined) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `${value}'s effort is one of ${levels.join(", ")}.`,
    };
  }
  return { kind: APP_TOOL_KIND.SETTING, setting, value, effort };
}

/**
 * Reads the narrowing a panel ask carries: several values, or a lone string
 * for a narrowing of one. Blank entries are dropped rather than validated,
 * and an emptied list is no narrowing at all.
 */
function spokenFilterValues(
  value: UnparsedWireValue,
): { values: readonly string[] | undefined } | { reason: string } {
  if (value === undefined) return { values: undefined };
  const entries = isWireString(value) ? [value] : value;
  if (!Array.isArray(entries) || !entries.every((entry) => isWireString(entry))) {
    return { reason: "filters takes a list of filter values." };
  }
  const cleaned = entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return { values: cleaned.length > 0 ? cleaned : undefined };
}

function validateShowPanel(parsed: WireRecord, context: AppToolContext): AppToolAction {
  const tab = parsed.tab ?? APP_PANEL_TAB.SESSIONS;
  if (!isAppPanelTab(tab)) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "The panel has no such tab." };
  }
  const sort = textArgument(parsed, "sort");
  if (sort !== undefined && !isSessionListSort(sort)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "The list orders by urgency or by recency.",
    };
  }
  // A search is bounded by the hand's own control: the magnifier is only
  // offered beside a list with more than one session, and a spoken ask
  // reaches no further than it. The words themselves are not validated
  // against the rows the way a filter is — a query is read against the lines
  // as the surface words them, which only the renderer knows, and a search
  // matching nothing is the list's own honest answer rather than a stale
  // narrowing to refuse.
  const query = textArgument(parsed, "query");
  if (query !== undefined && context.sessions.length < 2) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "The list offers a search only when more than one session is observed.",
    };
  }
  const asked = spokenFilterValues(parsed.filters);
  if ("reason" in asked) return { status: ACT_RESULT_STATUS.REJECTED, reason: asked.reason };
  if (asked.values === undefined) {
    const action: CarriedAppAction = { kind: APP_TOOL_KIND.PANEL, tab };
    if (sort !== undefined) action.sort = sort;
    if (query !== undefined) action.query = query;
    return action;
  }
  const outcome = panelFiltersAction(asked.values, context.sessions);
  if ("reason" in outcome) return { status: ACT_RESULT_STATUS.REJECTED, reason: outcome.reason };
  const action: CarriedAppAction = {
    kind: APP_TOOL_KIND.PANEL,
    tab,
    filters: outcome.filters,
  };
  if (sort !== undefined) action.sort = sort;
  if (query !== undefined) action.query = query;
  return action;
}

function validateOpenFeedbackComposer(parsed: WireRecord, _context: AppToolContext): AppToolAction {
  const composer = parsed.kind;
  if (!isFeedbackComposerKind(composer)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "The composer writes feedback or a prompt, nothing else.",
    };
  }
  // The draft is the developer's ask restated in their words, not a document,
  // so it is bounded like a typed one; a blank draft is no draft, and the
  // composer simply opens empty.
  const draft = textArgument(parsed, "draft")?.slice(0, maximumSessionMessageLength);
  const action: CarriedAppAction = { kind: APP_TOOL_KIND.FEEDBACK, composer };
  if (draft) action.draft = draft;
  return action;
}

/**
 * What stands where the asked-for act would be, so a refusal can say why the
 * row is not offering it — the row's own detail says where the build stands,
 * and this names the one press that stands instead.
 */
const UPDATE_BUTTON_STANDING = {
  [APP_UPDATE_ACT.CHECK]: "Its button offers a check right now.",
  [APP_UPDATE_ACT.DOWNLOAD]: "Its button offers the releases page in the browser right now.",
  [APP_UPDATE_ACT.RESTART]: "Its button offers Restart to update right now.",
  [APP_UPDATE_WAIT.CHECKING]: "Nothing is pressable while the check is out.",
  [APP_UPDATE_WAIT.DOWNLOADING]: "Nothing is pressable while the download runs.",
} as const satisfies Record<AppGuideUpdate["button"], string>;

function validateRunUpdateAction(parsed: WireRecord, context: AppToolContext): AppToolAction {
  // The guide's update entry is the roster here: a run that reported nothing
  // about updates — a fixture, a pure caller — advertises no act to run.
  const update = context.guide.update;
  if (!update) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "This run does not report where updates stand.",
    };
  }
  const act = parsed.action;
  if (!isAppUpdateAct(act)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "The Updates button checks, downloads, or restarts.",
    };
  }
  // One button, one act: only the press the row is actually drawing runs, so
  // the refusal is the row's own words plus what stands in the act's place.
  if (act !== update.button) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `${update.detail} ${UPDATE_BUTTON_STANDING[update.button]}`,
    };
  }
  return { kind: APP_TOOL_KIND.UPDATE, act };
}

/** Validates one automatic memory update against the bounded list in context. */
function validateRememberFact(parsed: WireRecord, context: AppToolContext): AppToolAction {
  const words = rememberedFactText(parsed.words);
  if (!words) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `A memory has to be under ${maximumRememberedFactLength} characters and longer than nothing.`,
    };
  }
  const replaces = textArgument(parsed, "replaces");
  if (replaces !== undefined && !holdsRememberedFact(context.rememberedFacts, replaces)) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "Nothing remembered goes by that id.",
    };
  }
  // A replacement retires one as it lands; a new fact never evicts silently.
  if (replaces === undefined && context.rememberedFacts.length >= maximumRememberedFacts) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: `Luke already remembers ${maximumRememberedFacts} things; replace or forget one first.`,
    };
  }
  return { kind: APP_TOOL_KIND.REMEMBER, words, ...(replaces ? { replaces } : undefined) };
}

function validateForgetFact(parsed: WireRecord, context: AppToolContext): AppToolAction {
  const id = textArgument(parsed, "id");
  if (!id || !holdsRememberedFact(context.rememberedFacts, id)) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "Nothing remembered goes by that id." };
  }
  return { kind: APP_TOOL_KIND.FORGET, id };
}

const LEGACY_VALIDATE = {
  send_session_message: validateSendSessionMessage,
  run_session_control: validateRunSessionControl,
  open_session: validateOpenSession,
  create_workspace: validateCreateWorkspace,
  add_workspace_agent: validateAddWorkspaceAgent,
  rename_workspace: validateRenameWorkspace,
  rename_session: validateRenameSession,
} as const satisfies Record<string, SessionToolValidate>;

const LEGACY_ISSUE_VALIDATE = {
  update_issue_state: validateUpdateIssueState,
  comment_on_issue: validateCommentOnIssue,
} as const satisfies Record<string, IssueToolValidate>;

const LEGACY_APP_VALIDATE = {
  change_app_setting: validateChangeAppSetting,
  show_panel: validateShowPanel,
  open_feedback_composer: validateOpenFeedbackComposer,
  run_update_action: validateRunUpdateAction,
  remember_fact: validateRememberFact,
  forget_fact: validateForgetFact,
} as const satisfies Record<string, AppToolValidate>;

export function sessionToolAction(
  call: RealtimeFunctionCall,
  sessions: readonly Session[],
  workspaceProjects: readonly ObservedWorkspaceProject[] = [],
  agentModels: (providerId: string) => readonly WorkspaceAgentModels[] = () => [],
  defaultProviderId?: string,
  defaultProjectIds?: Readonly<Partial<Record<string, string>>>,
): SessionToolAction {
  const parsed = parseToolArguments(call);
  if (!parsed.ok) return { status: ACT_RESULT_STATUS.REJECTED, reason: parsed.reason };
  // SAFETY: `Object.hasOwn` just answered that the table holds this name.
  const validate = Object.hasOwn(LEGACY_VALIDATE, call.name)
    ? LEGACY_VALIDATE[call.name as keyof typeof LEGACY_VALIDATE]
    : undefined;
  if (!validate) return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." };
  return validate(parsed.value, {
    sessions,
    workspaceProjects,
    agentModels,
    defaultProviderId,
    defaultProjectIds,
  });
}

export function issueToolAction(
  call: RealtimeFunctionCall,
  issues: readonly TrackedIssue[],
): IssueToolAction {
  const parsed = parseToolArguments(call);
  if (!parsed.ok) return { status: ACT_RESULT_STATUS.REJECTED, reason: parsed.reason };
  // SAFETY: `Object.hasOwn` just answered that the table holds this name.
  const validate = Object.hasOwn(LEGACY_ISSUE_VALIDATE, call.name)
    ? LEGACY_ISSUE_VALIDATE[call.name as keyof typeof LEGACY_ISSUE_VALIDATE]
    : undefined;
  if (!validate) return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." };
  return validate(parsed.value, { issues });
}

export function appToolAction(
  call: RealtimeFunctionCall,
  guide: AppGuideSnapshot,
  sessions: readonly Session[],
  rememberedFacts: readonly RememberedFact[] = [],
): AppToolAction {
  const parsed = parseToolArguments(call);
  if (!parsed.ok) return { status: ACT_RESULT_STATUS.REJECTED, reason: parsed.reason };
  // SAFETY: `Object.hasOwn` just answered that the table holds this name.
  const validate = Object.hasOwn(LEGACY_APP_VALIDATE, call.name)
    ? LEGACY_APP_VALIDATE[call.name as keyof typeof LEGACY_APP_VALIDATE]
    : undefined;
  if (!validate) return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such tool exists." };
  return validate(parsed.value, { guide, sessions, rememberedFacts });
}
