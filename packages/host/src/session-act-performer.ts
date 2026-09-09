import { randomUUID } from "node:crypto";
import {
  ACT_KIND,
  ACT_REFUSAL,
  type ActGuard,
  dispatchByKind,
  guardedRead,
  type IssueActKind,
  providerControlRequest,
  providerSessionMessage,
  providerSessionRenameRequest,
  providerWorkspaceAgentRequest,
  providerWorkspaceRenameRequest,
  providerWorkspaceRequest,
  type SessionActKind,
  type ValidatedAct,
} from "@sidecar/acts";
import {
  PRODUCT_EVENT,
  PRODUCT_ISSUE_ACT,
  PRODUCT_SESSION_ACT,
  type ProductSessionAct,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { LinearIssueTracker } from "@sidecar/credentials";
import {
  ISSUE_ACTION_KIND,
  isIssueTrackerId,
  type TrackedIssue,
  type TrackerActionResult,
} from "@sidecar/issues";
import {
  isSupersetControlId,
  type SupersetCli,
  type SupersetSessionContext,
  supersetPressedLink,
} from "@sidecar/providers";
import {
  dispatchAct,
  ExternalOpenAnswerLostError,
  isProviderId,
  type ProviderActResult,
  type ProviderWorkspaceResult,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionOpenResult,
  type SessionProviderPlugin,
  type SessionRoster,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import {
  ACT_RESULT_STATUS,
  UNKNOWN_ACT_STATUS,
  type UnknownActResult,
  type WireRecord,
} from "@sidecar/wire";
import type { SettingsStore } from "./settings-store.js";

/**
 * An open that was handed to the native node and whose answer was lost with
 * the node's connection: the system may have opened the address. Thrown by
 * the open port so the act that asked records itself unknown, never failed
 * and never retried.
 */
export { ExternalOpenAnswerLostError as NodeAnswerLostError };

/** What an open answers when its answer was lost: the effect is uncertain. */
function unknownOpen(error: ExternalOpenAnswerLostError): SessionOpenResult {
  return { status: UNKNOWN_ACT_STATUS, reason: error.message };
}

/**
 * What performing an act needs from the app: the registry the act is
 * validated against once more, the adapters that carry it, and the seams a
 * landed act moves — the refresh, the created-workspace watch, the counts.
 */
export interface SessionActPerformerDependencies {
  sessionRegistry: SessionRoster;
  openExternal: (url: string) => Promise<void>;
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
 * The one entry every act on a session or an issue passes through. The brain
 * is the only caller, and what arrives is a `ValidatedAct`, which only
 * `admit()` mints: whether the act may run was decided there, against the
 * roster it read for itself, so what is left here is carrying it — reading each
 * effect's own route back out of the adapter or the tracker that offered it,
 * and counting what landed. The opens are exposed on their own because a row
 * press is not a write and reaches them without the brain.
 */
export interface SessionActPerformer {
  /**
   * The guard is asked once more at the last boundary before a provider
   * effect. A brain-origin act arrives with one; a row press, which is not a
   * write and opens its turn and its effect in the same breath, carries none.
   * Only a create and a spawn ask it, because only they await a read of their
   * own — the stored agent defaults — between admission and the write.
   */
  perform(act: ValidatedAct<SessionActKind | IssueActKind>, guard?: ActGuard): Promise<WireRecord>;
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
  NO_SESSION: ACT_REFUSAL.NO_SESSION,
  NO_ISSUE: ACT_REFUSAL.NO_ISSUE,
  NO_ADDRESS: ACT_REFUSAL.NO_ADDRESS,
  TURN_OVER: ACT_REFUSAL.TURN_OVER,
  PROVIDER_ABSENT: "That session's provider is not connected.",
  NO_APP_ADDRESS: "That session has no address to open in that app.",
  NO_CHANGE: "That session reports no pull request.",
  OPEN_FAILED: OPEN_REFUSAL.SESSION,
  OPEN_APP_FAILED: OPEN_REFUSAL.APPLICATION,
  OPEN_CHANGE_FAILED: OPEN_REFUSAL.CHANGE,
} as const;

export function createSessionActPerformer(
  dependencies: SessionActPerformerDependencies,
): SessionActPerformer {
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
   * Counts an act that actually landed. It takes the result rather than
   * sitting inside `performSessionAct`, because a Superset-managed session
   * takes the same acts through the CLI without passing through there — an act
   * counted in only one of the two paths would read as a provider nobody sends
   * messages to.
   */
  function countSessionAct<Result extends ProviderActResult | UnknownActResult>(
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

  /**
   * Hands one admitted act to the adapter that observed its session. Whether
   * the act may run is admission's answer; what is asked here is whether this
   * process still holds the provider it names at all, which is a fact about
   * the app rather than about the roster.
   */
  async function performSessionAct<Result extends ProviderActResult | UnknownActResult>(
    identity: SessionIdentity,
    counted: ProductSessionAct,
    act: (plugin: SessionProviderPlugin) => Promise<Result>,
  ): Promise<Result | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string }> {
    const plugin = pluginFor(identity.providerId);
    if (!plugin) {
      return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.PROVIDER_ABSENT };
    }
    const result = await act(plugin);
    // A rejection refreshes like an acceptance: a write whose answer never
    // arrived may still have landed, so the roster must catch up with the
    // provider rather than keep advertising what it may have already taken. A
    // rejection that never reached the network is answered from the adapter's
    // cache anyway.
    if (result.status !== ACT_RESULT_STATUS.UNSUPPORTED) {
      void sessionRegistry.refresh(plugin);
    }
    return countSessionAct(plugin.provider.id, counted, result);
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
  ): Promise<SessionOpenResult> => {
    const observed = sessionRegistry.get(identity) !== undefined;
    const url = observed ? address(identity) : undefined;
    if (!url) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: observed ? absentAddressReason : REFUSAL.NO_SESSION,
      };
    }
    try {
      await openExternal(url);
    } catch (error) {
      if (error instanceof ExternalOpenAnswerLostError) return unknownOpen(error);
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
    } catch (error) {
      if (error instanceof ExternalOpenAnswerLostError) return unknownOpen(error);
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

  // A message is handed to the session's own provider, through the adapter
  // that observed it — the one component that knows the documented way in —
  // or, for a Superset-managed row, through the CLI that owns its terminal.
  const sendMessage = async (act: ValidatedAct<typeof ACT_KIND.MESSAGE>): Promise<WireRecord> => {
    const { identity } = act;
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.MESSAGE_SEND,
        await supersetCli.sendMessage(managed, act.text),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.MESSAGE_SEND, (plugin) =>
      dispatchAct(plugin, "message", providerSessionMessage(act)),
    );
  };

  // The control the act carries is the advertised entry itself, which is what
  // the effect is built from on either path.
  const executeControl = async (
    act: ValidatedAct<typeof ACT_KIND.CONTROL>,
  ): Promise<WireRecord> => {
    const { identity, control } = act;
    const managed = supersetContext(identity);
    if (managed && isSupersetControlId(control.id)) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.CONTROL_RUN,
        await supersetCli.executeControl(managed, control.id),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.CONTROL_RUN, (plugin) =>
      dispatchAct(plugin, "control", providerControlRequest(act)),
    );
  };

  // A new workspace lands only in a project an adapter reported on its latest
  // pass — read back here from the adapter itself, never from the act — before
  // it reaches the provider's documented creation endpoint. A fixture run
  // offers no projects at all, so it refuses every ask without touching a
  // network.
  const createWorkspace = async (
    act: ValidatedAct<typeof ACT_KIND.CREATE_WORKSPACE>,
    guard: ActGuard | undefined,
  ): Promise<ProviderWorkspaceResult> => {
    const { providerId, providerProjectId, providerTargetId } = act;
    if (!sendsNetwork) {
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "This run reaches no provider, so it can create nothing.",
      };
    }
    const plugin = pluginFor(providerId);
    if (!plugin) {
      return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: "That provider is not connected." };
    }
    const project = (plugin.projects?.() ?? []).find(
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
    // A model the user named for this one creation outranks the stored choice
    // for this act alone; the stored choice stands otherwise. Both are held to
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
      return { status: ACT_RESULT_STATUS.REJECTED, reason: REFUSAL.TURN_OVER };
    const result = await dispatchAct(
      plugin,
      "createWorkspace",
      providerWorkspaceRequest(act, stored),
    );
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
    // never a creation's. Deterministic on the validated act — nothing a
    // model composed decides this — and losing the save loses only the
    // remembered default, never the workspace that just landed.
    if (result.status === ACT_RESULT_STATUS.ACCEPTED) {
      await rememberWorkspaceDefaults(
        plugin,
        providerProjectId,
        providerTargetId,
        act.agentSelection,
        act.agent,
      );
      countSessionAct(plugin.provider.id, PRODUCT_SESSION_ACT.WORKSPACE_CREATE, result);
      // The named session was consumed above; the answer stays what became
      // of the ask, so nothing rides out that the roster will not report on
      // its own.
      return result.warning
        ? { status: ACT_RESULT_STATUS.ACCEPTED, warning: result.warning }
        : { status: ACT_RESULT_STATUS.ACCEPTED };
    }
    return result;
  };

  // Another agent in an observed workspace: the agent kind the act carries is
  // the one that session's own observation listed, and the adapter reads the
  // workspace it lands in back from its own last pass.
  const addWorkspaceAgent = async (
    act: ValidatedAct<typeof ACT_KIND.ADD_AGENT>,
    guard: ActGuard | undefined,
  ): Promise<WireRecord> => {
    const { identity } = act;
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.AGENT_ADD,
        await supersetCli.createAgent(managed, act.agent, act.task),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.AGENT_ADD, async (plugin) => {
      const stored: WorkspaceAgentSelection | undefined = isProviderId(identity.providerId)
        ? (
            await guardedRead(
              settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field),
              guard,
            )
          )?.[identity.providerId]
        : undefined;
      if (guard?.isRevoked()) {
        return { status: ACT_RESULT_STATUS.REJECTED, reason: REFUSAL.TURN_OVER };
      }
      return dispatchAct(plugin, "spawnAgent", providerWorkspaceAgentRequest(act, stored));
    });
  };

  // Renaming a workspace: the adapter resolves the workspace from its own
  // last pass, never from the act, which carries the session and the name.
  const renameWorkspace = async (
    act: ValidatedAct<typeof ACT_KIND.RENAME_WORKSPACE>,
  ): Promise<WireRecord> => {
    const { identity } = act;
    const managed = supersetContext(identity);
    if (managed) {
      return countSessionAct(
        identity.providerId,
        PRODUCT_SESSION_ACT.WORKSPACE_RENAME,
        await supersetCli.renameWorkspace(managed, act.name),
      );
    }
    return performSessionAct(identity, PRODUCT_SESSION_ACT.WORKSPACE_RENAME, (plugin) =>
      dispatchAct(plugin, "renameWorkspace", providerWorkspaceRenameRequest(act)),
    );
  };

  const renameSession = async (
    act: ValidatedAct<typeof ACT_KIND.RENAME_SESSION>,
  ): Promise<WireRecord> =>
    performSessionAct(act.identity, PRODUCT_SESSION_ACT.SESSION_RENAME, (plugin) =>
      dispatchAct(plugin, "renameSession", providerSessionRenameRequest(act)),
    );

  // An issue act is built from observed state alone: the issue's own tracker
  // id comes back off the latest board rather than out of the act, and the
  // transition comes back off that issue's own listed set. A fixture run
  // observes no tracker, so it carries nothing.
  const performIssueAct = async (
    action: ValidatedAct<IssueActKind>,
  ): Promise<TrackerActionResult> => {
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
    if (action.kind === ACT_KIND.ISSUE_STATE) {
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
      result = await tracker.execute({
        kind: ISSUE_ACTION_KIND.COMMENT,
        trackerIssueId: issue.trackerIssueId,
        body: action.body,
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
            action.kind === ACT_KIND.ISSUE_STATE
              ? PRODUCT_ISSUE_ACT.STATE_MOVE
              : PRODUCT_ISSUE_ACT.COMMENT_ADD,
        });
      }
    }
    return result;
  };

  // Of the acts below, only the create and the spawn await anything of their
  // own between admission and the provider effect, so only they take the
  // guard; the rest reach their adapter or the CLI with nothing awaited between.
  const performSessionAction = (
    act: ValidatedAct<SessionActKind>,
    guard: ActGuard | undefined,
  ): Promise<WireRecord> =>
    dispatchByKind(act, {
      [ACT_KIND.MESSAGE]: sendMessage,
      [ACT_KIND.CONTROL]: executeControl,
      [ACT_KIND.OPEN]: async (open): Promise<WireRecord> =>
        open.applicationId
          ? openSessionApplication(open.identity, open.applicationId)
          : openSession(open.identity),
      [ACT_KIND.CREATE_WORKSPACE]: async (creation): Promise<WireRecord> =>
        createWorkspace(creation, guard),
      [ACT_KIND.ADD_AGENT]: (spawn) => addWorkspaceAgent(spawn, guard),
      [ACT_KIND.RENAME_WORKSPACE]: renameWorkspace,
      [ACT_KIND.RENAME_SESSION]: renameSession,
    });

  return {
    async perform(act, guard) {
      if (act.kind === ACT_KIND.ISSUE_STATE || act.kind === ACT_KIND.ISSUE_COMMENT) {
        return performIssueAct(act);
      }
      return performSessionAction(act, guard);
    },
    openSession,
    openSessionApplication,
    openSessionChange,
  };
}
