import { randomUUID } from "node:crypto";
import {
  ACTION_KIND,
  ACTION_REFUSAL,
  type ActionGuard,
  dispatchByKind,
  guardedRead,
  type IssueActionKind,
  providerControlRequest,
  providerSessionMessage,
  providerSessionRenameRequest,
  providerWorkspaceAgentRequest,
  providerWorkspaceRenameRequest,
  providerWorkspaceRequest,
  type SessionActionKind,
  type ValidatedAction,
} from "@sidecar/actions";
import {
  PRODUCT_EVENT,
  PRODUCT_ISSUE_ACTION,
  PRODUCT_SESSION_ACTION,
  type ProductSessionAction,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { LinearIssueTracker } from "@sidecar/credentials";
import {
  isSupersetControlId,
  type SupersetCli,
  type SupersetSessionContext,
  supersetPressedLink,
} from "@sidecar/providers";
import {
  dispatchAction,
  ExternalOpenAnswerLostError,
  ISSUE_ACTION_KIND,
  isIssueTrackerId,
  isProviderId,
  type ProviderActionResult,
  type ProviderWorkspaceResult,
  type Session,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionOpenResult,
  type SessionProviderPlugin,
  type SessionRoster,
  type TrackedIssue,
  type TrackerActionResult,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import {
  ACTION_RESULT_STATUS,
  UNKNOWN_ACTION_STATUS,
  type UnknownActionResult,
  type WireRecord,
} from "@sidecar/wire";
import { HOST_NODE_OPEN_KIND, type HostNodeOpenKind } from "./node-capabilities.js";
import type { SettingsStore } from "./settings-store.js";

/**
 * An open that was handed to the native node and whose answer was lost with
 * the node's connection: the system may have opened the address. Thrown by
 * the open port so the action that asked records itself unknown, never failed
 * and never retried.
 */
export { ExternalOpenAnswerLostError as NodeAnswerLostError };

/** What an open answers when its answer was lost: the effect is uncertain. */
function unknownOpen(error: ExternalOpenAnswerLostError): SessionOpenResult {
  return { status: UNKNOWN_ACTION_STATUS, reason: error.message };
}

/**
 * What performing an action needs from the app: the registry the action is
 * validated against once more, the adapters that carry it, and the seams a
 * landed action moves — the refresh, the created-workspace watch, the counts.
 */
export interface SessionActionPerformerDependencies {
  sessionRegistry: SessionRoster;
  /**
   * Hands an address to the operating system through the native node, told
   * what the address is: a row's press has already stood its panel down, and
   * an open asked of Luke has no press behind it, so the client's windows
   * owe the two different things.
   */
  openExternal: (url: string, kind: HostNodeOpenKind) => Promise<void>;
  pluginFor: (providerId: string) => SessionProviderPlugin | undefined;
  sendsNetwork: boolean;
  settingsStore: Pick<SettingsStore, "get">;
  rememberWorkspaceDefaults: (
    plugin: SessionProviderPlugin,
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
  supersetCli: Pick<
    SupersetCli,
    "sendMessage" | "executeControl" | "createAgent" | "renameWorkspace"
  >;
  recordProductEvent: RecordProductEvent;
}

/**
 * The one entry every action on a session or an issue passes through. The brain
 * is the only caller, and what arrives is a `ValidatedAction`, which only
 * `admit()` mints: whether the action may run was decided there, against the
 * roster it read for itself, so what is left here is carrying it — reading each
 * effect's own route back out of the adapter or the tracker that offered it,
 * and counting what landed. The opens are exposed on their own because a row
 * press is not a write and reaches them without the brain.
 */
export interface SessionActionPerformer {
  /**
   * The guard is asked once more at the last boundary before a provider
   * effect. A brain-origin action arrives with one; a row press, which is not a
   * write and opens its turn and its effect in the same breath, carries none.
   * Only a create and a spawn ask it, because only they await a read of their
   * own — the stored agent defaults — between admission and the write.
   */
  perform(
    action: ValidatedAction<SessionActionKind | IssueActionKind>,
    guard?: ActionGuard,
  ): Promise<WireRecord>;
  openSession(identity: SessionIdentity): Promise<SessionOpenResult>;
  openSessionApplication(
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Promise<SessionOpenResult>;
  openSessionChange(identity: SessionIdentity): Promise<SessionOpenResult>;
}

/** What an open answers when the system refused it: the words a row press and the brain's ask share. */
export const OPEN_REFUSAL = {
  SESSION: "The system could not open that session.",
  APPLICATION: "The system could not open that session in the selected app.",
  CHANGE: "The system could not open that pull request.",
} as const;

const REFUSAL = {
  // The sentences `admit` already says for these. The performer refuses the
  // same three things at the last boundary before an effect, and a refusal
  // worded twice is a refusal that drifts.
  NO_SESSION: ACTION_REFUSAL.NO_SESSION,
  NO_ISSUE: ACTION_REFUSAL.NO_ISSUE,
  NO_ADDRESS: ACTION_REFUSAL.NO_ADDRESS,
  TURN_OVER: ACTION_REFUSAL.TURN_OVER,
  PROVIDER_ABSENT: "That session's provider is not connected.",
  NO_APP_ADDRESS: "That session has no address to open in that app.",
  NO_CHANGE: "That session reports no pull request.",
  OPEN_FAILED: OPEN_REFUSAL.SESSION,
  OPEN_APP_FAILED: OPEN_REFUSAL.APPLICATION,
  OPEN_CHANGE_FAILED: OPEN_REFUSAL.CHANGE,
} as const;

/**
 * The field a creation's answer carries the created session under, for the
 * brain's performer alone: it records the identity on the act's line and cuts
 * the field before the model reads the answer.
 */
export const CREATED_SESSION_FIELD = "createdSession";

/** How many departed sessions' addresses one provider keeps for the run; a roster is never near it. */
const REMEMBERED_ADDRESSES_PER_PROVIDER = 200;

export function createSessionActionPerformer(
  dependencies: SessionActionPerformerDependencies,
): SessionActionPerformer {
  const {
    sessionRegistry,
    openExternal,
    pluginFor,
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
   * Counts an action that actually landed. It takes the result rather than
   * sitting inside `performOnSession`, because a Superset-managed session
   * takes the same actions through the CLI without passing through there — an action
   * counted in only one of the two paths would read as a provider nobody sends
   * messages to.
   */
  function countSessionAction<Result extends ProviderActionResult | UnknownActionResult>(
    providerId: string,
    counted: ProductSessionAction,
    result: Result,
  ): Result {
    // An adapter reports its provider id as a string; only one this build's
    // own vocabulary names has anything to be counted under.
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED && isProviderId(providerId)) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACTION_SEND, {
        provider_id: providerId,
        session_action: counted,
      });
    }
    return result;
  }

  /**
   * Hands one admitted action to the adapter that observed its session. Whether
   * the action may run is admission's answer; what is asked here is whether this
   * process still holds the provider it names at all, which is a fact about
   * the app rather than about the roster.
   */
  async function performOnSession<Result extends ProviderActionResult | UnknownActionResult>(
    identity: SessionIdentity,
    counted: ProductSessionAction,
    action: (plugin: SessionProviderPlugin) => Promise<Result>,
  ): Promise<Result | { status: typeof ACTION_RESULT_STATUS.UNSUPPORTED; reason: string }> {
    const plugin = pluginFor(identity.providerId);
    if (!plugin) {
      return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.PROVIDER_ABSENT };
    }
    const result = await action(plugin);
    // A rejection refreshes like an acceptance: a write whose answer never
    // arrived may still have landed, so the roster must catch up with the
    // provider rather than keep advertising what it may have already taken. A
    // rejection that never reached the network is answered from the adapter's
    // cache anyway.
    if (result.status !== ACTION_RESULT_STATUS.UNSUPPORTED) {
      void sessionRegistry.refresh(plugin);
    }
    return countSessionAction(plugin.provider.id, counted, result);
  }

  // What a press fires is the address the roster reported, plus the one
  // nonce Superset's own rows mint per press: the app consumes a terminal
  // focus once per request id, so a nonce composed at observation time would
  // be spent by the first press and dead for every later one.
  const pressedLink = (link: string | undefined): string | undefined =>
    link === undefined ? undefined : supersetPressedLink(link, randomUUID());

  const countOpen = (identity: SessionIdentity) => {
    if (isProviderId(identity.providerId)) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACTION_SEND, {
        provider_id: identity.providerId,
        session_action: PRODUCT_SESSION_ACTION.SESSION_OPEN,
      });
    }
  };

  /**
   * The address each observed session last reported, kept for this run only,
   * so a press on the name of a chat the roster has since let go — archived
   * on its provider's own surface, most often — still opens the address its
   * provider gave it, which Conductor honours for an archived chat. Only the
   * plain open reads it: an app association or a change is opened from the
   * roster as it stands. Bounded per provider, oldest observation out first,
   * and never written anywhere.
   */
  const lastAddresses = new Map<string, Map<string, string>>();
  const rememberAddresses = (sessions: readonly Session[]): void => {
    for (const session of sessions) {
      const link = session.detail.link;
      if (link === undefined) continue;
      const known = lastAddresses.get(session.providerId) ?? new Map<string, string>();
      known.delete(session.providerSessionId);
      known.set(session.providerSessionId, link);
      while (known.size > REMEMBERED_ADDRESSES_PER_PROVIDER) {
        const oldest = known.keys().next().value;
        if (oldest === undefined) break;
        known.delete(oldest);
      }
      lastAddresses.set(session.providerId, known);
    }
  };
  // The roster as it stands when the performer is built counts as observed too.
  rememberAddresses(sessionRegistry.list());
  sessionRegistry.subscribe(rememberAddresses);
  const rememberedAddress = (identity: SessionIdentity): string | undefined =>
    lastAddresses.get(identity.providerId)?.get(identity.providerSessionId);

  const openAddress = async (
    identity: SessionIdentity,
    address: (identity: SessionIdentity) => string | undefined,
    // A session that left the roster and one still standing with nowhere to
    // go are different answers, and only the second says what to try instead.
    absentAddressReason: string,
    failureReason: string,
    kind: HostNodeOpenKind,
    // The address the session last reported, for an open of a session the
    // roster no longer holds; absent for the opens that read the roster alone.
    remembered?: (identity: SessionIdentity) => string | undefined,
  ): Promise<SessionOpenResult> => {
    const observed = sessionRegistry.get(identity) !== undefined;
    const url = observed ? address(identity) : remembered?.(identity);
    if (!url) {
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: observed ? absentAddressReason : REFUSAL.NO_SESSION,
      };
    }
    try {
      await openExternal(url, kind);
    } catch (error) {
      if (error instanceof ExternalOpenAnswerLostError) return unknownOpen(error);
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: failureReason };
    }
    countOpen(identity);
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };

  const openSession = (identity: SessionIdentity, kind: HostNodeOpenKind) =>
    openAddress(
      identity,
      (target) => pressedLink(sessionRegistry.get(target)?.detail.link),
      REFUSAL.NO_ADDRESS,
      REFUSAL.OPEN_FAILED,
      kind,
      (target) => pressedLink(rememberedAddress(target)),
    );

  const openSessionApplication = async (
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
    kind: HostNodeOpenKind,
  ): Promise<SessionOpenResult> => {
    const session = sessionRegistry.get(identity);
    if (!session) return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_SESSION };
    const application = session.applications.find((candidate) => candidate.id === applicationId);
    if (!application) {
      // The display names travel with the roster the caller already read,
      // so naming what still opens surfaces nothing the roster withheld.
      const openable = session.applications.filter((candidate) => candidate.link);
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: openable.length
          ? `That session opens only in ${openable.map((candidate) => candidate.displayName).join(", ")}.`
          : "That session lists no app to open in.",
      };
    }
    const url = pressedLink(application.link);
    if (!url) return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_APP_ADDRESS };
    try {
      await openExternal(url, kind);
    } catch (error) {
      if (error instanceof ExternalOpenAnswerLostError) return unknownOpen(error);
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.OPEN_APP_FAILED };
    }
    countOpen(identity);
    return { status: ACTION_RESULT_STATUS.ACCEPTED };
  };

  // The change is a web page beside the chat, not the chat itself: its row
  // press leaves the panel up, and so does the same open asked of Luke.
  const openSessionChange = (identity: SessionIdentity) =>
    openAddress(
      identity,
      (target) => sessionRegistry.get(target)?.detail.change,
      REFUSAL.NO_CHANGE,
      REFUSAL.OPEN_CHANGE_FAILED,
      HOST_NODE_OPEN_KIND.ADDRESS,
    );

  // A message is handed to the session's own provider, through the adapter
  // that observed it — the one component that knows the documented way in —
  // or, for a Superset-managed row, through the CLI that owns its terminal.
  const sendMessage = async (
    action: ValidatedAction<typeof ACTION_KIND.MESSAGE>,
  ): Promise<WireRecord> => {
    const { identity } = action;
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAction(
        identity.providerId,
        PRODUCT_SESSION_ACTION.MESSAGE_SEND,
        await supersetCli.sendMessage(managed, action.text),
      );
    }
    return performOnSession(identity, PRODUCT_SESSION_ACTION.MESSAGE_SEND, (plugin) =>
      dispatchAction(plugin, "message", providerSessionMessage(action)),
    );
  };

  // The control the action carries is the advertised entry itself, which is what
  // the effect is built from on either path.
  const executeControl = async (
    action: ValidatedAction<typeof ACTION_KIND.CONTROL>,
  ): Promise<WireRecord> => {
    const { identity, control } = action;
    const managed = supersetContext(identity);
    if (managed && isSupersetControlId(control.id)) {
      return countSessionAction(
        identity.providerId,
        PRODUCT_SESSION_ACTION.CONTROL_RUN,
        await supersetCli.executeControl(managed, control.id),
      );
    }
    return performOnSession(identity, PRODUCT_SESSION_ACTION.CONTROL_RUN, (plugin) =>
      dispatchAction(plugin, "control", providerControlRequest(action)),
    );
  };

  // A new workspace lands only in a project an adapter reported on its latest
  // pass — read back here from the adapter itself, never from the action — before
  // it reaches the provider's documented creation endpoint. A fixture run
  // offers no projects at all, so it refuses every ask without touching a
  // network.
  const createWorkspace = async (
    action: ValidatedAction<typeof ACTION_KIND.CREATE_WORKSPACE>,
    guard: ActionGuard | undefined,
  ): Promise<ProviderWorkspaceResult> => {
    const { providerId, providerProjectId, providerTargetId } = action;
    if (!sendsNetwork) {
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: "This run reaches no provider, so it can create nothing.",
      };
    }
    const plugin = pluginFor(providerId);
    if (!plugin) {
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: "That provider is not connected.",
      };
    }
    const project = (plugin.projects?.() ?? []).find(
      (candidate) =>
        candidate.providerProjectId === providerProjectId &&
        candidate.providerTargetId === providerTargetId,
    );
    if (!project) {
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: "No listed project matches that identity.",
      };
    }
    // A model the user named for this one creation outranks the stored choice
    // for this action alone; the stored choice stands otherwise. Both are held to
    // the build's documented table — the named one by admission, the stored one
    // when it was written — and the adapter holds whichever rides to its own
    // table again before anything reaches the network.
    const stored = isProviderId(providerId)
      ? (
          await guardedRead(
            settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field),
            guard,
          )
        )?.[providerId]
      : undefined;
    if (guard?.isRevoked())
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.TURN_OVER };
    const request = providerWorkspaceRequest(action, stored);
    const result = await dispatchAction(plugin, "createWorkspace", request);
    // A workspace that landed is a session the panel should be showing, so
    // the next look must actually ask rather than serve the cache. A
    // rejection refreshes too: a workspace can stand with its opening task
    // undelivered, and the adapter answers a rejection that never reached
    // the network from its cache anyway.
    if (result.status !== ACTION_RESULT_STATUS.UNSUPPORTED) {
      // A workspace that landed is also one the developer just asked to be
      // taken to, so the session the creation response named — an id the
      // adapter reported, never an address — waits here for observation to
      // report it, and is opened then like a pressed row. Noted before the
      // refresh, so the very pass that first sees the session resolves it.
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED && result.providerSessionId) {
        expectCreatedWorkspace(
          { providerId: plugin.provider.id, providerSessionId: result.providerSessionId },
          Date.now(),
        );
        // An interval pass can commit the new session while the creation's
        // own follow-up write is still in flight — before the entry above
        // exists — and a registry already holding the session commits
        // nothing further to resolve it. So the current picture is claimed
        // against here, and future commits carry every later arrival.
        openCreatedWorkspaces();
      }
      void sessionRegistry.refresh(plugin);
    }
    // The first workspace that actually lands chooses the default provider,
    // so a later ask that names none has somewhere unsurprising to go. Only
    // while nothing is chosen: a default the user holds is theirs to change,
    // never a creation's. Deterministic on the validated action — nothing a
    // model composed decides this — and losing the save loses only the
    // remembered default, never the workspace that just landed.
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
      await rememberWorkspaceDefaults(
        plugin,
        providerProjectId,
        providerTargetId,
        action.agentSelection,
        action.agent,
      );
      countSessionAction(plugin.provider.id, PRODUCT_SESSION_ACTION.WORKSPACE_CREATE, result);
      // The session the creation named rides out once more, as the identity
      // the brain's performer writes on the act's own line and cuts from the
      // answer before the model reads it — an id the roster is about to report
      // on its own, and never an address. The agent is the one the request
      // asked for; a creation that left the choice to the provider names none.
      const agent = request.agent ?? request.agentSelection?.agent;
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        ...(result.warning ? { warning: result.warning } : undefined),
        ...(result.providerSessionId
          ? {
              [CREATED_SESSION_FIELD]: {
                providerId: plugin.provider.id,
                providerSessionId: result.providerSessionId,
                ...(agent === undefined ? undefined : { agentId: agent }),
              },
            }
          : undefined),
      };
    }
    return result;
  };

  // Another agent in an observed workspace: the agent kind the action carries is
  // the one that session's own observation listed, and the adapter reads the
  // workspace it lands in back from its own last pass.
  const addWorkspaceAgent = async (
    action: ValidatedAction<typeof ACTION_KIND.ADD_AGENT>,
    guard: ActionGuard | undefined,
  ): Promise<WireRecord> => {
    const { identity } = action;
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAction(
        identity.providerId,
        PRODUCT_SESSION_ACTION.AGENT_ADD,
        await supersetCli.createAgent(managed, action.agent, action.task),
      );
    }
    return performOnSession(identity, PRODUCT_SESSION_ACTION.AGENT_ADD, async (plugin) => {
      const stored: WorkspaceAgentSelection | undefined = isProviderId(identity.providerId)
        ? (
            await guardedRead(
              settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field),
              guard,
            )
          )?.[identity.providerId]
        : undefined;
      if (guard?.isRevoked()) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.TURN_OVER };
      }
      return dispatchAction(plugin, "spawnAgent", providerWorkspaceAgentRequest(action, stored));
    });
  };

  // Renaming a workspace: the adapter resolves the workspace from its own
  // last pass, never from the action, which carries the session and the name.
  const renameWorkspace = async (
    action: ValidatedAction<typeof ACTION_KIND.RENAME_WORKSPACE>,
  ): Promise<WireRecord> => {
    const { identity } = action;
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAction(
        identity.providerId,
        PRODUCT_SESSION_ACTION.WORKSPACE_RENAME,
        await supersetCli.renameWorkspace(managed, action.name),
      );
    }
    return performOnSession(identity, PRODUCT_SESSION_ACTION.WORKSPACE_RENAME, (plugin) =>
      dispatchAction(plugin, "renameWorkspace", providerWorkspaceRenameRequest(action)),
    );
  };

  const renameSession = async (
    action: ValidatedAction<typeof ACTION_KIND.RENAME_SESSION>,
  ): Promise<WireRecord> =>
    performOnSession(action.identity, PRODUCT_SESSION_ACTION.SESSION_RENAME, (plugin) =>
      dispatchAction(plugin, "renameSession", providerSessionRenameRequest(action)),
    );

  // An issue action is built from observed state alone: the issue's own tracker
  // id comes back off the latest board rather than out of the action, and the
  // transition comes back off that issue's own listed set. A fixture run
  // observes no tracker, so it carries nothing.
  const performIssueAction = async (
    action: ValidatedAction<IssueActionKind>,
  ): Promise<TrackerActionResult> => {
    const issue = trackedIssues()?.find(
      (candidate) =>
        candidate.trackerId === action.identity.trackerId &&
        candidate.identifier === action.identity.identifier,
    );
    if (!issue) return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ISSUE };
    const tracker = issueTrackers.find((candidate) => candidate.tracker.id === issue.trackerId);
    if (!tracker) {
      return {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: "That issue's tracker is not connected.",
      };
    }

    let result: TrackerActionResult;
    if (action.kind === ACTION_KIND.ISSUE_STATE) {
      const transition = issue.transitions.find(
        (candidate) => candidate.id === action.transition.id,
      );
      if (!transition) {
        return {
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: "That issue lists no such state.",
        };
      }
      result = await tracker.execute({
        kind: ISSUE_ACTION_KIND.SET_STATE,
        trackerIssueId: issue.trackerIssueId,
        transition,
      });
    } else {
      result = await tracker.execute({
        kind: ISSUE_ACTION_KIND.COMMENT,
        trackerIssueId: issue.trackerIssueId,
        body: action.body,
      });
    }
    // An action that landed changes the board, so the roster should catch up
    // as soon as Linear will say.
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
      refreshIssues();
      if (isIssueTrackerId(issue.trackerId)) {
        recordProductEvent(PRODUCT_EVENT.ISSUE_ACTION_SEND, {
          tracker_id: issue.trackerId,
          issue_action:
            action.kind === ACTION_KIND.ISSUE_STATE
              ? PRODUCT_ISSUE_ACTION.STATE_MOVE
              : PRODUCT_ISSUE_ACTION.COMMENT_ADD,
        });
      }
    }
    return result;
  };

  // Of the actions below, only the create and the spawn await anything of their
  // own between admission and the provider effect, so only they take the
  // guard; the rest reach their adapter or the CLI with nothing awaited between.
  const performSessionAction = (
    action: ValidatedAction<SessionActionKind>,
    guard: ActionGuard | undefined,
  ): Promise<WireRecord> =>
    dispatchByKind(action, {
      [ACTION_KIND.MESSAGE]: sendMessage,
      [ACTION_KIND.CONTROL]: executeControl,
      // An open the brain carries was asked of Luke, never pressed on a row,
      // so the node is told a panel still stands over the chat coming forward.
      [ACTION_KIND.OPEN]: async (open): Promise<WireRecord> =>
        open.applicationId
          ? openSessionApplication(
              open.identity,
              open.applicationId,
              HOST_NODE_OPEN_KIND.ASKED_SESSION,
            )
          : openSession(open.identity, HOST_NODE_OPEN_KIND.ASKED_SESSION),
      [ACTION_KIND.CREATE_WORKSPACE]: async (creation): Promise<WireRecord> =>
        createWorkspace(creation, guard),
      [ACTION_KIND.ADD_AGENT]: (spawn) => addWorkspaceAgent(spawn, guard),
      [ACTION_KIND.RENAME_WORKSPACE]: renameWorkspace,
      [ACTION_KIND.RENAME_SESSION]: renameSession,
    });

  return {
    async perform(action, guard) {
      if (action.kind === ACTION_KIND.ISSUE_STATE || action.kind === ACTION_KIND.ISSUE_COMMENT) {
        return performIssueAction(action);
      }
      return performSessionAction(action, guard);
    },
    // The two a row press reaches: the pressing panel has stood itself down
    // already, so the node is handed an address and nothing more.
    openSession: (identity) => openSession(identity, HOST_NODE_OPEN_KIND.ADDRESS),
    openSessionApplication: (identity, applicationId) =>
      openSessionApplication(identity, applicationId, HOST_NODE_OPEN_KIND.ADDRESS),
    openSessionChange,
  };
}
