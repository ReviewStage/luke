import type { ProductEventName, ProductEventPropertiesFor } from "@sidecar/analytics";
import type { AccountProvider, AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { AgentWireTrace } from "@sidecar/devtrace/vocabulary";
import type { GatewayCallResult, GatewayClient, GatewayMethod } from "@sidecar/gateway";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  gatewayEventReader,
  type VoiceCreateLiveSessionResult,
  type VoiceEndLiveSessionParams,
  type VoiceLiveSessionChanged,
  type VoiceReportLiveTransportParams,
  voiceCreateLiveSessionResultSchema,
  voiceLiveSessionChangedSchema,
  voiceStopSpeakingResultSchema,
} from "@sidecar/gateway";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentDefaultAnswer,
  type CodingAgentListAnswer,
  type CodingAgentListParams,
  type CodingAgentMessageParams,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
  type CodingAgentModelsAnswer,
  type CodingAgentPullRequestAnswerView,
  type CodingAgentPullRequestParams,
  type CodingAgentStartParams,
  type CodingAgentStopParams,
  codingAgentAgentAnswerSchema,
  codingAgentDefaultAnswerViewSchema,
  codingAgentListAnswerViewSchema,
  codingAgentMessagesAnswerViewSchema,
  codingAgentModelsAnswerSchema,
  codingAgentPullRequestAnswerViewSchema,
} from "@sidecar/hosted/coding-agent-view";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import {
  PLAN_CALL_FAILURE,
  type PlanningBoardSaveParams,
  type PlanningRenameParams,
  type PlanningRepositoriesAnswer,
  type PlanningSetRepositoryAnswer,
  type PlanningSetRepositoryParams,
  type PlanningStartAnswer,
  type PlanningStartRequest,
  type PlanningView,
  planningRepositoriesAnswerSchema,
  planningSetRepositoryAnswerSchema,
  planningStartAnswerSchema,
  planningViewSchema,
} from "@sidecar/hosted/planning-view";
import type { LiveDiagnostics } from "@sidecar/live";
import type { AppSettingField, AppSettingValue, SettingsResetScope } from "@sidecar/settings";
import type { AppSettings, SettingsUpdateResult } from "@sidecar/settings/wire";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Effect, type Schema as EffectSchema, Option, Result } from "effect";

/**
 * The desktop's client over the host's own vocabulary: the settings, account,
 * voice, planning, and client-fact methods the runtime host answers, and the events it pushes. Every method answers an effect: it
 * composes one request and reads its answer, and nothing here runs it — the
 * act row that asked yields it, and the router runs it once on the launch's
 * own runtime. The host is this same process, so an answer that is not the
 * shape the method documents is a defect of the build rather than a reachable
 * host state, and dies where it is read; the act router words a defect as the
 * kind's own refusal. Nothing here holds host state beyond the last settings
 * snapshot a refusal is answered with.
 */
export interface HostBootstrap {
  settings: AppSettings;
  account: AccountSnapshot;
  sessionReplay: { permitted: boolean; accountId?: string };
  voiceAvailable: boolean;
  agentTraceEnabled: boolean;
}

interface HostSettingsChange {
  settings: AppSettings;
  /** The opaque reporter whose write produced the change, so the relay can skip echoing it. */
  reporter?: string;
}

interface HostSessionReplay {
  permitted: boolean;
  accountId?: string;
}

