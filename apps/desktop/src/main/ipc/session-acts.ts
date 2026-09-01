import { randomUUID } from "node:crypto";
import {
  ACT_VALIDATION_TARGET,
  type ActEnvelope,
  APP_TOOL_KIND,
  actValidationTarget,
  holdsRememberedFact,
  ISSUE_TOOL_KIND,
  isCarriedIssueAction,
  isCarriedSessionAction,
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
  type InMemorySessionRegistry,
  isListedWorkspaceAgentModel,
  isProviderId,
  type ProviderActResult,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceResult,
  SESSION_LOCATION,
  type Session,
  type SessionIdentity,
  type SessionProviderAdapter,
  sessionMessageText,
  type WorkspaceAgentSelection,
  workspaceNameText,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import type { SupersetSessionContext } from "@sidecar/superset";
import { isSupersetControlId, type SupersetCli, supersetPressedLink } from "@sidecar/superset";
import type { LinearIssueTracker } from "@sidecar/trackers";
import { ACT_RESULT_STATUS, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { IssueActionAsk, SessionOpenResult, SessionTranscriptResult } from "#shared/contracts";
import { createActionHandler } from "../action-handler";
import { registerBridgeEntry } from "../register-bridge";
import type { SettingsStore } from "../settings-store";

export interface SessionActsIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  sessionRegistry: InMemorySessionRegistry;
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
  /** The remembered entries as the main process holds them, and the write back. */
  rememberedFacts: () => readonly RememberedFact[];
  writeRememberedFacts: (facts: readonly RememberedFact[]) => boolean;
}

type ActAuthorizationDependencies = Pick<
  SessionActsIpcDependencies,
  "sessionRegistry" | "adapterFor" | "trackedIssues" | "rememberedFacts"
>;

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

/** Revalidates the renderer's act envelope against the main process's latest observations. */
export function authorizeActEnvelope(
  envelope: ActEnvelope,
  dependencies: ActAuthorizationDependencies,
): ProviderActResult {
  if (!envelope.armed) {
    return {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "Only a turn the developer opened can carry an act.",
    };
  }
  const target = actValidationTarget(envelope.id);
  if (!target) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such act exists." };
  }
  const { act } = envelope;
  if (target === ACT_VALIDATION_TARGET.SESSION_ROSTER) {
    if (isCarriedIssueAction(act)) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That act has the wrong target." };
    }
    if (
      isCarriedSessionAction(act) &&
      "identity" in act &&
      !dependencies.sessionRegistry.get(act.identity)
    ) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "No observed session matches that identity.",
      };
    }
  }
  if (target === ACT_VALIDATION_TARGET.ISSUE_ROSTER) {
    if (act.kind !== ISSUE_TOOL_KIND.ISSUE_STATE && act.kind !== ISSUE_TOOL_KIND.ISSUE_COMMENT) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That act has the wrong target." };
    }
    if (
      !dependencies
        .trackedIssues()
        ?.some(
          (issue) =>
            issue.trackerId === act.identity.trackerId &&
            issue.identifier === act.identity.identifier,
        )
    ) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "No tracked issue matches that identity.",
      };
    }
  }
  if (target === ACT_VALIDATION_TARGET.WORKSPACE_PROJECT) {
    if (act.kind !== SESSION_TOOL_KIND.CREATE_WORKSPACE) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That act has the wrong target." };
    }
    const adapter = dependencies.adapterFor(act.providerId);
    if (!adapter) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "That provider is not connected." };
    }
    if (
      !adapter
        .workspaceProjects()
        .some((project) => project.providerProjectId === act.providerProjectId)
    ) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "No listed project matches that identity.",
      };
    }
  }
  if (target === ACT_VALIDATION_TARGET.SETTING_ID && act.kind !== APP_TOOL_KIND.SETTING) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such setting act exists." };
  }
  if (target === ACT_VALIDATION_TARGET.UPDATE_ROW && act.kind !== APP_TOOL_KIND.UPDATE) {
    return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such update act exists." };
  }
  // The renderer validated the named entry against the list it was shown; this
  // is the same check against the list the main process actually holds, which
  // is the one the write lands on. A new entry names no prior id.
  if (target === ACT_VALIDATION_TARGET.REMEMBERED_FACT) {
    if (act.kind !== APP_TOOL_KIND.REMEMBER && act.kind !== APP_TOOL_KIND.FORGET) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "No such memory act exists." };
    }
    const named = act.kind === APP_TOOL_KIND.FORGET ? act.id : act.replaces;
    if (named !== undefined && !holdsRememberedFact(dependencies.rememberedFacts(), named)) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: "Nothing remembered goes by that id." };
    }
  }
  return { status: ACT_RESULT_STATUS.ACCEPTED };
}

