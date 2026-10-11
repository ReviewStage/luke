import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { Effect, Option, type Redacted, Result, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import { turnKindOf } from "../brain-host/auth.js";
import { RELAY_TURN } from "../brain-host/bounds.js";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "../brain-host/conversation.js";
import type { SessionPromptRecord } from "../brain-host/host.js";
import { childConversationId } from "../brain-host/ids.js";
import { type RelayStanding, type RelayStateStore, StreamRelay } from "../brain-host/relay.js";
import {
  type CodingAgent,
  readCodingAgentOfConversation,
  readDelegation,
} from "../coding-agent-store.js";
import { ModelCatalog, type OfferedModel } from "../model-catalog.js";
import type { RepositorySandbox } from "../repository-shell.js";
import { promptHashOf } from "../store/index.js";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";
import {
  agentRepositoryToken,
  CheckoutRefused,
  type CheckoutServices,
  checkOutAgentRepository,
} from "./checkout.js";
import { type DelegationAsk, delegationChoice, recordDelegation } from "./delegation.js";
import { coderInstructions } from "./instructions.js";
import { type CoderModelSelection, coderModel } from "./model.js";
import type { CoderHostSeams } from "./production.js";
import { CODER_TOOL } from "./tool-set.js";

/**
 * host.ts -- the coding-agent host composed over eve and the store: what the coder project's authored files call.
 *
 * The same shape as the planning brain's host (`brain-host/host.ts`): eve is
 * the runtime and the event emitter, and the host is everything eve leaves
 * to its author. Who a session is for is the conversation admission the two
 * share; what differs is that every admitted conversation is a coding
 * agent's, whose row names the model each step runs on, the repository its
 * sandbox checks out, and the plan its first message carried. The model is
 * read from the row at every step, so a later change to the row is the next
 * step's model. The relay into the store is the shared one, composed here
 * with no ask record: a message to a coding agent is written as a line
 * awaiting its turn by the message route, and the relay takes that line
 * into the turn that receives it, so nothing needs binding here.
 */

/** What a host function answers: an effect over the ambient client, which the coder's authored files run at the web's edge. */
type HostEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** How a checkout or a mint fails: the checkout's refusal, which the host's own refusal of a conversation that is no agent's is carried as, or the store's. */
export type CheckoutFailure = CheckoutRefused | SqlError | Schema.SchemaError;

/** The prompt a session runs under and the content address its turns are recorded under. */
interface CoderSessionPrompt {
  readonly text: string;
  readonly hash: string;
}

/** The model a step runs on under the scripted fixture: whatever the authored file hands in, under the fixture's own id. */
interface ScriptedCoderModel {
  readonly model: CoderModelSelection["model"];
}

/** What a delegation answers once admitted: the model and effort the worker runs on, or the one sentence refusing the agent's ask. */
type DelegationEffect = Effect.Effect<
  Result.Result<ModelChoice, string>,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient | ModelCatalog
>;

export interface CoderHost {
  /** Whether the session stands for a conversation of the caller's and is the one it runs in; every other function takes what this admitted. */
  admit(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The same admission for a session claiming the conversation as it starts, before its record stands. */
  admitStarting(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The admission a worker's resolvers take, on ownership alone: eve hands a resolver no lineage, and the child's id is no record's. */
  admitDelegated(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The agent the admitted conversation is, or the refusal for a conversation that is no agent's. */
  agent(admitted: AdmittedConversation): HostEffect<Result.Result<CodingAgent, CoderRefusal>>;
  /** The model one step runs on, read from the agent's row now, with the window the catalog lists for it. */
  model(
    admitted: AdmittedConversation,
    scripted: ScriptedCoderModel | undefined,
  ): Effect.Effect<
    Result.Result<CoderModelSelection, CoderRefusal>,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | ModelCatalog
  >;
  /**
   * A delegation under the call that makes it: the pair the agent asked for,
   * filled in from its own row and held to the catalog, recorded under the
   * child conversation the call names ahead of the worker's session.
   */
  delegate(admitted: AdmittedConversation, callId: string, asked: DelegationAsk): DelegationEffect;
  /** The model one step of a worker runs on, read from the delegation the parent's call recorded, with the window the catalog lists for it. */
  delegatedModel(
    admitted: AdmittedConversation,
    parentCallId: string,
    scripted: ScriptedCoderModel | undefined,
  ): Effect.Effect<
    Result.Result<CoderModelSelection, CoderRefusal>,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | ModelCatalog
  >;
  /** The instructions the session runs under, with the hash its turns are recorded under; the text itself is stored nowhere. */
  prompt(agent: CodingAgent): CoderSessionPrompt;
  /** The agent's repository checked out into the sandbox; answers the write token for the caller to set at the firewall. */
  checkOut(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<Redacted.Redacted, CheckoutFailure, CheckoutServices>;
  /** A fresh write token for the agent's repository, for the firewall once the standing one is old. */
  repositoryToken(
    admitted: AdmittedConversation,
  ): Effect.Effect<Redacted.Redacted, CheckoutFailure, CheckoutServices>;
  /** Claims the conversation for the eve session now starting; answers whether the record is now this session's. */
  sessionStarted(admitted: AdmittedConversation, sessionId: string): HostEffect<boolean>;
  /**
   * Relays one event of a worker's session into the child conversation its
   * delegation was recorded under, as a child turn on the recorded pair; a
   * session with no parent, one the account does not own, or one no
   * delegation was recorded for relays nothing.
   */
  relayChild(
    event: MessageStreamEvent,
    session: SessionContext["session"],
    state: RelayStateStore,
  ): Effect.Effect<
    void,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | HttpClient.HttpClient
  >;
  /** Relays one event of the session's stream into the store, under the state the caller keeps for the session and the prompt it composed. */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
    prompt: SessionPromptRecord,
  ): Effect.Effect<
    void,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | HttpClient.HttpClient
  >;
}

/** The host over the deployment's seams. */
export function coderHost(seams: CoderHostSeams): CoderHost {
  const agentOf = (admitted: AdmittedConversation) =>
    Effect.map(
      readCodingAgentOfConversation(admitted.target.userId, admitted.target.conversationId),
      (found) =>
        Option.match(found, {
          onNone: () => Result.fail(CODER_REFUSAL.NO_AGENT),
          onSome: (agent) => Result.succeed(agent),
        }),
    );

  /** The agent, or the refusal as the checkout's own failure, so a caller reads one failure channel. */
  const agentOrRefused = (admitted: AdmittedConversation) =>
    Effect.flatMap(agentOf(admitted), (found) =>
      Result.isFailure(found)
        ? Effect.fail(new CheckoutRefused({ reason: found.failure }))
        : Effect.succeed(found.success),
    );

  /** The catalog as the instance reads it now; empty where it cannot be read, since no step is failed for that. */
  const catalogNow = Effect.flatMap(ModelCatalog, (catalog) =>
    catalog.read.pipe(Effect.orElseSucceed((): readonly OfferedModel[] => [])),
  );

  /** The model a step runs on for the choice: the fixture's own under the scripted model, else the provider's at the window the catalog lists, or the fallback where it lists none. */
  const selectedModel = (choice: ModelChoice, scripted: ScriptedCoderModel | undefined) =>
    Effect.gen(function* () {
      if (scripted !== undefined) {
        return Result.succeed({
          model: scripted.model,
          modelContextWindowTokens: CODER.FALLBACK_CONTEXT_WINDOW_TOKENS,
          modelOptions: {},
        });
      }
      const offered = yield* catalogNow;
      const contextWindow =
        offered.find((model) => model.id === choice.model)?.contextWindow ??
        CODER.FALLBACK_CONTEXT_WINDOW_TOKENS;
      return coderModel(choice, seams.keys(), contextWindow);
    });

  /** One event relayed through the shared relay, with no ask record beside it. */
  const relayEvent = (event: MessageStreamEvent, standing: RelayStanding) =>
    Effect.gen(function* () {
      const writer = yield* seams.writer();
      const relay = new StreamRelay({
        writer,
        now: seams.now,
        report: (message) => console.warn(message),
      });
      yield* relay.handle(event, standing);
    });

  return {
    admit: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CURRENT }),
    admitStarting: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CLAIMING }),
    admitDelegated: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.DELEGATED }),

    agent: agentOf,

    model: (admitted, scripted) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return Result.fail(found.failure);
        const agent = found.success;
        return yield* selectedModel({ model: agent.model, effort: agent.effort }, scripted);
      }),

    delegate: (admitted, callId, asked) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return Result.fail(found.failure);
        const own = { model: found.success.model, effort: found.success.effort };
        let choice: ModelChoice;
        if (seams.scriptedModel()) {
          // The fixture runs no provider, so the ask is taken as the pair the fixture's turns record.
          choice = { model: asked.model ?? own.model, effort: asked.effort ?? own.effort };
        } else {
          const catalog = yield* ModelCatalog;
          const offered = yield* catalog.read.pipe(Effect.option);
          if (Option.isNone(offered)) return Result.fail(CODER_REFUSAL.CATALOG_UNAVAILABLE);
          const chosen = delegationChoice(own, asked, offered.value);
          if (Result.isFailure(chosen)) return chosen;
          choice = chosen.success;
        }
        const childId = childConversationId(admitted.target.conversationId, callId);
        yield* recordDelegation(admitted.target, childId, choice, CODER_TOOL.DELEGATE);
        return Result.succeed(choice);
      }),

    delegatedModel: (admitted, parentCallId, scripted) =>
      Effect.gen(function* () {
        const childId = childConversationId(admitted.target.conversationId, parentCallId);
        const delegation = yield* readDelegation(admitted.target, childId);
        if (Option.isNone(delegation)) return Result.fail(CODER_REFUSAL.NO_DELEGATION);
        const { model, effort } = delegation.value;
        return yield* selectedModel({ model, effort }, scripted);
      }),

    prompt: (agent) => {
      const text = coderInstructions(agent.repository);
      return { text, hash: promptHashOf(text) };
    },

    checkOut: (admitted, sandbox) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        checkOutAgentRepository(admitted.target, agent, sandbox),
      ),

    repositoryToken: (admitted) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        Effect.map(agentRepositoryToken(admitted.target, agent), (minted) => minted.token),
      ),

    sessionStarted: (admitted, sessionId) =>
      claimRuntimeSession(admitted.target, sessionId, new Date(seams.now())),

    relayChild: (event, session, state) =>
      Effect.gen(function* () {
        const parent = session.parent;
        if (parent === undefined) return;
        // Admitted on ownership alone, as the worker's resolvers are: claiming the agent's record
        // for the child's session would refuse every later call of the agent's own.
        const admitted = yield* admitConversation(session.auth, {
          id: session.id,
          standing: SESSION_STANDING.DELEGATED,
        });
        if (Result.isFailure(admitted)) return;
        const { target } = admitted.success;
        const conversationId = childConversationId(target.conversationId, parent.callId);
        const delegation = yield* readDelegation(target, conversationId);
        if (Option.isNone(delegation)) return;
        const model = seams.scriptedModel()
          ? CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID
          : delegation.value.model;
        yield* relayEvent(event, {
          sessionId: session.id,
          target: { userId: target.userId, conversationId },
          turn: RELAY_TURN.CHILD,
          model,
          reasoningEffort: delegation.value.effort,
          state,
        });
      }),

    relay: (event, admitted, session, state, prompt) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        // The turn row names what the agent runs on as its row holds it now, the fixture's own
        // id under the scripted model; a conversation that is no agent's records no model.
        const agent = Result.getOrUndefined(found);
        const model = seams.scriptedModel() ? CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID : agent?.model;
        yield* relayEvent(event, {
          sessionId: session.id,
          target: admitted.target,
          turn: turnKindOf(session.auth.current),
          ...(model !== undefined ? { model } : undefined),
          ...(agent !== undefined ? { reasoningEffort: agent.effort } : undefined),
          ...(prompt.hash !== undefined ? { promptHash: prompt.hash } : undefined),
          state,
        });
      }),
  };
}