export interface HostOperator {
  bootstrap(): Effect.Effect<Option.Option<HostBootstrap>>;
  settingsSnapshot(): Effect.Effect<Option.Option<AppSettings>>;
  updateSetting<Field extends AppSettingField>(
    field: Field,
    value: AppSettingValue<Field>,
    reporter: string,
  ): Effect.Effect<SettingsUpdateResult>;
  resetSettings(scope: SettingsResetScope, reporter: string): Effect.Effect<SettingsUpdateResult>;
  accountSnapshot(): Effect.Effect<Option.Option<AccountSnapshot>>;
  beginSignIn(provider: AccountProvider): Effect.Effect<AccountSnapshot>;
  cancelSignIn(): Effect.Effect<void>;
  signOut(): Effect.Effect<AccountSnapshot>;
  deleteAccount(): Effect.Effect<AccountSnapshot>;
  /** Why voice is or is not available, carrying no credential; a host that cannot be reached answers nothing. */
  liveDiagnostics(): Effect.Effect<Option.Option<LiveDiagnostics>>;
  /**
   * The peer's SDP offer, and the plan the call is about, answered with the
   * session the host created; a host that creates none answers nothing.
   */
  createLiveSession(
    sdp: string,
    planId: string,
  ): Effect.Effect<Option.Option<VoiceCreateLiveSessionResult>>;
  /** The peer's hang-up of the session it names; one the host no longer holds is left alone. */
  endLiveSession(request: VoiceEndLiveSessionParams): Effect.Effect<void>;
  reportLiveTransport(report: VoiceReportLiveTransportParams): Effect.Effect<void>;
  /** The peer's own idle decision, from its local signals alone; the host decides the close. */
  reportLiveActivity(idle: boolean): Effect.Effect<void>;
  /** The stop key: the standing session is told to stop speaking; answers whether one stood to tell. */
  stopSpeaking(): Effect.Effect<boolean>;
  /** One tapped wire event for the host's development trace; the host drops it where no writer stands. */
  recordAgentTrace(trace: AgentWireTrace): Effect.Effect<void>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  /** The Plans tab shows: the host reads the plan list and the active document now and follows both until it is paused. */
  planningRefresh(): Effect.Effect<void>;
  /** The Plans tab stopped showing: the host follows nothing, and the open plan and its call stand. */
  /** One plan made the active one, replacing whichever was; answers whether the host took it. */
  planningOpen(planId: string): Effect.Effect<boolean>;
  /** The developer left the open plan: its call ends and no plan is active. */
  planningClose(): Effect.Effect<void>;
  /** A named plan started on the repository it names, where it names one, and made the active one; or why none started. */
  planningStart(request: PlanningStartRequest): Effect.Effect<PlanningStartAnswer>;
  /** One plan deleted; answers whether the service deleted it. */
  planningDelete(planId: string): Effect.Effect<boolean>;
  /** One plan renamed; answers whether the service renamed it. */
  planningRename(params: PlanningRenameParams): Effect.Effect<boolean>;
  /** The repositories the account reaches through the Luke GitHub App, read from the service now; or why there is no list. */
  planningRepositories(): Effect.Effect<PlanningRepositoriesAnswer>;
  /** One plan given its repository, or none; the repository as kept, or why it is unchanged. */
  planningSetRepository(
    params: PlanningSetRepositoryParams,
  ): Effect.Effect<PlanningSetRepositoryAnswer>;
  /** The open plan's whiteboard scene, saved whole with the number of Luke's drawing it holds. */
  planningBoardSave(params: PlanningBoardSaveParams): Effect.Effect<void>;
  /** The models a coding agent may run on, as the service offers them now; or why there is no list. */
  codingAgentModels(): Effect.Effect<CodingAgentModelsAnswer>;
  /** The account's default model and effort for a coding agent; or why there is none. */
  codingAgentDefaultRead(): Effect.Effect<CodingAgentDefaultAnswer>;
  /** The default written; the choice as kept, or why it is unchanged. */
  codingAgentDefaultWrite(choice: ModelChoice): Effect.Effect<CodingAgentDefaultAnswer>;
  /** One plan's coding agents with their status; or why there is no list. */
  codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
  /** An agent started on a plan under the press's own key; the agent, or why none started. */
  codingAgentStart(params: CodingAgentStartParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent's transcript past a cursor, held by the service while the agent runs; or why there is none. */
  codingAgentMessages(
    params: CodingAgentMessagesParams,
  ): Effect.Effect<CodingAgentMessagesAnswerView>;
  /** One agent sent a message naming how it reaches a turn under way; the agent as it then stands, or why it was not. */
  codingAgentMessage(params: CodingAgentMessageParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** One agent stopped; the agent as it then stands, or why it was not. */
  codingAgentStop(params: CodingAgentStopParams): Effect.Effect<CodingAgentAgentAnswer>;
  /** What one agent published: its branch and pull request as GitHub holds them; or why there is no answer. */
  codingAgentPullRequest(
    params: CodingAgentPullRequestParams,
  ): Effect.Effect<CodingAgentPullRequestAnswerView>;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onVoiceLiveSessionChanged(listener: (change: VoiceLiveSessionChanged) => void): () => void;
  onSessionReplayChanged(listener: (replay: HostSessionReplay) => void): () => void;
  onPlanningChanged(listener: (view: PlanningView) => void): () => void;
}

interface HostOperatorOptions {
  client: GatewayClient;
  report: (message: string) => void;
}

/** The host refused a call, or answered a shape its method does not document: a defect of this build, worded by the router as the kind's refusal. */
function unanswered(method: GatewayMethod, answer: GatewayCallResult): Effect.Effect<never> {
  return Effect.die(
    new Error(
      answer.ok
        ? `${method} answered a shape this client cannot read`
        : `${method} was refused: ${answer.error.message}`,
    ),
  );
}

/**
 * The host's answers are the same structured-clone payloads the windows
 * already receive over the bridge, carried through the protocol as JSON. The
 * readers below check the field the client itself decides on and hand the
 * rest on to the act, whose own answer guard is checked in the router and
 * again in the window that asked.
 */
function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is Luke's own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The protocol carries JSON; the domain type is restored at this one boundary.
  return value === undefined ? undefined : (value as unknown as Value);
}

/** What a coding-agent call the host could not answer is drawn as. */
const CODING_AGENT_UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

export function createHostOperator(options: HostOperatorOptions): HostOperator {
  const { client } = options;

  const settingsResult = (
    method: GatewayMethod,
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<SettingsUpdateResult> =>
    Effect.flatMap(result, (answer) => {
      const parsed = answered<SettingsUpdateResult>(record(answer));
      return parsed?.settings !== undefined ? Effect.succeed(parsed) : unanswered(method, answer);
    });

  const accountResult = (
    method: GatewayMethod,
    result: Effect.Effect<GatewayCallResult>,
  ): Effect.Effect<AccountSnapshot> =>
    Effect.flatMap(result, (answer) => {
      const account = answered<AccountSnapshot>(record(answer)?.account);
      return account ? Effect.succeed(account) : unanswered(method, answer);
    });

  const fire = (result: Effect.Effect<GatewayCallResult>): Effect.Effect<void> =>
    Effect.asVoid(result);

  const on = gatewayEventReader(client);

  const wireReporter = (reporter: string) => ({ reporter });

  /**
   * A setting's value as the method's own field, or no field for a cleared
   * one. The envelope is JSON, and its encoder refuses a record holding
   * `undefined` rather than dropping the key, so a clear carried as a value
   * would never leave this process.
   */
  const wireValue = <Value>(value: Value | undefined) =>
    value !== undefined ? { value: carried(value) } : undefined;

  /**
   * A coding-agent answer as the host's method documents it, or unanswered
   * where the host refused the call or answered a shape the view cannot
   * read: the window draws why and offers to try again either way.
   */
  const codingAgentAnswer =
    <Answer, Encoded>(schema: EffectSchema.Codec<Answer, Encoded>) =>
    (answer: GatewayCallResult): Answer | typeof CODING_AGENT_UNANSWERED =>
      (answer.ok
        ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
        : undefined) ?? CODING_AGENT_UNANSWERED;

  return {
    bootstrap: () =>
      Effect.map(client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP), (answer) =>
        Option.fromUndefinedOr(answered<HostBootstrap>(record(answer))),
      ),
    settingsSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AppSettings>(record(answer)?.settings)),
      ),
    updateSetting: (field, value, reporter) =>
      settingsResult(
        GATEWAY_METHOD.SETTINGS_UPDATE,
        client.call(GATEWAY_METHOD.SETTINGS_UPDATE, {
          field,
          ...wireValue(value),
          ...wireReporter(reporter),
        }),
      ),
    resetSettings: (scope, reporter) =>
      settingsResult(
        GATEWAY_METHOD.SETTINGS_RESET,
        client.call(GATEWAY_METHOD.SETTINGS_RESET, { scope, ...wireReporter(reporter) }),
      ),
    accountSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AccountSnapshot>(record(answer)?.account)),
      ),
    beginSignIn: (provider) =>
      accountResult(
        GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN,
        client.call(GATEWAY_METHOD.ACCOUNT_BEGIN_SIGN_IN, { provider }),
      ),
    cancelSignIn: () => fire(client.call(GATEWAY_METHOD.ACCOUNT_CANCEL_SIGN_IN)),
    signOut: () =>
      accountResult(GATEWAY_METHOD.ACCOUNT_SIGN_OUT, client.call(GATEWAY_METHOD.ACCOUNT_SIGN_OUT)),
    deleteAccount: () =>
      accountResult(GATEWAY_METHOD.ACCOUNT_DELETE, client.call(GATEWAY_METHOD.ACCOUNT_DELETE)),
    liveDiagnostics: () =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_DIAGNOSTICS), (answer) =>
        Option.fromUndefinedOr(answered<LiveDiagnostics>(record(answer)?.diagnostics)),
      ),
    createLiveSession: (sdp, planId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp, planId }),
        (answer) =>
          answer.ok
            ? Result.getSuccess(
                readEither(voiceCreateLiveSessionResultSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : Option.none(),
      ),
    endLiveSession: (request) => fire(client.call(GATEWAY_METHOD.VOICE_END_LIVE_SESSION, request)),
    reportLiveTransport: (report) =>
      fire(client.call(GATEWAY_METHOD.VOICE_REPORT_LIVE_TRANSPORT, report)),
    reportLiveActivity: (idle) =>
      fire(client.call(GATEWAY_METHOD.VOICE_REPORT_LIVE_ACTIVITY, { idle })),
    stopSpeaking: () =>
      Effect.map(client.call(GATEWAY_METHOD.VOICE_STOP_SPEAKING), (answer) =>
        answer.ok
          ? (Result.getOrUndefined(
              readEither(voiceStopSpeakingResultSchema, { excess: EXCESS_KEYS.DROP })(
                answer.result,
              ),
            )?.stopped ?? false)
          : false,
      ),
    recordAgentTrace: (trace) =>
      fire(client.call(GATEWAY_METHOD.VOICE_RECORD_TRACE, { trace: carried(trace) })),
    recordEvent: (name, properties) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        fire(
          client.call(GATEWAY_METHOD.ANALYTICS_RECORD, {
            // The host reads the event against the allowlist again before it is queued.
            event: { name, at, properties: carried(properties) },
          }),
        ),
      ),
    planningRefresh: () => fire(client.call(GATEWAY_METHOD.PLANNING_REFRESH)),
    planningOpen: (planId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLANNING_OPEN, { planId }),
        (answer) => record(answer)?.opened === true,
      ),
    planningClose: () => fire(client.call(GATEWAY_METHOD.PLANNING_CLOSE)),
    planningDelete: (planId) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLANNING_DELETE, { planId }),
        (answer) => record(answer)?.deleted === true,
      ),
    planningRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLANNING_RENAME, { planId: params.planId, name: params.name }),
        (answer) => record(answer)?.renamed === true,
      ),
    planningRepositories: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLANNING_REPOSITORIES),
        (answer): PlanningRepositoriesAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(planningRepositoriesAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: PLAN_CALL_FAILURE.UNANSWERED },
      ),
    planningSetRepository: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLANNING_SET_REPOSITORY, {
          planId: params.planId,
          repository: params.repository,
        }),
        (answer): PlanningSetRepositoryAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(planningSetRepositoryAnswerSchema, { excess: EXCESS_KEYS.DROP })(
                  answer.result,
                ),
              )
            : undefined) ?? { failure: PLAN_CALL_FAILURE.UNANSWERED },
      ),
    planningStart: (request) =>
      Effect.map(
        client.call(GATEWAY_METHOD.PLANNING_START, {
          name: request.name,
          ...("repository" in request ? { repository: request.repository } : undefined),
        }),
        (answer): PlanningStartAnswer =>
          (answer.ok
            ? Result.getOrUndefined(
                readEither(planningStartAnswerSchema, { excess: EXCESS_KEYS.DROP })(answer.result),
              )
            : undefined) ?? { failure: PLAN_CALL_FAILURE.UNANSWERED },
      ),
    planningBoardSave: (params) =>
      fire(
        client.call(GATEWAY_METHOD.PLANNING_BOARD_SAVE, {
          planId: params.planId,
          elements: params.elements,
          appliedDrawing: params.appliedDrawing,
          ...(params.image === undefined ? undefined : { image: params.image }),
        }),
      ),
    codingAgentModels: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_MODELS),
        codingAgentAnswer(codingAgentModelsAnswerSchema),
      ),
    codingAgentDefaultRead: () =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_DEFAULT_READ),
        codingAgentAnswer(codingAgentDefaultAnswerViewSchema),
      ),
    codingAgentDefaultWrite: (choice) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_DEFAULT_WRITE, {
          model: choice.model,
          effort: choice.effort,
        }),
        codingAgentAnswer(codingAgentDefaultAnswerViewSchema),
      ),
    codingAgentList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_LIST, { planId: params.planId }),
        codingAgentAnswer(codingAgentListAnswerViewSchema),
      ),
    codingAgentStart: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_START, {
          planId: params.planId,
          idempotencyKey: params.idempotencyKey,
          ...("model" in params ? { model: params.model } : undefined),
          ...("effort" in params ? { effort: params.effort } : undefined),
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentMessages: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_MESSAGES, {
          agentId: params.agentId,
          after: params.after,
        }),
        codingAgentAnswer(codingAgentMessagesAnswerViewSchema),
      ),
    codingAgentMessage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_MESSAGE, {
          agentId: params.agentId,
          text: params.text,
          delivery: params.delivery,
        }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentStop: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_STOP, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentAgentAnswerSchema),
      ),
    codingAgentPullRequest: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CODING_AGENTS_PULL_REQUEST, { agentId: params.agentId }),
        codingAgentAnswer(codingAgentPullRequestAnswerViewSchema),
      ),
    onSettingsChanged: (listener) =>
      on(
        GATEWAY_EVENT.SETTINGS_CHANGED,
        (payload): HostSettingsChange | undefined => {
          if (!isRecord(payload) || !isRecord(payload.settings)) return undefined;
          const settings = answered<AppSettings>(payload.settings);
          if (!settings) return undefined;
          return {
            settings,
            ...(isWireString(payload.reporter) ? { reporter: payload.reporter } : undefined),
          };
        },
        listener,
      ),
    onAccountChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_CHANGED,
        (payload) => (isRecord(payload) ? answered<AccountSnapshot>(payload) : undefined),
        listener,
      ),
    onVoiceLiveSessionChanged: (listener) =>
      on(
        GATEWAY_EVENT.VOICE_LIVE_SESSION_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(voiceLiveSessionChangedSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    onPlanningChanged: (listener) =>
      on(
        GATEWAY_EVENT.PLANNING_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(planningViewSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    onSessionReplayChanged: (listener) =>
      on(
        GATEWAY_EVENT.SESSION_REPLAY_CHANGED,
        (payload): HostSessionReplay | undefined =>
          isRecord(payload) && isWireBoolean(payload.permitted)
            ? {
                permitted: payload.permitted,
                ...(isWireString(payload.accountId) ? { accountId: payload.accountId } : undefined),
              }
            : undefined,
        listener,
      ),
  };
}
