/**
 * The acts Luke can carry for the developer, named as Realtime tools, in one
 * table. Family membership, the spoken tool count, and the schema list are
 * derived from it; adding a tool is adding a row.
 *
 * The session trio are the same acts the panel's rows offer — the two writes,
 * and the press that opens a session where its provider keeps it — and the
 * issue pair are the two acts a connected tracker takes. Creating a workspace
 * and the standing-ask pair — keeping the developer's ask to hear about a
 * session, and letting it go — are the acts with no row yet to mirror. The
 * last three are the same presses turned toward the app itself: a settings
 * change, showing the panel, and opening the feedback composer.
 *
 * All run the same gauntlet: a call is validated against the observed roster
 * (or the guide) before anything leaves the renderer, and the main process
 * validates it again against what it observed before anything happens. The
 * `validate` on each row is the renderer's half of that, never a substitute
 * for the main process's. Luke is another way to ask, never a wider one.
 */

import { attentionRequestText, maximumAttentionRequestLength } from "./attention.js";
import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  type AppGuideSetting,
  type AppGuideSnapshot,
  type AppPanelTab,
  appGuideSetting,
  appToggleValue,
  FEEDBACK_COMPOSER_KIND,
  type FeedbackComposerKind,
  isAppPanelTab,
  isFeedbackComposerKind,
  isSessionListSort,
  SESSION_LIST_SORT,
  type SessionListSort,
} from "./guide.js";
import {
  type IssueIdentity,
  type IssueTransition,
  issueCommentText,
  type TrackedIssue,
} from "./issues.js";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  text as wireText,
} from "./json.js";
import {
  maximumWorkspaceNameLength,
  type ObservedWorkspaceProject,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
  workspaceNameText,
} from "./providers.js";
import type { RealtimeFunctionCall } from "./realtime-protocol.js";
import {
  maximumSessionMessageLength,
  type NormalizedSession,
  SESSION_LOCATION,
  type SessionControl,
  type SessionIdentity,
  sessionMessageText,
  supportsSessionControl,
} from "./session.js";

/** Which process a tool call is about: a session, an issue, or Luke himself. */
export const REALTIME_TOOL_FAMILY = {
  SESSION: "session",
  ISSUE: "issue",
  APP: "app",
} as const;

export type RealtimeToolFamily = (typeof REALTIME_TOOL_FAMILY)[keyof typeof REALTIME_TOOL_FAMILY];

/** What a validated session tool call asks for, as the bridge names it. */
export const SESSION_TOOL_KIND = {
  MESSAGE: "message",
  CONTROL: "control",
  OPEN: "open",
  NOTICE_REQUEST: "notice-request",
  NOTICE_WITHDRAW: "notice-withdraw",
  READ_TRANSCRIPT: "read-transcript",
  CREATE_WORKSPACE: "create-workspace",
  ADD_AGENT: "add-agent",
} as const;

export type SessionToolKind = (typeof SESSION_TOOL_KIND)[keyof typeof SESSION_TOOL_KIND];

/** What a validated issue tool call asks for, as the bridge names it. */
export const ISSUE_TOOL_KIND = {
  ISSUE_STATE: "issue-state",
  ISSUE_COMMENT: "issue-comment",
} as const;

export type IssueToolKind = (typeof ISSUE_TOOL_KIND)[keyof typeof ISSUE_TOOL_KIND];

/** What a validated app tool call asks for, as the app performs it. */
export const APP_TOOL_KIND = {
  SETTING: "setting",
  PANEL: "panel",
  FEEDBACK: "feedback",
} as const;

export type AppToolKind = (typeof APP_TOOL_KIND)[keyof typeof APP_TOOL_KIND];

/**
 * The whole-list scope a spoken panel ask may name. The rest of the filter
 * vocabulary is not this module's to define: a location is a session's own
 * `location`, and a provider is its `provider_id`, so a spoken filter is
 * validated against the observed roster rather than against a second list.
 */
export const SESSION_LIST_ALL = "all";
export const SESSION_LIST_VOICE = "voice";

/** What one validated tool call asks for, ready for the bridge that carries it. */
export type SessionToolAction =
  | { kind: typeof SESSION_TOOL_KIND.MESSAGE; identity: SessionIdentity; text: string }
  | { kind: typeof SESSION_TOOL_KIND.CONTROL; identity: SessionIdentity; control: SessionControl }
  | { kind: typeof SESSION_TOOL_KIND.OPEN; identity: SessionIdentity }
  | { kind: typeof SESSION_TOOL_KIND.NOTICE_REQUEST; identity: SessionIdentity; request: string }
  | { kind: typeof SESSION_TOOL_KIND.NOTICE_WITHDRAW; identity: SessionIdentity }
  | { kind: typeof SESSION_TOOL_KIND.READ_TRANSCRIPT; identity: SessionIdentity }
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
  | { kind: "refused"; reason: string };

/** A session act that passed the renderer's half of the gauntlet. */
export type CarriedSessionAction = Exclude<SessionToolAction, { kind: "refused" }>;

