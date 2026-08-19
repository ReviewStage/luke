import {
  ATTENTION_REQUEST_RESULT_STATUS,
  type AttentionRequestRegistry,
  type AttentionRequestResult,
  attentionRequestText,
  type InMemorySessionRegistry,
  ISSUE_ACTION_KIND,
  type IssueIdentity,
  isProviderId,
  issueCommentText,
  type NormalizedSession,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderActResult,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceResult,
  SESSION_LOCATION,
  type SessionAttentionReviewer,
  type SessionIdentity,
  type SessionProviderAdapter,
  sessionMessageText,
  TRACKER_ACTION_RESULT_STATUS,
  type TrackedIssue,
  type TrackerActionResult,
  type WorkspaceAgentSelection,
  workspaceNameText,
} from "@sidecar/core";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { createActionHandler } from "../action-handler";
import type { LinearIssueTracker } from "../linear-tracker";
import type { SettingsStore } from "../settings-store";
import {
  channels,
  SESSION_OPEN_RESULT_STATUS,
  SESSION_TRANSCRIPT_RESULT_STATUS,
  type SessionOpenResult,
  type SessionTranscriptResult,
} from "../shared/contracts";
import { APP_SETTING_SCHEMA } from "../shared/settings-schema";
import { isWorkspaceAgentSelection } from "../shared/workspace-agents";
import type { SupersetCli } from "../superset-cli";
import type { SupersetSessionContext } from "../superset-workspaces";

export interface SessionActsIpcDependencies {
  ipcMain: Pick<IpcMain, "handle">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  sessionRegistry: InMemorySessionRegistry;
  openExternal: (url: string) => Promise<unknown>;
  adapterFor: (providerId: string) => SessionProviderAdapter | undefined;
  attentionReviewer: () => SessionAttentionReviewer | undefined;
  attentionRequests: AttentionRequestRegistry;
  broadcastNoticeAsks: () => void;
  sendsNetwork: boolean;
  settingsStore: SettingsStore;
  rememberWorkspaceDefaults: (
    adapter: SessionProviderAdapter,
    providerProjectId: string,
    selection: WorkspaceAgentSelection | undefined,
  ) => Promise<void>;
  expectCreatedWorkspace: (identity: SessionIdentity, now: number) => void;
  openCreatedWorkspaces: () => void;
  trackedIssues: () => readonly TrackedIssue[] | undefined;
  issueTrackers: readonly LinearIssueTracker[];
  refreshIssues: () => void;
  supersetContext: (identity: SessionIdentity) => SupersetSessionContext | undefined;
  supersetCli: SupersetCli;
}

