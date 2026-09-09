/**
 * The one gauntlet an act runs, and the only place a {@link ValidatedAct}
 * comes from. In order: the guard (the turn that asked still stands), the
 * roster (a fresh read of its own, and the target has to be one it holds), the
 * advertisement (the advertised entry itself becomes what the act carries — a
 * control, an agent kind, a rename target, a listed project — so nothing a
 * caller sent can redirect the effect), then the bounds (the developer's own
 * text, refused rather than cut). The guard is asked again after every await,
 * so an act whose turn ended while the roster was refreshing refuses rather
 * than dispatching.
 *
 * Admission decides only whether an act may run. Which acts a conversation may
 * ask for at all was the effective tool policy's decision before a call left
 * the model, and who opened the turn is recorded on what admission mints and
 * consulted as a permission by nothing.
 */

import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  APP_UPDATE_ACT,
  APP_UPDATE_WAIT,
  type AppGuideSetting,
  type AppGuideSnapshot,
  type AppGuideUpdate,
  appGuideSetting,
  appToggleValue,
  EMPTY_APP_GUIDE,
} from "@sidecar/guide";
import type { IssueIdentity, TrackedIssue } from "@sidecar/issues";
import type { RunOrigin } from "@sidecar/runtime-contracts";
import {
  advertisedActFor,
  advertisedControl,
  isSessionApplicationId,
  matchesFilterSelection,
  maximumSessionMessageLength,
  maximumWorkspaceNameLength,
  type ObservedWorkspaceProject,
  SESSION_LOCATION,
  type Session,
  type SessionIdentity,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceAgentSelection,
  workspaceProjectSelectionId,
} from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  type Admitted,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  text as wireText,
} from "@sidecar/wire";
import {
  ACT_KIND,
  type ActKind,
  type ActPayloads,
  type ActRequest,
  type CarriedAct,
  SESSION_LIST_ALL,
  SESSION_LIST_VOICE,
} from "./act-kinds.js";
import {
  COMMENT_BODY,
  FEEDBACK_KIND,
  ISSUE_IDENTITY_FIELDS,
  MESSAGE_TEXT,
  OPENING_TASK,
  PANEL_FILTERS,
  PANEL_SORT,
  PANEL_TAB,
  SESSION_IDENTITY_FIELDS,
  SESSION_LIST_FILTER_VALUES,
  UPDATE_ACT,
  WORKSPACE_NAME,
} from "./act-schemas.js";
import {
  holdsRememberedFact,
  maximumRememberedFactLength,
  maximumRememberedFacts,
  type RememberedFact,
  rememberedFactText,
} from "./memory.js";

/**
 * An act that ran the gauntlet, carrying the turn's origin for History to
 * record. The brand is `@sidecar/wire`'s, whose key nothing anywhere can spell,
 * and {@link admit} below is the one place in the repository that enters the
 * admitted set: everything downstream re-shapes what it already holds. What the
 * brand buys is that admission cannot be skipped by accident; a deliberate
 * `as ValidatedAct` would still compile, since the admitted act is a subtype of
 * its own payload, and that assertion appears nowhere but in `admit` itself —
 * `validated-act.type-test.ts` says both in as many words.
 */
export type ValidatedAct<Kind extends ActKind = ActKind> = Admitted<CarriedAct<Kind>> & {
  /** Who opened the turn; recorded, never a permission. */
  readonly origin: RunOrigin;
};

/** Whether the turn an act belongs to still stands, asked again after every await. */
export interface ActGuard {
  isRevoked(): boolean;
  /** Fires on revocation, so a read awaited before the effect settles at once rather than finishing first. */
  readonly signal?: AbortSignal;
}

/**
 * The roster as admission reads it, and never as a caller hands it: `read`
 * answers what the latest observation saw, so the fresh-roster step is
 * admission's own rather than each intake's promise.
 */
export interface ActRoster {
  read(): Promise<readonly Session[]>;
}

/** The projects a creation ask may land in, read the same way and from the same pass. */
export interface ActProjects {
  read(): Promise<readonly ObservedWorkspaceProject[]>;
  /**
   * The developer's saved tie-breaks, which only ever narrow within what
   * `read` returned: a default can settle an ambiguous ask, never widen where
   * one can land or override a provider or project the ask actually named.
   */
  defaults(): Promise<{
    defaultProviderId?: string;
    defaultProjectIds?: Readonly<Partial<Record<string, string>>>;
  }>;
  /** The models a creation or a spawn may name, per provider, as the build documents them. */
  agentModels(providerId: string): readonly WorkspaceAgentModels[];
}

export interface AdmitContext {
  /**
   * Who opened the turn this act belongs to. Recorded on what admission mints
   * and never consulted as a permission: a developer's ask and a heartbeat's
   * turn run exactly the same admission.
   */
  readonly origin: RunOrigin;
  /** Absent for a row's own press, which opens its turn and its effect in the same breath. */
  readonly guard?: ActGuard;
  readonly roster: ActRoster;
  /** Absent in a run that offers none, which then admits no creation. */
  readonly projects?: ActProjects;
  /** The app's own word about itself; absent in a run that reports none, which then admits no app act. */
  readonly guide?: AppGuideSnapshot;
  /** Absent when no tracker is connected, which then admits no issue act. */
  readonly issues?: readonly TrackedIssue[];
  /** The facts standing right now; an id the conversation never saw names nothing. */
  readonly rememberedFacts?: readonly RememberedFact[];
}