/** What one validated issue tool call asks for, ready for the bridge that carries it. */
export type IssueToolAction =
  | {
      kind: typeof ISSUE_TOOL_KIND.ISSUE_STATE;
      identity: IssueIdentity;
      transition: IssueTransition;
    }
  | { kind: typeof ISSUE_TOOL_KIND.ISSUE_COMMENT; identity: IssueIdentity; body: string }
  | { kind: "refused"; reason: string };

/** An issue act that passed the renderer's half of the gauntlet. */
export type CarriedIssueAction = Exclude<IssueToolAction, { kind: "refused" }>;

/**
 * What one validated app tool call asks for, ready for the app to perform.
 * The feedback action opens the composer and nothing else: `draft` is at most
 * the developer's own words, placed only into an empty note, and what the
 * composer holds leaves only by its own Send button — no action here sends.
 */
export type AppToolAction =
  | {
      kind: typeof APP_TOOL_KIND.SETTING;
      setting: AppGuideSetting;
      value: string;
      /** The effort riding the new value, when the developer named both. */
      effort?: string;
    }
  | { kind: typeof APP_TOOL_KIND.PANEL; tab: AppPanelTab; filter?: string; sort?: SessionListSort }
  | { kind: typeof APP_TOOL_KIND.FEEDBACK; composer: FeedbackComposerKind; draft?: string }
  | { kind: "refused"; reason: string };

/** An app act that passed the renderer's half of the gauntlet. */
export type CarriedAppAction = Exclude<AppToolAction, { kind: "refused" }>;

export interface SessionToolContext {
  sessions: readonly NormalizedSession[];
  workspaceProjects: readonly ObservedWorkspaceProject[];
  agentModels: (providerId: string) => readonly WorkspaceAgentModels[];
}

export interface IssueToolContext {
  issues: readonly TrackedIssue[];
}

export interface AppToolContext {
  guide: AppGuideSnapshot;
  sessions: readonly NormalizedSession[];
}

type JsonSchemaStringProperty = {
  type: "string";
  description?: string;
  enum?: readonly string[];
};

type JsonSchemaObjectProperty = {
  type: "object";
  description?: string;
  properties?: JsonSchemaPropertyMap;
  required?: readonly string[];
  additionalProperties?: boolean;
};

type JsonSchemaProperty = JsonSchemaStringProperty | JsonSchemaObjectProperty;

type JsonSchemaPropertyMap = {
  readonly [key: string]: JsonSchemaProperty;
};

interface RealtimeToolParameters {
  type: "object";
  properties: JsonSchemaPropertyMap;
  required: readonly string[];
}

export interface RealtimeToolWireDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: RealtimeToolParameters;
}

type SessionToolValidate = (parsed: WireRecord, context: SessionToolContext) => SessionToolAction;

type IssueToolValidate = (parsed: WireRecord, context: IssueToolContext) => IssueToolAction;

type AppToolValidate = (parsed: WireRecord, context: AppToolContext) => AppToolAction;

interface RealtimeToolSchema {
  description: string;
  parameters: RealtimeToolParameters;
}

type SessionToolSpec = {
  name: string;
  family: typeof REALTIME_TOOL_FAMILY.SESSION;
  schema: RealtimeToolSchema;
  validate: SessionToolValidate;
};

type IssueToolSpec = {
  name: string;
  family: typeof REALTIME_TOOL_FAMILY.ISSUE;
  schema: RealtimeToolSchema;
  validate: IssueToolValidate;
};

type AppToolSpec = {
  name: string;
  family: typeof REALTIME_TOOL_FAMILY.APP;
  schema: RealtimeToolSchema;
  validate: AppToolValidate;
};

type RealtimeToolSpec = SessionToolSpec | IssueToolSpec | AppToolSpec;

const SESSION_IDENTITY_PARAMETERS = {
  provider_id: {
    type: "string",
    description: "The provider_id of the session, exactly as the roster lists it.",
  },
  provider_session_id: {
    type: "string",
    description: "The provider_session_id of the session, exactly as the roster lists it.",
  },
} as const;