export function registerSessionActsIpc(dependencies: SessionActsIpcDependencies): void {
  const {
    ipcMain,
    trustedSender,
    sessionRegistry,
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
    rememberedFacts,
    writeRememberedFacts,
  } = dependencies;
  const registerAction = createActionHandler({
    ipcMain,
    trustedSender,
  });
  const registerHandler = (
    definition: Parameters<typeof registerBridgeEntry>[1],
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- The manifest parses this erased domain result before it crosses Electron.
    handler: (...args: never[]) => unknown,
  ) =>
    registerBridgeEntry(BRIDGE, definition, (_context, ...args) => handler(...args), {
      ipcMain,
      trustedSender,
    });

  registerHandler(BRIDGE.authorizeAct, (envelope: ActEnvelope) =>
    authorizeActEnvelope(envelope, {
      sessionRegistry,
      adapterFor,
      trackedIssues,
      rememberedFacts,
    }),
  );

  /** The local writes behind automatic memory, returning only what actually persisted. */
  registerHandler(BRIDGE.rememberFact, (words: string, replaces: string | undefined) => {
    return saveRememberedFact(
      rememberedFacts(),
      words,
      replaces,
      randomUUID(),
      writeRememberedFacts,
    );
  });

  registerHandler(BRIDGE.forgetFact, (id: string) => {
    return forgetRememberedFact(rememberedFacts(), id, writeRememberedFacts);
  });
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
    if (!session)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "No observed session matches that identity.",
      };
    const adapter = adapterFor(identity.providerId);
    if (!adapter)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That session's provider is not connected.",
      };
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
  const registerOpenAction = (
    definition: Parameters<typeof registerAction>[0],
    address: (identity: SessionIdentity) => string | undefined,
    // A session that left the roster and one still standing with nowhere to
    // go are different answers, and only the second says what to try instead.
    absentAddressReason: string,
    failureReason: string,
  ) =>
    registerAction<[SessionIdentity], SessionOpenResult>(definition, {
      async act(identity) {
        if (!sessionRegistry.get(identity))
          return {
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "No observed session matches that identity.",
          };
        const url = address(identity);
        if (!url) return { status: ACT_RESULT_STATUS.UNSUPPORTED, reason: absentAddressReason };
        await openExternal(url);
        if (isProviderId(identity.providerId)) {
          recordProductEvent(PRODUCT_EVENT.SESSION_ACT_SEND, {
            provider_id: identity.providerId,
            session_act: PRODUCT_SESSION_ACT.SESSION_OPEN,
          });
        }
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      },
      failure: () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: failureReason }),
    });
  // What a press fires is the address the roster reported, plus the one
  // nonce Superset's own rows mint per press: the app consumes a terminal
  // focus once per request id, so a nonce composed at observation time would
  // be spent by the first press and dead for every later one.
  const pressedLink = (link: string | undefined): string | undefined =>
    link === undefined ? undefined : supersetPressedLink(link, randomUUID());
  registerOpenAction(
    BRIDGE.openSession,
    (identity) => pressedLink(sessionRegistry.get(identity)?.detail.link),
    "That session has no address to open.",
    "The system could not open that session.",
  );
  registerAction<[SessionIdentity, string], SessionOpenResult>(BRIDGE.openSessionApplication, {
    async act(identity, applicationId) {
      const session = sessionRegistry.get(identity);
      if (!session)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No observed session matches that identity.",
        };
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
      if (!url)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That session has no address to open in that app.",
        };
      await openExternal(url);
      if (isProviderId(identity.providerId)) {
        recordProductEvent(PRODUCT_EVENT.SESSION_ACT_SEND, {
          provider_id: identity.providerId,
          session_act: PRODUCT_SESSION_ACT.SESSION_OPEN,
        });
      }
      return { status: ACT_RESULT_STATUS.ACCEPTED };
    },
    failure: () => ({
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "The system could not open that session in the selected app.",
    }),
  });
  registerOpenAction(
    BRIDGE.openSessionChange,
    (identity) => sessionRegistry.get(identity)?.detail.change,
    "That session reports no pull request.",
    "The system could not open that pull request.",
  );

  // Pressing an issue — the notice under the housing while Luke names it —
  // hands its tracker's own address to the system, exactly as pressing a
  // session's row does. The renderer names an issue rather than an address,
  // so the pages Luke can send you to are the issues currently observed: the
  // URL is read back out of the roster, where normalization admitted nothing
  // but a bounded https address, and nothing reaches the tracker. A fixture
  // run observes no tracker and so opens nothing.
  registerAction<[IssueIdentity], SessionOpenResult>(BRIDGE.openIssue, {
    async act(identity) {
      const issue = trackedIssues()?.find(
        (candidate) =>
          candidate.trackerId === identity.trackerId &&
          candidate.identifier === identity.identifier,
      );
      if (!issue)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No tracked issue matches that identity.",
        };
      if (!issue.url)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That issue has no address to open.",
        };
      await openExternal(issue.url);
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
    },
    failure: () => ({
      status: ACT_RESULT_STATUS.REJECTED,
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
  registerHandler(
    BRIDGE.readSessionTranscript,
    async (identity: SessionIdentity): Promise<SessionTranscriptResult> => {
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "No observed session matches that identity.",
        };
      }
      // Checked here as well as in the reader's own lookup, because one
      // provider observes both halves: a cloud Cursor agent shares its
      // provider id with the sessions on this machine, and only the local
      // half has a file here to read.
      if (session.location !== SESSION_LOCATION.LOCAL) {
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "A cloud session's conversation lives with its provider, not on this machine.",
        };
      }
      const adapter = adapterFor(identity.providerId);
      if (!adapter) {
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That session's provider keeps no transcript this build can read.",
        };
      }
      try {
        const result = await adapter.readTranscript(identity.providerSessionId);
        if (result.status === ACT_RESULT_STATUS.ACCEPTED && isProviderId(identity.providerId)) {
          recordProductEvent(PRODUCT_EVENT.SESSION_ACT_SEND, {
            provider_id: identity.providerId,
            session_act: PRODUCT_SESSION_ACT.TRANSCRIPT_READ,
          });
        }
        return result;
      } catch {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
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
  registerHandler(
    BRIDGE.sendSessionMessage,
    async (identity: SessionIdentity, text: string): Promise<ProviderMessageResult> => {
      const message = boundedField(text, sessionMessageText);
      if (!message.ok || message.value === undefined) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "That message is empty or too long.",
        };
      }
      const messageText = message.value;
      const session = sessionRegistry.get(identity);
      if (!session) {
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No observed session matches that identity.",
        };
      }
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
      return performSessionAct(identity, PRODUCT_SESSION_ACT.MESSAGE_SEND, (adapter) => {
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
  registerHandler(
    BRIDGE.executeSessionControl,
    async (identity: SessionIdentity, controlId: string): Promise<ProviderControlResult> => {
      const session = sessionRegistry.get(identity);
      if (!session)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No observed session matches that identity.",
        };
      const control = session.controls.find((candidate) => candidate.id === controlId);
      // The labels travel with the roster the caller already read, so naming
      // what still stands surfaces nothing the roster withheld.
      if (!control)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: session.controls.length
            ? `That session advertises no such control, only ${session.controls.map((candidate) => candidate.label).join(", ")}.`
            : "That session advertises no controls right now.",
        };
      const managed = supersetContext(identity);
      if (managed && isSupersetControlId(control.id)) {
        return countSessionAct(
          identity.providerId,
          PRODUCT_SESSION_ACT.CONTROL_RUN,
          await supersetCli.executeControl(managed, control.id),
        );
      }
      return performSessionAct(identity, PRODUCT_SESSION_ACT.CONTROL_RUN, (adapter) => {
        return adapter.executeControl({
          providerSessionId: identity.providerSessionId,
          control,
        });
      });
    },
  );

  // A new workspace runs the same gauntlet a message does, against the list
  // that offered it: the renderer names a project rather than a repository, and
  // only a project an adapter reported on its latest pass — read back here from
  // the adapter itself, never from the request — reaches the provider's
  // documented creation endpoint. A fixture run offers no projects at all, so
  // it refuses every ask without touching a network.
  registerHandler(
    BRIDGE.createSessionWorkspace,
    async (
      providerId: string,
      providerProjectId: string,
      providerTargetId: string | undefined,
      agent: string | undefined,
      name: string | undefined,
      task: string | undefined,
      namedSelection: WorkspaceAgentSelection | undefined,
    ): Promise<ProviderWorkspaceResult> => {
      const parsedSelection = namedSelection;
      if (!sendsNetwork)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "This run reaches no provider, so it can create nothing.",
        };
      const adapter = adapterFor(providerId);
      if (!adapter) {
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That provider is not connected.",
        };
      }
      const project = adapter
        .workspaceProjects()
        .find(
          (candidate) =>
            candidate.providerProjectId === providerProjectId &&
            candidate.providerTargetId === providerTargetId,
        );
      if (!project)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No listed project matches that identity.",
        };
      if (project.spawnableAgents && !(agent && project.spawnableAgents.includes(agent.trim())))
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: project.spawnableAgents.length
            ? `That project lists no such agent, only ${project.spawnableAgents.join(", ")}.`
            : "That project lists no agent to create with.",
        };
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
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "That task is empty or too long.",
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
      const agentSelection = parsedSelection ?? stored;
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
          parsedSelection,
          isWireString(agent) ? agent.trim() : undefined,
        );
        countSessionAct(adapter.provider.id, PRODUCT_SESSION_ACT.WORKSPACE_CREATE, result);
        // The named session was consumed above; the renderer's answer stays
        // what became of the ask, so nothing rides this boundary that the
        // roster will not report on its own.
        return result.warning
          ? { status: ACT_RESULT_STATUS.ACCEPTED, warning: result.warning }
          : { status: ACT_RESULT_STATUS.ACCEPTED };
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
  registerHandler(
    BRIDGE.executeIssueAction,
    async (action: IssueActionAsk): Promise<TrackerActionResult> => {
      // A fixture run observes no tracker, so it refuses every act — a
      // deterministic capture must not reach Linear.
      const issue = trackedIssues()?.find(
        (candidate) =>
          candidate.trackerId === action.identity.trackerId &&
          candidate.identifier === action.identity.identifier,
      );
      if (!issue)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No tracked issue matches that identity.",
        };
      const tracker = issueTrackers.find((candidate) => candidate.tracker.id === issue.trackerId);
      if (!tracker)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That issue's tracker is not connected.",
        };

      let result: TrackerActionResult;
      if (action.kind === "issue-state") {
        const transition = issue.transitions.find(
          (candidate) => candidate.id === action.transition?.id,
        );
        if (!transition)
          return {
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "That issue lists no such state.",
          };
        result = await tracker.execute({
          kind: ISSUE_ACTION_KIND.SET_STATE,
          trackerIssueId: issue.trackerIssueId,
          transition,
        });
      } else {
        if (!issue.canComment)
          return {
            status: ACT_RESULT_STATUS.UNSUPPORTED,
            reason: "That issue does not take comments.",
          };
        const body = boundedField(action.body, issueCommentText);
        if (!body.ok || body.value === undefined) {
          return {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "That comment is empty or too long.",
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
      if (result.status === ACT_RESULT_STATUS.ACCEPTED) {
        refreshIssues();
        if (isIssueTrackerId(issue.trackerId)) {
          recordProductEvent(PRODUCT_EVENT.ISSUE_ACT_SEND, {
            tracker_id: issue.trackerId,
            issue_act:
              action.kind === "issue-state"
                ? PRODUCT_ISSUE_ACT.STATE_MOVE
                : PRODUCT_ISSUE_ACT.COMMENT_ADD,
          });
        }
      }
      return result;
    },
  );

  // Another agent in an observed workspace runs the gauntlet a control does,
  // and one more: the agent kind the renderer names must be one the session's
  // latest observation actually listed. The registry is what advertised it, so
  // the registry is what answers whether it stands; the adapter then reads the
  // workspace back from its own last pass.
  registerHandler(
    BRIDGE.addWorkspaceAgent,
    async (
      identity: SessionIdentity,
      agent: string,
      name: string | undefined,
      task: string | undefined,
      namedModel: string | undefined,
      namedEffort: string | undefined,
    ): Promise<ProviderWorkspaceResult> => {
      const session = sessionRegistry.get(identity);
      if (!session)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No observed session matches that identity.",
        };
      const advertised = session.spawnableAgents.find((candidate) => candidate === agent.trim());
      if (!advertised)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: session.spawnableAgents.length
            ? `That session lists no such agent to add, only ${session.spawnableAgents.join(", ")}.`
            : "That session lists no agent to add.",
        };
      // A model named for this one agent must be a documented pairing of
      // exactly the asked-for kind: the user's chosen agent is never
      // re-decided by the model named beside it.
      if (namedModel !== undefined) {
        const selection: WorkspaceAgentSelection = { agent: advertised, model: namedModel };
        if (namedEffort !== undefined) selection.effort = namedEffort;
        if (!isListedWorkspaceAgentModel(identity.providerId, selection)) {
          throw new Error("Invalid workspace agent request");
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
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "That task is empty or too long.",
        };
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
    },
  );

  // Renaming a workspace runs the gauntlet a control does: the session the
  // renderer names must have advertised a rename target on its latest
  // observation. The registry is what advertised it, so the registry is what
  // answers whether it stands; the adapter then resolves the workspace from
  // its own last pass, never from the request.
  registerHandler(
    BRIDGE.renameSessionWorkspace,
    async (identity: SessionIdentity, name: string): Promise<ProviderActResult> => {
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
      if (!session)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No observed session matches that identity.",
        };
      if (!session.renameTarget)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That session's workspace cannot be renamed.",
        };
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
    },
  );

  // Renaming a chat itself runs the same gauntlet one notch narrower: only a
  // session whose latest observation advertised `canRename` takes one, and
  // the registry that advertised it is what answers whether it stands.
  registerHandler(
    BRIDGE.renameSession,
    async (identity: SessionIdentity, name: string): Promise<ProviderActResult> => {
      const sessionName = workspaceNameText(name);
      if (!sessionName) {
        return {
          status: ACT_RESULT_STATUS.REJECTED,
          reason: "That session name is empty or too long.",
        };
      }
      const session = sessionRegistry.get(identity);
      if (!session)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "No observed session matches that identity.",
        };
      if (!session.canRename)
        return {
          status: ACT_RESULT_STATUS.UNSUPPORTED,
          reason: "That chat cannot be renamed.",
        };
      return performSessionAct(identity, PRODUCT_SESSION_ACT.SESSION_RENAME, (adapter) =>
        adapter.renameSession({
          providerSessionId: identity.providerSessionId,
          name: sessionName,
        }),
      );
    },
  );
}

function boundedField(
  raw: UnparsedWireValue,
  bound: (value: UnparsedWireValue) => string | undefined,
): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = bound(raw);
  return value === undefined ? { ok: false } : { ok: true, value };
}