/**
 * Why an act was not admitted, in words Luke can say aloud. What rides beside
 * a reason is only ever what the roster the caller already read already told
 * them — the controls a session does advertise, the efforts a model does
 * take — so a refusal is also the correction and never a disclosure.
 */
export const ACT_REFUSAL = {
  UNREADABLE: "The tool call's arguments were not readable.",
  NO_TOOL: "No such tool exists.",
  TURN_OVER: "Not run: the turn that asked for this act ended before it could start.",
  NO_SESSION: "No observed session matches that identity.",
  NO_MESSAGES: "That session does not take messages right now.",
  MESSAGE_BOUND: "That message is empty or too long.",
  NO_CONTROL: "That session advertises no such control.",
  NO_ADDRESS: "That session has no address to open.",
  NO_APP_ADDRESS: "No app carries an exact address for that session.",
  NO_PROJECT: "No listed project matches that identity.",
  MANY_PROJECTS: "More than one listed project matches; name the project and host.",
  NO_PROJECT_AGENT: "That project lists no such agent to start.",
  NAME_A_PROJECT_AGENT: "Name one of the agents that project lists for a new workspace.",
  PROJECT_NAMES_ITSELF: "That project names its own workspaces.",
  NO_SESSION_AGENT: "That session lists no such agent to add.",
  WORKSPACE_NAME_BOUND: `A workspace name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
  SESSION_NAME_BOUND: `A session name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
  CHAT_NAME_BOUND: `A chat name has to be under ${maximumWorkspaceNameLength} characters and longer than nothing.`,
  NO_WORKSPACE_RENAME: "That session's workspace cannot be renamed.",
  NO_SESSION_RENAME: "That chat cannot be renamed.",
  TASK_BOUND: "That task is empty or too long.",
  NO_TASK_TAKEN: "That project takes no opening task.",
  TASK_REQUIRED: "That project needs an opening task to create a workspace.",
  NO_MODEL: "No documented model goes by that name here.",
  NO_EFFORT_LEVEL: "That model takes no effort level.",
  EFFORT_NEEDS_MODEL: "An effort rides a model; name the model too.",
  NO_ISSUE: "No tracked issue matches that identity.",
  NO_ISSUE_STATE: "That issue lists no such state.",
  NO_COMMENTS: "That issue does not take comments.",
  COMMENT_BOUND: "That comment is empty or too long.",
  NO_SETTING: "The app guide lists no such setting.",
  NO_TAB: "The panel has no such tab.",
  NO_SORT: "The list orders by urgency or by recency.",
  NO_SEARCH: "The list offers a search only when more than one session is observed.",
  FILTERS_SHAPE: "filters takes a list of filter values.",
  ALL_STANDS_ALONE: `${SESSION_LIST_ALL} is the whole list, so it combines with nothing.`,
  NO_FILTER_MATCH: "No observed session matches that combination of filters.",
  NO_VOICE_SESSIONS: "No voice sessions are observed right now.",
  NO_COMPOSER: "The composer writes feedback or a prompt, nothing else.",
  NO_UPDATE_REPORT: "This run does not report where updates stand.",
  NO_UPDATE_ACT: "The Updates button checks, downloads, or restarts.",
  NO_SUCH_FACT: "Nothing remembered goes by that id.",
  MEMORY_BOUND: `A memory has to be under ${maximumRememberedFactLength} characters and longer than nothing.`,
  MEMORY_FULL: `Luke already remembers ${maximumRememberedFacts} things; replace or forget one first.`,
  NO_TRACKER: "No issue tracker is connected.",
} as const;

export type ActRefusalReason = (typeof ACT_REFUSAL)[keyof typeof ACT_REFUSAL];

/** Why an act was not admitted. Disjoint from every carried act, by `kind`. */
export interface Refusal {
  readonly status: typeof ACT_RESULT_STATUS.REJECTED;
  readonly reason: string;
  readonly kind?: never;
}

function refuse(reason: string): Refusal {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}

/**
 * A read awaited before an effect, held only as long as the guard's standing:
 * once the signal fires the wait answers nothing, and the `isRevoked` check
 * that follows every such read refuses the act before anything is dispatched.
 * A guard with no signal — a row's own press — waits the read out.
 */