const ISSUE_IDENTITY_PARAMETERS = {
  tracker_id: {
    type: "string",
    description: "The tracker_id of the issue, exactly as the issue roster lists it.",
  },
  issue_id: {
    type: "string",
    description:
      "The issue_id of the issue, exactly as the issue roster lists it, such as LUKE-123.",
  },
} as const;

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
  sessions: readonly NormalizedSession[],
): { session: NormalizedSession; identity: SessionIdentity } | { kind: "refused"; reason: string } {
  const providerId = textArgument(parsed, "provider_id");
  const providerSessionId = textArgument(parsed, "provider_session_id");
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === providerId && candidate.providerSessionId === providerSessionId,
  );
  if (!session) {
    return { kind: "refused", reason: "No observed session matches that identity." };
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
): { issue: TrackedIssue; identity: IssueIdentity } | { kind: "refused"; reason: string } {
  const trackerId = textArgument(parsed, "tracker_id");
  const issueId = textArgument(parsed, "issue_id");
  const issue = issues.find(
    (candidate) => candidate.trackerId === trackerId && candidate.identifier === issueId,
  );
  if (!issue) {
    return { kind: "refused", reason: "No tracked issue matches that identity." };
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
): { selection: WorkspaceAgentSelection } | { refused: string } {
  const normalizedModel = modelWord.trim().toLowerCase();
  const named = entries
    .flatMap((entry) => entry.models.map((model) => ({ entry, model })))
    .find(
      ({ model }) =>
        model.label.toLowerCase() === normalizedModel || model.id.toLowerCase() === normalizedModel,
    );
  if (!named) return { refused: "No documented model goes by that name here." };
  let effort: string | undefined;
  if (effortWord !== undefined) {
    const normalizedEffort = effortWord.trim().toLowerCase();
    effort = named.entry.efforts.find((candidate) => candidate.toLowerCase() === normalizedEffort);
    if (!effort) {
      return {
        refused:
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
  if ("kind" in found) return found;
  const { session, identity } = found;
  if (!session.canReceiveMessage) {
    return { kind: "refused", reason: "That session does not take messages right now." };
  }
  const messageText = sessionMessageText(parsed.text);
  if (!messageText) {
    return {
      kind: "refused",
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
  if ("kind" in found) return found;
  const { session, identity } = found;
  const controlId = textArgument(parsed, "control_id");
  const control = session.controls.find((candidate) => candidate.id === controlId);
  if (!controlId || !control || !supportsSessionControl(session, controlId)) {
    return { kind: "refused", reason: "That session advertises no such control." };
  }
  return { kind: SESSION_TOOL_KIND.CONTROL, identity, control };
}

function validateOpenSession(parsed: WireRecord, context: SessionToolContext): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("kind" in found) return found;
  const { session, identity } = found;
  // The action carries the identity, never the address: the main process
  // reads the link back out of its own registry, the same as a pressed row.
  if (!session.detail.link) {
    return { kind: "refused", reason: "That session has no address to open." };
  }
  return { kind: SESSION_TOOL_KIND.OPEN, identity };
}

function validateRequestSessionNotice(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("kind" in found) return found;
  const { identity } = found;
  // Observation is the only prerequisite: the ask writes nothing anywhere and
  // asks the session for nothing, so a session that takes no messages and
  // advertises no controls can still be asked about.
  const request = attentionRequestText(parsed.request);
  if (!request) {
    return {
      kind: "refused",
      reason: `An ask has to be under ${maximumAttentionRequestLength} characters and longer than nothing.`,
    };
  }
  return { kind: SESSION_TOOL_KIND.NOTICE_REQUEST, identity, request };
}

function validateWithdrawSessionNotice(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("kind" in found) return found;
  return { kind: SESSION_TOOL_KIND.NOTICE_WITHDRAW, identity: found.identity };
}

function validateReadSessionTranscript(
  parsed: WireRecord,
  context: SessionToolContext,
): SessionToolAction {
  const found = sessionFromArguments(parsed, context.sessions);
  if ("kind" in found) return found;
  const { session, identity } = found;
  // The action carries the identity, never a path: the main process locates
  // the transcript in its own provider home, the same way a pressed row's
  // open never carries an address. Only a session on this machine has a
  // transcript here to read; which local providers keep a readable one is
  // the main process's answer.
  if (session.location !== SESSION_LOCATION.LOCAL) {
    return { kind: "refused", reason: "Only local sessions keep a transcript on this machine." };
  }
  return { kind: SESSION_TOOL_KIND.READ_TRANSCRIPT, identity };
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
  const matchingProjects = context.workspaceProjects.filter(
    (candidate) =>
      (!providerId || candidate.providerId === providerId) &&
      (!projectId || candidate.providerProjectId === projectId) &&
      (!targetId || candidate.providerTargetId === targetId),
  );
  if (matchingProjects.length !== 1) {
    return {
      kind: "refused",
      reason:
        matchingProjects.length === 0
          ? "No listed project matches that identity."
          : "More than one listed project matches; name the project and host.",
    };
  }
  const project = matchingProjects[0];
  if (!project) return { kind: "refused", reason: "No listed project matches that identity." };
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
      kind: "refused",
      reason: agent
        ? "That project lists no such agent to start."
        : "Name one of the agents that project lists for a new workspace.",
    };
  }
  let name: string | undefined;
  if (parsed.name !== undefined) {
    name = workspaceNameText(parsed.name);
    if (!name) {
      return {
        kind: "refused",
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
      return { kind: "refused", reason: "That project takes no opening task." };
    }
    task = sessionMessageText(parsed.task);
    if (!task) {
      return {
        kind: "refused",
        reason: "That task is empty or too long.",
      };
    }
  } else if (project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
    return {
      kind: "refused",
      reason: "That project needs an opening task to create a workspace.",
    };
  }
  // A model named for this one creation resolves against the provider's own
  // documented table, and the effort only ever rides a model: alone it has
  // nothing documented to attach to.
  const spokenModel = textArgument(parsed, "model");
  const spokenEffort = textArgument(parsed, "effort");
  if (spokenEffort !== undefined && spokenModel === undefined) {
    return { kind: "refused", reason: "An effort rides a model; name the model too." };
  }
  let agentSelection: WorkspaceAgentSelection | undefined;
  if (spokenModel !== undefined) {
    const resolved = resolveWorkspaceAgentModel(
      context.agentModels(project.providerId),
      spokenModel,
      spokenEffort,
    );
    if ("refused" in resolved) return { kind: "refused", reason: resolved.refused };
    agentSelection = resolved.selection;
  }
  const action: SessionToolAction = {
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
  if ("kind" in found) return found;
  const { session, identity } = found;
  // The agent must be one this session's own roster entry listed: the list
  // is the provider's word for what its endpoint takes, so an ask outside it
  // is refused rather than forwarded to be refused.
  const agent = textArgument(parsed, "agent");
  if (!agent || !session.spawnableAgents.includes(agent)) {
    return { kind: "refused", reason: "That session lists no such agent to add." };
  }
  let name: string | undefined;
  if (parsed.name !== undefined) {
    name = workspaceNameText(parsed.name);
    if (!name) {
      return {
        kind: "refused",
        reason: `A session name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
      };
    }
  }
  let task: string | undefined;
  if (parsed.task !== undefined) {
    task = sessionMessageText(parsed.task);
    if (!task) {
      return {
        kind: "refused",
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
    return { kind: "refused", reason: "An effort rides a model; name the model too." };
  }
  let selection: WorkspaceAgentSelection | undefined;
  if (spokenModel !== undefined) {
    const entries = context
      .agentModels(session.providerId)
      .filter((candidate) => candidate.agent === agent);
    const resolved = resolveWorkspaceAgentModel(entries, spokenModel, spokenEffort);
    if ("refused" in resolved) {
      return {
        kind: "refused",
        reason: resolved.refused.startsWith("No documented model")
          ? `A ${agent} agent runs no model by that name.`
          : resolved.refused,
      };
    }
    selection = resolved.selection;
  }
  const action: SessionToolAction = {
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

function validateUpdateIssueState(parsed: WireRecord, context: IssueToolContext): IssueToolAction {
  const found = issueFromArguments(parsed, context.issues);
  if ("kind" in found) return found;
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
    return { kind: "refused", reason: "That issue lists no such state." };
  }
  return { kind: ISSUE_TOOL_KIND.ISSUE_STATE, identity, transition };
}

function validateCommentOnIssue(parsed: WireRecord, context: IssueToolContext): IssueToolAction {
  const found = issueFromArguments(parsed, context.issues);
  if ("kind" in found) return found;
  const { issue, identity } = found;
  if (!issue.canComment) {
    return { kind: "refused", reason: "That issue does not take comments." };
  }
  const body = issueCommentText(parsed.body);
  if (!body) {
    return {
      kind: "refused",
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
 * Validates a spoken session-list filter against the sessions actually being
 * observed. A filter that would show nothing is refused rather than applied:
 * the panel would quietly fall back to showing everything, and Luke would have
 * reported a narrowing that never happened. A workspace manager's scope id —
 * the one a session's workspace carries when an orchestrator owns it — is a
 * filter on the same terms as a provider id: the two share no namespace.
 */
function panelFilterAction(
  filter: string,
  sessions: readonly NormalizedSession[],
): { filter: string } | { reason: string } {
  if (filter === SESSION_LIST_ALL) return { filter };
  if (filter === SESSION_LOCATION.LOCAL || filter === SESSION_LOCATION.CLOUD) {
    if (sessions.some((session) => session.location === filter)) return { filter };
    return { reason: `No ${filter} sessions are observed right now.` };
  }
  if (filter === SESSION_LIST_VOICE) {
    if (sessions.some((session) => session.realtimeVoice === true)) return { filter };
    return { reason: "No voice sessions are observed right now." };
  }
  if (
    sessions.some(
      (session) => session.providerId === filter || session.workspace?.scopeId === filter,
    )
  ) {
    return { filter };
  }
  return { reason: "No observed session belongs to that provider or workspace manager." };
}

function validateChangeAppSetting(parsed: WireRecord, context: AppToolContext): AppToolAction {
  const setting = appGuideSetting(context.guide, textArgument(parsed, "setting_id"));
  if (!setting) {
    return { kind: "refused", reason: "The app guide lists no such setting." };
  }
  if (!setting.adjustable) {
    return {
      kind: "refused",
      reason: `${setting.label} can only be changed by hand: ${setting.manual}`,
    };
  }
  const value = appSettingValue(setting, parsed.value);
  if (value === undefined) {
    const accepted =
      setting.kind === APP_SETTING_KIND.TOGGLE ? "on or off" : (setting.choices ?? []).join(", ");
    return { kind: "refused", reason: `${setting.label} takes ${accepted}.` };
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
      kind: "refused",
      reason:
        setting.efforts === undefined
          ? `${setting.label} takes no effort level.`
          : `${value} takes no effort level.`,
    };
  }
  const normalizedEffort = effortWord.trim().toLowerCase();
  const effort = levels.find((candidate) => candidate.toLowerCase() === normalizedEffort);
  if (effort === undefined) {
    return { kind: "refused", reason: `${value}'s effort is one of ${levels.join(", ")}.` };
  }
  return { kind: APP_TOOL_KIND.SETTING, setting, value, effort };
}

function validateShowPanel(parsed: WireRecord, context: AppToolContext): AppToolAction {
  const tab = parsed.tab ?? APP_PANEL_TAB.SESSIONS;
  if (!isAppPanelTab(tab)) {
    return { kind: "refused", reason: "The panel has no such tab." };
  }
  const sort = textArgument(parsed, "sort");
  if (sort !== undefined && !isSessionListSort(sort)) {
    return { kind: "refused", reason: "The list orders by urgency or by recency." };
  }
  const filter = textArgument(parsed, "filter");
  if (filter === undefined) {
    const action: AppToolAction = { kind: APP_TOOL_KIND.PANEL, tab };
    if (sort !== undefined) action.sort = sort;
    return action;
  }
  const outcome = panelFilterAction(filter, context.sessions);
  if ("reason" in outcome) return { kind: "refused", reason: outcome.reason };
  const action: AppToolAction = {
    kind: APP_TOOL_KIND.PANEL,
    tab,
    filter: outcome.filter,
  };
  if (sort !== undefined) action.sort = sort;
  return action;
}

function validateOpenFeedbackComposer(parsed: WireRecord, _context: AppToolContext): AppToolAction {
  const composer = parsed.kind;
  if (!isFeedbackComposerKind(composer)) {
    return { kind: "refused", reason: "The composer writes feedback or a prompt, nothing else." };
  }
  // The draft is the developer's ask restated in their words, not a document,
  // so it is bounded like a typed one; a blank draft is no draft, and the
  // composer simply opens empty.
  const draft = textArgument(parsed, "draft")?.slice(0, maximumSessionMessageLength);
  const action: AppToolAction = { kind: APP_TOOL_KIND.FEEDBACK, composer };
  if (draft) action.draft = draft;
  return action;
}

/**
 * The acts Luke can carry, keyed the way a value set is: adding a tool is
 * adding a key, and the family sets, the spoken count, and the schema list
 * follow. Each row's `validate` is the renderer's half of the gauntlet — the
 * main process still validates the same act against what it observed.
 */
export const REALTIME_TOOLS = {
  SEND_SESSION_MESSAGE: {
    name: "send_session_message",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Send a message the developer just asked you to send to one observed session. " +
        "Only sessions the roster marks as taking messages can receive one.",
      parameters: {
        type: "object",
        properties: {
          ...SESSION_IDENTITY_PARAMETERS,
          text: {
            type: "string",
            description: "The message, in the developer's own words or their clear intent.",
          },
        },
        required: ["provider_id", "provider_session_id", "text"],
      },
    },
    validate: validateSendSessionMessage,
  },
  RUN_SESSION_CONTROL: {
    name: "run_session_control",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Run a control one observed session advertises, such as stopping its current run or " +
        "archiving the settled workspace around it. " +
        "Only controls the roster lists for that session exist.",
      parameters: {
        type: "object",
        properties: {
          ...SESSION_IDENTITY_PARAMETERS,
          control_id: {
            type: "string",
            description: "The control's id, exactly as the roster lists it in parentheses.",
          },
        },
        required: ["provider_id", "provider_session_id", "control_id"],
      },
    },
    validate: validateRunSessionControl,
  },
  OPEN_SESSION: {
    name: "open_session",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Open one observed session on the developer's screen, the same as pressing its row. " +
        "Only sessions the roster marks as able to be opened have somewhere to open.",
      parameters: {
        type: "object",
        properties: { ...SESSION_IDENTITY_PARAMETERS },
        required: ["provider_id", "provider_session_id"],
      },
    },
    validate: validateOpenSession,
  },
  REQUEST_SESSION_NOTICE: {
    name: "request_session_notice",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Keep the developer's ask to hear about one observed session later, in their own words " +
        "— told when it finishes, warned if it fails, whatever they asked. Luke's background " +
        "review speaks when an update satisfies it. One ask stands per session; a new one " +
        "replaces it.",
      parameters: {
        type: "object",
        properties: {
          ...SESSION_IDENTITY_PARAMETERS,
          request: {
            type: "string",
            description:
              "What the developer asked to hear about, in their own words or their clear intent.",
          },
        },
        required: ["provider_id", "provider_session_id", "request"],
      },
    },
    validate: validateRequestSessionNotice,
  },
  WITHDRAW_SESSION_NOTICE: {
    name: "withdraw_session_notice",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Let go of the standing ask kept for one observed session, when the developer no longer " +
        "wants to hear about it.",
      parameters: {
        type: "object",
        properties: { ...SESSION_IDENTITY_PARAMETERS },
        required: ["provider_id", "provider_session_id"],
      },
    },
    validate: validateWithdrawSessionNotice,
  },
  READ_SESSION_TRANSCRIPT: {
    name: "read_session_transcript",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Read the recent transcript of one observed local session, to answer what it has been " +
        "doing, what it said, or where it is stuck. Reading happens on this machine, performs " +
        "nothing, and reaches no provider.",
      parameters: {
        type: "object",
        properties: { ...SESSION_IDENTITY_PARAMETERS },
        required: ["provider_id", "provider_session_id"],
      },
    },
    validate: validateReadSessionTranscript,
  },
  CREATE_WORKSPACE: {
    name: "create_workspace",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Create a new workspace — a new agent — the developer just asked for, in one project " +
        "a provider listed. An ask for a new agent means this unless its own words name the " +
        "existing workspace or session the agent should join. Only projects the " +
        "[workspace projects] context lists exist.",
      parameters: {
        type: "object",
        properties: {
          provider_id: {
            type: "string",
            description: "The provider_id of the project, exactly as the projects list gives it.",
          },
          project_id: {
            type: "string",
            description: "The project_id, exactly as the projects list gives it.",
          },
          target_id: {
            type: "string",
            description:
              "The target_id of the host, exactly as the projects list gives it, when present.",
          },
          agent: {
            type: "string",
            description:
              "The agent kind to start, exactly as the projects list gives it; omit only when the list names a default.",
          },
          name: {
            type: "string",
            description:
              "A short name for the workspace, only when the developer chose one; " +
              "the provider names it otherwise.",
          },
          task: {
            type: "string",
            description:
              "What the developer asked the new agent to work on, in their own words or their " +
              "clear intent. Required where the projects list says a task is needed; omitted " +
              "where it says the project takes none.",
          },
          model: {
            type: "string",
            description:
              "The model for the new agent, exactly as the app guide's model setting lists it, " +
              "only when the developer named one for this creation; the settings decide otherwise.",
          },
          effort: {
            type: "string",
            description:
              "The effort level riding that model, exactly as the guide lists it, only when the " +
              "developer named both; never without a model.",
          },
        },
        required: [],
      },
    },
    validate: validateCreateWorkspace,
  },
  ADD_WORKSPACE_AGENT: {
    name: "add_workspace_agent",
    family: REALTIME_TOOL_FAMILY.SESSION,
    schema: {
      description:
        "Start another agent in the workspace one observed session runs in, only when the " +
        "developer's own words named that workspace or session; a bare ask for a new agent " +
        "creates a workspace instead. Only sessions whose roster entry lists new agents can " +
        "take one, only as an agent kind it lists.",
      parameters: {
        type: "object",
        properties: {
          ...SESSION_IDENTITY_PARAMETERS,
          agent: {
            type: "string",
            description: "The kind of agent, exactly as the roster lists it under new agents.",
          },
          name: {
            type: "string",
            description:
              "A short name for the new agent's session, only when the developer chose one.",
          },
          task: {
            type: "string",
            description:
              "What the developer asked the new agent to work on, in their own words or their " +
              "clear intent, when they gave it something to start on.",
          },
          model: {
            type: "string",
            description:
              "The model for the new agent, exactly as the app guide's model setting lists it, " +
              "only when the developer named one for this agent; the settings decide otherwise.",
          },
          effort: {
            type: "string",
            description:
              "The effort level riding that model, exactly as the guide lists it, only when the " +
              "developer named both; never without a model.",
          },
        },
        required: ["provider_id", "provider_session_id", "agent"],
      },
    },
    validate: validateAddWorkspaceAgent,
  },
  UPDATE_ISSUE_STATE: {
    name: "update_issue_state",
    family: REALTIME_TOOL_FAMILY.ISSUE,
    schema: {
      description:
        "Move one tracked issue to a state the developer just asked for. " +
        "Only issues the issue roster lists exist, and only the states it lists for one.",
      parameters: {
        type: "object",
        properties: {
          ...ISSUE_IDENTITY_PARAMETERS,
          state: {
            type: "string",
            description: "The target state's name, exactly as the issue roster lists it.",
          },
        },
        required: ["tracker_id", "issue_id", "state"],
      },
    },
    validate: validateUpdateIssueState,
  },
  COMMENT_ON_ISSUE: {
    name: "comment_on_issue",
    family: REALTIME_TOOL_FAMILY.ISSUE,
    schema: {
      description:
        "Add a comment the developer just asked you to add to one tracked issue. " +
        "Only issues the issue roster marks as taking comments can receive one.",
      parameters: {
        type: "object",
        properties: {
          ...ISSUE_IDENTITY_PARAMETERS,
          body: {
            type: "string",
            description: "The comment, in the developer's own words or their clear intent.",
          },
        },
        required: ["tracker_id", "issue_id", "body"],
      },
    },
    validate: validateCommentOnIssue,
  },
  CHANGE_APP_SETTING: {
    name: "change_app_setting",
    family: REALTIME_TOOL_FAMILY.APP,
    schema: {
      description:
        "Change one of Luke's own settings the developer just asked for. " +
        "Only settings the app guide marks as changeable by voice can be changed.",
      parameters: {
        type: "object",
        properties: {
          setting_id: {
            type: "string",
            description: "The setting_id, exactly as the app guide lists it.",
          },
          value: {
            type: "string",
            description:
              "The new value: on or off for a switch, or one of the choices the guide lists.",
          },
          effort: {
            type: "string",
            description:
              "The effort level riding the new value, only when the developer named both and " +
              "the guide lists levels for that choice — a model and its effort are one change, " +
              "not two; never on any other setting.",
          },
        },
        required: ["setting_id", "value"],
      },
    },
    validate: validateChangeAppSetting,
  },
  SHOW_PANEL: {
    name: "show_panel",
    family: REALTIME_TOOL_FAMILY.APP,
    schema: {
      description:
        "Show Luke's own panel on the developer's screen, the same as pressing the capsule — or, " +
        "when the panel is already open, switch it to the named tab, the same as pressing that tab. " +
        "It can open the sessions list — narrowed to one provider or location, ordered by urgency or recency — or the settings tab.",
      parameters: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            enum: Object.values(APP_PANEL_TAB),
            description: "Which tab to open or switch to. Defaults to sessions.",
          },
          filter: {
            type: "string",
            description:
              "Narrows the session list: all, local, cloud, voice for realtime voice chats, " +
              "the provider_id of one observed provider, or superset for the sessions whose " +
              "workspaces Superset manages. Only meaningful on the sessions tab.",
          },
          sort: {
            type: "string",
            enum: Object.values(SESSION_LIST_SORT),
            description:
              "Reorders the session list: urgency puts what needs the developer first, recency puts what moved last first. Only meaningful on the sessions tab.",
          },
        },
        required: [],
      },
    },
    validate: validateShowPanel,
  },
  OPEN_FEEDBACK_COMPOSER: {
    name: "open_feedback_composer",
    family: REALTIME_TOOL_FAMILY.APP,
    schema: {
      description:
        "Open the composer for a note the developer sends the founders by hand. " +
        "It opens and may draft; it never sends — the developer edits and presses Send themselves.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: Object.values(FEEDBACK_COMPOSER_KIND),
            description:
              "What the note is: feedback about Luke, or a prompt for the founders. A refused ask offered onward is a prompt.",
          },
          draft: {
            type: "string",
            description:
              "Optional starting text: the developer's own ask, in their words. Never words they did not say.",
          },
        },
        required: ["kind"],
      },
    },
    validate: validateOpenFeedbackComposer,
  },
} as const satisfies Record<string, RealtimeToolSpec>;

