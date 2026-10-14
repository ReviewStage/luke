import type { DatabaseServices, QueryError } from "@sidecar/database/core/query";
import {
  type CodingAgent,
  readCodingAgentOfConversation,
  readDelegation,
  recordCodingAgentCompaction,
  recordCodingAgentStep,
  updateCodingAgentBranch,
} from "@sidecar/database/models/coding-agent-store";
import { promptHashOf } from "@sidecar/database/models/content-addressed";
import { childConversationId, hostTurnId } from "@sidecar/database/models/ids";
import { CODING_AGENT_BRIEF, CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import { INBOX_TOOL } from "@sidecar/hosted/inbox-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { Effect, Option, type Redacted, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import type { UnparsedWireValue, WireRecord } from "../../core.js";
import { delegatedChildOf, type HostAdmission, hostAdmission } from "../agent-runtime/host-core.js";
import type { AgentSkill } from "../agent-runtime/skills.js";
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
import { type RelayStanding, type RelayStateStore, StreamRelay } from "../brain-host/relay.js";
import { ModelCatalog, type OfferedModel, offeredToAccount } from "../model-catalog.js";
import { runShowPage, SHOW_PAGE_REFUSAL, showPageRejected } from "../page-tool.js";
import {
  type ReadWebPageResult,
  ResearchBudget,
  runReadWebPage,
  runSearchWeb,
  type SearchWebResult,
} from "../public-research.js";
import type { RepositorySandbox } from "../repository-shell.js";
import { logStoreFailure } from "../store-failure.js";
import { anthropicFastAccess } from "./account-keys.js";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";
import {
  agentCiReadable,
  agentRepositoryToken,
  CheckoutRefused,
  type CheckoutServices,
  checkOutAgentRepository,
  checkoutBranch,
} from "./checkout.js";
import { contextWindowOf } from "./context.js";
import { agentStepOf } from "./context-estimate.js";
import { type DelegationAsk, delegationChoice, recordDelegation } from "./delegation.js";
import {
  closeInInbox,
  INBOX_REFUSAL,
  type InboxToolResult,
  inboxRejected,
  postToInbox,
  readOwnInbox,
} from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import { coderInstructions } from "./instructions.js";
import { type CoderModelSelection, coderModel } from "./model.js";
import {
  PLAN_EDIT_REFUSAL,
  type PlanEditResult,
  planEditRejected,
  recordPlanEdit,
} from "./plan-edit.js";
import type { CoderHostSeams } from "./production.js";
import { agentSkills } from "./skills.js";
import { titleCodingAgent, titleSubagent } from "./title.js";
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
 * into the turn that receives it, so nothing needs binding here. The
 * agent's title is the host's one model call of its own: generated from its
 * first exchange as one of its first turns ends, written where no title
 * stands yet, and never again, so a name the developer gives is the last
 * word; each worker is named by the same call over the task its delegation
 * handed it.
 * Beside the relay, each step's end and each compaction of the agent's own
 * conversation is written on the agent's row, which is what the tab's
 * context ring reads (`context-estimate.ts`).
 * Any member of the plan's workspace is admitted to an agent's conversation,
 * and the plan is read and written as the member whose turn it is; the
 * agent's row, its provider keys, its checkout, and its context stay its
 * starter's, the conversation's owner, whoever is speaking to it.
 */

/** What a host function answers: an effect over the ambient client, which the coder's authored files run at the web's edge. */
type HostEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** How a checkout or a mint fails: the checkout's refusal, which the host's own refusal of a conversation that is no agent's is carried as, or the store's. */
export type CheckoutFailure = CheckoutRefused | QueryError | Schema.SchemaError;

/** The prompt a session runs under and the content address its turns are recorded under, with the one fact of the repository it was composed on. */
interface CoderSessionPrompt {
  readonly text: string;
  readonly hash: string;
  readonly ciReadable: boolean;
}

/**
 * What the coder project keeps of the session's prompt, beside the content
 * address the planning brain keeps (`brain-host/host.ts`): whether the
 * prompt said the repository's CI is readable, which is what composes the
 * same text again for a step's estimate of it.
 */
export interface CoderSessionPromptRecord extends SessionPromptRecord {
  readonly ciReadable?: boolean;
}

/** The model a step runs on under the scripted fixture: whatever the authored file hands in, under the fixture's own id. */
interface ScriptedCoderModel {
  readonly model: CoderModelSelection["model"];
}

/** What a delegation answers once admitted: the model and effort the worker runs on, or the one sentence refusing the agent's ask. */
type DelegationEffect = Effect.Effect<
  Result.Result<ModelChoice, string>,
  QueryError | Schema.SchemaError,
  DatabaseServices | ModelCatalog
>;

export interface CoderHost extends HostAdmission {
  /**
   * The admission the session's sandbox takes as it opens, claiming the
   * record as the start does: eve stages a message's files in the sandbox
   * before the turn opens, so an opening message that carries files opens
   * the sandbox ahead of `session.started`, when nothing has claimed the
   * record yet. A session that cannot claim it is refused as `admit` refuses.
   */
  admitSandbox(auth: SessionAuth, sessionId: string): HostEffect<ConversationAdmission>;
  /** The agent the admitted conversation is, or the refusal for a conversation that is no agent's. */
  agent(admitted: AdmittedConversation): HostEffect<Result.Result<CodingAgent, CoderRefusal>>;
  /** The model one step of the turn named runs on, read from the agent's row now, with the window the catalog lists for it. */
  model(
    admitted: AdmittedConversation,
    scripted: ScriptedCoderModel | undefined,
    turnId: string,
  ): Effect.Effect<
    Result.Result<CoderModelSelection, CoderRefusal>,
    QueryError | Schema.SchemaError,
    DatabaseServices | ModelCatalog
  >;
  /**
   * A delegation under the call that makes it: the pair the agent asked for,
   * filled in from its own row and held to the catalog, recorded under the
   * child conversation the call names ahead of the worker's session.
   */
  delegate(admitted: AdmittedConversation, callId: string, asked: DelegationAsk): DelegationEffect;
  /** The model one step of a worker's turn named runs on, read from the delegation the parent's call recorded, with the window the catalog lists for it. */
  delegatedModel(
    admitted: AdmittedConversation,
    parentCallId: string,
    scripted: ScriptedCoderModel | undefined,
    turnId: string,
  ): Effect.Effect<
    Result.Result<CoderModelSelection, CoderRefusal>,
    QueryError | Schema.SchemaError,
    DatabaseServices | ModelCatalog
  >;
  /** The instructions the session runs under, with the hash its turns are recorded under, composed on whether the agent's token reads the repository's CI; the text itself is stored nowhere. */
  prompt(
    admitted: AdmittedConversation,
    agent: CodingAgent,
  ): Effect.Effect<CoderSessionPrompt, never, CheckoutServices>;
  /** The skills the agent's repository keeps, offered to the session as it starts; none where they could not be read (`skills.ts`). */
  skills(
    admitted: AdmittedConversation,
    agent: CodingAgent,
  ): Effect.Effect<readonly AgentSkill[], never, CheckoutServices>;
  /** The agent's repository checked out into the sandbox; answers the write token for the caller to set at the firewall. */
  checkOut(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<Redacted.Redacted, CheckoutFailure, CheckoutServices>;
  /** A fresh write token for the agent's repository, for the firewall once the standing one is old. */
  repositoryToken(
    admitted: AdmittedConversation,
  ): Effect.Effect<Redacted.Redacted, CheckoutFailure, CheckoutServices>;
  /**
   * The branch checked out in the sandbox as the turn ended, written on the
   * agent's row for its pull request to be read from; null where the
   * checkout stood detached. A read or write that fails is logged and
   * nothing is written, so the caller's stop of the sandbox follows either
   * way.
   */
  recordBranch(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<void, never, DatabaseServices>;
  /**
   * Relays one event of a worker's session into the child conversation its
   * delegation was recorded under, as a child turn on the recorded pair; a
   * session with no parent, one the caller does not reach, or one no
   * delegation was recorded for relays nothing.
   */
  relayChild(
    event: MessageStreamEvent,
    session: SessionContext["session"],
    state: RelayStateStore,
  ): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices | HttpClient.HttpClient>;
  /** The agent's title generated from its first exchange as one of its first turns ends, written where none stands; a later turn, a failed or empty answer, and a title already standing each leave the row as it is. */
  title(admitted: AdmittedConversation): HostEffect<void>;
  /** A worker's title generated from the task its call handed it and written on the child conversation the call recorded, where none stands; a call no delegation was recorded for, a failed call, and a title already standing each write nothing. */
  delegationTitle(admitted: AdmittedConversation, callId: string, task: string): HostEffect<void>;
  /** Takes one `edit_plan` call's notes into the agent's plan, given how many notes the turn has taken already. */
  editPlan(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    takenInTurn: number,
  ): Effect.Effect<PlanEditResult, never, DatabaseServices>;
  /** Runs one of the agent's inbox tools (`inbox.ts`): a post, a close, or a read of its own items. */
  inbox(
    admitted: AdmittedConversation,
    call: InboxCall,
  ): Effect.Effect<InboxToolResult, never, DatabaseServices>;
  /**
   * Runs one of the agent's public reads, the planning model's own
   * (`../public-research.ts`): a search or a page read, under the turn's
   * budget, the search on Luke's key and counted on the account's meter.
   * The budget is the turn's own, named with its session, since eve numbers
   * every session's turns afresh.
   */
  research(
    admitted: AdmittedConversation,
    tool: typeof CODER_TOOL.SEARCH_WEB | typeof CODER_TOOL.READ_WEB_PAGE,
    turn: { readonly sessionId: string; readonly eveTurnId: string },
    input: UnparsedWireValue,
  ): Effect.Effect<SearchWebResult | ReadWebPageResult, never, HttpClient.HttpClient>;
  /** Runs one `show_page` call (`../page-tool.ts`) on the agent's plan, a page's path read from the session's sandbox through the door given. */
  showPage(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    sandbox: InboxSandboxDoor,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
  /** Relays one event of the session's stream into the store, under the state the caller keeps for the session and the prompt it composed. */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
    prompt: CoderSessionPromptRecord,
  ): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices | HttpClient.HttpClient>;
}

/** One call of the agent's inbox tools, by the tool's name and the input eve held to its schema; a post carries the door to the session's sandbox, where its pictures are read. */
export type InboxCall =
  | {
      readonly tool: typeof INBOX_TOOL.POST;
      readonly input: UnparsedWireValue;
      readonly sandbox: InboxSandboxDoor;
    }
  | {
      readonly tool: typeof INBOX_TOOL.CLOSE | typeof INBOX_TOOL.READ;
      readonly input: UnparsedWireValue;
    };

/** A failure as a log line carries it: the checkout's reason, or a store failure's kind alone, since its message may name a statement. */
function describeFailure(failure: CheckoutFailure): string {
  return failure._tag === "CheckoutRefused" ? failure.reason : failure._tag;
}

/** The host over the deployment's seams. */
export function coderHost(seams: CoderHostSeams): CoderHost {
  const research = new ResearchBudget();
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

  /** The model a step of the turn runs on for the choice: the fixture's own under the scripted model, else the provider's at the window the choice names of the ones the catalog lists, or the fallback where it lists none. */
  const selectedModel = (
    userId: string,
    choice: ModelChoice,
    scripted: ScriptedCoderModel | undefined,
    turnId: string,
  ) =>
    Effect.gen(function* () {
      if (scripted !== undefined) {
        return Result.succeed({
          model: scripted.model,
          modelContextWindowTokens: CODER.FALLBACK_CONTEXT_WINDOW_TOKENS,
          modelOptions: {},
        });
      }
      const offered = yield* catalogNow;
      const window = contextWindowOf(
        offered,
        choice.model,
        choice.contextWindow ?? CONTEXT_WINDOW.LONG,
      );
      return coderModel(choice, yield* seams.keys(userId), window, () =>
        seams.fastRefused(userId, turnId),
      );
    });

  /** The instructions the agent's session runs under, composed on what its row names and whether its token reads the repository's CI. */
  const promptOf = (agent: CodingAgent, ciReadable: boolean): CoderSessionPrompt => {
    const brief = agent.task === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.TASK;
    const text = coderInstructions(agent.repository, brief, ciReadable);
    return { text, hash: promptHashOf(text), ciReadable };
  };

  /**
   * What a step's end or a compaction leaves in the agent's context,
   * written on its row; every other event writes nothing. The instructions
   * are composed again as the session's start composed them, from what its
   * prompt record kept. A write that fails is logged and the relay goes on,
   * since the transcript stands without it and the next step writes again.
   */
  const recordContext = (
    event: MessageStreamEvent,
    userId: string,
    agent: CodingAgent,
    prompt: CoderSessionPromptRecord,
  ) => {
    const written = Effect.suspend(() => {
      switch (event.type) {
        case "step.completed": {
          const step = agentStepOf(
            event.data.usage,
            {
              instructions: promptOf(agent, prompt.ciReadable ?? false).text,
              brief: agent.task ?? agent.planSnapshot ?? "",
            },
            seams.now(),
          );
          return step === undefined ? Effect.void : recordCodingAgentStep(userId, agent.id, step);
        }
        case "compaction.completed":
          return recordCodingAgentCompaction(userId, agent.id, new Date(seams.now()));
        default:
          return Effect.void;
      }
    });
    return written.pipe(Effect.catch(logStoreFailure));
  };

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
    ...hostAdmission(seams.now),
    admitSandbox: (auth, sessionId) =>
      Effect.gen(function* () {
        const starting = yield* admitConversation(auth, {
          id: sessionId,
          standing: SESSION_STANDING.CLAIMING,
        });
        if (Result.isFailure(starting)) return starting;
        yield* claimRuntimeSession(starting.success.target, sessionId, new Date(seams.now()));
        return yield* admitConversation(auth, {
          id: sessionId,
          standing: SESSION_STANDING.CURRENT,
        });
      }),
    agent: agentOf,

    model: (admitted, scripted, turnId) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return Result.fail(found.failure);
        const agent = found.success;
        return yield* selectedModel(
          admitted.target.userId,
          { model: agent.model, effort: agent.effort, contextWindow: agent.contextWindow },
          scripted,
          turnId,
        );
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
          // A worker is offered what the agent's account is, so no worker runs a fast version its key's organization was never granted.
          const fastAccess = yield* anthropicFastAccess(admitted.target.userId);
          const chosen = delegationChoice(own, asked, offeredToAccount(offered.value, fastAccess));
          if (Result.isFailure(chosen)) return chosen;
          choice = chosen.success;
        }
        const childId = childConversationId(admitted.target.conversationId, callId);
        yield* recordDelegation(admitted.target, callId, choice, CODER_TOOL.DELEGATE);
        // The pair answered is the pair recorded: a call replayed after the agent's row changed
        // finds the delegation it already made, which is the one the worker runs on.
        const recorded = yield* readDelegation(admitted.target, childId);
        return Result.succeed(
          Option.match(recorded, {
            onNone: () => choice,
            onSome: ({ model, effort }) => ({ model, effort }),
          }),
        );
      }),

    delegatedModel: (admitted, parentCallId, scripted, turnId) =>
      Effect.gen(function* () {
        const childId = childConversationId(admitted.target.conversationId, parentCallId);
        const delegation = yield* readDelegation(admitted.target, childId);
        if (Option.isNone(delegation)) return Result.fail(CODER_REFUSAL.NO_DELEGATION);
        const { model, effort } = delegation.value;
        return yield* selectedModel(admitted.target.userId, { model, effort }, scripted, turnId);
      }),

    prompt: (admitted, agent) =>
      Effect.map(agentCiReadable(admitted.target, agent), (ciReadable) =>
        promptOf(agent, ciReadable),
      ),

    skills: (admitted, agent) => agentSkills(admitted.target, agent),

    checkOut: (admitted, sandbox) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        checkOutAgentRepository(admitted.target, agent, sandbox),
      ),

    repositoryToken: (admitted) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        Effect.map(agentRepositoryToken(admitted.target, agent), (minted) => minted.token),
      ),

    recordBranch: (admitted, sandbox) =>
      Effect.gen(function* () {
        const agent = yield* agentOrRefused(admitted);
        const branch = yield* checkoutBranch(sandbox);
        yield* updateCodingAgentBranch(admitted.target.userId, agent.id, branch);
      }).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `The branch of conversation ${admitted.target.conversationId} was not recorded: ${describeFailure(failure)}`,
          ),
        ),
      ),

    relayChild: (event, session, state) =>
      Effect.gen(function* () {
        const found = yield* delegatedChildOf(session);
        if (Option.isNone(found)) return;
        const { parent, child } = found.value;
        const delegation = yield* readDelegation(parent, child.conversationId);
        if (Option.isNone(delegation)) return;
        const model = seams.scriptedModel()
          ? CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID
          : delegation.value.model;
        yield* relayEvent(event, {
          sessionId: session.id,
          target: child,
          turn: RELAY_TURN.CHILD,
          model,
          reasoningEffort: delegation.value.effort,
          state,
        });
      }),
    editPlan: (admitted, input, takenInTurn) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return planEditRejected(found.failure);
        // An agent handed a task never saw the plan, so it has none to take notes on.
        if (found.success.task !== null) return planEditRejected(PLAN_EDIT_REFUSAL.NO_PLAN);
        const { id: agentId, planId } = found.success;
        // The plan is written as the member whose turn this is, whoever started the agent.
        const binding = { userId: admitted.caller, planId };
        return yield* recordPlanEdit(binding, { agentId }, input, takenInTurn);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNAVAILABLE))),
      ),

    inbox: (admitted, call) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return inboxRejected(INBOX_REFUSAL.NO_AGENT);
        const { id: agentId, planId, repository } = found.success;
        const agent = { userId: admitted.target.userId, planId, agentId };
        switch (call.tool) {
          case INBOX_TOOL.POST:
            return yield* postToInbox({ ...agent, repository }, call.input, call.sandbox);
          case INBOX_TOOL.CLOSE:
            return yield* closeInInbox(agent, call.input);
          case INBOX_TOOL.READ:
            return yield* readOwnInbox(agent);
        }
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
      ),

    showPage: (admitted, input, sandbox) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return showPageRejected(found.failure);
        const binding = {
          userId: admitted.target.userId,
          planId: found.success.planId,
          sandbox: { door: sandbox, checkout: CODER.CHECKOUT_PATH },
        };
        return yield* runShowPage(binding, input);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(showPageRejected(SHOW_PAGE_REFUSAL.UNAVAILABLE))),
      ),

    title: (admitted) =>
      Effect.gen(function* () {
        const model = seams.titleModel(admitted.target.userId);
        if (model === undefined) return;
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return;
        yield* titleCodingAgent(model, admitted.target, found.success);
      }),

    delegationTitle: (admitted, callId, task) =>
      Effect.gen(function* () {
        const model = seams.titleModel(admitted.target.userId);
        if (model === undefined) return;
        // A call no delegation was recorded for opened no child, so the fill finds no row to write.
        const childId = childConversationId(admitted.target.conversationId, callId);
        yield* titleSubagent(model, admitted.target, childId, task);
      }),

    research: (admitted, tool, turn, input) => {
      const access = seams.research(admitted.target.userId);
      const turnId = hostTurnId(turn.sessionId, turn.eveTurnId);
      const call = { turnId, budget: research, openAi: access.openAi, spend: access.spend };
      return tool === CODER_TOOL.SEARCH_WEB
        ? runSearchWeb(call, input)
        : runReadWebPage(call, input);
    },

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
        if (agent !== undefined) {
          yield* recordContext(event, admitted.target.userId, agent, prompt);
        }
      }),
  };
}