export function guardedRead<T>(
  read: Promise<T>,
  guard: ActGuard | undefined,
): Promise<T | undefined> {
  const signal = guard?.signal;
  if (!signal) return read;
  return new Promise<T | undefined>((resolve, reject) => {
    let decided = false;
    const settle = () => {
      if (decided) return false;
      decided = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    function onAbort() {
      if (settle()) resolve(undefined);
    }
    if (signal.aborted) {
      onAbort();
      // The read still runs; its value and any failure are nobody's once the
      // abort has answered, so neither is left to surface unhandled.
      void read.catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    void (async () => {
      try {
        const value = await read;
        if (settle()) resolve(value);
      } catch (failure) {
        // A failure after the abort answered belongs to nobody, and is dropped
        // rather than surfacing as an unhandled rejection.
        if (settle()) reject(failure instanceof Error ? failure : new Error(String(failure)));
      }
    })();
  });
}

/**
 * The reads one admission makes, each made at most once and each held only as
 * long as the guard's standing. `undefined` means the turn ended mid-read, and
 * the admitter that asked refuses rather than deciding on a half-read picture.
 */
interface AdmittedReads {
  sessions(): Promise<readonly Session[] | undefined>;
  projects(): Promise<readonly ObservedWorkspaceProject[] | undefined>;
  defaults(): Promise<
    | { defaultProviderId?: string; defaultProjectIds?: Readonly<Partial<Record<string, string>>> }
    | undefined
  >;
}

function admittedReads(context: AdmitContext): AdmittedReads {
  const once = <T>(read: () => Promise<T>): (() => Promise<T | undefined>) => {
    let pending: Promise<T | undefined> | undefined;
    return () => {
      pending ??= (async () => {
        if (context.guard?.isRevoked()) return undefined;
        const value = await guardedRead(read(), context.guard);
        return context.guard?.isRevoked() ? undefined : value;
      })();
      return pending;
    };
  };
  const projects = context.projects;
  return {
    sessions: once(() => context.roster.read()),
    projects: once(async () => (projects ? projects.read() : [])),
    defaults: once(async () => (projects ? projects.defaults() : {})),
  };
}

function textArgument(fields: WireRecord, key: string): string | undefined {
  return wireText(fields[key]);
}

function sessionFrom(
  fields: WireRecord,
  sessions: readonly Session[],
): { session: Session; identity: SessionIdentity } | Refusal {
  const providerId = SESSION_IDENTITY_FIELDS.provider_id.parse(fields.provider_id);
  const providerSessionId = SESSION_IDENTITY_FIELDS.provider_session_id.parse(
    fields.provider_session_id,
  );
  const session = sessions.find(
    (candidate) =>
      candidate.providerId === providerId && candidate.providerSessionId === providerSessionId,
  );
  if (!session) return refuse(ACT_REFUSAL.NO_SESSION);
  return {
    session,
    identity: {
      providerId: session.providerId,
      providerSessionId: session.providerSessionId,
    },
  };
}

function issueFrom(
  fields: WireRecord,
  issues: readonly TrackedIssue[],
): { issue: TrackedIssue; identity: IssueIdentity } | Refusal {
  const trackerId = ISSUE_IDENTITY_FIELDS.tracker_id.parse(fields.tracker_id);
  const issueId = ISSUE_IDENTITY_FIELDS.issue_id.parse(fields.issue_id);
  const issue = issues.find(
    (candidate) => candidate.trackerId === trackerId && candidate.identifier === issueId,
  );
  if (!issue) return refuse(ACT_REFUSAL.NO_ISSUE);
  return { issue, identity: { trackerId: issue.trackerId, identifier: issue.identifier } };
}

/**
 * The one entry a spoken name picks out. Spoken names arrive with their case
 * retold rather than copied, so the match forgives case alone — never
 * spelling — and only while it stays unambiguous: two advertised entries apart
 * only in case are not a guess Luke gets to make.
 */
function namedOnce<Entry>(
  entries: readonly Entry[],
  word: string,
  nameOf: (entry: Entry) => string,
  fold: (name: string) => string,
): Entry | undefined {
  const folded = fold(word);
  const named = entries.filter((candidate) => fold(nameOf(candidate)) === folded);
  return (
    named.find((candidate) => nameOf(candidate) === word) ??
    (named.length === 1 ? named[0] : undefined)
  );
}

/**
 * Resolves a model the developer named — by the label the guide lists it
 * under, or its id — to the wire pairing an endpoint takes, held to the
 * build's documented entries for the provider. The effort, when named, must be
 * one the resolved model's own agent documents: the pairing is validated as
 * the whole it will be sent as.
 */
function resolveWorkspaceAgentModel(
  entries: readonly WorkspaceAgentModels[],
  modelWord: string,
  effortWord: string | undefined,
): { selection: WorkspaceAgentSelection } | { refusal: Refusal; unnamedModel: boolean } {
  const normalizedModel = modelWord.trim().toLowerCase();
  const named = entries
    .flatMap((entry) => entry.models.map((model) => ({ entry, model })))
    .find(
      ({ model }) =>
        model.label.toLowerCase() === normalizedModel || model.id.toLowerCase() === normalizedModel,
    );
  if (!named) return { refusal: refuse(ACT_REFUSAL.NO_MODEL), unnamedModel: true };
  let effort: string | undefined;
  if (effortWord !== undefined) {
    const normalizedEffort = effortWord.trim().toLowerCase();
    effort = named.entry.efforts.find((candidate) => candidate.toLowerCase() === normalizedEffort);
    if (!effort) {
      return {
        unnamedModel: false,
        refusal:
          named.entry.efforts.length > 0
            ? refuse(`That model's effort is one of ${named.entry.efforts.join(", ")}.`)
            : refuse(ACT_REFUSAL.NO_EFFORT_LEVEL),
      };
    }
  }
  const selection: WorkspaceAgentSelection = { agent: named.entry.agent, model: named.model.id };
  if (effort) selection.effort = effort;
  return { selection };
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
 * Whether one observed session answers one spoken filter value. Every identity
 * a row carries is a filter on the same terms as its provider id — the agent
 * behind a hosted chat, an app associated with it, and a workspace manager's
 * scope id — so a spoken ask reaches exactly the rows the matching chip would
 * keep.
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
 * Admits a spoken session-list narrowing against the sessions actually being
 * observed. A narrowing that would show nothing is refused rather than
 * applied: the panel would quietly fall back to showing everything, and Luke
 * would have reported a narrowing that never happened. Each value is checked
 * on its own first, so the refusal can name the value that is wrong rather
 * than only the combination — and then the combination is checked whole, on
 * the same axis terms the chips combine on, because two values a roster
 * answers separately can still name an intersection nothing occupies.
 */
function admittedFilters(
  filters: readonly string[],
  sessions: readonly Session[],
): { filters: readonly string[] } | Refusal {
  // The enum on the tool's own schema already binds a compliant model to these
  // tokens; this is the backstop for a call composed past it.
  for (const filter of filters) {
    if (!SESSION_LIST_FILTER_VALUES.includes(filter)) {
      return refuse(`"${filter}" is not one of the filter values the tool lists.`);
    }
  }
  const chosen = [...new Set(filters)];
  if (chosen.includes(SESSION_LIST_ALL)) {
    if (chosen.length > 1) return refuse(ACT_REFUSAL.ALL_STANDS_ALONE);
    return { filters: chosen };
  }
  for (const filter of chosen) {
    if (sessions.some((session) => sessionAnswersFilter(session, filter))) continue;
    if (filter === SESSION_LOCATION.LOCAL || filter === SESSION_LOCATION.CLOUD) {
      return refuse(`No ${filter} sessions are observed right now.`);
    }
    if (filter === SESSION_LIST_VOICE) return refuse(ACT_REFUSAL.NO_VOICE_SESSIONS);
    return refuse(
      `No observed session belongs to an agent, app, or workspace manager "${filter}".`,
    );
  }
  if (
    chosen.length > 1 &&
    !sessions.some((session) =>
      matchesFilterSelection(chosen, (filter) => sessionAnswersFilter(session, filter)),
    )
  ) {
    return refuse(ACT_REFUSAL.NO_FILTER_MATCH);
  }
  return { filters: chosen };
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

type AdmittedPayload<Kind extends ActKind> = ({ kind: Kind } & ActPayloads[Kind]) | Refusal;

type Admitter<Kind extends ActKind> = (
  fields: WireRecord,
  context: AdmitContext,
  reads: AdmittedReads,
) => Promise<AdmittedPayload<Kind>> | AdmittedPayload<Kind>;

async function admittedSession(
  fields: WireRecord,
  reads: AdmittedReads,
): Promise<{ session: Session; identity: SessionIdentity } | Refusal> {
  const sessions = await reads.sessions();
  if (!sessions) return refuse(ACT_REFUSAL.TURN_OVER);
  return sessionFrom(fields, sessions);
}

const admitMessage: Admitter<typeof ACT_KIND.MESSAGE> = async (fields, _context, reads) => {
  const found = await admittedSession(fields, reads);
  if ("status" in found) return found;
  if (!advertisedActFor(found.session, ACT_KIND.MESSAGE)) {
    return refuse(ACT_REFUSAL.NO_MESSAGES);
  }
  const text = MESSAGE_TEXT.parse(fields.text);
  if (!text) return refuse(ACT_REFUSAL.MESSAGE_BOUND);
  return { kind: ACT_KIND.MESSAGE, identity: found.identity, text };
};

const admitControl: Admitter<typeof ACT_KIND.CONTROL> = async (fields, _context, reads) => {
  const found = await admittedSession(fields, reads);
  if ("status" in found) return found;
  const controlId = textArgument(fields, "control_id");
  // The advertised control itself is what the act carries: the caller's copy
  // names which one, and never what the effect is built from.
  const control = controlId ? advertisedControl(found.session, controlId) : undefined;
  if (!control) return refuse(ACT_REFUSAL.NO_CONTROL);
  return { kind: ACT_KIND.CONTROL, identity: found.identity, control };
};

const admitOpen: Admitter<typeof ACT_KIND.OPEN> = async (fields, _context, reads) => {
  const found = await admittedSession(fields, reads);
  if ("status" in found) return found;
  const { session, identity } = found;
  // The act carries the identity — and, when the developer named an app, that
  // app's id — never the address: the address is read back out of the roster
  // by whoever performs the open, the same as a pressed row or a pressed app mark.
  const applicationWord = textArgument(fields, "application");
  if (applicationWord !== undefined) {
    const normalized = applicationWord.trim().toLowerCase();
    const application = session.applications.find(
      (candidate) =>
        candidate.displayName.toLowerCase() === normalized || candidate.id === normalized,
    );
    // An association without an exact address identifies the app but opens
    // nothing, so it refuses like an app the roster never listed — and the
    // refusal names the apps that can open, which the roster already carries.
    // The id must be one the build fixed: the bridge takes no other.
    const applicationId = application?.link ? application.id : undefined;
    if (applicationId === undefined || !isSessionApplicationId(applicationId)) {
      const openable = session.applications.filter((candidate) => candidate.link);
      return openable.length > 0
        ? refuse(
            `That session opens in ${openable
              .map((candidate) => candidate.displayName)
              .join(" or ")}, not there.`,
          )
        : refuse(ACT_REFUSAL.NO_APP_ADDRESS);
    }
    return { kind: ACT_KIND.OPEN, identity, applicationId };
  }
  if (!session.detail.link) return refuse(ACT_REFUSAL.NO_ADDRESS);
  return { kind: ACT_KIND.OPEN, identity };
};

const admitCreateWorkspace: Admitter<typeof ACT_KIND.CREATE_WORKSPACE> = async (
  fields,
  context,
  reads,
) => {
  // A creation ask names a project rather than a session, so it is admitted
  // against the projects the conversation was shown — the same discipline,
  // against the list that actually offered it.
  const listed = await reads.projects();
  const saved = await reads.defaults();
  if (!listed || !saved) return refuse(ACT_REFUSAL.TURN_OVER);
  const providerId = textArgument(fields, "provider_id");
  const projectId = textArgument(fields, "project_id");
  const targetId = textArgument(fields, "target_id");
  let matchingProjects = listed.filter(
    (candidate) =>
      (!providerId || candidate.providerId === providerId) &&
      (!projectId || candidate.providerProjectId === projectId) &&
      (!targetId || candidate.providerTargetId === targetId),
  );
  // The saved defaults settle only what the ask left unnamed: no provider
  // named sends a still-ambiguous ask to the default provider while it is
  // offering, and no project named sends it on to that provider's chosen
  // project. Neither step can leave the listed set, and an ask that named its
  // own provider or project is never overridden.
  if (!providerId && saved.defaultProviderId && matchingProjects.length > 1) {
    const offeredByDefault = matchingProjects.filter(
      (candidate) => candidate.providerId === saved.defaultProviderId,
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
        saved.defaultProjectIds?.[candidate.providerId] === workspaceProjectSelectionId(candidate),
    );
    if (chosenProjects.length === 1) matchingProjects = chosenProjects;
  }
  const [project] = matchingProjects;
  if (matchingProjects.length !== 1 || project === undefined) {
    return refuse(matchingProjects.length > 1 ? ACT_REFUSAL.MANY_PROJECTS : ACT_REFUSAL.NO_PROJECT);
  }
  const requestedAgent = textArgument(fields, "agent");
  const spawnable = project.spawnableAgents;
  const agent =
    (spawnable === undefined || requestedAgent === undefined
      ? undefined
      : namedOnce(
          spawnable,
          requestedAgent,
          (agentKind) => agentKind,
          (name) => name.toLocaleLowerCase(),
        )) ?? project.defaultAgent;
  if (spawnable && (!agent || !spawnable.includes(agent))) {
    return refuse(agent ? ACT_REFUSAL.NO_PROJECT_AGENT : ACT_REFUSAL.NAME_A_PROJECT_AGENT);
  }
  let name: string | undefined;
  if (fields.name !== undefined) {
    if (project.namesItself) return refuse(ACT_REFUSAL.PROJECT_NAMES_ITSELF);
    name = WORKSPACE_NAME.parse(fields.name);
    if (!name) return refuse(ACT_REFUSAL.WORKSPACE_NAME_BOUND);
  }
  // The task is held to the project's own word for it: a project that takes
  // none cannot be handed one, a project that needs one cannot be created
  // without it, and the text itself is bounded like the message it is.
  let task: string | undefined;
  if (fields.task !== undefined) {
    if (project.taskSupport === WORKSPACE_TASK_SUPPORT.NONE) {
      return refuse(ACT_REFUSAL.NO_TASK_TAKEN);
    }
    task = OPENING_TASK.parse(fields.task);
    if (!task) return refuse(ACT_REFUSAL.TASK_BOUND);
  } else if (project.taskSupport === WORKSPACE_TASK_SUPPORT.REQUIRED) {
    return refuse(ACT_REFUSAL.TASK_REQUIRED);
  }
  // A model named for this one creation resolves against the provider's own
  // documented table, and the effort only ever rides a model: alone it has
  // nothing documented to attach to.
  const spokenModel = textArgument(fields, "model");
  const spokenEffort = textArgument(fields, "effort");
  if (spokenEffort !== undefined && spokenModel === undefined) {
    return refuse(ACT_REFUSAL.EFFORT_NEEDS_MODEL);
  }
  let agentSelection: WorkspaceAgentSelection | undefined;
  if (spokenModel !== undefined) {
    const resolved = resolveWorkspaceAgentModel(
      context.projects?.agentModels(project.providerId) ?? [],
      spokenModel,
      spokenEffort,
    );
    if ("refusal" in resolved) return resolved.refusal;
    agentSelection = resolved.selection;
  }
  const act: {
    kind: typeof ACT_KIND.CREATE_WORKSPACE;
  } & ActPayloads[typeof ACT_KIND.CREATE_WORKSPACE] = {
    kind: ACT_KIND.CREATE_WORKSPACE,
    providerId: project.providerId,
    providerProjectId: project.providerProjectId,
  };
  if (project.providerTargetId) act.providerTargetId = project.providerTargetId;
  if (agent) act.agent = agent;
  if (name) act.name = name;
  if (task) act.task = task;
  if (agentSelection) act.agentSelection = agentSelection;
  return act;
};

const admitAddAgent: Admitter<typeof ACT_KIND.ADD_AGENT> = async (fields, context, reads) => {
  const found = await admittedSession(fields, reads);
  if ("status" in found) return found;
  const { session, identity } = found;
  // The agent must be one this session's own roster entry listed: the list is
  // the provider's word for what its endpoint takes, so an ask outside it is
  // refused rather than forwarded to be refused.
  const asked = textArgument(fields, "agent");
  const advertised = advertisedActFor(session, ACT_KIND.ADD_AGENT)?.agents ?? [];
  const agent = asked === undefined ? undefined : advertised.find((entry) => entry === asked);
  if (agent === undefined) return refuse(ACT_REFUSAL.NO_SESSION_AGENT);
  let name: string | undefined;
  if (fields.name !== undefined) {
    name = WORKSPACE_NAME.parse(fields.name);
    if (!name) return refuse(ACT_REFUSAL.SESSION_NAME_BOUND);
  }
  let task: string | undefined;
  if (fields.task !== undefined) {
    task = OPENING_TASK.parse(fields.task);
    if (!task) return refuse(ACT_REFUSAL.TASK_BOUND);
  }
  // A model named for this one agent resolves within the asked-for kind alone:
  // the developer's chosen agent is never re-decided by the model they named
  // beside it, so a mismatch is a refusal rather than a swap.
  const spokenModel = textArgument(fields, "model");
  const spokenEffort = textArgument(fields, "effort");
  if (spokenEffort !== undefined && spokenModel === undefined) {
    return refuse(ACT_REFUSAL.EFFORT_NEEDS_MODEL);
  }
  let selection: WorkspaceAgentSelection | undefined;
  if (spokenModel !== undefined) {
    const entries = (context.projects?.agentModels(session.providerId) ?? []).filter(
      (candidate) => candidate.agent === agent,
    );
    const resolved = resolveWorkspaceAgentModel(entries, spokenModel, spokenEffort);
    if ("refusal" in resolved) {
      return resolved.unnamedModel
        ? refuse(`A ${agent} agent runs no model by that name.`)
        : resolved.refusal;
    }
    selection = resolved.selection;
  }
  const act: { kind: typeof ACT_KIND.ADD_AGENT } & ActPayloads[typeof ACT_KIND.ADD_AGENT] = {
    kind: ACT_KIND.ADD_AGENT,
    identity,
    agent,
  };
  if (name) act.name = name;
  if (task) act.task = task;
  if (selection) act.model = selection.model;
  if (selection?.effort) act.effort = selection.effort;
  return act;
};

const admitRenameWorkspace: Admitter<typeof ACT_KIND.RENAME_WORKSPACE> = async (
  fields,
  _context,
  reads,
) => {
  const found = await admittedSession(fields, reads);
  if ("status" in found) return found;
  // Only a session whose roster entry advertised renaming has a workspace a
  // rename can land on. The act carries the identity and the name, never the
  // target: the workspace is resolved from the observed entry, the same way an
  // open never carries an address.
  if (!advertisedActFor(found.session, ACT_KIND.RENAME_WORKSPACE)) {
    return refuse(ACT_REFUSAL.NO_WORKSPACE_RENAME);
  }
  const name = WORKSPACE_NAME.parse(fields.name);
  if (!name) return refuse(ACT_REFUSAL.WORKSPACE_NAME_BOUND);
  return { kind: ACT_KIND.RENAME_WORKSPACE, identity: found.identity, name };
};

const admitRenameSession: Admitter<typeof ACT_KIND.RENAME_SESSION> = async (
  fields,
  _context,
  reads,
) => {
  const found = await admittedSession(fields, reads);
  if ("status" in found) return found;
  if (!advertisedActFor(found.session, ACT_KIND.RENAME_SESSION)) {
    return refuse(ACT_REFUSAL.NO_SESSION_RENAME);
  }
  const name = WORKSPACE_NAME.parse(fields.name);
  if (!name) return refuse(ACT_REFUSAL.CHAT_NAME_BOUND);
  return { kind: ACT_KIND.RENAME_SESSION, identity: found.identity, name };
};

function admittedIssue(
  fields: WireRecord,
  context: AdmitContext,
): { issue: TrackedIssue; identity: IssueIdentity } | Refusal {
  if (!context.issues) return refuse(ACT_REFUSAL.NO_TRACKER);
  return issueFrom(fields, context.issues);
}

const admitIssueState: Admitter<typeof ACT_KIND.ISSUE_STATE> = (fields, context) => {
  const found = admittedIssue(fields, context);
  if ("status" in found) return found;
  const state = textArgument(fields, "state");
  const transition =
    state === undefined
      ? undefined
      : namedOnce(
          found.issue.transitions,
          state,
          (candidate) => candidate.name,
          (name) => name.toLowerCase(),
        );
  if (!transition) return refuse(ACT_REFUSAL.NO_ISSUE_STATE);
  return { kind: ACT_KIND.ISSUE_STATE, identity: found.identity, transition };
};

const admitIssueComment: Admitter<typeof ACT_KIND.ISSUE_COMMENT> = (fields, context) => {
  const found = admittedIssue(fields, context);
  if ("status" in found) return found;
  if (!found.issue.canComment) return refuse(ACT_REFUSAL.NO_COMMENTS);
  const body = COMMENT_BODY.parse(fields.body);
  if (!body) return refuse(ACT_REFUSAL.COMMENT_BOUND);
  return { kind: ACT_KIND.ISSUE_COMMENT, identity: found.identity, body };
};

const admitSetting: Admitter<typeof ACT_KIND.SETTING> = (fields, context) => {
  const guide = context.guide ?? EMPTY_APP_GUIDE;
  const setting = appGuideSetting(guide, textArgument(fields, "setting_id"));
  if (!setting) return refuse(ACT_REFUSAL.NO_SETTING);
  if (!setting.adjustable) {
    return refuse(`${setting.label} can only be changed by hand: ${setting.manual}`);
  }
  const value = appSettingValue(setting, fields.value);
  if (value === undefined) {
    const accepted =
      setting.kind === APP_SETTING_KIND.TOGGLE ? "on or off" : (setting.choices ?? []).join(", ");
    return refuse(`${setting.label} takes ${accepted}.`);
  }
  // An effort may ride only a value the guide lists levels for, so both halves
  // of one stored pairing can be asked for in one change — matched like the
  // value: case retold rather than copied, answered in the guide's own casing.
  const effortWord = textArgument(fields, "effort");
  if (effortWord === undefined) return { kind: ACT_KIND.SETTING, setting, value };
  const levels = setting.efforts?.[value] ?? [];
  if (levels.length === 0) {
    return refuse(
      setting.efforts === undefined
        ? `${setting.label} takes no effort level.`
        : `${value} takes no effort level.`,
    );
  }
  const normalizedEffort = effortWord.trim().toLowerCase();
  const effort = levels.find((candidate) => candidate.toLowerCase() === normalizedEffort);
  if (effort === undefined) return refuse(`${value}'s effort is one of ${levels.join(", ")}.`);
  return { kind: ACT_KIND.SETTING, setting, value, effort };
};

const admitPanel: Admitter<typeof ACT_KIND.PANEL> = async (fields, _context, reads) => {
  const sessions = await reads.sessions();
  if (!sessions) return refuse(ACT_REFUSAL.TURN_OVER);
  const askedTab = fields.tab ?? undefined;
  const tab = askedTab === undefined ? APP_PANEL_TAB.SESSIONS : PANEL_TAB.parse(askedTab);
  if (tab === undefined) return refuse(ACT_REFUSAL.NO_TAB);
  const sortWord = textArgument(fields, "sort");
  const sort = sortWord === undefined ? undefined : PANEL_SORT.parse(sortWord);
  if (sortWord !== undefined && sort === undefined) return refuse(ACT_REFUSAL.NO_SORT);
  // A search is bounded by the hand's own control: the magnifier is only
  // offered beside a list with more than one session, and a spoken ask reaches
  // no further than it. The words themselves are not validated against the
  // rows the way a filter is — a query is read against the lines as the
  // surface words them, which only the renderer knows, and a search matching
  // nothing is the list's own honest answer rather than a stale narrowing to
  // refuse.
  const query = textArgument(fields, "query");
  if (query !== undefined && sessions.length < 2) return refuse(ACT_REFUSAL.NO_SEARCH);
  const asked = PANEL_FILTERS.read(fields.filters);
  if (!asked.ok) return refuse(ACT_REFUSAL.FILTERS_SHAPE);
  const act: { kind: typeof ACT_KIND.PANEL } & ActPayloads[typeof ACT_KIND.PANEL] = {
    kind: ACT_KIND.PANEL,
    tab,
  };
  if (asked.value !== undefined) {
    const outcome = admittedFilters(asked.value, sessions);
    if ("status" in outcome) return outcome;
    act.filters = outcome.filters;
  }
  if (sort !== undefined) act.sort = sort;
  if (query !== undefined) act.query = query;
  return act;
};

const admitFeedback: Admitter<typeof ACT_KIND.FEEDBACK> = (fields) => {
  const composer = FEEDBACK_KIND.parse(fields.kind);
  if (composer === undefined) return refuse(ACT_REFUSAL.NO_COMPOSER);
  // The draft is the developer's ask restated in their words, not a document,
  // so it is bounded like a typed one; a blank draft is no draft, and the
  // composer simply opens empty.
  const draft = textArgument(fields, "draft")?.slice(0, maximumSessionMessageLength);
  const act: { kind: typeof ACT_KIND.FEEDBACK } & ActPayloads[typeof ACT_KIND.FEEDBACK] = {
    kind: ACT_KIND.FEEDBACK,
    composer,
  };
  if (draft) act.draft = draft;
  return act;
};

const admitUpdate: Admitter<typeof ACT_KIND.UPDATE> = (fields, context) => {
  // The guide's update entry is the roster here: a run that reported nothing
  // about updates — a fixture, a pure caller — advertises no act to run.
  const update = (context.guide ?? EMPTY_APP_GUIDE).update;
  if (!update) return refuse(ACT_REFUSAL.NO_UPDATE_REPORT);
  const act = UPDATE_ACT.parse(fields.action);
  if (act === undefined) return refuse(ACT_REFUSAL.NO_UPDATE_ACT);
  // One button, one act: only the press the row is actually drawing runs, so
  // the refusal is the row's own words plus what stands in the act's place.
  if (act !== update.button) {
    return refuse(`${update.detail} ${UPDATE_BUTTON_STANDING[update.button]}`);
  }
  return { kind: ACT_KIND.UPDATE, act };
};

const admitRemember: Admitter<typeof ACT_KIND.REMEMBER> = (fields, context) => {
  const facts = context.rememberedFacts ?? [];
  const words = rememberedFactText(fields.words);
  if (!words) return refuse(ACT_REFUSAL.MEMORY_BOUND);
  const replaces = textArgument(fields, "replaces");
  if (replaces !== undefined && !holdsRememberedFact(facts, replaces)) {
    return refuse(ACT_REFUSAL.NO_SUCH_FACT);
  }
  // A replacement retires one as it lands; a new fact never evicts silently.
  if (replaces === undefined && facts.length >= maximumRememberedFacts) {
    return refuse(ACT_REFUSAL.MEMORY_FULL);
  }
  return { kind: ACT_KIND.REMEMBER, words, ...(replaces ? { replaces } : undefined) };
};

const admitForget: Admitter<typeof ACT_KIND.FORGET> = (fields, context) => {
  const id = textArgument(fields, "id");
  if (!id || !holdsRememberedFact(context.rememberedFacts ?? [], id)) {
    return refuse(ACT_REFUSAL.NO_SUCH_FACT);
  }
  return { kind: ACT_KIND.FORGET, id };
};

const ADMITTERS = {
  [ACT_KIND.MESSAGE]: admitMessage,
  [ACT_KIND.CONTROL]: admitControl,
  [ACT_KIND.OPEN]: admitOpen,
  [ACT_KIND.CREATE_WORKSPACE]: admitCreateWorkspace,
  [ACT_KIND.ADD_AGENT]: admitAddAgent,
  [ACT_KIND.RENAME_WORKSPACE]: admitRenameWorkspace,
  [ACT_KIND.RENAME_SESSION]: admitRenameSession,
  [ACT_KIND.ISSUE_STATE]: admitIssueState,
  [ACT_KIND.ISSUE_COMMENT]: admitIssueComment,
  [ACT_KIND.SETTING]: admitSetting,
  [ACT_KIND.PANEL]: admitPanel,
  [ACT_KIND.FEEDBACK]: admitFeedback,
  [ACT_KIND.UPDATE]: admitUpdate,
  [ACT_KIND.REMEMBER]: admitRemember,
  [ACT_KIND.FORGET]: admitForget,
} as const satisfies { [K in ActKind]: Admitter<K> };

/**
 * The one function that mints a {@link ValidatedAct}. Everything a performer
 * or an adapter needs to have been checked is checked here, once, and the type
 * it answers with is how every path is held to having run it.
 */
export async function admit<Kind extends ActKind>(
  request: ActRequest<Kind>,
  context: AdmitContext,
): Promise<ValidatedAct<Kind> | Refusal> {
  if (context.guard?.isRevoked()) return refuse(ACT_REFUSAL.TURN_OVER);
  // SAFETY: the table is keyed by the same union `request.kind` ranges over, so
  // the entry selected is the admitter written for this request's own kind.
  const admitter = ADMITTERS[request.kind] as Admitter<Kind>;
  const admitted = await admitter(request.fields, context, admittedReads(context));
  if ("status" in admitted) return admitted;
  // Asked once more after every await admission made, so an act whose turn
  // ended while the roster was refreshing refuses rather than being minted.
  if (context.guard?.isRevoked()) return refuse(ACT_REFUSAL.TURN_OVER);
  // SAFETY: the brand is nominal and this is its one producer in the
  // repository; the payload stands exactly as the admitter built it.
  return { ...admitted, origin: context.origin } as ValidatedAct<Kind>;
}