function namesFromToolTable<T extends Record<string, { readonly name: string }>>(table: T) {
  // SAFETY: keys are drawn from the same table object; each entry's name field is the tool id.
  const names = {} as { [K in keyof T]: T[K]["name"] };
  // SAFETY: Object.keys returns string[]; every key exists on table because keys are table's own keys.
  for (const key of Object.keys(table) as (keyof T & string)[]) {
    const tool = table[key];
    if (tool) names[key] = tool.name;
  }
  return names;
}

export const REALTIME_TOOL = namesFromToolTable(REALTIME_TOOLS);

export type RealtimeToolName = (typeof REALTIME_TOOL)[keyof typeof REALTIME_TOOL];

const REALTIME_TOOL_LIST: readonly RealtimeToolSpec[] = Object.values(REALTIME_TOOLS);

const REALTIME_TOOLS_BY_NAME = new Map<string, RealtimeToolSpec>(
  REALTIME_TOOL_LIST.map((tool) => [tool.name, tool]),
);

function toolNamesOfFamily(family: RealtimeToolFamily): ReadonlySet<string> {
  return new Set(
    REALTIME_TOOL_LIST.filter((tool) => tool.family === family).map((tool) => tool.name),
  );
}

const SESSION_TOOL_NAMES = toolNamesOfFamily(REALTIME_TOOL_FAMILY.SESSION);
const ISSUE_TOOL_NAMES = toolNamesOfFamily(REALTIME_TOOL_FAMILY.ISSUE);
const APP_TOOL_NAMES = toolNamesOfFamily(REALTIME_TOOL_FAMILY.APP);