export function registerSessionActsIpc(dependencies: SessionActsIpcDependencies): void {
  const {
    ipcMain,
    trustedSender,
    sessionRegistry,
    openExternal,
    adapterFor,
    attentionReviewer,
    attentionRequests,
    broadcastNoticeAsks,
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
  } = dependencies;
  const registerAction = createActionHandler({
    trustedSender,
    handle: (channel, handler) => ipcMain.handle(channel, handler),
  });
  // Capability checks stay in their handlers so no act can inherit another act's authority.
  async function performSessionAct<Result extends ProviderActResult>(
    identity: SessionIdentity,
    act: (adapter: SessionProviderAdapter, session: NormalizedSession) => Promise<Result>,
  ): Promise<Result | { status: typeof PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED }> {
    const session = sessionRegistry.get(identity);
    if (!session) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    const adapter = adapterFor(identity.providerId);
    if (!adapter) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    const result = await act(adapter, session);
    if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
      void sessionRegistry.refresh(adapter);
    }
    return result;
  }
  const registerOpenAction = (
    channel: string,
    address: (identity: SessionIdentity) => string | undefined,
    failureReason: string,
  ) =>
    registerAction<[SessionIdentity], SessionOpenResult>(channel, {
      validate: ([identity]) => {
        if (!isSessionIdentity(identity)) throw new Error("Invalid session open request");
        return [identity];
      },
      async act(identity) {
        const url = address(identity);
        if (!url) return { status: SESSION_OPEN_RESULT_STATUS.UNSUPPORTED };
        await openExternal(url);
        return { status: SESSION_OPEN_RESULT_STATUS.OPENED };
      },
      failure: () => ({ status: SESSION_OPEN_RESULT_STATUS.REJECTED, reason: failureReason }),
    });
  registerOpenAction(
    channels.openSession,
    (identity) => sessionRegistry.get(identity)?.detail.link,
    "The system could not open that session.",
  );
  registerOpenAction(
    channels.openSessionChange,
    (identity) => sessionRegistry.get(identity)?.detail.change,
    "The system could not open that pull request.",
  );

  // Pressing an issue — the notice under the housing while Luke names it —
  // hands its tracker's own address to the system, exactly as pressing a
  // session's row does. The renderer names an issue rather than an address,
  // so the pages Luke can send you to are the issues currently observed: the
  // URL is read back out of the roster, where normalization admitted nothing
  // but a bounded https address, and nothing reaches the tracker. A fixture
  // run observes no tracker and so opens nothing.
  registerAction<[IssueIdentity], SessionOpenResult>(channels.openIssue, {
    validate: ([identity]) => {
      if (!isIssueIdentity(identity)) throw new Error("Invalid issue open request");
      return [identity];
    },
    async act(identity) {
      const url = trackedIssues()?.find(
        (candidate) =>
          candidate.trackerId === identity.trackerId &&
          candidate.identifier === identity.identifier,
      )?.url;
      if (!url) return { status: SESSION_OPEN_RESULT_STATUS.UNSUPPORTED };
      await openExternal(url);
      return { status: SESSION_OPEN_RESULT_STATUS.OPENED };
    },
    failure: () => ({
      status: SESSION_OPEN_RESULT_STATUS.REJECTED,
      reason: "The system could not open that issue.",
    }),
  });

  // Reading a session's transcript is a conversational act that returns
  // session content instead of performing anything: the file its provider
  // wrote is read on this machine, rendered into a bounded conversation, and
  // discarded — nothing reaches a provider, and nothing is kept. The renderer
  // names a session rather than a path, validated here against the registry
  // like every session act, so the set of transcripts Luke can read is the
  // set of sessions currently observed. The session's own adapter is what
  // reads it, because the adapter is what knows the shape its provider wrote;
  // everything else — above all a cloud session, whose conversation lives
  // with its provider — answers honestly rather than guessing at files never
  // documented.
  ipcMain.handle(
    channels.readSessionTranscript,
    async (event, identity: unknown): Promise<SessionTranscriptResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid transcript request");
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      // Checked here as well as in the reader's own lookup, because one
      // provider observes both halves: a cloud Cursor agent shares its
      // provider id with the sessions on this machine, and only the local
      // half has a file here to read.
      if (session.location !== SESSION_LOCATION.LOCAL) {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.UNSUPPORTED,
          reason: "A cloud session's conversation lives with its provider, not on this machine.",
        };
      }
      const adapter = adapterFor(identity.providerId);
      if (!adapter) {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.UNSUPPORTED,
          reason: "That session's provider keeps no transcript this build can read.",
        };
      }
      try {
        const transcript = await adapter.readTranscript(identity.providerSessionId);
        if (!transcript) {
          return {
            status: SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED,
            reason: "That session's transcript could not be found.",
          };
        }
        return { status: SESSION_TRANSCRIPT_RESULT_STATUS.READ, transcript };
      } catch {
        return {
          status: SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED,
          reason: "That session's transcript could not be read.",
        };
      }
    },
  );

  // A reply typed on a row is handed to the session's own provider, through
  // the adapter that observed it — the one component that knows the documented
  // way in. The renderer names a session it is already drawing, the text is
  // bounded before an adapter sees it, and only a session whose latest
  // observation advertised taking messages gets one. Refusals are answers for
  // the row, never thrown: a send is the user's own act, and what became of it
  // belongs beside the field it left.
  ipcMain.handle(
    channels.sendSessionMessage,
    async (event, identity: unknown, text: unknown): Promise<ProviderMessageResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session message request");
      const message = boundedField(text, sessionMessageText);
      if (!message.ok || message.value === undefined) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A message has to be shorter than a document and longer than nothing.",
        };
      }
      const messageText = message.value;
      const session = sessionRegistry.get(identity);
      if (!session?.canReceiveMessage) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const managed = supersetContext(identity);
      if (managed) return supersetCli.sendMessage(managed, messageText);
      return performSessionAct(identity, (adapter) => {
        return adapter.sendMessage({
          providerSessionId: identity.providerSessionId,
          text: messageText,
        });
      });
    },
  );

  // A control runs the same gauntlet a message does, and one more: the id the
  // renderer names must be a control the session's latest observation actually
  // advertised. The registry is what advertised it, so the registry is what
  // answers whether it stands.
  ipcMain.handle(
    channels.executeSessionControl,
    async (event, identity: unknown, controlId: unknown): Promise<ProviderControlResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity) || typeof controlId !== "string" || !controlId.trim()) {
        throw new Error("Invalid session control request");
      }
      const session = sessionRegistry.get(identity);
      const control = session?.controls.find((candidate) => candidate.id === controlId);
      if (!control) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const managed = supersetContext(identity);
      if (managed) return supersetCli.executeControl(managed, control.id);
      return performSessionAct(identity, (adapter) => {
        return adapter.executeControl({
          providerSessionId: identity.providerSessionId,
          control,
        });
      });
    },
  );

  // A standing ask runs the front half of the message gauntlet — a trusted
  // sender, a bounded text, a session the registry actually observes — and
  // then stops on this machine: it is kept for the attention evaluator to
  // weigh updates against, and no adapter or provider ever sees it. It is
  // refused while no evaluator is configured, because keeping an ask nothing
  // will ever read is a promise Luke cannot keep.
  ipcMain.handle(
    channels.requestSessionNotice,
    (event, identity: unknown, request: unknown): AttentionRequestResult => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session notice request");
      const ask = attentionRequestText(request);
      if (!ask) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "An ask has to be one short request and longer than nothing.",
        };
      }
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      if (!attentionReviewer()) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No OpenAI key is connected, so nothing would ever read the ask.",
        };
      }
      attentionRequests.set(identity, ask);
      broadcastNoticeAsks();
      // The status rides the acceptance because the ask may already be
      // answered: a session asked about after it finished has no later finish
      // coming, and the reply should say so rather than promise one.
      return { status: ATTENTION_REQUEST_RESULT_STATUS.ACCEPTED, sessionStatus: session.status };
    },
  );

  ipcMain.handle(
    channels.withdrawSessionNotice,
    (event, identity: unknown): AttentionRequestResult => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isSessionIdentity(identity)) throw new Error("Invalid session notice request");
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      if (!attentionRequests.withdraw(identity)) {
        return {
          status: ATTENTION_REQUEST_RESULT_STATUS.REJECTED,
          reason: "No ask was standing for that session.",
        };
      }
      broadcastNoticeAsks();
      return { status: ATTENTION_REQUEST_RESULT_STATUS.ACCEPTED, sessionStatus: session.status };
    },
  );

  // A new workspace runs the same gauntlet a message does, against the list
  // that offered it: the renderer names a project rather than a repository, and
  // only a project an adapter reported on its latest pass — read back here from
  // the adapter itself, never from the request — reaches the provider's
  // documented creation endpoint. A fixture run offers no projects at all, so
  // it refuses every ask without touching a network.
  ipcMain.handle(
    channels.createSessionWorkspace,
    async (
      event,
      providerId: unknown,
      providerProjectId: unknown,
      name: unknown,
      task: unknown,
      namedSelection: unknown,
    ): Promise<ProviderWorkspaceResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (
        typeof providerId !== "string" ||
        !providerId.trim() ||
        typeof providerProjectId !== "string" ||
        !providerProjectId.trim() ||
        (name !== undefined && typeof name !== "string") ||
        (task !== undefined && typeof task !== "string")
      ) {
        throw new Error("Invalid workspace creation request");
      }
      // Its own statement so the guard's narrowing survives: past here the
      // named selection is a documented pairing or nothing at all.
      if (namedSelection !== undefined && !isWorkspaceAgentSelection(providerId, namedSelection)) {
        throw new Error("Invalid workspace creation request");
      }
      if (!sendsNetwork) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const adapter = adapterFor(providerId);
      if (!adapter) {
        return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      }
      const offered = adapter
        .workspaceProjects()
        .some((project) => project.providerProjectId === providerProjectId);
      if (!offered) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const workspaceName = boundedField(name, workspaceNameText);
      if (!workspaceName.ok) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A workspace name has to be short enough to say and longer than nothing.",
        };
      }
      // The task's own bound, and its fit to the project, are answered by the
      // adapter, which validates both against the projects it actually offers.
      const openingTask = boundedField(task, sessionMessageText);
      if (!openingTask.ok) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A task has to be shorter than a document and longer than nothing.",
        };
      }
      // A model the user named for this one creation outranks the stored
      // choice for this act alone; the stored choice stands otherwise. Both
      // are held to the build's documented table — the named one just above,
      // the stored one when it was written — and the adapter holds whichever
      // rides to its own table again before anything reaches the network.
      const stored = isProviderId(providerId)
        ? (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[providerId]
        : undefined;
      const agentSelection = namedSelection ?? stored;
      const result = await adapter.createWorkspace({
        providerProjectId,
        ...(workspaceName.value ? { name: workspaceName.value } : {}),
        ...(openingTask.value ? { task: openingTask.value } : {}),
        ...(agentSelection ? { agentSelection } : {}),
      });
      // A workspace that landed is a session the panel should be showing, so
      // the next look must actually ask rather than serve the cache. A
      // rejection refreshes too: a workspace can stand with its opening task
      // undelivered, and the adapter answers a rejection that never reached
      // the network from its cache anyway.
      if (result.status !== PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED) {
        // A workspace that landed is also one the developer just asked to be
        // taken to, so the session the creation response named — an id the
        // adapter reported, never an address — waits here for observation to
        // report it, and is opened then like a pressed row. Noted before the
        // refresh, so the very pass that first sees the session resolves it.
        if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED && result.providerSessionId) {
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
      if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
        await rememberWorkspaceDefaults(
          adapter,
          providerProjectId,
          namedSelection as WorkspaceAgentSelection | undefined,
        );
        // The named session was consumed above; the renderer's answer stays
        // what became of the ask, so nothing rides this boundary that the
        // roster will not report on its own.
        return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      }
      return result;
    },
  );

  // A spoken issue act runs the same gauntlet a session act does, in the same
  // two halves: the renderer refused anything its roster did not advertise,
  // and here every named thing is resolved again from the latest observation —
  // the issue by its identity, the transition by the id the tracker itself
  // listed — so what reaches a tracker client is built from observed state,
  // never from what a model composed.
  ipcMain.handle(
    channels.executeIssueAction,
    async (event, action: unknown): Promise<TrackerActionResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (!isIssueActionAsk(action)) throw new Error("Invalid issue action request");
      // A fixture run observes no tracker, so it refuses every act — a
      // deterministic capture must not reach Linear.
      const issue = trackedIssues()?.find(
        (candidate) =>
          candidate.trackerId === action.identity.trackerId &&
          candidate.identifier === action.identity.identifier,
      );
      if (!issue) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
      const tracker = issueTrackers.find((candidate) => candidate.tracker.id === issue.trackerId);
      if (!tracker) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };

      let result: TrackerActionResult;
      if (action.kind === "issue-state") {
        const transition = issue.transitions.find(
          (candidate) => candidate.id === action.transition?.id,
        );
        if (!transition) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.SET_STATE,
          trackerIssueId: issue.trackerIssueId,
          transition,
        });
      } else {
        if (!issue.canComment) return { status: TRACKER_ACTION_RESULT_STATUS.UNSUPPORTED };
        const body = boundedField(action.body, issueCommentText);
        if (!body.ok || body.value === undefined) {
          return {
            status: TRACKER_ACTION_RESULT_STATUS.REJECTED,
            reason: "A comment has to be shorter than a document and longer than nothing.",
          };
        }
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.COMMENT,
          trackerIssueId: issue.trackerIssueId,
          body: body.value,
        });
      }
      // An act that landed changes the board, so the roster should catch up
      // as soon as Linear will say.
      if (result.status === TRACKER_ACTION_RESULT_STATUS.ACCEPTED) {
        refreshIssues();
      }
      return result;
    },
  );

  // Another agent in an observed workspace runs the gauntlet a control does,
  // and one more: the agent kind the renderer names must be one the session's
  // latest observation actually listed. The registry is what advertised it, so
  // the registry is what answers whether it stands; the adapter then reads the
  // workspace back from its own last pass.
  ipcMain.handle(
    channels.addWorkspaceAgent,
    async (
      event,
      identity: unknown,
      agent: unknown,
      name: unknown,
      task: unknown,
      namedModel: unknown,
      namedEffort: unknown,
    ): Promise<ProviderWorkspaceResult> => {
      if (!trustedSender(event)) throw new Error("Untrusted renderer");
      if (
        !isSessionIdentity(identity) ||
        typeof agent !== "string" ||
        !agent.trim() ||
        (name !== undefined && typeof name !== "string") ||
        (task !== undefined && typeof task !== "string") ||
        (namedModel !== undefined && typeof namedModel !== "string") ||
        (namedEffort !== undefined && (typeof namedEffort !== "string" || namedModel === undefined))
      ) {
        throw new Error("Invalid workspace agent request");
      }
      return performSessionAct(identity, async (adapter, session) => {
        const advertised = session.spawnableAgents.find((candidate) => candidate === agent.trim());
        if (!advertised) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
        // A model named for this one agent must be a documented pairing of
        // exactly the asked-for kind: the user's chosen agent is never
        // re-decided by the model named beside it.
        if (
          namedModel !== undefined &&
          !isWorkspaceAgentSelection(identity.providerId, {
            agent: advertised,
            model: namedModel,
            ...(namedEffort !== undefined ? { effort: namedEffort } : {}),
          })
        ) {
          throw new Error("Invalid workspace agent request");
        }
        const sessionName = boundedField(name, workspaceNameText);
        if (!sessionName.ok) {
          return {
            status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
            reason: "A session name has to be short enough to say and longer than nothing.",
          };
        }
        const openingTask = boundedField(task, sessionMessageText);
        if (!openingTask.ok) {
          return {
            status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
            reason: "A task has to be shorter than a document and longer than nothing.",
          };
        }
        const managed = supersetContext(identity);
        if (managed) return supersetCli.createAgent(managed, advertised, openingTask.value);
        const stored: WorkspaceAgentSelection | undefined = isProviderId(identity.providerId)
          ? (await settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field))?.[
              identity.providerId
            ]
          : undefined;
        const fallback = stored?.agent === advertised ? stored : undefined;
        const model = namedModel ?? fallback?.model;
        const effort = namedModel !== undefined ? namedEffort : fallback?.effort;
        const result = await adapter.spawnWorkspaceAgent({
          providerSessionId: identity.providerSessionId,
          agent: advertised,
          ...(sessionName.value ? { name: sessionName.value } : {}),
          ...(openingTask.value ? { task: openingTask.value } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
        });
        if (result.status === PROVIDER_ACT_RESULT_STATUS.REJECTED) {
          void sessionRegistry.refresh(adapter);
        }
        return result;
      });
    },
  );
}

