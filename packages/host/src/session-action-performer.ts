import {
  ACTION_KIND,
  ACTION_REFUSAL,
  type ActionGuard,
  type CarriedActionResult,
  dispatchByKind,
  guardedRead,
  type SessionActionKind,
  type ValidatedAction,
} from "@sidecar/actions";
import {
  PRODUCT_EVENT,
  PRODUCT_SESSION_ACTION,
  type ProductSessionAction,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { HostedActionClient, HostedActionOutcome, HostedActionTarget } from "@sidecar/hosted";
import {
  type CloudAgentProviderId,
  ExternalOpenAnswerLostError,
  isCloudAgentProviderId,
  isProviderId,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionOpenResult,
  type SessionRoster,
  type SessionWriteResult,
  type WorkspaceAgentSelection,
} from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import {
  HOSTED_ACTION_ANSWER,
  hostedActionResult,
  settleHostedWrite,
} from "./hosted-action-result.js";
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
 * What performing an action needs from the app: the roster an open reads its
 * address from, the service call that carries every write, and the seams a
 * landed action moves — the refresh, the created-workspace watch, the counts.
 */
export interface SessionActionPerformerDependencies {
  sessionRegistry: Pick<SessionRoster, "get">;
  /**
   * Hands an address to the operating system through the native node, told
   * what the address is: a row's press has already stood its panel down, and
   * an open asked of Luke has no press behind it, so the client's windows
   * owe the two different things.
   */
  openExternal: (url: string, kind: HostNodeOpenKind) => Promise<void>;
  /**
   * The service's side of every session write. The service admits each
   * against the stored snapshot this Mac's rows were drawn from, by the same
   * `admitEffect()` the brain already ran here, builds the write from that
   * snapshot's own advertisement, and answers what the provider said.
   */
  actions: Pick<
    HostedActionClient,
    | "sendMessage"
    | "executeControl"
    | "createWorkspace"
    | "addAgent"
    | "renameSession"
    | "renameWorkspace"
  >;
  /** Pokes a fresh observation pass, so a write that moved a session is seen rather than remembered. */
  refreshSessions: Effect.Effect<void>;
  sendsNetwork: boolean;
  settingsStore: Pick<SettingsStore, "get">;
  rememberWorkspaceDefaults: (
    providerId: CloudAgentProviderId,
    providerProjectId: string,
    selection: WorkspaceAgentSelection | undefined,
  ) => Effect.Effect<void>;
  expectCreatedWorkspace: (identity: SessionIdentity, now: number) => void;
  openCreatedWorkspaces: () => void;
  recordProductEvent: RecordProductEvent;
}

/**
 * The one entry every action on a session passes through. The brain
 * is the only caller, and what arrives is a `ValidatedAction`, which only
 * `admitEffect()` mints: whether the action may run was decided there, against the
 * roster it read for itself, so what is left here is carrying it — a session
 * write to the service that admits it once more against the same stored
 * snapshot — and counting what landed. The opens are exposed on their own
 * because a row press is not a
 * write and reaches them without the brain.
 */
export interface SessionActionPerformer {
  /**
   * The guard is asked once more at the last boundary before a provider
   * effect. A brain-origin action arrives with one; a row press, which is not a
   * write and opens its turn and its effect in the same breath, carries none.
   * Only a create and a spawn ask it, because only they wait on a read of
   * their own — the stored agent defaults — between admission and the write.
   */
  perform(
    action: ValidatedAction<SessionActionKind>,
    guard?: ActionGuard,
  ): Effect.Effect<CarriedActionResult>;
  openSession(identity: SessionIdentity): Effect.Effect<SessionOpenResult>;
  openSessionApplication(
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Effect.Effect<SessionOpenResult>;
  openSessionChange(identity: SessionIdentity): Effect.Effect<SessionOpenResult>;
}

/** What an open answers when the system refused it: the words a row press and the brain's ask share. */
export const OPEN_REFUSAL = {
  SESSION: "The system could not open that session.",
  APPLICATION: "The system could not open that session in the selected app.",
  CHANGE: "The system could not open that pull request.",
} as const;

const REFUSAL = {
  // The sentences `admit` already says for these. The performer refuses the
  // same things at the last boundary before an effect, and a refusal worded
  // twice is a refusal that drifts.
  NO_SESSION: ACTION_REFUSAL.NO_SESSION,
  NO_ADDRESS: ACTION_REFUSAL.NO_ADDRESS,
  TURN_OVER: ACTION_REFUSAL.TURN_OVER,
  NO_ENDPOINT: HOSTED_ACTION_ANSWER.NO_ENDPOINT,
  NO_CREATION: "That provider documents no way to create a workspace from this Mac.",
  NO_NETWORK: "This run reaches no provider, so it can create nothing.",
  NO_APP_ADDRESS: "That session has no address to open in that app.",
  NO_CHANGE: "That session reports no pull request.",
  OPEN_FAILED: OPEN_REFUSAL.SESSION,
  OPEN_APP_FAILED: OPEN_REFUSAL.APPLICATION,
  OPEN_CHANGE_FAILED: OPEN_REFUSAL.CHANGE,
} as const;

export function createSessionActionPerformer(
  dependencies: SessionActionPerformerDependencies,
): SessionActionPerformer {
  const {
    sessionRegistry,
    openExternal,
    actions,
    refreshSessions,
    sendsNetwork,
    settingsStore,
    rememberWorkspaceDefaults,
    expectCreatedWorkspace,
    openCreatedWorkspaces,
    recordProductEvent,
  } = dependencies;

  const settle = <Result extends SessionWriteResult>(
    providerId: CloudAgentProviderId,
    counted: ProductSessionAction,
    result: Result,
  ): Effect.Effect<Result> =>
    settleHostedWrite(result, providerId, counted, refreshSessions, recordProductEvent);

  /**
   * The session an admitted act names, as the service admits it: only a cloud
   * session has a documented way in from this Mac, and a local session, which
   * stands behind no row here, has none.
   */
  function cloudTarget(identity: SessionIdentity): HostedActionTarget | undefined {
    return isCloudAgentProviderId(identity.providerId)
      ? { providerId: identity.providerId, providerSessionId: identity.providerSessionId }
      : undefined;
  }

  /**
   * Hands one admitted act on a session to the service, and reads what the
   * provider said. From the call to the settle the fiber is uninterruptible:
   * an effect already dispatched is awaited for its result whatever the
   * standing says, so a write that reached the provider is always the one
   * that redraws the roster and is counted.
   */
  function carry(
    identity: SessionIdentity,
    counted: ProductSessionAction,
    call: (target: HostedActionTarget) => Promise<HostedActionOutcome>,
  ): Effect.Effect<CarriedActionResult> {
    return Effect.gen(function* () {
      const target = cloudTarget(identity);
      if (!target) return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ENDPOINT };
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const outcome = yield* Effect.promise(() => call(target));
          return yield* settle(target.providerId, counted, hostedActionResult(outcome));
        }),
      );
    });
  }

  const countOpen = (identity: SessionIdentity) => {
    if (isProviderId(identity.providerId)) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACTION_SEND, {
        provider_id: identity.providerId,
        session_action: PRODUCT_SESSION_ACTION.SESSION_OPEN,
      });
    }
  };

  /**
   * Hands one address to the system through the native node: the one answer
   * both opens read of it, and the count a landed open earns. Uninterruptible
   * for the same reason a write is — an open already handed to the node is
   * awaited for its answer, so the open that landed is the one counted.
   */
  const openThroughNode = (
    identity: SessionIdentity,
    url: string,
    kind: HostNodeOpenKind,
    failureReason: string,
  ): Effect.Effect<SessionOpenResult> =>
    Effect.tryPromise({ try: () => openExternal(url, kind), catch: (error) => error }).pipe(
      Effect.as<SessionOpenResult>({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      Effect.tap(() => Effect.sync(() => countOpen(identity))),
      Effect.catchAll((error) =>
        Effect.succeed<SessionOpenResult>(
          error instanceof ExternalOpenAnswerLostError
            ? unknownOpen(error)
            : { status: ACTION_RESULT_STATUS.REJECTED, reason: failureReason },
        ),
      ),
      Effect.uninterruptible,
    );

  const openAddress = (
    identity: SessionIdentity,
    address: (identity: SessionIdentity) => string | undefined,
    // A session that left the roster and one still standing with nowhere to
    // go are different answers, and only the second says what to try instead.
    absentAddressReason: string,
    failureReason: string,
    kind: HostNodeOpenKind,
  ): Effect.Effect<SessionOpenResult> =>
    Effect.suspend(() => {
      const observed = sessionRegistry.get(identity) !== undefined;
      const url = observed ? address(identity) : undefined;
      if (!url) {
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: observed ? absentAddressReason : REFUSAL.NO_SESSION,
        });
      }
      return openThroughNode(identity, url, kind, failureReason);
    });

  // What a press fires is the address the roster reported, as the service
  // relayed it from the provider's own pass.
  const openSession = (identity: SessionIdentity, kind: HostNodeOpenKind) =>
    openAddress(
      identity,
      (target) => sessionRegistry.get(target)?.detail.link,
      REFUSAL.NO_ADDRESS,
      REFUSAL.OPEN_FAILED,
      kind,
    );

  const openSessionApplication = (
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
    kind: HostNodeOpenKind,
  ): Effect.Effect<SessionOpenResult> =>
    Effect.suspend(() => {
      const session = sessionRegistry.get(identity);
      if (!session) {
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: REFUSAL.NO_SESSION,
        });
      }
      const application = session.applications.find((candidate) => candidate.id === applicationId);
      if (!application) {
        // The display names travel with the roster the caller already read,
        // so naming what still opens surfaces nothing the roster withheld.
        const openable = session.applications.filter((candidate) => candidate.link);
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: openable.length
            ? `That session opens only in ${openable.map((candidate) => candidate.displayName).join(", ")}.`
            : "That session lists no app to open in.",
        });
      }
      const url = application.link;
      if (!url) {
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: REFUSAL.NO_APP_ADDRESS,
        });
      }
      return openThroughNode(identity, url, kind, REFUSAL.OPEN_APP_FAILED);
    });

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

  // A message is handed to the session's own provider through the service,
  // which holds the documented way in under the developer's synced key.
  const sendMessage = (action: ValidatedAction<typeof ACTION_KIND.MESSAGE>) =>
    carry(action.identity, PRODUCT_SESSION_ACTION.MESSAGE_SEND, (target) =>
      actions.sendMessage(target, action.text),
    );

  // The control the action carries is the advertised entry itself; the
  // service reads the same advertisement back out of its stored snapshot.
  const executeControl = (action: ValidatedAction<typeof ACTION_KIND.CONTROL>) =>
    carry(action.identity, PRODUCT_SESSION_ACTION.CONTROL_RUN, (target) =>
      actions.executeControl(target, action.control.id),
    );

  /**
   * The stored agent pairing for a provider, read under the turn's guard: the
   * one read a create and a spawn each wait on between admission and the
   * write. The wait is held only as long as the guard's standing — once the
   * signal fires the read is interrupted and answers nothing, and the
   * `isRevoked` check that follows it refuses the action before anything is
   * dispatched. A guard with no signal — a row's own press — waits the read
   * out. A store that cannot be read is a defect, not a refusal, exactly as
   * the rejected promise it replaces was.
   */
  const storedSelection = (
    providerId: CloudAgentProviderId,
    guard: ActionGuard | undefined,
  ): Effect.Effect<WorkspaceAgentSelection | undefined> =>
    guardedRead(
      Effect.map(
        Effect.orDie(settingsStore.get(APP_SETTING_SCHEMA.workspaceAgentDefaults.field)),
        (defaults) => defaults?.[providerId],
      ),
      guard,
    );

  // A new workspace lands only in a project the service's snapshot listed:
  // admission read that list here, and the service admits the ask against
  // the same snapshot before the provider's documented creation endpoint is
  // reached. A fixture run offers no projects at all, so it refuses every ask
  // without touching a network.
  const createWorkspace = (
    action: ValidatedAction<typeof ACTION_KIND.CREATE_WORKSPACE>,
    guard: ActionGuard | undefined,
  ): Effect.Effect<CarriedActionResult> =>
    Effect.gen(function* () {
      const { providerId, providerProjectId } = action;
      if (!sendsNetwork) {
        return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_NETWORK };
      }
      if (!isCloudAgentProviderId(providerId)) {
        return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_CREATION };
      }
      // A model the user named for this one creation outranks the stored choice
      // for this action alone; the stored choice stands otherwise. Both are held
      // to the build's documented table — the named one by admission, the stored
      // one when it was written — and the service's admission holds whichever
      // rides to the same table again before anything reaches the provider.
      const stored = yield* storedSelection(providerId, guard);
      if (guard?.isRevoked()) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.TURN_OVER };
      }
      const selection = action.agentSelection ?? stored;
      // From the creation to the remembered default the fiber is
      // uninterruptible: a workspace the provider made is redrawn, counted,
      // watched for, and remembered whatever became of the standing that
      // asked for it.
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const outcome = yield* Effect.promise(() =>
            actions.createWorkspace(providerId, {
              providerProjectId,
              agent: action.agent ?? selection?.agent,
              model: selection?.model,
              effort: selection?.effort,
              name: action.name,
              task: action.task,
            }),
          );
          const result = yield* settle(
            providerId,
            PRODUCT_SESSION_ACTION.WORKSPACE_CREATE,
            hostedActionResult(outcome),
          );
          if ("failure" in outcome || result.status !== ACTION_RESULT_STATUS.ACCEPTED)
            return result;
          // The session the creation named rides out as an identity under the
          // provider that was asked — an identifier, never an address — for the
          // envelope to record as the created session.
          const { providerSessionId } = outcome.answer;
          const createdSession: SessionIdentity | undefined =
            providerSessionId === undefined ? undefined : { providerId, providerSessionId };
          if (createdSession) {
            // A workspace that landed is also one the developer just asked to be
            // taken to, so the session the creation response named waits here for
            // observation to report it, and is opened then like a pressed row.
            // Noted before the refresh the settle began can commit, so the very pass
            // that first sees the session resolves it; a pass that already committed
            // it is claimed against here, and later commits carry every later arrival.
            expectCreatedWorkspace(createdSession, Date.now());
            openCreatedWorkspaces();
          }
          // The first workspace that actually lands chooses the default provider,
          // so a later ask that names none has somewhere unsurprising to go. Only
          // while nothing is chosen: a default the user holds is theirs to change,
          // never a creation's. Deterministic on the validated action — nothing a
          // model composed decides this — and losing the save loses only the
          // remembered default, never the workspace that just landed.
          yield* rememberWorkspaceDefaults(providerId, providerProjectId, action.agentSelection);
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            ...(createdSession ? { createdSession } : undefined),
          };
        }),
      );
    });

  // Another agent in an observed workspace: the agent kind the action carries
  // is the one that session's own observation listed, and the service reads
  // the workspace it lands in back from its stored snapshot.
  const addWorkspaceAgent = (
    action: ValidatedAction<typeof ACTION_KIND.ADD_AGENT>,
    guard: ActionGuard | undefined,
  ): Effect.Effect<CarriedActionResult> =>
    Effect.gen(function* () {
      const target = cloudTarget(action.identity);
      if (!target) return { status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: REFUSAL.NO_ENDPOINT };
      const stored = yield* storedSelection(target.providerId, guard);
      if (guard?.isRevoked()) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: REFUSAL.TURN_OVER };
      }
      // A stored pairing rides along only when it names the very agent kind the
      // developer asked for, and a model the ask named brings its own effort or
      // none: a preference rides with an ask, never against it.
      const paired = stored?.agent === action.agent ? stored : undefined;
      const model = action.model ?? paired?.model;
      const effort = action.model === undefined ? paired?.effort : action.effort;
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const outcome = yield* Effect.promise(() =>
            actions.addAgent(target, {
              agent: action.agent,
              model,
              effort,
              name: action.name,
              task: action.task,
            }),
          );
          return yield* settle(
            target.providerId,
            PRODUCT_SESSION_ACTION.AGENT_ADD,
            hostedActionResult(outcome),
          );
        }),
      );
    });

  // The two renames carry the session and the name, never the target: the
  // service resolves the workspace or the session from its stored snapshot.
  const renameWorkspace = (action: ValidatedAction<typeof ACTION_KIND.RENAME_WORKSPACE>) =>
    carry(action.identity, PRODUCT_SESSION_ACTION.WORKSPACE_RENAME, (target) =>
      actions.renameWorkspace(target, action.name),
    );

  const renameSession = (action: ValidatedAction<typeof ACTION_KIND.RENAME_SESSION>) =>
    carry(action.identity, PRODUCT_SESSION_ACTION.SESSION_RENAME, (target) =>
      actions.renameSession(target, action.name),
    );

  // Of the actions below, only the create and the spawn wait on anything of
  // their own between admission and the provider effect, so only they take the
  // guard; the rest reach the service with nothing awaited between.
  const performSessionAction = (
    action: ValidatedAction<SessionActionKind>,
    guard: ActionGuard | undefined,
  ): Effect.Effect<CarriedActionResult> =>
    dispatchByKind(action, {
      [ACTION_KIND.MESSAGE]: sendMessage,
      [ACTION_KIND.CONTROL]: executeControl,
      // An open the brain carries was asked of Luke, never pressed on a row,
      // so the node is told a panel still stands over the chat coming forward.
      [ACTION_KIND.OPEN]: (open): Effect.Effect<CarriedActionResult> =>
        open.applicationId
          ? openSessionApplication(
              open.identity,
              open.applicationId,
              HOST_NODE_OPEN_KIND.ASKED_SESSION,
            )
          : openSession(open.identity, HOST_NODE_OPEN_KIND.ASKED_SESSION),
      [ACTION_KIND.CREATE_WORKSPACE]: (creation) => createWorkspace(creation, guard),
      [ACTION_KIND.ADD_AGENT]: (spawn) => addWorkspaceAgent(spawn, guard),
      [ACTION_KIND.RENAME_WORKSPACE]: renameWorkspace,
      [ACTION_KIND.RENAME_SESSION]: renameSession,
    });

  return {
    perform: (action, guard) => performSessionAction(action, guard),
    // The two a row press reaches: the pressing panel has stood itself down
    // already, so the node is handed an address and nothing more.
    openSession: (identity) => openSession(identity, HOST_NODE_OPEN_KIND.ADDRESS),
    openSessionApplication: (identity, applicationId) =>
      openSessionApplication(identity, applicationId, HOST_NODE_OPEN_KIND.ADDRESS),
    openSessionChange,
  };
}