/** Whether a tool call names one of the session acts. */
export function isSessionToolName(name: string): boolean {
  return SESSION_TOOL_NAMES.has(name);
}

/** Whether a tool call names one of the issue acts. */
export function isIssueToolName(name: string): boolean {
  return ISSUE_TOOL_NAMES.has(name);
}

/** Whether a tool call is about the app itself rather than about a session. */
export function isAppToolCall(call: RealtimeFunctionCall): boolean {
  return APP_TOOL_NAMES.has(call.name);
}

/** The family a named tool belongs to, or nothing when no such tool exists. */
export function realtimeToolFamily(name: string): RealtimeToolFamily | undefined {
  return REALTIME_TOOLS_BY_NAME.get(name)?.family;
}

const SPOKEN_CARDINAL = {
  0: "zero",
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
} as const;

/** How many tools Luke has, as he says it in the standing instructions. */
export function spokenRealtimeToolCount(): string {
  const count = REALTIME_TOOL_LIST.length;
  // SAFETY: count is a small cardinal; SPOKEN_CARDINAL keys are the documented spoken counts.
  return SPOKEN_CARDINAL[count as keyof typeof SPOKEN_CARDINAL] ?? String(count);
}

/** The tool schemas a Realtime session is configured with. */
export function realtimeToolDefinitions(): readonly RealtimeToolWireDefinition[] {
  return REALTIME_TOOL_LIST.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.schema.description,
    parameters: tool.schema.parameters,
  }));
}

