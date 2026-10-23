import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { settleEndedSession } from "@luke/database/models/abandoned-turns";
import { chatEnabledFor } from "@luke/database/models/account-store";
import { askRecord } from "@luke/database/models/asks";
import { readBoard } from "@luke/database/models/board-store";
import {
  type CodingAgent,
  codingAgentBriefOf,
  hasRepository,
  readCodingAgentContext,
  readCodingAgentOfConversation,
  readDelegation,
  recordCodingAgentCompaction,
  recordCodingAgentStep,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { promptHashOf } from "@luke/database/models/content-addressed";
import { childConversationId, hostTurnId } from "@luke/database/models/ids";
import {
  listRecentMessages,
  type StoredMessageRecord,
  turnsBefore,
} from "@luke/database/models/message-reads";
import { readPlanCommentThreads } from "@luke/database/models/plan-comments";
import { listRevisions } from "@luke/database/models/plan-revisions";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { readTask } from "@luke/database/models/task-store";
import type { ConversationTarget, StoreWriter } from "@luke/database/models/writer";
import { EMPTY_BOARD } from "@luke/features/board-wire";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import type { ModelChoice } from "@luke/features/models-wire";
import { causeKind } from "@luke/runtime/effect";
import { Effect, Option, Result, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionContext } from "eve/context";
import { MESSAGE_ROLE, type UnparsedWireValue, type WireRecord } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { WorkspaceLinearConnect } from "../../integrations/integration-connect.js";
import {
  ModelCatalog,
  type OfferedModel,
  offeredToAccount,
} from "../../providers/model-catalog.js";
import type { CommentToolName } from "../../tasks/comment-tools.js";
import type { PictureLookResult } from "../../tasks/picture-look.js";
import { reopenTaskForWork, settleTaskIfFinished } from "../../tasks/task-finish.js";
import type { SentryApp } from "../../triggers/sentry/sentry-app-config.js";
import { delegatedChildOf, type HostAdmission, hostAdmission } from "../agent-runtime/host-core.js";
import { endsTurn } from "../agent-runtime/sandbox.js";
import type { AgentSkill } from "../agent-runtime/skills.js";
import { type ChatSince, standingContext } from "../agent-runtime/standing-context.js";
import { turnKindOf } from "../brain-host/auth.js";
import {
  BRAIN_HOST,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
  RELAY_TURN,
} from "../brain-host/bounds.js";
import {
  type AdmittedConversation,
  admitConversation,
  type ConversationAdmission,
  claimRuntimeSession,
  SESSION_STANDING,
} from "../brain-host/conversation.js";
import {
  EVE_MOUNT,
  type EveSessionsComposer,
  eveSessionsComposer,
} from "../brain-host/eve-sessions.js";
import {
  foldedQuietly,
  type RelayAskSeams,
  type RelayStanding,
  type RelayStateStore,
  StreamRelay,
} from "../brain-host/relay.js";
import { rotationSeedText } from "../brain-host/seed.js";
import { carryStop } from "../brain-host/stop-carrier.js";
import { newestLineIsAutomation } from "../memory-provenance.js";
import { memoryOnFor, seedMemoryText } from "../memory-tools.js";
import { markDeskNoticesRead, type OperatorDesk, readOperatorDesk } from "../operator-desk.js";
import { type ReadWebPageResult, ResearchBudget, runReadWebPage } from "../public-research.js";
import { checkoutDeepened, type RepositorySandbox } from "../repository-shell.js";
import { isOperator } from "../steward.js";
import type { RepositoryCredential } from "../terminal/agent-sandbox.js";
import { workspaceStepOf } from "../written-mentions.js";
import {
  type AgentToolCall,
  type BoardTool,
  type ChatCall,
  runAgentBoard,
  runAgentChat,
  runAgentComment,
  runAgentEditPlan,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
  runAgentShowCode,
  runAgentShowImage,
  runAgentShowPage,
  runAgentTools,
} from "./agent-doors.js";
import { accountFastOffer } from "./agent-runtime-choice.js";
import { CODER, CODER_MODEL_FIXTURE, CODER_REFUSAL, type CoderRefusal } from "./bounds.js";
import { type ChatToolResult, chatDigest } from "./chat.js";
import {
  agentCiReadable,
  agentCoAuthor,
  agentRepositoryToken,
  CheckoutRefused,
  type CheckoutServices,
  checkOutAgentRepository,
  checkoutBranch,
  deepenAgentCheckout,
  openWorkingFolder,
} from "./checkout.js";
import { contextWindowOf } from "./context.js";
import { agentStepOf } from "./context-estimate.js";
import { type DelegationAsk, delegationChoice, recordDelegation } from "./delegation.js";
import type { InboxToolResult } from "./inbox.js";
import { type InboxCall, runAgentInbox } from "./inbox-door.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import { CODER_HARNESS, coderInstructions } from "./instructions.js";
import { type CoderModelSelection, coderModel } from "./model.js";
import type { PlanEditResult } from "./plan-edit.js";
import type { CoderHostSeams } from "./production.js";
import type { PullRequestToolResult } from "./pull-request.js";
import { runShowImage, SHOW_IMAGE_REFUSAL, showImageRejected } from "./show-image.js";
import { agentSkills } from "./skills.js";
import { titleCodingAgent, titleSubagent } from "./title.js";
import { CODER_TOOL, CODER_TOOL_SET } from "./tool-set.js";
import {
  contentKey,
  FLUSH_LINE,
  flushDue,
  savedByAnotherSince,
  type TurnHanded,
  taskKey,
  taskWithLead,
  timeWithLead,
  turnKindWords,
} from "./turn-context.js";

/**
 * host.ts -- the coding-agent host composed over eve and the store: what the coder project's authored files call.
 *
 * eve is the runtime and the event emitter, and the host is everything eve
 * leaves to its author. Who a session is for is the conversation admission
 * every host shares (`agent-runtime/host-core.ts`); what differs is that every admitted conversation is a coding
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
 * An agent with no repository runs too: its sandbox opens with an empty
 * working folder and no credential, it is told of no checkout, branch,
 * commit, or pull request, and it is offered no repository skills, only
 * the ones its member installed, and none of the repository's tools
 * (`tool-set.ts`'s `repositoryToolsOf`). A session
 * opened afresh over a conversation whose last session retired is seeded
 * with what was said in it, as the brain's rotation is (`seed`).
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
  /** Whether the prompt told of the task's chat as the team's channel, which only an agent whose starter turned Chat on is, though every agent has the chat's tools. */
  readonly chatOn: boolean;
  /** Whether the prompt told of the workspace's memory, which only an agent whose starter turned Memory on is offered. */
  readonly memoryOn: boolean;
}