/**
 * Whether a renderer message names an issue, on the session identity's own
 * terms: both halves present, and everything it names re-resolved against the
 * latest observation before anything is done with it.
 */
function isIssueIdentity(value: unknown): value is IssueIdentity {
  if (value === null || typeof value !== "object") return false;
  const { trackerId, identifier } = value as Partial<IssueIdentity>;
  return (
    typeof trackerId === "string" &&
    trackerId.trim().length > 0 &&
    typeof identifier === "string" &&
    identifier.trim().length > 0
  );
}

function isSessionIdentity(value: unknown): value is SessionIdentity {
  if (value === null || typeof value !== "object") return false;
  const { providerId, providerSessionId } = value as Partial<SessionIdentity>;
  return (
    typeof providerId === "string" &&
    providerId.trim().length > 0 &&
    typeof providerSessionId === "string" &&
    providerSessionId.trim().length > 0
  );
}

function isIssueActionAsk(value: unknown): value is {
  kind: "issue-state" | "issue-comment";
  identity: { trackerId: string; identifier: string };
  transition?: { id: string; name: string };
  body?: string;
} {
  if (value === null || typeof value !== "object") return false;
  const { kind, identity } = value as {
    kind?: unknown;
    identity?: { trackerId?: unknown; identifier?: unknown };
  };
  if (kind !== "issue-state" && kind !== "issue-comment") return false;
  return (
    typeof identity?.trackerId === "string" &&
    identity.trackerId.trim().length > 0 &&
    typeof identity.identifier === "string" &&
    identity.identifier.trim().length > 0
  );
}

function boundedField(
  raw: unknown,
  bound: (value: unknown) => string | undefined,
): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = bound(raw);
  return value === undefined ? { ok: false } : { ok: true, value };
}
