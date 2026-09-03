import { randomUUID } from "node:crypto";
import {
  type CarriedIssueAction,
  type CarriedSessionAction,
  dispatchByKind,
  holdsRememberedFact,
  ISSUE_TOOL_KIND,
  maximumRememberedFacts,
  type RememberedFact,
  rememberedFactText,
  SESSION_TOOL_KIND,
  withoutRememberedFact,
} from "@sidecar/acts";
import {
  PRODUCT_EVENT,
  PRODUCT_ISSUE_ACT,
  PRODUCT_SESSION_ACT,
  type ProductSessionAct,
  type RecordProductEvent,
} from "@sidecar/analytics";
import {
  ISSUE_ACTION_KIND,
  type IssueIdentity,
  isIssueTrackerId,
  issueCommentText,
  type TrackedIssue,
  type TrackerActionResult,
} from "@sidecar/issues";
import {
  isListedWorkspaceAgentModel,
  isProviderId,
  type ProviderActResult,
  type ProviderWorkspaceResult,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionProviderAdapter,
  type SessionRoster,
  sessionMessageText,
  type WorkspaceAgentSelection,
  workspaceNameText,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { SupersetSessionContext } from "@sidecar/superset";
import { isSupersetControlId, type SupersetCli, supersetPressedLink } from "@sidecar/superset";
import type { LinearIssueTracker } from "@sidecar/trackers";
import {
  ACT_RESULT_STATUS,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { SessionOpenResult } from "#shared/contracts";
import { createActionHandler } from "../action-handler";
import type { SettingsStore } from "../settings-store";

/**
 * What performing an act needs from the app: the registry the act is
 * validated against once more, the adapters that carry it, and the seams a
 * landed act moves — the refresh, the created-workspace watch, the counts.
 */
export interface SessionActPerformerDependencies {
  sessionRegistry: SessionRoster;
  /** The last address an observation pass reported for a now-departed session. */
  lastReportedSessionLink: (identity: SessionIdentity) => string | undefined;
  openExternal: (url: string) => Promise<void>;
  adapterFor: (providerId: string) => SessionProviderAdapter | undefined;
  sendsNetwork: boolean;
  settingsStore: SettingsStore;
  rememberWorkspaceDefaults: (
    adapter: SessionProviderAdapter,
    providerProjectId: string,
    providerTargetId: string | undefined,
    selection: WorkspaceAgentSelection | undefined,
    agent: string | undefined,
  ) => Promise<void>;
  expectCreatedWorkspace: (identity: SessionIdentity, now: number) => void;
  openCreatedWorkspaces: () => void;
  trackedIssues: () => readonly TrackedIssue[] | undefined;
  issueTrackers: readonly LinearIssueTracker[];
  refreshIssues: () => void;
  supersetContext: (identity: SessionIdentity) => SupersetSessionContext | undefined;
  supersetCli: SupersetCli;
  recordProductEvent: RecordProductEvent;
}

export interface SessionActsIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  performer: SessionActPerformer;
}

/**
 * The one entry every act on a session or an issue passes through. The brain
 * is the only caller: a validated action arrives, is checked again against
 * what this process observed, and is carried by the adapter or tracker that
 * advertised it. The opens are exposed on their own because a row press is
 * not a write and reaches them without the brain.
 */
export interface SessionActPerformer {
  perform(action: CarriedSessionAction | CarriedIssueAction): Promise<WireRecord>;
  openSession(identity: SessionIdentity): Promise<SessionOpenResult>;
  openSessionApplication(
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Promise<SessionOpenResult>;
  openSessionChange(identity: SessionIdentity): Promise<SessionOpenResult>;
  openIssue(identity: IssueIdentity): Promise<SessionOpenResult>;
}

type MemoryWriter = (facts: readonly RememberedFact[]) => boolean;

export function saveRememberedFact(
  held: readonly RememberedFact[],
  words: string,
  replaces: string | undefined,
  id: string,
  write: MemoryWriter,
): readonly RememberedFact[] {
  const remembered = rememberedFactText(words);
  if (!remembered) return held;
  if (replaces !== undefined && !holdsRememberedFact(held, replaces)) return held;
  const retained = replaces ? withoutRememberedFact(held, replaces) : held;
  if (retained.some((fact) => fact.words === remembered)) {
    return retained.length === held.length || !write(retained) ? held : retained;
  }
  if (replaces === undefined && held.length >= maximumRememberedFacts) return held;
  const next = [...retained, { id, words: remembered }];
  return write(next) ? next : held;
}

export function forgetRememberedFact(
  held: readonly RememberedFact[],
  id: string,
  write: MemoryWriter,
): readonly RememberedFact[] {
  if (!holdsRememberedFact(held, id)) return held;
  const next = withoutRememberedFact(held, id);
  return write(next) ? next : held;
}

const REFUSAL = {
  NO_SESSION: "No observed session matches that identity.",
  NO_ISSUE: "No tracked issue matches that identity.",
  PROVIDER_ABSENT: "That session's provider is not connected.",
  NO_ADDRESS: "That session has no address to open.",
  NO_APP_ADDRESS: "That session has no address to open in that app.",
  NO_CHANGE: "That session reports no pull request.",
  NO_ISSUE_ADDRESS: "That issue has no address to open.",
  OPEN_FAILED: "The system could not open that session.",
  OPEN_APP_FAILED: "The system could not open that session in the selected app.",
  OPEN_CHANGE_FAILED: "The system could not open that pull request.",
  OPEN_ISSUE_FAILED: "The system could not open that issue.",
} as const;

export function createSessionActPerformer(
  dependencies: SessionActPerformerDependencies,
): SessionActPerformer {
  const {
    sessionRegistry,
    lastReportedSessionLink,
    openExternal,
    adapterFor,
    sendsNetwork,
    settingsStore,
    rememberWorkspaceDefaults,
    expectCreatedWorkspace,
    openCreatedWorkspaces,
    trackedIssues,
    issueTrackers,
    refreshIssues,
    supersetContext,
    supersetCli,
    recordProductEvent,
  } = dependencies;

  /**
   * Counts an act that actually landed. It takes the result rather than
   * sitting inside `performSessionAct`, because a Superset-managed session
   * takes the same acts through the CLI without passing through there — an act
   * counted in only one of the two paths would read as a provider nobody sends
   * messages to.
   */
  function countSessionAct<Result extends ProviderActResult>(
    providerId: string,
    counted: ProductSessionAct,
    result: Result,
  ): Result {
    // An adapter reports its provider id as a string; only one this build's
    // own vocabulary names has anything to be counted under.
    if (result.status === ACT_RESULT_STATUS.ACCEPTED && isProviderId(providerId)) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACT_SEND, {
        provider_id: providerId,
        session_act: counted,
      });
    }
    return result;
  }

  // Capability checks stay in their handlers so no act can inherit another act's authority.
  async function performSessionAct<Result extends ProviderActResult>(
    identity: SessionIdentity,
    counted: ProductSessionAct,
    act: (adapter: SessionProviderAdapter, session: Session) => Promise<Result>,
  ): Promise<Result | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string }> {
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    const adapter = adapterFor(identity.providerId);
    if (!adapter) {
      return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.PROVIDER_ABSENT };
    }
    const result = await act(adapter, session);
    // A rejection refreshes like an acceptance: a write whose answer never
    // arrived may still have landed, so the roster must catch up with the
    // provider rather than keep advertising what it may have already taken. A
    // rejection that never reached the network is answered from the adapter's
    // cache anyway.
    if (result.status !== ACT_RESULT_STATUS.UNSUPPORTED) {
      void sessionRegistry.refresh(adapter);
    }
    return countSessionAct(adapter.provider.id, counted, result);
  }

  // What a press fires is the address the roster reported, plus the one
  // nonce Superset's own rows mint per press: the app consumes a terminal
  // focus once per request id, so a nonce composed at observation time would
  // be spent by the first press and dead for every later one.
  const pressedLink = (link: string | undefined): string | undefined =>
    link === undefined ? undefined : supersetPressedLink(link, randomUUID());

  const countOpen = (identity: SessionIdentity) => {
    if (isProviderId(identity.providerId)) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACT_SEND, {
        provider_id: identity.providerId,
        session_act: PRODUCT_SESSION_ACT.SESSION_OPEN,
      });
    }
  };

  const openAddress = async (
    identity: SessionIdentity,
    address: (identity: SessionIdentity) => string | undefined,
    // A session that left the roster and one still standing with nowhere to
    // go are different answers, and only the second says what to try instead.
    absentAddressReason: string,
    failureReason: string,
    // The one open that outlives the roster row: a History chip's press. A
    // session still reporting an address opens at its current one; the
    // remembered address answers only where the roster has nothing better,
    // so the offer the renderer computes from what it ever saw reported can
    // never name a chat this refuses on this-run staleness alone.
    rememberedAddress?: (identity: SessionIdentity) => string | undefined,
  ): Promise<SessionOpenResult> => {
    const observed = sessionRegistry.get(identity) !== undefined;
    const url = (observed ? address(identity) : undefined) ?? rememberedAddress?.(identity);
    if (!url) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: observed ? absentAddressReason : REFUSAL.NO_SESSION,
      };
    }
    try {
      await openExternal(url);
    } catch {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: failureReason };
    }
    countOpen(identity);
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  };

  const openSession = (identity: SessionIdentity) =>
    openAddress(
      identity,
      (target) => pressedLink(sessionRegistry.get(target)?.detail.link),
      REFUSAL.NO_ADDRESS,
      REFUSAL.OPEN_FAILED,
      // A History line keeps its press after the roster lets its session go —
      // Conductor keeps an archived chat's deep link alive — at the last
      // address an observation pass itself reported, never one the renderer
      // carried over the bridge.
      (target) => pressedLink(lastReportedSessionLink(target)),
    );

  const openSessionApplication = async (
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Promise<SessionOpenResult> => {
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    const application = session.applications.find((candidate) => candidate.id === applicationId);
    if (!application) {
      // The display names travel with the roster the caller already read,
      // so naming what still opens surfaces nothing the roster withheld.
      const openable = session.applications.filter((candidate) => candidate.link);
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: openable.length
          ? `That session opens only in ${openable.map((candidate) => candidate.displayName).join(", ")}.`
          : "That session lists no app to open in.",
      };
    }
    const url = pressedLink(application.link);
    if (!url) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_APP_ADDRESS };
    try {
      await openExternal(url);
    } catch {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: REFUSAL.OPEN_APP_FAILED };
    }
    countOpen(identity);
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  };

  const openSessionChange = (identity: SessionIdentity) =>
    openAddress(
      identity,
      (target) => sessionRegistry.get(target)?.detail.change,
      REFUSAL.NO_CHANGE,
      REFUSAL.OPEN_CHANGE_FAILED,
    );

  // Pressing an issue — the notice under the housing while Luke names it —
  // hands its tracker's own address to the system, exactly as pressing a
  // session's row does. The caller names an issue rather than an address, so
  // the pages Luke can send you to are the issues currently observed: the
  // URL is read back out of the roster, where normalization admitted nothing
  // but a bounded https address, and nothing reaches the tracker. A fixture
  // run observes no tracker and so opens nothing.
  const openIssue = async (identity: IssueIdentity): Promise<SessionOpenResult> => {
    const issue = trackedIssues()?.find(
      (candidate) =>
        candidate.trackerId === identity.trackerId && candidate.identifier === identity.identifier,
    );
    if (!issue) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ISSUE };
    if (!issue.url) {
      return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ISSUE_ADDRESS };
    }
    try {
      await openExternal(issue.url);
    } catch {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: REFUSAL.OPEN_ISSUE_FAILED };
    }
    // A roster reports its tracker id as a string; only one this build's own
    // vocabulary names has anything to be counted under, exactly as the
    // session opens narrow their provider id.
    if (isIssueTrackerId(identity.trackerId)) {
      recordProductEvent(PRODUCT_EVENT.ISSUE_ACT_SEND, {
        tracker_id: identity.trackerId,
        issue_act: PRODUCT_ISSUE_ACT.ISSUE_OPEN,
      });
    }
    return { status: ACT_RESULT_STATUS.ACCEPTED };
  };

  // A message is handed to the session's own provider, through the adapter
  // that observed it — the one component that knows the documented way in.
  // The action names a session already observed, the text is bounded before
  // an adapter sees it, and only a session whose latest observation
  // advertised taking messages gets one.
  const sendMessage = async (identity: SessionIdentity, text: string): Promise<WireRecord> => {
    const message = boundedField(text, sessionMessageText);
    if (!message.ok || message.value === undefined) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That message is empty or too long." };
    }
    const messageText = message.value;
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    if (!session.canReceiveMessage) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That session does not take messages right now.",
      };
    }
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.MESSAGE_SEND,
        await supersetCli.sendMessage(managed, messageText),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.MESSAGE_SEND, (adapter) =>
      adapter.sendMessage({ providerSessionId: identity.providerSessionId, text: messageText }),
    );
  };

  // A control runs the same gauntlet a message does, and one more: the id
  // named must be a control the session's latest observation actually
  // advertised. The registry is what advertised it, so the registry is what
  // answers whether it stands.
  const executeControl = async (
    identity: SessionIdentity,
    controlId: string,
  ): Promise<WireRecord> => {
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    const control = session.controls.find((candidate) => candidate.id === controlId);
    // The labels travel with the roster the caller already read, so naming
    // what still stands surfaces nothing the roster withheld.
    if (!control) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: session.controls.length
          ? `That session advertises no such control, only ${session.controls.map((candidate) => candidate.label).join(", ")}.`
          : "That session advertises no controls right now.",
      };
    }
    const managed = supersetContext(identity);
    if (managed && isSupersetControlId(control.id)) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.CONTROL_RUN,
        await supersetCli.executeControl(managed, control.id),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.CONTROL_RUN, (adapter) =>
      adapter.executeControl({ providerSessionId: identity.providerSessionId, control }),
    );
  };

  // A new workspace runs the same gauntlet a message does, against the list
  // that offered it: the action names a project rather than a repository, and
  // only a project an adapter reported on its latest pass — read back here from
  // the adapter itself, never from the request — reaches the provider's
  // documented creation endpoint. A fixture run offers no projects at all, so
  // it refuses every ask without touching a network.
  const createWorkspace = async (
    providerId: string,
    providerProjectId: string,
    providerTargetId: string | undefined,
    agent: string | undefined,
    name: string | undefined,
    task: string | undefined,
    namedSelection: WorkspaceAgentSelection | undefined,
  ): Promise<ProviderWorkspaceResult> => {
    if (!sendsNetwork) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "This run reaches no provider, so it can create nothing.",
      };
    }
    const adapter = adapterFor(providerId);
    if (!adapter) {
      return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "That provider is not connected." };
    }
    const project = adapter
      .workspaceProjects()
      .find(
        (candidate) =>
          candidate.providerProjectId === providerProjectId &&
          candidate.providerTargetId === providerTargetId,
      );
    if (!project) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "No listed project matches that identity.",
      };
    }
    if (project.spawnableAgents && !(agent && project.spawnableAgents.includes(agent.trim()))) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: project.spawnableAgents.length
          ? `That project lists no such agent, only ${project.spawnableAgents.join(", ")}.`
          : "That project lists no agent to create with.",
      };
    }
    const workspaceName = boundedField(name, workspaceNameText);
    if (!workspaceName.ok) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That workspace name is empty or too long.",
      };
    }
    // The task's own bound, and its fit to the project, are answered by the
    // adapter, which validates both against the projects it actually offers.
    const openingTask = boundedField(task, sessionMessageText);
    if (!openingTask.ok) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That task is empty or too long." };
    }
    // A model the user named for this one creation outranks the stored
    // choice for this act alone; the stored choice stands otherwise. Both
    // are held to the build's documented table — the named one by the
    // validator, the stored one when it was written — and the adapter holds
    // whichever rides to its own table again before anything reaches the network.
    const stored = isProviderId(providerId)
      ? (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[providerId]
      : undefined;
    const agentSelection = namedSelection ?? stored;
    const createRequest: Parameters<SessionProviderAdapter["createWorkspace"]>[0] = {
      providerProjectId,
    };
    if (isWireString(providerTargetId) && providerTargetId.trim()) {
      createRequest.providerTargetId = providerTargetId.trim();
    }
    if (isWireString(agent) && agent.trim()) {
      createRequest.agent = agent.trim();
    }
    if (workspaceName.value) createRequest.name = workspaceName.value;
    if (openingTask.value) createRequest.task = openingTask.value;
    if (agentSelection) createRequest.agentSelection = agentSelection;
    const result = await adapter.createWorkspace(createRequest);
    // A workspace that landed is a session the panel should be showing, so
    // the next look must actually ask rather than serve the cache. A
    // rejection refreshes too: a workspace can stand with its opening task
    // undelivered, and the adapter answers a rejection that never reached
    // the network from its cache anyway.
    if (result.status !== ACT_RESULT_STATUS.UNSUPPORTED) {
      // A workspace that landed is also one the developer just asked to be
      // taken to, so the session the creation response named — an id the
      // adapter reported, never an address — waits here for observation to
      // report it, and is opened then like a pressed row. Noted before the
      // refresh, so the very pass that first sees the session resolves it.
      if (result.status === ACT_RESULT_STATUS.ACCEPTED && result.providerSessionId) {
        expectCreatedWorkspace(
          { providerId: adapter.provider.id, providerSessionId: result.providerSessionId },
          Date.now(),
        );
        // An interval pass can commit the new session while the creation's
        // own follow-up write is still in flight — before the entry above
        // exists — and a registry already holding the session commits
        // nothing further to resolve it. So the current picture is claimed
        // against here, and future commits carry every later arrival.
        openCreatedWorkspaces();
      }
      void sessionRegistry.refresh(adapter);
    }
    // The first workspace that actually lands chooses the default provider,
    // so a later ask that names none has somewhere unsurprising to go. Only
    // while nothing is chosen: a default the user holds is theirs to change,
    // never a creation's. Deterministic on the validated act — nothing a
    // model composed decides this — and losing the save loses only the
    // remembered default, never the workspace that just landed.
    if (result.status === ACT_RESULT_STATUS.ACCEPTED) {
      await rememberWorkspaceDefaults(
        adapter,
        providerProjectId,
        isWireString(providerTargetId) ? providerTargetId.trim() : undefined,
        namedSelection,
        isWireString(agent) ? agent.trim() : undefined,
      );
      countSessionAct(adapter.provider.id, PRODUCT_SESSION_ACT.WORKSPACE_CREATE, result);
      // The named session was consumed above; the answer stays what became
      // of the ask, so nothing rides out that the roster will not report on
      // its own.
      return result.warning
        ? { status: ACT_RESULT_STATUS.ACCEPTED, warning: result.warning }
        : { status: ACT_RESULT_STATUS.ACCEPTED };
    }
    return result;
  };

  // Another agent in an observed workspace runs the gauntlet a control does,
  // and one more: the agent kind named must be one the session's latest
  // observation actually listed. The registry is what advertised it, so the
  // registry is what answers whether it stands; the adapter then reads the
  // workspace back from its own last pass.
  const addWorkspaceAgent = async (
    identity: SessionIdentity,
    agent: string,
    name: string | undefined,
    task: string | undefined,
    namedModel: string | undefined,
    namedEffort: string | undefined,
  ): Promise<WireRecord> => {
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    const advertised = session.spawnableAgents.find((candidate) => candidate === agent.trim());
    if (!advertised) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: session.spawnableAgents.length
          ? `That session lists no such agent to add, only ${session.spawnableAgents.join(", ")}.`
          : "That session lists no agent to add.",
      };
    }
    // A model named for this one agent must be a documented pairing of
    // exactly the asked-for kind: the user's chosen agent is never
    // re-decided by the model named beside it.
    if (namedModel !== undefined) {
      const selection: WorkspaceAgentSelection = { agent: advertised, model: namedModel };
      if (namedEffort !== undefined) selection.effort = namedEffort;
      if (!isListedWorkspaceAgentModel(identity.providerId, selection)) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "That agent lists no such model.",
        };
      }
    }
    const sessionName = boundedField(name, workspaceNameText);
    if (!sessionName.ok) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That session name is empty or too long.",
      };
    }
    const openingTask = boundedField(task, sessionMessageText);
    if (!openingTask.ok) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That task is empty or too long." };
    }
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.AGENT_ADD,
        await supersetCli.createAgent(managed, advertised, openingTask.value),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.AGENT_ADD, async (adapter) => {
      const stored: WorkspaceAgentSelection | undefined = isProviderId(identity.providerId)
        ? (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[
            identity.providerId
          ]
        : undefined;
      const fallback = stored?.agent === advertised ? stored : undefined;
      const model = namedModel ?? fallback?.model;
      const effort = namedModel !== undefined ? namedEffort : fallback?.effort;
      return adapter.spawnWorkspaceAgent({
        providerSessionId: identity.providerSessionId,
        agent: advertised,
        ...(sessionName.value ? { name: sessionName.value } : undefined),
        ...(openingTask.value ? { task: openingTask.value } : undefined),
        ...(model ? { model } : undefined),
        ...(effort ? { effort } : undefined),
      });
    });
  };

  // Renaming a workspace runs the gauntlet a control does: the session named
  // must have advertised a rename target on its latest observation. The
  // registry is what advertised it, so the registry is what answers whether
  // it stands; the adapter then resolves the workspace from its own last
  // pass, never from the request.
  const renameWorkspace = async (identity: SessionIdentity, name: string): Promise<WireRecord> => {
    // Unlike a creation's optional name, a rename with nothing to rename to
    // is no ask at all, so an absent name is refused with the same words an
    // oversized one earns.
    const workspaceName = workspaceNameText(name);
    if (!workspaceName) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That workspace name is empty or too long.",
      };
    }
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    if (!session.renameTarget) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That session's workspace cannot be renamed.",
      };
    }
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.WORKSPACE_RENAME,
        await supersetCli.renameWorkspace(managed, workspaceName),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.WORKSPACE_RENAME, (adapter) =>
      adapter.renameWorkspace({
        providerSessionId: identity.providerSessionId,
        name: workspaceName,
      }),
    );
  };

  // Renaming a chat itself runs the same gauntlet one notch narrower: only a
  // session whose latest observation advertised `canRename` takes one, and
  // the registry that advertised it is what answers whether it stands.
  const renameSession = async (identity: SessionIdentity, name: string): Promise<WireRecord> => {
    const sessionName = workspaceNameText(name);
    if (!sessionName) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That session name is empty or too long.",
      };
    }
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    if (!session.canRename) {
      return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "That chat cannot be renamed." };
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.SESSION_RENAME, (adapter) =>
      adapter.renameSession({ providerSessionId: identity.providerSessionId, name: sessionName }),
    );
  };

  // An issue act resolves every named thing again from the latest
  // observation — the issue by its identity, the transition by the id the
  // tracker itself listed — so what reaches a tracker client is built from
  // observed state, never from what a model composed. A fixture run observes
  // no tracker, so it refuses every act.
  const performIssueAct = async (action: CarriedIssueAction): Promise<TrackerActionResult> => {
    const issue = trackedIssues()?.find(
      (candidate) =>
        candidate.trackerId === action.identity.trackerId &&
        candidate.identifier === action.identity.identifier,
    );
    if (!issue) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ISSUE };
    const tracker = issueTrackers.find((candidate) => candidate.tracker.id === issue.trackerId);
    if (!tracker) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That issue's tracker is not connected.",
      };
    }

    let result: TrackerActionResult;
    if (action.kind === ISSUE_TOOL_KIND.ISSUE_STATE) {
      const transition = issue.transitions.find(
        (candidate) => candidate.id === action.transition.id,
      );
      if (!transition) {
        return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "That issue lists no such state." };
      }
      result = await tracker.execute({
        kind: ISSUE_ACTION_KIND.SET_STATE,
        trackerIssueId: issue.trackerIssueId,
        transition,
      });
    } else {
      if (!issue.canComment) {
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That issue does not take comments.",
        };
      }
      const body = boundedField(action.body, issueCommentText);
      if (!body.ok || body.value === undefined) {
        return { status: ACT_RESULT_STATUS.REJECTED, reason: "That comment is empty or too long." };
      }
      result = await tracker.execute({
        kind: ISSUE_ACTION_KIND.COMMENT,
        trackerIssueId: issue.trackerIssueId,
        body: body.value,
      });
    }
    // An act that landed changes the board, so the roster should catch up
    // as soon as Linear will say.
    if (result.status === ACT_RESULT_STATUS.ACCEPTED) {
      refreshIssues();
      if (isIssueTrackerId(issue.trackerId)) {
        recordProductEvent(PRODUCT_EVENT.ISSUE_ACT_SEND, {
          tracker_id: issue.trackerId,
          issue_act:
            action.kind === ISSUE_TOOL_KIND.ISSUE_STATE
              ? PRODUCT_ISSUE_ACT.STATE_MOVE
              : PRODUCT_ISSUE_ACT.COMMENT_ADD,
        });
      }
    }
    return result;
  };

  const performSessionAction = (action: CarriedSessionAction): Promise<WireRecord> =>
    dispatchByKind(action, {
      [SESSION_TOOL_KIND.MESSAGE]: (act) => sendMessage(act.identity, act.text),
      [SESSION_TOOL_KIND.CONTROL]: (act) => executeControl(act.identity, act.control.id),
      [SESSION_TOOL_KIND.OPEN]: async (act): Promise<WireRecord> =>
        act.applicationId
          ? openSessionApplication(act.identity, act.applicationId)
          : openSession(act.identity),
      // The brain reads transcripts for itself; nothing here is spoken.
      [SESSION_TOOL_KIND.READ_TRANSCRIPT]: async (): Promise<WireRecord> => ({
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "Transcripts are read with the brain's own read, not carried as an act.",
      }),
      [SESSION_TOOL_KIND.CREATE_WORKSPACE]: async (act): Promise<WireRecord> =>
        createWorkspace(
          act.providerId,
          act.providerProjectId,
          act.providerTargetId,
          act.agent,
          act.name,
          act.task,
          act.agentSelection,
        ),
      [SESSION_TOOL_KIND.ADD_AGENT]: (act) =>
        addWorkspaceAgent(act.identity, act.agent, act.name, act.task, act.model, act.effort),
      [SESSION_TOOL_KIND.RENAME_WORKSPACE]: (act) => renameWorkspace(act.identity, act.name),
      [SESSION_TOOL_KIND.RENAME_SESSION]: (act) => renameSession(act.identity, act.name),
    });

  return {
    async perform(action) {
      if (
        action.kind === ISSUE_TOOL_KIND.ISSUE_STATE ||
        action.kind === ISSUE_TOOL_KIND.ISSUE_COMMENT
      ) {
        return performIssueAct(action);
      }
      return performSessionAction(action);
    },
    openSession,
    openSessionApplication,
    openSessionChange,
    openIssue,
  };
}

