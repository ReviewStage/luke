import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { settleEndedSession } from "@luke/database/models/abandoned-turns";
import { chatEnabledFor } from "@luke/database/models/account-store";
import {
  type CodingAgent,
  readCodingAgentOfConversation,
  readDelegation,
  recordCodingAgentCompaction,
  recordCodingAgentStep,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { promptHashOf } from "@luke/database/models/content-addressed";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { CHAT_TOOL, MEMBER_KIND } from "@luke/features/chat-wire";
import { CODING_AGENT_BRIEF, CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { ModelChoice } from "@luke/features/models-wire";
import { PAGE_SHOWER } from "@luke/features/page-wire";
import { causeKind } from "@luke/runtime/effect";
import { Effect, Option, type Redacted, Result, type Schema, Stream } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import type { UnparsedWireValue, WireRecord } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  ModelCatalog,
  type OfferedModel,
  offeredToAccount,
} from "../../providers/model-catalog.js";
import { runShowPage, SHOW_PAGE_REFUSAL, showPageRejected } from "../../tasks/page-tool.js";
import {
  PICTURE_LOOK_REFUSAL,
  type PictureLookResult,
  pictureNotLooked,
  runLookAtPicture,
} from "../../tasks/picture-look.js";
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
import {
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveSessions,
  eveSessionsComposer,
} from "../brain-host/eve-sessions.js";
import type { SessionPromptRecord } from "../brain-host/host.js";
import { type RelayStanding, type RelayStateStore, StreamRelay } from "../brain-host/relay.js";
import {
  AGENT_CALLER,
  agentToolRejected,
  CODING_AGENT_TOOL_REFUSAL,
  runArchiveAgent,
  runListAgents,
  runListModels,
  runListTasks,
  runMessageAgent,
  runReadAgent,
  runReadPage,
  runStartAgent,
  runStopAgent,
  runUnarchiveAgent,
} from "../coding-agent-tools.js";
import {
  type ReadWebPageResult,
  ResearchBudget,
  runReadWebPage,
  runSearchWeb,
  type SearchWebResult,
} from "../public-research.js";
import type { RepositorySandbox } from "../repository-shell.js";
import { runCreateSection, runDeleteSection, runMoveTask } from "../task-section-tools.js";
import { workspaceStepOf } from "../written-mentions.js";
import { anthropicFastAccess } from "./account-keys.js";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";
import {
  agentAway,
  CHAT_TOOL_REFUSAL,
  type ChatToolResult,
  chatDigest,
  chatRejected,
  postAsAgent,
  readAsAgent,
  resolveAsAgent,
} from "./chat.js";
import { CHAT_DOORS } from "./chat-notify.js";
import {
  agentCiReadable,
  agentCoAuthor,
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
  replyInInbox,
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
import {
  openPullRequest,
  PULL_REQUEST_UNAVAILABLE,
  type PullRequestToolResult,
  pullRequestRejected,
} from "./pull-request.js";
import { runShowImage, SHOW_IMAGE_REFUSAL, showImageRejected } from "./show-image.js";
import { agentSkills } from "./skills.js";
import { titleCodingAgent, titleSubagent } from "./title.js";
import { CODER_TOOL } from "./tool-set.js";

/**
 * host.ts -- the coding-agent host composed over eve and the store: what the coder project's authored files call.
 *
 * The same shape as the brain's host (`brain-host/host.ts`): eve is
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
 * opening as the relay writes it, and from its first exchange as one of its
 * first turns ends, written where no title stands yet, and never again, so
 * a name the developer gives is the last word; each worker is named by the
 * same call over the task its delegation handed it.
 * Beside the relay, each step's end and each compaction of the agent's own
 * conversation is written on the agent's row, which is what the tab's
 * context ring reads (`context-estimate.ts`).
 * Any member of the task's workspace is admitted to an agent's conversation,
 * and the plan is read and written as the member whose turn it is; the
 * agent's row, its provider keys, its checkout, and its context stay its
 * starter's, the conversation's owner, whoever is speaking to it.
 */

/** What a host function answers: an effect over the ambient client, which the coder's authored files run at the web's edge. */
type HostEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** How a checkout or a mint fails: the checkout's refusal, which the host's own refusal of a conversation that is no agent's is carried as, or the store's. */
export type CheckoutFailure = CheckoutRefused | QueryError | Schema.SchemaError;

/** The prompt a session runs under and the content address its turns are recorded under, with the facts of the repository it was composed on. */
interface CoderSessionPrompt {
  readonly text: string;
  readonly hash: string;
  readonly ciReadable: boolean;
  /** The co-author trailer the prompt handed, where the agent writes as its developer. */
  readonly coAuthor: string | undefined;
  /** The step the agent's workspace was written under in the prompt's links (`../written-mentions.ts`). */
  readonly workspace: string;
  /** Whether the prompt told of the workspace's chat, which only an agent whose starter turned Chat on is. */
  readonly chatOn: boolean;
}

/**
 * What the coder project keeps of the session's prompt, beside the content
 * address the brain keeps (`brain-host/host.ts`): whether the
 * prompt said the repository's CI is readable, the co-author trailer it
 * handed where it handed one, the step its links wrote the workspace
 * under, and whether it told of the chat, which are what compose the same text again for a step's estimate
 * of it; a record kept before the step was keeps none, and its links are
 * composed under the workspace's id.
 */
export interface CoderSessionPromptRecord extends SessionPromptRecord {
  readonly ciReadable?: boolean;
  readonly coAuthor?: string;
  readonly workspace?: string;
  readonly chatOn?: boolean;
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
  /** The instructions the session runs under, with the hash its turns are recorded under, composed on whether the agent's token reads the repository's CI and whose its commits are; the text itself is stored nowhere. */
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
   * checkout stood detached or on the branch the agent was started on. A read or write that fails is logged and
   * nothing is written, so the caller's stop of the sandbox follows either
   * way.
   */
  recordBranch(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<void, never, DatabaseServices>;
  /**
   * Whether a developer's terminal holds the agent's sandbox now: a lease
   * the terminal relay moves on as they type (`sandbox-terminal-lease.ts`),
   * which the turn-end stop leaves running. A read that fails is logged and
   * answers no, so the stop goes ahead as it would with no terminal.
   */
  sandboxHeld(admitted: AdmittedConversation): Effect.Effect<boolean, never, DatabaseServices>;
  /**
   * Settles failed for its session's end the turn still queued or running
   * of the coding agent whose conversation records the session eve said
   * ended, failed or completed, or cancelled where a Stop was asked of it
   * (`abandoned-turns.ts`'s `settleEndedSession`),
   * so the agent reads as failed at once rather than running until the
   * sweep's day-long bound. eve names the session itself, from inside its
   * own run, so nothing is admitted: a session no agent's conversation
   * records settles nothing. Never fails, since its caller is eve's channel
   * adapter: a store failure is logged and dropped, and the sweep's bound
   * still ends the turn in time.
   */
  sessionEnded(sessionId: string): Effect.Effect<void, never, DatabaseServices>;
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
  /** A worker's title generated from the task its call handed it and written on the child conversation the call recorded, where none stands; a call no delegation was recorded for, a failed call, and a title already standing each write nothing. */
  delegationTitle(admitted: AdmittedConversation, callId: string, task: string): HostEffect<void>;
  /** Takes one `edit_plan` call's notes into the agent's plan, given how many notes the turn has taken already. */
  editPlan(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    takenInTurn: number,
    sandbox: InboxSandboxDoor,
  ): Effect.Effect<PlanEditResult, never, DatabaseServices>;
  /** Opens the agent's pull request (`pull-request.ts`): as its developer where it writes as them, as the App otherwise. */
  openPullRequest(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
  ): Effect.Effect<PullRequestToolResult, never, CheckoutServices>;
  /** Runs one of the agent's inbox tools (`inbox.ts`): a post, a close, or a read of its own items. */
  inbox(
    admitted: AdmittedConversation,
    call: InboxCall,
  ): Effect.Effect<InboxToolResult, never, DatabaseServices>;
  /**
   * Whether the agent is offered its chat tools this turn: only where the
   * account that started it turned Chat on and where the session's prompt,
   * composed as it started, told of chat; never where that cannot be read.
   * Note that a session started before Chat was turned on is offered none,
   * because its instructions do not say when to use them.
   */
  chatOffered(
    admitted: AdmittedConversation,
    prompt: CoderSessionPromptRecord,
  ): Effect.Effect<boolean, never, DatabaseServices>;
  /**
   * Runs one of the agent's chat tools (`chat.ts`): a post, told to each
   * agent it addresses through eve as the deployment acting for that agent's
   * starter, and held for its next read where the deployment names no secret
   * or no origin for eve; a read; or a resolve. Refused where Chat is off for
   * the agent's starter, as the tools are then not offered.
   */
  chat(
    admitted: AdmittedConversation,
    call: ChatCall,
  ): Effect.Effect<ChatToolResult, never, DatabaseServices | HttpClient.HttpClient | GitHubApp>;
  /** What the agent has not read in its workspace's chat, as a turn opens with it (`chat.ts`); nothing where nothing waits, the conversation is no agent's, or the agent's starter has not turned Chat on. */
  chatDigest(
    admitted: AdmittedConversation,
  ): Effect.Effect<string | undefined, never, DatabaseServices>;
  /**
   * Runs one of the agent's public reads, the brain's own
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
  /**
   * Runs one `look_at_picture` call (`../../plans/picture-look.ts`): one of
   * the pictures of the agent's plan, read as the member whose turn this is.
   */
  lookAtPicture(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
  ): Effect.Effect<PictureLookResult, never, DatabaseServices>;
  /** Runs one `show_page` call (`../page-tool.ts`) on the agent's task, a page's path read from the session's sandbox through the door given. */
  showPage(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    sandbox: InboxSandboxDoor,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
  /** Runs one `show_image` call (`show-image.ts`): the pictures read from the session's sandbox through the door given and kept beside the agent's transcript. */
  showImage(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    sandbox: InboxSandboxDoor,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
  /** Runs one of a worker's `show_image` calls, its pictures kept beside the worker's own transcript, the child of the call that started it; nothing kept for a session that is no worker the account reaches. */
  showDelegatedImage(
    session: SessionContext["session"],
    input: UnparsedWireValue,
    sandbox: InboxSandboxDoor,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
  /**
   * Runs one of the agent's tools about the workspace's coding agents
   * (`../coding-agent-tools.ts`), the agent its session was admitted to as
   * the caller: a list of agents or of tasks, a message sent under the
   * call's own key, or a start on a task of its workspace under the same key, which reach eve as the deployment
   * acting for this agent's starter, and reach nothing where the deployment
   * names no secret or no origin for eve.
   */
  agentTools(
    admitted: AdmittedConversation,
    call: AgentToolCall,
  ): Effect.Effect<
    WireRecord,
    never,
    DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog
  >;
  /** Relays one event of the session's stream into the store, under the state the caller keeps for the session and the prompt it composed, then, as the developer's words are received or a turn completes, asks for the agent's title where none stands and waits for it (`title.ts`); a title that fails is logged and the relay still answers. */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
    prompt: CoderSessionPromptRecord,
  ): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices | HttpClient.HttpClient>;
}

/** One call of the agent's inbox tools, by the tool's name and the input eve held to its schema; a post and a reply carry the door to the session's sandbox, where their pictures are read. */
export type InboxCall =
  | {
      readonly tool: typeof INBOX_TOOL.POST | typeof INBOX_TOOL.REPLY;
      readonly input: UnparsedWireValue;
      readonly sandbox: InboxSandboxDoor;
    }
  | {
      readonly tool: typeof INBOX_TOOL.CLOSE | typeof INBOX_TOOL.READ;
      readonly input: UnparsedWireValue;
    };

/** One call of the agent's tools about the workspace's coding agents, by the tool's name, the input eve held to its schema, and eve's id for the call. */
export interface AgentToolCall {
  readonly tool:
    | typeof CODER_TOOL.LIST_AGENTS
    | typeof CODER_TOOL.READ_AGENT
    | typeof CODER_TOOL.MESSAGE_AGENT
    | typeof CODER_TOOL.START_AGENT
    | typeof CODER_TOOL.ARCHIVE_AGENT
    | typeof CODER_TOOL.UNARCHIVE_AGENT
    | typeof CODER_TOOL.STOP_AGENT
    | typeof CODER_TOOL.READ_PAGE
    | typeof CODER_TOOL.LIST_TASKS
    | typeof CODER_TOOL.CREATE_SECTION
    | typeof CODER_TOOL.DELETE_SECTION
    | typeof CODER_TOOL.MOVE_TASK
    | typeof CODER_TOOL.LIST_MODELS;
  readonly input: UnparsedWireValue;
  readonly callId: string;
}

/** Each of the agent tools a coding agent is offered, run under the call it makes. */
const AGENT_TOOL_RUN = {
  [CODER_TOOL.LIST_AGENTS]: runListAgents,
  [CODER_TOOL.READ_AGENT]: runReadAgent,
  [CODER_TOOL.MESSAGE_AGENT]: runMessageAgent,
  [CODER_TOOL.START_AGENT]: runStartAgent,
  [CODER_TOOL.ARCHIVE_AGENT]: runArchiveAgent,
  [CODER_TOOL.UNARCHIVE_AGENT]: runUnarchiveAgent,
  [CODER_TOOL.STOP_AGENT]: runStopAgent,
  [CODER_TOOL.READ_PAGE]: runReadPage,
  [CODER_TOOL.LIST_TASKS]: runListTasks,
  [CODER_TOOL.CREATE_SECTION]: runCreateSection,
  [CODER_TOOL.DELETE_SECTION]: runDeleteSection,
  [CODER_TOOL.MOVE_TASK]: runMoveTask,
  [CODER_TOOL.LIST_MODELS]: runListModels,
} as const;

/** One call of the agent's chat tools, by the tool's name and the input eve held to its schema; a post carries its call's id, its key, how many posts its turn has made, and the door to the session's sandbox, where its pictures are read. */
export type ChatCall =
  | {
      readonly tool: typeof CHAT_TOOL.POST;
      readonly input: UnparsedWireValue;
      readonly clientKey: string;
      readonly postsInTurn: number;
      readonly sandbox: InboxSandboxDoor;
    }
  | { readonly tool: typeof CHAT_TOOL.READ; readonly input: UnparsedWireValue }
  | { readonly tool: typeof CHAT_TOOL.RESOLVE; readonly input: UnparsedWireValue };

/**
 * eve as a deployment that names no secret or no origin for it reaches it:
 * every call answered as failed, so a chat post still lands and a member it
 * addresses, whose notice could not be handed over, reads it when it next
 * reads, as one whose steer eve refused does (`chat-notify.ts`).
 */
const EVE_UNREACHED: EveSessions = {
  open: () =>
    Effect.succeed({
      outcome: EVE_SEND_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  send: () =>
    Effect.succeed({
      outcome: EVE_SEND_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  cancel: () =>
    Effect.succeed({
      outcome: EVE_CANCEL_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  reset: () =>
    Effect.succeed({
      outcome: EVE_RESET_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  stream: () => Stream.empty,
};

/** A failure as a log line carries it: the checkout's reason, or a store failure's kind alone, since its message may name a statement. */
function describeFailure(failure: CheckoutFailure): string {
  return failure._tag === "CheckoutRefused" ? failure.reason : failure._tag;
}

/** Whether the agent is asked for its title as this event is relayed: the developer's words received, so a long first turn is named as it starts, and a turn's end, which reads the answer too, a failed one's among them, so an agent whose first turn fails is still named. */
function asksTitle(event: MessageStreamEvent): boolean {
  return (
    event.type === "message.received" ||
    event.type === "turn.completed" ||
    event.type === "turn.failed"
  );
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

  /** The instructions the agent's session runs under, composed on what its row names, whether its token reads the repository's CI, and the co-author trailer where it writes as its developer. */
  const promptOf = (
    agent: CodingAgent,
    ciReadable: boolean,
    coAuthor: string | undefined,
    workspace: string,
    chatOn: boolean,
  ): CoderSessionPrompt => {
    const brief = agent.prompt === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.PROMPT;
    const taskLink =
      agent.taskId === null
        ? null
        : encodeMention(
            { kind: MENTION_KIND.TASK, taskId: agent.taskId },
            { workspace, repository: null },
          );
    const text = coderInstructions(
      agent.repository,
      brief,
      ciReadable,
      taskLink,
      coAuthor,
      chatOn,
      agent.startBranch,
    );
    return { text, hash: promptHashOf(text), ciReadable, coAuthor, workspace, chatOn };
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
              instructions: promptOf(
                agent,
                prompt.ciReadable ?? false,
                prompt.coAuthor,
                prompt.workspace ?? agent.organizationId,
                prompt.chatOn ?? false,
              ).text,
              brief: agent.prompt ?? agent.planSnapshot ?? "",
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
      Effect.map(
        Effect.all([
          agentCiReadable(admitted.target, agent),
          agentCoAuthor(admitted.target, agent),
          // A slug that cannot be read is written as the workspace's id, which finds the same things.
          workspaceStepOf(admitted.target.userId, agent.organizationId).pipe(
            Effect.tapError(logStoreFailure),
            Effect.orElseSucceed(() => agent.organizationId),
          ),
          // Chat is told of only where the agent's starter turned it on; where that cannot be read, it is off.
          chatEnabledFor(admitted.target.userId).pipe(
            Effect.tapError(logStoreFailure),
            Effect.orElseSucceed(() => false),
          ),
        ]),
        ([ciReadable, coAuthor, workspace, chatOn]) =>
          promptOf(agent, ciReadable, coAuthor, workspace, chatOn),
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
        // Note that the branch the agent was started on is another's, such as a stacked pull
        // request's, so standing on it is recorded as no branch of its own: no pull request
        // and no GitHub delivery on that branch is taken for this agent's.
        const own = branch === agent.startBranch ? null : branch;
        yield* updateCodingAgentBranch(admitted.target.userId, agent.id, own);
      }).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `The branch of conversation ${admitted.target.conversationId} was not recorded: ${describeFailure(failure)}`,
          ),
        ),
      ),

    sandboxHeld: (admitted) =>
      sandboxHeld(admitted.target.conversationId, new Date(seams.now())).pipe(
        Effect.catch((failure) =>
          Effect.as(
            Effect.logWarning(
              `The terminal lease of conversation ${admitted.target.conversationId} was not read: ${failure._tag}`,
            ),
            false,
          ),
        ),
      ),

    sessionEnded: (sessionId) =>
      Effect.gen(function* () {
        const writer = yield* seams.writer();
        yield* settleEndedSession(writer, sessionId, { now: seams.now() });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `The turn of ended session ${sessionId} was not settled: ${causeKind(cause)}`,
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
    editPlan: (admitted, input, takenInTurn, sandbox) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return planEditRejected(found.failure);
        // An agent handed a prompt never saw the plan, so it has none to take notes on.
        if (found.success.prompt !== null) return planEditRejected(PLAN_EDIT_REFUSAL.NO_TASK);
        const { id: agentId, taskId } = found.success;
        if (taskId === null) return planEditRejected(PLAN_EDIT_REFUSAL.NO_TASK);
        // The plan is written as the member whose turn this is, whoever started the agent.
        const binding = { userId: admitted.caller, taskId };
        return yield* recordPlanEdit(binding, { agentId }, input, takenInTurn, sandbox);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNAVAILABLE))),
      ),

    inbox: (admitted, call) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return inboxRejected(INBOX_REFUSAL.NO_AGENT);
        const { id: agentId, taskId, repository } = found.success;
        const agent = { userId: admitted.target.userId, taskId, agentId };
        switch (call.tool) {
          case INBOX_TOOL.POST:
            return yield* postToInbox({ ...agent, repository }, call.input, call.sandbox);
          case INBOX_TOOL.CLOSE:
            return yield* closeInInbox(agent, call.input);
          case INBOX_TOOL.READ:
            return yield* readOwnInbox(agent);
          case INBOX_TOOL.REPLY:
            return yield* replyInInbox(agent, call.input, call.sandbox);
        }
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
      ),

    lookAtPicture: (admitted, input) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return pictureNotLooked(found.failure);
        const { taskId } = found.success;
        if (taskId === null) return pictureNotLooked(PICTURE_LOOK_REFUSAL.TASKLESS);
        // The plan is read as the member whose turn this is, as `editPlan` writes it.
        return yield* runLookAtPicture({ userId: admitted.caller, taskId }, input);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
      ),

    openPullRequest: (admitted, input) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return pullRequestRejected(found.failure);
        return yield* openPullRequest(admitted.target, found.success, input);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(pullRequestRejected(PULL_REQUEST_UNAVAILABLE))),
      ),

    chatOffered: (admitted, prompt) =>
      (prompt.chatOn === true
        ? chatEnabledFor(admitted.target.userId)
        : Effect.succeed(false)
      ).pipe(
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => false),
      ),

    chat: (admitted, call) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return chatRejected(CHAT_TOOL_REFUSAL.NO_AGENT);
        if (!(yield* chatEnabledFor(admitted.target.userId))) {
          return chatRejected(CHAT_TOOL_REFUSAL.OFF);
        }
        const { id: agentId, taskId, repository } = found.success;
        const self = { kind: MEMBER_KIND.AGENT, agentId };
        const reader = { userId: admitted.target.userId, taskId, self };
        if (call.tool === CHAT_TOOL.READ) return yield* readAsAgent(reader, call.input);
        if (call.tool === CHAT_TOOL.RESOLVE) return yield* resolveAsAgent(reader, call.input);
        // An archived agent, or one on an archived task, posts nothing until it is brought back.
        if (yield* agentAway(admitted.target.userId, found.success)) {
          return chatRejected(CHAT_TOOL_REFUSAL.LEFT);
        }
        // A notice reaches the receiving agent's session as the deployment acting for that agent's
        // starter, whose principal its turn runs under, as the planning model's message to an
        // agent does: no bearer stands here.
        const secret = seams.deploymentSecret();
        const origin = seams.eveOrigin();
        const compose = yield* eveSessionsComposer;
        const eveFor = (starter: string) =>
          secret === undefined || origin === undefined
            ? EVE_UNREACHED
            : compose({ origin, caller: { secret, account: starter }, mount: EVE_MOUNT.CODER });
        const telling = { eveFor, writer: seams.writer(), doors: CHAT_DOORS };
        const { clientKey, postsInTurn, sandbox } = call;
        return yield* postAsAgent({ ...reader, repository, telling }, call.input, {
          clientKey,
          postsInTurn,
          sandbox,
        });
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNAVAILABLE))),
      ),

    chatDigest: (admitted) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return undefined;
        // A turn opens with the chat only where the agent's starter turned Chat on.
        if (!(yield* chatEnabledFor(admitted.target.userId))) return undefined;
        const { id: agentId, taskId } = found.success;
        return yield* chatDigest({
          userId: admitted.target.userId,
          taskId,
          self: { kind: MEMBER_KIND.AGENT, agentId },
        });
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(undefined)),
      ),

    showPage: (admitted, input, sandbox) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return showPageRejected(found.failure);
        const { taskId } = found.success;
        if (taskId === null) return showPageRejected(SHOW_PAGE_REFUSAL.TASKLESS);
        const binding = {
          userId: admitted.target.userId,
          taskId,
          sandbox: { door: sandbox, checkout: CODER.CHECKOUT_PATH },
        };
        return yield* runShowPage(binding, input, {
          kind: PAGE_SHOWER.AGENT,
          agentId: found.success.id,
        });
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(showPageRejected(SHOW_PAGE_REFUSAL.UNAVAILABLE))),
      ),

    showImage: (admitted, input, sandbox) =>
      runShowImage({ target: admitted.target, sandbox, checkout: CODER.CHECKOUT_PATH }, input),

    showDelegatedImage: (session, input, sandbox) =>
      Effect.gen(function* () {
        const found = yield* delegatedChildOf(session);
        if (Option.isNone(found)) return showImageRejected(SHOW_IMAGE_REFUSAL.UNAVAILABLE);
        const binding = { target: found.value.child, sandbox, checkout: CODER.CHECKOUT_PATH };
        return yield* runShowImage(binding, input);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(showImageRejected(SHOW_IMAGE_REFUSAL.UNAVAILABLE))),
      ),

    agentTools: (admitted, call) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found)) return agentToolRejected(found.failure);
        // The agent asking is the one the session was admitted to, and eve is reached as its starter.
        const sender = found.success;
        const secret = seams.deploymentSecret();
        const origin = seams.eveOrigin();
        const compose = yield* eveSessionsComposer;
        const eve =
          secret === undefined || origin === undefined
            ? undefined
            : compose({
                origin,
                caller: { secret, account: sender.userId },
                mount: EVE_MOUNT.CODER,
              });
        const caller = { kind: AGENT_CALLER.AGENT, agent: sender } as const;
        const toolCall = {
          caller,
          eve,
          writer: seams.writer(),
          clientKey: call.callId,
          summaryModel: seams.summaryModel,
        };
        return yield* AGENT_TOOL_RUN[call.tool](toolCall, call.input);
      }).pipe(
        Effect.tapError(logStoreFailure),
        Effect.catch(() => Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.STORE))),
      ),

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
        if (agent === undefined) return;
        yield* recordContext(event, admitted.target.userId, agent, prompt);
        const titleModel = seams.titleModel(admitted.target.userId);
        if (titleModel === undefined || !asksTitle(event)) return;
        // Note that the title is awaited here rather than forked, because eve's step, and the
        // function instance under it, end when the hook returns and take a detached call with them.
        yield* titleCodingAgent(titleModel, admitted.target, agent).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(`The agent's title was not written: ${failure._tag}`),
          ),
        );
      }),
  };
}