/**
 * What the coder project keeps of the session's prompt between the start
 * that composed it and the turns that run under it, in eve's durable session
 * state, because the prompt applies at session scope and the turn row must
 * name the prompt the model actually reads: its content address, absent
 * until the session has composed one; whether the prompt said the
 * repository's CI is readable, the co-author trailer it handed where it
 * handed one, the step its links wrote the workspace under, and whether it
 * told of the chat, which are what compose the same text again for a step's
 * estimate of it. A record kept before the step was keeps none, and its
 * links are composed under the workspace's id.
 */
export interface CoderSessionPromptRecord {
  readonly hash?: string;
  readonly ciReadable?: boolean;
  readonly coAuthor?: string;
  readonly workspace?: string;
  readonly chatOn?: boolean;
  readonly memoryOn?: boolean;
}

/** The turn opening: its kind, as its request named it, and its store id. */
interface CoderTurn {
  readonly kind: BrainHostTurn | undefined;
  readonly turnId: string | undefined;
}

/** A turn's own message, where there is one to hand, and what the session has handed once it is. */
export interface CoderTurnMessage {
  readonly text: string | undefined;
  readonly handed: TurnHanded;
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
  /** The instructions the session runs under, with the hash its turns are recorded under, composed on whether the agent's token reads the repository's CI and whose its commits are, neither asked of GitHub for an agent with no repository; the text itself is stored nowhere. */
  prompt(
    admitted: AdmittedConversation,
    agent: CodingAgent,
  ): Effect.Effect<CoderSessionPrompt, never, CheckoutServices>;
  /** The skills offered to the session as it starts: its repository's, none for an agent with no repository, then those its member installed, each source none where it could not be read (`skills.ts`). */
  skills(
    admitted: AdmittedConversation,
    agent: CodingAgent,
  ): Effect.Effect<readonly AgentSkill[], never, CheckoutServices>;
  /**
   * The conversation so far, for a session opened over a conversation with
   * words already said, as the brain's rotation seeds one (`brain-host/seed.ts`):
   * a session opened afresh after its last one retired remembers what was
   * said. A line awaiting its turn is left out, since it is the message the
   * session opens with; nothing for a conversation with nothing else said.
   * An operator's is followed by the workspace's memory as a recall with no
   * query answers it (`../memory-tools.ts`'s `seedMemoryText`), where its
   * member has Memory on. No compaction summary leads it, since Luke keeps
   * none of a coding agent's history.
   */
  seed(admitted: AdmittedConversation): HostEffect<string | undefined>;
  /**
   * The agent's repository checked out shallow into the sandbox as it opens,
   * with no credential standing (`checkout.ts`). An agent with no repository
   * has an empty working folder made where the checkout would stand, so its
   * shell and reads start there.
   */
  checkOut(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<void, CheckoutFailure, CheckoutServices>;
  /**
   * The agent's shallow checkout deepened to its whole history, as its
   * first write asks, with the write credential set at the sandbox's
   * firewall (`checkout.ts`'s `deepenAgentCheckout`); nothing where a deepen
   * already finished in the sandbox or the agent has no repository to deepen.
   */
  deepen(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<void, CheckoutFailure, CheckoutServices>;
  /** Whether a deepen finished in the sandbox, so its credential may stand and be renewed; none ever did for an agent with no repository. */
  deepened(
    admitted: AdmittedConversation,
    sandbox: RepositorySandbox,
  ): Effect.Effect<boolean, CheckoutFailure, DatabaseServices>;
  /** A fresh credential for the agent's repository, for the firewall once the standing one is old or was taken off; none for an agent with no repository, which mints nothing. */
  repositoryCredential(
    admitted: AdmittedConversation,
  ): Effect.Effect<RepositoryCredential | undefined, CheckoutFailure, CheckoutServices>;
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
  /** The kind of turn the current request opened, as its header named it; nothing for one that named none. */
  turnKind(auth: SessionAuth): BrainHostTurn | undefined;
  /**
   * What a turn opens with as a user-role message of its own, which eve
   * appends to the history after what came before, so the system prompt,
   * the tools, and the history stay the provider's cached prefix from one
   * turn to the next, whatever kind of turn each is (`turn-context.ts`):
   * the call's words on a spoken turn where the turn before was not one, and
   * a line naming the turn's kind where it changed; the developer's time on
   * every turn; the task as it stands where someone other than the agent saved
   * the plan since its previous turn started, or the rest of it is not what
   * the session last handed (`handed`); and what the agent has not read in
   * its workspace's chat (`chat.ts`), where its starter turned Chat on and
   * the digest is not the one last handed; and an operator's desk, its
   * member's open work (`../operator-desk.ts`), where its standing work is
   * not what was last handed or it carries notices of what its member's
   * agents did since, which are marked read once handed; and, once an
   * operator's newest step passed the flush mark and it was not told since
   * eve last compacted it, the line telling it to keep what is durable before
   * its history is summarised, where its member has Memory on. Answers what the session has
   * handed once this message is, for the session to keep; nothing to hand
   * where the conversation is no agent's. A read that fails is logged and
   * leaves its part out, so the turn still opens.
   */
  turnMessage(
    admitted: AdmittedConversation,
    turn: CoderTurn,
    handed: TurnHanded,
  ): Effect.Effect<CoderTurnMessage, never, DatabaseServices | ModelCatalog>;
  /**
   * Runs one of the agent's public page reads (`../public-research.ts`),
   * under the turn's budget; its search is eve's provider-run `web_search`,
   * inside its own model call.
   * The budget is the turn's own, named with its session, since eve numbers
   * every session's turns afresh.
   */
  research(
    admitted: AdmittedConversation,
    tool: typeof CODER_TOOL.READ_WEB_PAGE,
    turn: { readonly sessionId: string; readonly eveTurnId: string },
    input: UnparsedWireValue,
  ): Effect.Effect<ReadWebPageResult, never, HttpClient.HttpClient>;
  /**
   * Runs one `look_at_picture` call (`../../plans/picture-look.ts`): one of
   * the pictures of the agent's plan, read as the member whose turn this is.
   */
  lookAtPicture(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
  ): Effect.Effect<PictureLookResult, never, DatabaseServices>;
  /** Runs one call of a comment tool (`tasks/comment-tools.ts`) on the agent's plan, as the member whose turn it is, written under the agent. */
  comment(
    admitted: AdmittedConversation,
    name: CommentToolName,
    input: UnparsedWireValue,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
  /**
   * Runs one `show_code` call (`../../tasks/show-code.ts`): lines of the
   * checkout the session's sandbox opened with, read through the door given,
   * and journaled with the call on the agent's own conversation, whatever
   * kind of turn made it.
   */
  showCode(
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    sandbox: () => Promise<RepositorySandbox>,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
  /** Runs one call of the whiteboard's tools (`../../tasks/board-tool.ts`, `../../tasks/board-look.ts`) on the agent's task, as the member whose turn it is. */
  board(
    admitted: AdmittedConversation,
    tool: BoardTool,
    input: UnparsedWireValue,
  ): Effect.Effect<WireRecord, never, DatabaseServices>;
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
    | DatabaseServices
    | HttpClient.HttpClient
    | GitHubApp
    | ModelCatalog
    | WorkspaceLinearConnect
    | SentryApp
  >;
  /** Folds an event the store need hear nothing of into the session's relay state and answers whether it did, so the caller admits the session and relays only the rest: the relay's own quiet events (`foldedQuietly`), bar a compaction's end, which the agent's row records. */
  relaysQuietly(event: MessageStreamEvent, state: RelayStateStore): boolean;
  /** Relays one event of the session's stream into the store, under the state the caller keeps for the session and the prompt it composed, then, as the developer's words are received or a turn completes, asks for the agent's title where none stands and waits for it (`title.ts`); a title that fails is logged and the relay still answers. */
  relay(
    event: MessageStreamEvent,
    admitted: AdmittedConversation,
    session: SessionContext["session"],
    state: RelayStateStore,
    prompt: CoderSessionPromptRecord,
  ): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices | HttpClient.HttpClient>;
}

export type { AgentToolCall, BoardTool, ChatCall } from "./agent-doors.js";
export type { InboxCall } from "./inbox-door.js";

/** The newest turns read to find the agent's previous one: the turn opening, where the relay queued it already, and the one before. */
const PREVIOUS_TURN_READ = 2;

/** No chat in the task as it stands: the agent's own digest of the chat follows it (`chatDigest`). */
const NO_CHAT: ChatSince = { messages: [], more: false };

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

/** Whether a stored row is a line awaiting its turn: a user's words no turn has taken yet (`writer.ts`'s `takeAwaitingLine`). */
function awaitsTurn(record: StoredMessageRecord): boolean {
  return record.message.role === MESSAGE_ROLE.USER && record.turnId === undefined;
}

/** A stored row's message, as the seed renders it. */
function messageOf(record: StoredMessageRecord) {
  return record.message;
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
    memoryOn: boolean,
  ): CoderSessionPrompt => {
    const brief = codingAgentBriefOf(agent);
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
      agent.githubAccess === GITHUB_ACCESS.TOKEN,
      CODER_HARNESS.EVE,
      agent.kind,
      memoryOn,
    );
    return { text, hash: promptHashOf(text), ciReadable, coAuthor, workspace, chatOn, memoryOn };
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
                prompt.memoryOn ?? false,
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

  /** What the agent has not read in its workspace's chat, as a turn opens with it (`chat.ts`); nothing where its starter has not turned Chat on, or the read failed. */
  const digestOf = (admitted: AdmittedConversation, agent: CodingAgent) =>
    Effect.gen(function* () {
      // A turn opens with the chat only where the agent's starter turned Chat on.
      if (!(yield* chatEnabledFor(admitted.target.userId))) return undefined;
      return yield* chatDigest(
        {
          userId: admitted.target.userId,
          taskId: agent.taskId,
          self: { kind: MEMBER_KIND.AGENT, agentId: agent.id },
        },
        admitted.target.conversationId,
      );
    }).pipe(
      Effect.tapError(logStoreFailure),
      Effect.catch(() => Effect.succeed(undefined)),
    );

  /**
   * The operator's desk as its turn opens (`../operator-desk.ts`), its
   * member's open work as it stands; nothing for any other agent, or where
   * a read failed, which is logged, so the turn still opens.
   */
  const deskOf = (
    agent: CodingAgent,
  ): Effect.Effect<OperatorDesk | undefined, never, DatabaseServices> =>
    isOperator(agent)
      ? readOperatorDesk(agent).pipe(
          Effect.tapError(logStoreFailure),
          Effect.orElseSucceed(() => undefined),
        )
      : Effect.succeed(undefined);

  /**
   * Whether an operator's turn opens with the line telling it its history
   * will soon be summarised (`turn-context.ts`'s `flushDue`), read against
   * the window the catalog lists for what it runs on now; never for any
   * other agent, nor where its member has Memory off, nor on a turn an
   * automation's line opens, its heartbeat's among them, which may keep
   * nothing and so leaves the line to the member's next turn; and not where
   * a read failed, which is logged, so the turn still opens.
   */
  const flushOf = (
    agent: CodingAgent,
    handed: TurnHanded,
  ): Effect.Effect<boolean, never, DatabaseServices | ModelCatalog> =>
    !isOperator(agent) || handed.opened !== true || handed.flushTold === true
      ? Effect.succeed(false)
      : Effect.gen(function* () {
          if (!(yield* memoryOnFor(agent.userId))) return false;
          // A turn an automation opens may keep nothing, so it is not told, and a member's later turn is.
          if (yield* newestLineIsAutomation(agent)) return false;
          const context = yield* readCodingAgentContext(agent.userId, agent.id);
          if (Option.isNone(context)) return false;
          const { model, contextWindow } = context.value;
          const windowTokens = contextWindowOf(yield* catalogNow, model, contextWindow);
          return flushDue(context.value, windowTokens, handed);
        }).pipe(
          Effect.tapError(logStoreFailure),
          Effect.orElseSucceed(() => false),
        );

  /**
   * When the agent's turn before the one opening started, or nothing for its
   * first turn: the newest of the conversation's turns but the one named,
   * which the relay may have queued already as this one opens.
   */
  const previousTurnStart = (target: ConversationTarget, turnId: string | undefined) =>
    Effect.map(
      turnsBefore(target.userId, target.conversationId, PREVIOUS_TURN_READ, undefined),
      (page) => {
        const previous = page.turns.findLast((turn) => turn.id !== turnId);
        return previous === undefined
          ? undefined
          : (previous.startedAt ?? previous.queuedAt).getTime();
      },
    );

  /**
   * The agent's task as the turn's message hands it (`turn-context.ts`), read
   * as the member whose turn this is, and what the session has handed of it
   * once this turn is (`taskKey`), or nothing for an agent on no task or one
   * whose task is gone. The task is handed where a revision of the plan
   * another writer made was saved after the agent's previous turn started,
   * so a save made while that turn ran, which none of its steps may have
   * read, is handed too; or where the rest of it is not what the session
   * last handed; never on a typed first turn, whose first message the plan,
   * or the prompt beside it, already is. The chat is left out, since the
   * agent's own digest of it follows (`digestOf`). A read that fails is
   * logged and hands nothing.
   */
  const taskOf = (
    admitted: AdmittedConversation,
    agent: CodingAgent,
    turn: CoderTurn,
    handed: TurnHanded,
  ) =>
    Effect.gen(function* () {
      const { taskId } = agent;
      if (taskId === null) return undefined;
      const [stored, board, comments, since] = yield* Effect.all(
        [
          readTask(admitted.caller, taskId),
          readBoard(admitted.caller, taskId),
          readPlanCommentThreads(admitted.caller, taskId),
          previousTurnStart(admitted.target, turn.turnId),
        ],
        { concurrency: "unbounded" },
      );
      if (Option.isNone(stored)) return undefined;
      const drawn = Option.getOrElse(board, () => EMPTY_BOARD);
      const threads = Option.getOrElse(comments, () => []);
      const key = taskKey(stored.value, drawn, threads);
      const opening = since === undefined && turn.kind !== BRAIN_HOST_TURN.SPOKEN;
      const saved =
        since !== undefined &&
        savedByAnotherSince(
          (yield* listRevisions(admitted.caller, taskId)).revisions,
          since,
          agent.id,
        );
      if (!saved && (opening || key === handed.task)) return { key: handed.task, text: undefined };
      const clock = { now: seams.now(), timeZone: admitted.timeZone };
      const text = taskWithLead(standingContext(stored.value, drawn, NO_CHAT, clock, threads));
      return { key, text };
    }).pipe(
      Effect.tapError(logStoreFailure),
      Effect.catch(() => Effect.succeed(undefined)),
    );

  /**
   * The ask record every turn binds the voice's asks to: each ask eve delivered into the
   * turn learns the turn it ran in, which is what ties the transcript's line
   * to it and what the voice follows the answer by, and a Stop the ask took
   * while it waited is carried the moment its turn starts, by the deployment
   * acting for the agent's starter on the coder's mount, since the hook that
   * sees the start holds no bearer; a deployment with no secret or no origin
   * for eve reports the Stop it could not carry. A typed turn takes it too,
   * since a call's ask joins one under way (`channel.ts`'s
   * `CODER_DEPLOYMENT_PRESENCE`): at its start that costs a binding of its
   * delivery and a read of the Stops on it, two statements.
   */
  const turnAsks = (writer: StoreWriter, compose: EveSessionsComposer): RelayAskSeams => ({
    binding: askRecord(),
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
            // Composed to send no message at all: the deployment here cancels a turn and does nothing else.
            eve: compose<never>({
              origin,
              caller: { secret, account: target.userId },
              mount: EVE_MOUNT.CODER,
            }),
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
  });

  /** One event relayed through the shared relay, with the ask record beside it on the agent's own turns, which a call may join, and none on a worker's. */
  const relayEvent = (event: MessageStreamEvent, standing: RelayStanding) =>
    Effect.gen(function* () {
      const writer = yield* seams.writer();
      const compose = yield* eveSessionsComposer;
      const relay = new StreamRelay({
        writer,
        ...(standing.turn === RELAY_TURN.CHILD ? undefined : { asks: turnAsks(writer, compose) }),
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
          // A worker is offered what the agent's account is, so no worker runs a fast version the account is not offered.
          const fastOffer = yield* accountFastOffer(admitted.target.userId);
          const chosen = delegationChoice(own, asked, offeredToAccount(offered.value, fastOffer));
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
          // An agent with no repository has no CI to read and makes no commits, so GitHub is asked neither.
          hasRepository(agent) ? agentCiReadable(admitted.target, agent) : Effect.succeed(false),
          hasRepository(agent) ? agentCoAuthor(admitted.target, agent) : Effect.succeed(undefined),
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
          // Memory likewise, off where it cannot be read, as its tools then are (`../memory-tools.ts`).
          memoryOnFor(admitted.target.userId),
        ]),
        ([ciReadable, coAuthor, workspace, chatOn, memoryOn]) =>
          promptOf(agent, ciReadable, coAuthor, workspace, chatOn, memoryOn),
      ),

    skills: (admitted, agent) => agentSkills(admitted.target, agent),

    seed: (admitted) =>
      Effect.gen(function* () {
        const read = yield* listRecentMessages(
          admitted.target.userId,
          admitted.target.conversationId,
          CODER_TOOL_SET,
          BRAIN_HOST.SEED_MESSAGES,
        );
        const said = rotationSeedText(
          read.ok ? read.value.filter((record) => !awaitsTurn(record)).map(messageOf) : [],
          seams.now(),
        );
        // An operator's rotated session is seeded with the workspace's memory after what was said.
        // Note that Luke keeps no compaction summary of a coding agent's history, so none leads it.
        if (said === undefined) return undefined;
        const found = yield* agentOf(admitted);
        if (Result.isFailure(found) || !isOperator(found.success)) return said;
        const memory = yield* seedMemoryText(found.success);
        return memory === undefined ? said : `${said}\n\n${memory}`;
      }),

    checkOut: (admitted, sandbox) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        hasRepository(agent)
          ? checkOutAgentRepository(admitted.target, agent, sandbox)
          : openWorkingFolder(sandbox),
      ),

    deepen: (admitted, sandbox) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        // An agent with no repository has a working folder and no history to fetch.
        hasRepository(agent) ? deepenAgentCheckout(admitted.target, agent, sandbox) : Effect.void,
      ),

    deepened: (admitted, sandbox) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        hasRepository(agent)
          ? checkoutDeepened(sandbox).pipe(
              Effect.mapError((refused) => new CheckoutRefused({ reason: refused.reason })),
            )
          : Effect.succeed(false),
      ),

    repositoryCredential: (admitted) =>
      Effect.flatMap(agentOrRefused(admitted), (agent) =>
        hasRepository(agent)
          ? agentRepositoryToken(admitted.target, agent)
          : Effect.succeed(undefined),
      ),

    recordBranch: (admitted, sandbox) =>
      Effect.gen(function* () {
        const agent = yield* agentOrRefused(admitted);
        // An agent with no repository has no checkout, so no branch to record.
        if (!hasRepository(agent)) return;
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
      runAgentEditPlan(admitted, input, takenInTurn, sandbox),

    inbox: (admitted, call) => runAgentInbox(admitted, call),

    lookAtPicture: (admitted, input) => runAgentLookAtPicture(admitted, input),

    openPullRequest: (admitted, input) => runAgentOpenPullRequest(admitted, input),

    comment: (admitted, name, input) => runAgentComment(admitted, name, input),
    chat: (admitted, call) => runAgentChat(seams, admitted, call),

    turnKind: (auth) => turnKindOf(auth.current),

    turnMessage: (admitted, turn, handed) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted).pipe(
          Effect.tapError(logStoreFailure),
          Effect.orElseSucceed(() => Result.fail(CODER_REFUSAL.NO_AGENT)),
        );
        if (Result.isFailure(found)) return { text: undefined, handed };
        const agent = found.success;
        const [task, digest, desk, flush] = yield* Effect.all(
          [
            taskOf(admitted, agent, turn, handed),
            digestOf(admitted, agent),
            deskOf(agent),
            flushOf(agent, handed),
          ],
          { concurrency: "unbounded" },
        );
        const clock = { now: seams.now(), timeZone: admitted.timeZone };
        const standing =
          task?.text ?? timeWithLead(standingContext(undefined, EMPTY_BOARD, NO_CHAT, clock));
        // The digest is handed again only where it holds what the last one did not.
        const chatKey = digest === undefined ? handed.chat : contentKey(digest);
        const chat = digest !== undefined && chatKey !== handed.chat ? [digest] : [];
        // An operator's desk is handed again only where its standing work changed since the session
        // last handed it, or where it carries notices, which are marked read once handed.
        const deskKey = desk === undefined ? handed.desk : contentKey(desk.standing);
        const fresh = desk !== undefined && (desk.notices.length > 0 || deskKey !== handed.desk);
        const desked = fresh ? [desk.text] : [];
        if (fresh && desk.notices.length > 0) {
          yield* markDeskNoticesRead(agent, desk).pipe(
            Effect.tapError(logStoreFailure),
            Effect.orElseSucceed(() => undefined),
          );
        }
        const spoken = turn.kind === BRAIN_HOST_TURN.SPOKEN;
        const kind = turnKindWords(spoken, handed, agent.taskId !== null);
        const taskHanded = task === undefined ? handed.task : task.key;
        const next: TurnHanded = {
          ...(taskHanded === undefined ? undefined : { task: taskHanded }),
          ...(chatKey === undefined ? undefined : { chat: chatKey }),
          ...(deskKey === undefined ? undefined : { desk: deskKey }),
          ...(spoken ? { spoken: true, callWords: true } : undefined),
          opened: true,
          ...(flush || handed.flushTold === true ? { flushTold: true } : undefined),
        };
        const flushed = flush ? [FLUSH_LINE] : [];
        const parts = [
          ...(kind === undefined ? [] : [kind]),
          ...flushed,
          standing,
          ...desked,
          ...chat,
        ];
        return { text: parts.join("\n\n"), handed: next };
      }),