/**
 * The presses that need no brain: a row, an app mark, the pull-request chip,
 * and an issue chip each hand an address the roster reported to the system.
 * Opening is not a write, so these stay on the bridge for the renderer to
 * call directly.
 */
export function registerSessionActsIpc(dependencies: SessionActsIpcDependencies): void {
  const { ipcMain, trustedSender, performer } = dependencies;
  const registerAction = createActionHandler({ ipcMain, trustedSender });
  const failure = (reason: string) => (): SessionOpenResult => ({
    status: ACT_RESULT_STATUS.REJECTED,
    reason,
  });
  registerAction<[SessionIdentity], SessionOpenResult>(BRIDGE.openSession, {
    act: (identity) => performer.openSession(identity),
    failure: failure(REFUSAL.OPEN_FAILED),
  });
  registerAction<[SessionIdentity, SessionApplicationId], SessionOpenResult>(
    BRIDGE.openSessionApplication,
    {
      act: (identity, applicationId) => performer.openSessionApplication(identity, applicationId),
      failure: failure(REFUSAL.OPEN_APP_FAILED),
    },
  );
  registerAction<[SessionIdentity], SessionOpenResult>(BRIDGE.openSessionChange, {
    act: (identity) => performer.openSessionChange(identity),
    failure: failure(REFUSAL.OPEN_CHANGE_FAILED),
  });
  registerAction<[IssueIdentity], SessionOpenResult>(BRIDGE.openIssue, {
    act: (identity) => performer.openIssue(identity),
    failure: failure(REFUSAL.OPEN_ISSUE_FAILED),
  });
}

function boundedField(
  raw: UnparsedWireValue,
  bound: (value: UnparsedWireValue) => string | undefined,
): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = bound(raw);
  return value === undefined ? { ok: false } : { ok: true, value };
}