/**
 * Validates one tool call against the sessions actually being observed. This
 * is the renderer's half of the gauntlet — the main process re-validates
 * against its registry — and it exists so a call the model composed can only
 * name a session Luke was shown, doing something that session advertised.
 * Everything else is refused with a reason Luke can say aloud.
 */
export function sessionToolAction(
  call: RealtimeFunctionCall,
  sessions: readonly NormalizedSession[],
  workspaceProjects: readonly ObservedWorkspaceProject[] = [],
  // The models a creation ask may name, per provider — the app's own
  // build-documented tables, handed in so this stays brand-neutral. The
  // default offers none, so an ask that names a model is refused rather than
  // forwarded unchecked.
  agentModels: (providerId: string) => readonly WorkspaceAgentModels[] = () => [],
): SessionToolAction {
  const parsed = parseToolArguments(call);
  if (!parsed.ok) return { kind: "refused", reason: parsed.reason };
  const tool = REALTIME_TOOLS_BY_NAME.get(call.name);
  if (!tool || tool.family !== REALTIME_TOOL_FAMILY.SESSION) {
    return { kind: "refused", reason: "No such tool exists." };
  }
  return tool.validate(parsed.value, { sessions, workspaceProjects, agentModels });
}

/**
 * Validates one issue tool call against the issues actually observed. The
 * renderer's half of the same gauntlet the session tools run — the main
 * process re-validates against what it observed — so a call the model
 * composed can only name an issue Luke was shown, going somewhere its
 * tracker advertised. Everything else is refused with a reason Luke can say
 * aloud.
 */
