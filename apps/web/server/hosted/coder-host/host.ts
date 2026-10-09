import { Effect, Option, type Redacted, Result, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import { turnKindOf } from "../brain-host/auth.js";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "../brain-host/conversation.js";
import type { SessionPromptRecord } from "../brain-host/host.js";
import { type RelayStateStore, StreamRelay } from "../brain-host/relay.js";
import { type CodingAgent, readCodingAgentOfConversation } from "../coding-agent-store.js";
import { ModelCatalog } from "../model-catalog.js";
import type { RepositorySandbox } from "../repository-shell.js";
import { promptHashOf } from "../store/index.js";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";
import {
  agentRepositoryToken,
  CheckoutRefused,
  type CheckoutServices,
  checkOutAgentRepository,
} from "./checkout.js";
import { coderInstructions } from "./instructions.js";
import { type CoderModelSelection, coderModel } from "./model.js";
import type { CoderHostSeams } from "./production.js";

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
 * with no ask record, since nothing asks a coding agent mid-turn.
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

export interface CoderHost {
  /** Whether the session stands for a conversation of the caller's and is the one it runs in; every other function takes what this admitted. */
  admit(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The same admission for a session claiming the conversation as it starts, before its record stands. */
  admitStarting(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
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

  return {
    admit: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CURRENT }),
    admitStarting: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CLAIMING }),

    agent: agentOf,

    model: (admitted, scripted) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return Result.fail(found.failure);
        if (scripted !== undefined) {
          return Result.succeed({
            model: scripted.model,
            modelContextWindowTokens: CODER.FALLBACK_CONTEXT_WINDOW_TOKENS,
            modelOptions: {},
          });
        }
        const agent = found.success;
        // The window is the catalog's word for the model; a catalog the instance cannot read
        // right now is no reason to fail the step, so the fallback stands in for it.
        const catalog = yield* ModelCatalog;
        const offered = yield* catalog.read.pipe(Effect.orElseSucceed(() => []));
        const contextWindow =
          offered.find((model) => model.id === agent.model)?.contextWindow ??
          CODER.FALLBACK_CONTEXT_WINDOW_TOKENS;
        return coderModel(
          { model: agent.model, effort: agent.effort },
          seams.keys(),
          contextWindow,
        );
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

    relay: (event, admitted, session, state, prompt) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        // The turn row names what the agent runs on as its row holds it now, the fixture's own
        // id under the scripted model; a conversation that is no agent's records no model.
        const agent = Result.getOrUndefined(found);
        const model = seams.scriptedModel() ? CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID : agent?.model;
        const writer = yield* seams.writer();
        const relay = new StreamRelay({
          writer,
          now: seams.now,
          report: (message) => console.warn(message),
        });
        yield* relay.handle(event, {
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