    showPage: (admitted, input, sandbox) => runAgentShowPage(admitted, input, sandbox),

    showCode: (admitted, input, sandbox) => runAgentShowCode(admitted, input, sandbox),

    board: (admitted, tool, input) => runAgentBoard(admitted, tool, input),

    showImage: (admitted, input, sandbox) => runAgentShowImage(admitted, input, sandbox),

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

    agentTools: (admitted, call) => runAgentTools(seams, admitted, call),

    delegationTitle: (admitted, callId, task) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        const chosen = Result.isSuccess(found) ? found.success.model : undefined;
        // No model, as for an account that saved no API key, titles the worker from its task's first words.
        const model = yield* seams.titleModel(admitted.target.userId, chosen);
        // A call no delegation was recorded for opened no child, so the fill finds no row to write.
        const childId = childConversationId(admitted.target.conversationId, callId);
        yield* titleSubagent(model, admitted.target, childId, task);
      }),

    research: (_admitted, _tool, turn, input) =>
      runReadWebPage(
        { turnId: hostTurnId(turn.sessionId, turn.eveTurnId), budget: research },
        input,
      ),

    relaysQuietly: (event, state) =>
      event.type !== "compaction.completed" && foldedQuietly(event, state, seams.now()),

    relay: (event, admitted, session, state, prompt) =>
      Effect.gen(function* () {
        const found = yield* agentOf(admitted);
        // The turn row names what the agent runs on as its row holds it now, the fixture's own
        // id under the scripted model; a conversation that is no agent's records no model.
        const agent = Result.getOrUndefined(found);
        const model = seams.scriptedModel() ? CODER_MODEL_FIXTURE.SCRIPTED_MODEL_ID : agent?.model;
        // Note that eve moves the session's current auth to a line's that joins a turn under way,
        // so the kind the turn opened as is the relay's to keep and answer, past its start.
        const opened = turnKindOf(session.auth.current);
        yield* relayEvent(event, {
          sessionId: session.id,
          target: admitted.target,
          turn: opened,
          ...(model !== undefined ? { model } : undefined),
          ...(agent !== undefined ? { reasoningEffort: agent.effort } : undefined),
          ...(prompt.hash !== undefined ? { promptHash: prompt.hash } : undefined),
          state,
        });
        if (agent === undefined) return;
        yield* recordContext(event, admitted.target.userId, agent, prompt);
        // A turn starting takes up the task, reopening one settled; a turn's end, its row settled by
        // the relay above, may have finished the task's work. Neither is the relay's failure.
        if (agent.taskId !== null && event.type === "turn.started") {
          yield* reopenTaskForWork(admitted.target.userId, agent.taskId);
        }
        if (agent.taskId !== null && endsTurn(event)) {
          yield* settleTaskIfFinished(admitted.target.userId, agent.taskId);
        }
        if (agent.title !== null || !asksTitle(event)) return;
        // Note that the title is awaited here rather than forked, because eve's step, and the
        // function instance under it, end when the hook returns and take a detached call with them.
        // No model, as for an account that saved no API key, titles the agent from its opening's first words.
        yield* Effect.flatMap(seams.titleModel(admitted.target.userId, agent.model), (titleModel) =>
          titleCodingAgent(titleModel, admitted.target, agent),
        ).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(`The agent's title was not written: ${failure._tag}`),
          ),
        );
      }),
  };
}