export function issueToolAction(
  call: RealtimeFunctionCall,
  issues: readonly TrackedIssue[],
): IssueToolAction {
  const parsed = parseToolArguments(call);
  if (!parsed.ok) return { kind: "refused", reason: parsed.reason };
  const tool = REALTIME_TOOLS_BY_NAME.get(call.name);
  if (!tool || tool.family !== REALTIME_TOOL_FAMILY.ISSUE) {
    return { kind: "refused", reason: "No such tool exists." };
  }
  return tool.validate(parsed.value, { issues });
}

/**
 * Validates one app tool call against the guide the app actually provided and
 * the sessions actually observed. The same posture as {@link sessionToolAction}:
 * a call the model composed can only name a setting the guide lists, changing
 * it to a value the guide accepts, a panel view the roster can fill, or the
 * composer on one of its own two kinds — and a setting the guide marks as
 * by-hand-only is refused with the path to it, so the refusal Luke voices is
 * itself the guidance.
 */
export function appToolAction(
  call: RealtimeFunctionCall,
  guide: AppGuideSnapshot,
  sessions: readonly NormalizedSession[],
): AppToolAction {
  const parsed = parseToolArguments(call);
  if (!parsed.ok) return { kind: "refused", reason: parsed.reason };
  const tool = REALTIME_TOOLS_BY_NAME.get(call.name);
  if (!tool || tool.family !== REALTIME_TOOL_FAMILY.APP) {
    return { kind: "refused", reason: "No such tool exists." };
  }
  return tool.validate(parsed.value, { guide, sessions });
}

/**
 * Picks the handler for a discriminated `kind`. The map is exhaustive over
 * the union, so a new kind does not compile until its handler is written.
 */
export function dispatchByKind<
  T extends { kind: string },
  R,
  M extends { [K in T["kind"]]: (action: Extract<T, { kind: K }>) => R },
>(action: T, handlers: M): R {
  const kind = action.kind;
  // SAFETY: action.kind is T["kind"]; M is keyed by every member of that union.
  const handle = handlers[kind as T["kind"]];
  // SAFETY: M is keyed by T["kind"]; kind selects the handler that accepts this action shape.
  return handle(action as Extract<T, { kind: typeof kind }>);
}
