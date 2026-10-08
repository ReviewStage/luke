import { EMPTY_BOARD } from "@sidecar/hosted/board-wire";
import type { LanguageModel } from "ai";
import { Effect, Option, Result, type Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import type { ToolContext as EveToolContext } from "eve/tools";
import {
  ACTION_RESULT_STATUS,
  type BrainTurnTrigger,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "../../core.js";
import { readBoard } from "../board-store.js";
import { HOSTED_TOOL_SET } from "../brain-tool-set.js";
import { readPlanOfConversation } from "../plan-store.js";
import { MeterUnavailable, ResearchBudget } from "../public-research.js";
import { askRecord } from "../store/asks.js";
import { toolSetHashOf } from "../store/content-addressed.js";
import { type ConversationTarget, promptHashOf } from "../store/index.js";
import { turnKindOf } from "./auth.js";
import {
  BRAIN_HOST,
  BRAIN_HOST_MODEL_FIXTURE,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
} from "./bounds.js";
import { readRecentMessages } from "./context.js";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "./conversation.js";
import { eveSessionsComposer } from "./eve-sessions.js";
import { hostTurnId } from "./ids.js";
import { meteredModel, openAiBrainModel } from "./model.js";
import {
  type HostedToolDeclaration,
  PLANNING_INSTRUCTIONS,
  planningStandingContext,
  planningToolDeclarations,
  runPlanningTool,
} from "./planning.js";
import type { BrainHostSeams } from "./production.js";
import { type RelayStateStore, StreamRelay } from "./relay.js";
import { rotationSeedText } from "./seed.js";
import { carryStop } from "./stop-carrier.js";

/**
 * The hosted brain composed over eve and the store: what the eve project's
 * authored files call, one function per thing eve asks the host for. eve is
 * the runtime and the event emitter — the loop, the sessions, the queue, the
 * stream — and the host is everything eve leaves to its author: who a
 * session is for, the prompt its turns run under, the standing context each
 * turn opens with, the tools it is offered and what they reach, the model
 * with the meter in front of it, and the relay from eve's stream into the
 * store's writer, which is the sole consumer and the only thing that writes
 * a message row. A conversation is a plan's: its turns run under the
 * planning model's instructions, its saved document as the standing context,
 * and the planning tools (`planning.ts`), and every write runs under the
 * conversation the session was admitted for.
 */

/** The turn a resolver or a tool runs in, as eve names it and as the store keys it; plain data, so a tool may capture it. */
interface HostedTurn {
  readonly kind: BrainHostTurn;
  readonly trigger: BrainTurnTrigger;
  readonly turnId: string;
}

/** What a tool eve runs is bound to: the conversation and the turn, as data eve can keep across its steps. */
export interface HostedToolBinding {
  readonly target: ConversationTarget;
  readonly turn: HostedTurn;
}

/** The kind of turn the current request opened, with the trigger the run stream names it by. */
interface HostedTurnKind {
  readonly kind: BrainHostTurn;
  readonly trigger: BrainTurnTrigger;
}

/** The prompt a session runs under and the content address its turns are recorded under. */
interface HostedSessionPrompt {
  readonly text: string;
  readonly hash: string;
}

/**
 * What the eve project keeps of the session's prompt between the start that
 * composed it and the turns that run under it: the content address alone,
 * absent until the session has composed one. It lives in eve's durable
 * session state, because the prompt applies at session scope and the turn
 * row must name the prompt the model actually reads.
 */
export interface SessionPromptRecord {
  readonly hash?: string;
}

/** The turn id eve's `turn.started` event carries, read off the event a resolver is handed; nothing for any other shape. */
export function eveTurnIdOf(event: UnparsedWireValue): string | undefined {
  if (!isRecord(event) || !isRecord(event.data)) return undefined;
  return isWireString(event.data.turnId) ? event.data.turnId : undefined;
}

/**
 * The eve session a conversation's record names for this session: its own id
 * for a root session, and its root's for a subagent's child session. Note that
 * a child's tool call is admitted through its root, because eve mints a child
 * its own session id that no conversation records and hands a tool the
 * child's lineage, so the root standing as the conversation's current session
 * is what lets the call land. A resolver is handed no lineage, so a child's
 * resolvers take `admitDelegated` instead.
 */
function conversationSessionOf(session: Pick<SessionContext["session"], "id" | "parent">): string {
  return session.parent?.rootSessionId ?? session.id;
}

/** What a host function answers: an effect over the ambient client, which eve's own authored files run at the web's edge. */
type HostEffect<A> = Effect.Effect<A, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

export interface BrainHost {
  /** Whether the session stands for a conversation of the caller's and is the one it runs in; every other function takes what this admitted. */
  admit(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The same admission for a session claiming the conversation as it starts, before its record stands. */
  admitStarting(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The admission a subagent's resolvers take, on ownership alone: eve hands a resolver no lineage, and the child's id is no record's. */
  admitDelegated(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The kind of turn the current request opened, or nothing for a request that named none. */
  turnKindOf(auth: SessionAuth): HostedTurnKind | undefined;
  /** The turn eve just started, keyed as the store keys it; nothing for a request that named no kind. */
  turnOf(auth: SessionAuth, sessionId: string, eveTurnId: string): HostedTurn | undefined;
  /** The prompt a session runs under, with the hash its turns are recorded under; the text itself is stored nowhere. */
  prompt(): HostedSessionPrompt;
  /** The standing context one turn opens with: the plan's name and saved document, as data. */
  standingContext(admitted: AdmittedConversation): HostEffect<string>;
  /** The conversation so far, for a session opened over a conversation with words already said; nothing otherwise. */
  seed(admitted: AdmittedConversation): HostEffect<string | undefined>;
  /** The tools every turn is offered, as declarations; the eve project binds each to `runTool`. */
  toolDeclarations(): readonly HostedToolDeclaration[];
  /** Carries one call of one declared tool under the binding the tool captured and the standing eve hands it. */
  runTool(
    name: string,
    binding: HostedToolBinding,
    input: UnparsedWireValue,
    context: EveToolContext,
  ): Effect.Effect<
    WireRecord,
    SqlError | Schema.SchemaError,
    SqlClient.SqlClient | HttpClient.HttpClient
  >;
  /** The model one inference runs on, the meter spent for the account first; nothing when the deployment holds no key. */
  model(admitted: AdmittedConversation): LanguageModel | undefined;
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

/** The host over the deployment's seams; the research budget it keeps stands for the host's life. */
export function brainHost(seams: BrainHostSeams): BrainHost {
  const research = new ResearchBudget();

  /** The account's metered model, or nothing while the deployment holds no key. */
  const modelFor = (admitted: AdmittedConversation): LanguageModel | undefined => {
    const access = seams.openAi();
    if (!access) return undefined;
    return meteredModel(openAiBrainModel(access.apiKey, access.modelId), () =>
      seams.spend(admitted.target.userId),
    );
  };

  /** The plan a conversation belongs to, as the account owns it now; nothing once it is deleted. */
  const planOf = (target: ConversationTarget) =>
    Effect.map(readPlanOfConversation(target.userId, target.conversationId), Option.getOrUndefined);

  return {
    admit: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CURRENT }),
    admitStarting: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.CLAIMING }),
    admitDelegated: (auth, sessionId) =>
      admitConversation(auth, { id: sessionId, standing: SESSION_STANDING.DELEGATED }),

    turnKindOf(auth) {
      const kind = turnKindOf(auth.current);
      return kind === undefined ? undefined : { kind, trigger: BRAIN_HOST_TURN_KIND[kind].trigger };
    },

    turnOf(auth, sessionId, eveTurnId) {
      const kind = turnKindOf(auth.current);
      if (kind === undefined) return undefined;
      return {
        kind,
        trigger: BRAIN_HOST_TURN_KIND[kind].trigger,
        turnId: hostTurnId(sessionId, eveTurnId),
      };
    },

    prompt: () => ({ text: PLANNING_INSTRUCTIONS, hash: promptHashOf(PLANNING_INSTRUCTIONS) }),

    standingContext: (admitted) =>
      Effect.gen(function* () {
        const plan = yield* planOf(admitted.target);
        const board =
          plan === undefined
            ? Option.none()
            : yield* readBoard(admitted.target.userId, plan.plan.id);
        return planningStandingContext(
          plan,
          Option.getOrElse(board, () => EMPTY_BOARD),
          seams.now(),
        );
      }),

    seed: (admitted) =>
      Effect.map(
        readRecentMessages(admitted.target, HOSTED_TOOL_SET, BRAIN_HOST.SEED_MESSAGES),
        (recent) => rotationSeedText(recent, seams.now()),
      ),

    toolDeclarations: () => planningToolDeclarations(),

    runTool: (name, binding, input, context) =>
      Effect.gen(function* () {
        // Admitted again as the call runs, not only as the tools were resolved:
        // a conversation that rotated to a newer session mid-turn refuses the
        // old session's calls here, so no effect lands without a turn record.
        const standing = yield* admitConversation(context.session.auth, {
          id: conversationSessionOf(context.session),
          standing: SESSION_STANDING.CURRENT,
        });
        if (Result.isFailure(standing)) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: standing.failure };
        }
        // The plan is found again as the call runs, so a plan deleted mid-turn saves nothing.
        const { target } = standing.success;
        const plan = yield* planOf(target);
        return yield* runPlanningTool(
          name,
          plan === undefined
            ? undefined
            : {
                plan: { userId: target.userId, planId: plan.plan.id },
                research: {
                  turnId: binding.turn.turnId,
                  budget: research,
                  openAi: seams.openAi(),
                  spend: Effect.tryPromise({
                    try: () => seams.spend(target.userId),
                    catch: (cause) => new MeterUnavailable({ cause }),
                  }).pipe(Effect.map((spent) => spent.allowed)),
                },
              },
          input,
        );
      }),

    model: (admitted) => modelFor(admitted),

    sessionStarted: (admitted, sessionId) =>
      claimRuntimeSession(admitted.target, sessionId, new Date(seams.now())),

    relay: (event, admitted, session, state, prompt) =>
      Effect.gen(function* () {
        const model = seams.scriptedModel()
          ? BRAIN_HOST_MODEL_FIXTURE.SCRIPTED_MODEL_ID
          : seams.openAi()?.modelId;
        // The tool set's hash is taken as each turn starts, from the same
        // declarations the tools resolver hands eve, so the hash names what
        // the model is offered and not a list kept beside it.
        const toolSetHash =
          event.type === "turn.started" ? toolSetHashOf(planningToolDeclarations()) : undefined;
        const writer = yield* seams.writer();
        const eve = yield* eveSessionsComposer;
        const relay = new StreamRelay({
          writer,
          asks: askRecord(),
          // A Stop an ask took while it waited is carried the moment its turn starts, by the
          // deployment acting for the account, since the hook that sees the start holds no bearer
          // of the account's; a deployment with no secret or no origin for eve reports the Stop it
          // could not carry.
          stopTurn: (target, sessionId, eveTurnId, turnId) =>
            Effect.suspend(() => {
              const secret = seams.deploymentSecret();
              const origin = seams.eveOrigin();
              if (secret === undefined || origin === undefined) {
                return Effect.logWarning(
                  `The Stop on turn ${eveTurnId} of session ${sessionId} could not be carried.`,
                );
              }
              return carryStop(
                {
                  eve: eve({ origin, caller: { secret, account: target.userId } }),
                  writer,
                  now: seams.now,
                  report: (message) => console.warn(message),
                },
                target,
                sessionId,
                eveTurnId,
                turnId,
              );
            }),
          now: seams.now,
          report: (message) => console.warn(message),
        });
        yield* relay.handle(event, {
          sessionId: session.id,
          target: admitted.target,
          turn: turnKindOf(session.auth.current),
          ...(model !== undefined ? { model } : undefined),
          ...(prompt.hash !== undefined ? { promptHash: prompt.hash } : undefined),
          ...(toolSetHash !== undefined ? { toolSetHash } : undefined),
          state,
        });
      }),
  };
}
