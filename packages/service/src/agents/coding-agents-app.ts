import type { DatabaseServices } from "@luke/database/core/query";
import { childTitlesOf } from "@luke/database/models/child-titles";
import {
  archiveCodingAgent,
  type CodingAgent,
  listCodingAgents,
  listWorkspaceCodingAgents,
  pinCodingAgent,
  readCodingAgent,
  renameCodingAgent,
  updateCodingAgentChoice,
  updateCodingAgentServers,
} from "@luke/database/models/coding-agent-store";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { childConversationId } from "@luke/database/models/ids";
import { readTask } from "@luke/database/models/task-store";
import { isWorkspaceMember, readAccountNames } from "@luke/database/models/workspace-store";
import {
  type ConversationTarget,
  type StoreWriter,
  storeWriter,
} from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  base64Chars,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_LIST_ARCHIVED,
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_STATUS,
  CODING_AGENT_WORKSPACE_QUERY,
  type CodingAgentAttachment,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  codingAgentArchiveRequestSchema,
  codingAgentCallIdSchema,
  codingAgentCursorSchema,
  codingAgentMessageRequestSchema,
  codingAgentPinRequestSchema,
  codingAgentRenameRequestSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestSchema,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
} from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import {
  INBOX_BOUNDS,
  INBOX_CURSOR_START,
  INBOX_STATUS,
  type InboxItem,
  type InboxReply,
  inboxAnswerHeard,
  inboxAnswerMessage,
  inboxAnswerRequestSchema,
  inboxCursorSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReplyRefusal,
  inboxThreadMessage,
} from "@luke/features/inbox-wire";
import { modelChoiceSchema } from "@luke/features/models-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  type PullRequestActionRequest,
  pullRequestActionRequestSchema,
} from "@luke/features/pull-request-write-wire";
import { readEither } from "@luke/wire/effect";
import { Cache, Clock, Effect, Layer, Option, type Redacted, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { isRecord, isWireString, type UnparsedWireValue, unparsedWire } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { githubImage } from "../github/github-images.js";
import {
  changesPeople,
  namedOverviewConversation,
  namedOverviewPullRequest,
  namedReviewOptions,
} from "../github/github-people.js";
import { githubReadOrRefusal, logGitHubReadFailure } from "../github/github-refusal.js";
import { pullRequestMerging } from "../github/pull-request-merging.js";
import {
  type GitHubWriteFailure,
  mergePullRequest,
  pullRequestNodeId,
  reactOnPullRequest,
  replyToReviewThread,
  setAutoMerge,
  setLabelled,
  setPullRequestDraft,
  setPullRequestOpen,
  setPullRequestTitle,
  setReviewRequested,
  setReviewThreadResolved,
  submitPullRequestReview,
  takeOutOfMergeQueue,
} from "../github/pull-request-writes.js";
import {
  GRAPHQL_REACTION_OF,
  imageCommits,
  type PullRequestReadFailure,
  pullRequestByNumber,
  pullRequestChecks,
  pullRequestConversation,
  pullRequestDeployments,
  pullRequestFiles,
  pullRequestOverview,
  pullRequestReviewOptions,
  viewerReactionsOf,
} from "../github/pull-requests.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { logStoreFailure } from "../http/store-failure.js";
import {
  answerInboxItem,
  INBOX_MESSAGE_OUTCOME,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  postInboxMessage,
  readInboxAttachment,
  readInboxItem,
  type StoredInboxItem,
  withdrawInboxAnswer,
  withdrawInboxMessage,
} from "../inbox/inbox-store.js";
import type { ModelCatalog, ModelChoiceRefused } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { reachedAgent, resolvedUserId, uuidOf } from "./agent-reach.js";
import { accountInboxPast, agentInboxPast, taskInboxPast } from "./coder-host/inbox-page.js";
import {
  agentPullRequestReach,
  type PublishedCache,
  PublishedKey,
  withPublishedCache,
} from "./coder-host/published.js";
import { productionSummaryModel, type SummaryModelOf } from "./coder-host/replay-summary.js";
import { acceptedAgentChoice, startCodingAgent } from "./coder-host/start.js";
import {
  codingAgentPage,
  codingAgentSummary,
  pageAccounts,
  summaryAccounts,
} from "./coder-host/status.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import {
  continuedByOf,
  type EveReach,
  eveFor,
  standingsOf,
  statusOf,
  stoppedForGood,
  stoppedTurn,
  summaryOf,
} from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import {
  cursorOfWire,
  cursorToWire,
  delegationPast,
  NO_TITLE_AWAITED,
  type TitleAwaited,
  type TranscriptPage,
  titleMayLand,
  transcriptPast,
} from "./coder-host/transcript.js";
import {
  type MemberPullRequest,
  memberPullRequestWrite,
  memberReadToken,
  writeAnswerOf,
} from "./pull-request-write.js";

/**
 * coding-agents-app.ts -- a task's coding agents: start one, list them, read one's transcript and its workers', message one, change one's model, and stop one.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one of a workspace the bearer's account is a member of: a
 * task or an agent of any other workspace answers exactly as one that names
 * nothing. A member reads, messages, renames, re-chooses, and stops an agent
 * a teammate started, its conversation read and written under that teammate,
 * whose conversation it is. A Start
 * (`POST /api/plans/{id}/agents`) takes the one path a start takes
 * (`packages/service/src/agents/coder-host/start.ts`), which the voice brain's tool shares: the
 * model and effort checked against the catalog, the account's default where
 * the request names none, the task's repository confirmed reachable through
 * the Luke GitHub App, the agent and its conversation made, and its eve
 * session opened with the task's document, or the prompt the request named in
 * its place, as the first message, here under the developer's own bearer so
 * eve's door admits it as the developer. A retry carrying the same key is
 * the same agent, and opens nothing again. The list (`GET /api/plans/{id}/agents`) reads each agent's
 * status from its newest turn. The transcript
 * (`GET /api/agents/{id}/messages?after=`) is the conversation's rows past a
 * cursor, held open while the agent runs (`packages/service/src/agents/coder-host/transcript.ts`).
 * A message (`POST /api/agents/{id}/messages`) is the developer's words
 * handed to the session the agent runs in, under the developer's own
 * bearer, with the client's own key for the send, through the one steer
 * path the voice brain's tool shares (`packages/service/src/agents/coder-host/steer.ts`): the
 * words steer the turn under way, or open a turn where none runs, and are
 * written as a user row awaiting its turn, so the transcript shows the
 * line at once and the agent reads as running until the turn that receives
 * the line takes it (`brain-host/relay.ts`). eve answering that the
 * session is still coming up is a conflict the desktop tries again; eve no
 * longer running the session is one it does not, since the agent's sandbox
 * lives with the session. A change of model (`PATCH /api/agents/{id}`) writes the
 * choice on the agent's row, checked against the catalog as a Start checks
 * its own; the row is read at every step, so the change is the next step's
 * whether a turn runs or the next one is yet to open, and the account's
 * default stands as it was. The same PATCH carrying a title instead renames
 * the agent, the one write of the title that covers whatever stands, and an
 * empty title clears it so the tab falls back to the model's name; the
 * title generated from the agent's first exchange as a turn of its ends
 * lands only where none stands, so a rename is never undone. The same PATCH
 * carrying `archived` archives the agent or brings it back: an archive
 * stops a turn still running first, as a Stop does, and refuses where that
 * Stop could not reach eve, or where the agent works on with no turn a Stop
 * can name yet, still starting or with a line awaiting its turn, which the
 * desktop tries again; an archived agent takes no message; the list leaves an archived agent out unless
 * `archived=include` asks for it, while its transcript and what it
 * published still read by its id. The same PATCH carrying `pinned` pins
 * the agent for the asking member alone, or unpins it, as a plan's pin is
 * its reader's own (`agent-pin.ts`). A Stop
 * (`POST /api/agents/{id}/stop`) is eve's cancel
 * of the turn under way, named by eve's own id for it, and the row's stamp;
 * the service's hook stops the sandbox as the cancelled turn ends, and
 * anything the agent pushed stays.
 * What the agent published (`GET /api/agents/{id}/pull-request`) is the
 * branch and pull request its own transcript names, as GitHub holds them
 * now (`packages/service/src/agents/coder-host/published.ts`), kept per agent for a short while
 * so a tab asking beside every held page does not ask GitHub as often.
 * The agent's changes (`GET /api/agents/{id}/changes`) are the files of
 * the pull request that answer names, read from GitHub afresh on each ask
 * (`github/pull-requests.ts`), each with its patch, or none where the
 * agent has opened none yet. Its overview, which its Pull request tab
 * draws, is read afresh on each ask on the same terms in three reads the
 * tab asks for at once and draws as each lands: the pull request itself,
 * its description, branches, mergeability, author, and the reviewers it
 * asks for (`GET /api/agents/{id}/overview/pull-request`); its head's checks
 * one by one and its deployments (`GET /api/agents/{id}/overview/checks`); and its conversation
 * and where its reviewers stand (`GET /api/agents/{id}/overview/conversation`),
 * its words as GitHub renders them. A change to that pull request
 * (`POST /api/agents/{id}/pull-request/action`), such as marking it ready for
 * review, submitting a review, or replying on or resolving a review
 * thread, is made on GitHub as the member who asks, on their own GitHub
 * sign-in and never the App's, through the one seam every such change takes
 * (`pull-request-write.ts`), and answers how GitHub took it; the agent's kept
 * published answer is let go, so the next read asks GitHub afresh. What the
 * reviewer and label pickers offer (`GET /api/agents/{id}/review-options`),
 * the repository's labels, collaborators, and teams, is read on a token for
 * the agent's repository, as the overview is. An image
 * those words name (`GET /api/agents/{id}/github-image`) is
 * read on a token for the agent's repository too, an upload re-signed by its
 * asset's id (`github/github-images.ts`), and answered as bytes.
 * A worker's transcript (`GET /api/agents/{id}/subagents/{callId}/messages`)
 * is read as the agent's own is, under the agent and eve's id for the
 * delegation call that started the worker, which its tool part in the
 * agent's transcript carries: the child conversation is a function of the
 * two (`@luke/database/models/ids`), and only a delegation recorded under an
 * agent the account reaches answers, so a call of any other agent reads as
 * none. Each worker's title, generated from its task as it starts, is
 * carried on its own page and, for every worker titled so far, on the
 * agent's; a read of an ended agent, or worker, with nothing new waits for a
 * title still due, the agent's own or a worker's, since each can land after
 * the turn ended and a reader stops at that read.
 */

const AGENTS_PATH = {
  /** GET lists the task's agents, the archived ones too where `archived=include` asks; POST starts one; the rewrite moves the path's task id into the `id` query. */
  OF_TASK: "/api/plans/agents",
  /** GET reads the agent's transcript past `after`, POST sends the agent a message; the rewrite moves the path's agent id into the `id` query. */
  MESSAGES: "/api/agents/messages",
  /** GET reads the agent as its own page, on a plan or with none; PATCH changes the agent's model, effort, and context window, renames it, archives it, or pins it for the asking member; the rewrite moves the path's agent id into the `id` query. */
  AGENT: "/api/agents/agent",
  /** POST stops the agent; the rewrite moves the path's agent id into the `id` query. */
  STOP: "/api/agents/stop",
  /** GET reads what the agent published; the rewrite moves the path's agent id into the `id` query. */
  PULL_REQUEST: "/api/agents/pull-request",
  /** GET reads the agent's changes, its pull request's files; the rewrite moves the path's agent id into the `id` query. */
  CHANGES: "/api/agents/changes",
  /** GET reads the agent's pull request itself, as its Pull request tab's overview draws it; the rewrite moves the path's agent id into the `id` query. */
  OVERVIEW_PULL_REQUEST: "/api/agents/overview-pull-request",
  /** GET reads the checks on the agent's pull request's head, as its overview draws them; the rewrite moves the path's agent id into the `id` query. */
  OVERVIEW_CHECKS: "/api/agents/overview-checks",
  /** GET reads the agent's pull request's conversation, as its overview draws it; the rewrite moves the path's agent id into the `id` query. */
  OVERVIEW_CONVERSATION: "/api/agents/overview-conversation",
  /** POST makes one change to the agent's pull request as the asking member; the rewrite moves the path's agent id into the `id` query. */
  PULL_REQUEST_ACTION: "/api/agents/pull-request-action",
  /** GET reads what the reviewer and label pickers of the agent's Pull request tab offer; the rewrite moves the path's agent id into the `id` query. */
  REVIEW_OPTIONS: "/api/agents/review-options",
  /** GET reads one image its pull request's overview names, by its address in the `src` query; the rewrite moves the path's agent id into the `id` query. */
  GITHUB_IMAGE: "/api/agents/github-image",
  /** GET reads a worker's transcript past `after`; the rewrite moves the path's agent id into the `id` query and the delegation call's id into `call`. */
  SUBAGENT_MESSAGES: "/api/agents/subagent-messages",
  /** GET reads the task's inbox past `after`; the rewrite moves the path's task id into the `id` query. */
  INBOX_OF_TASK: "/api/plans/inbox",
  /** GET reads one agent's inbox past `after`, an agent with no task as much as one on a task; the rewrite moves the path's agent id into the `id` query. */
  INBOX_OF_AGENT: "/api/agents/inbox",
  /** POST answers one inbox item; the rewrite moves the path's item id into the `id` query. */
  INBOX_ITEM: "/api/inbox/item",
  /** POST writes a member's message on one inbox item's thread; the rewrite moves the path's item id into the `id` query. */
  INBOX_MESSAGES: "/api/inbox/messages",
  /** PUT marks one inbox item read for the asking member and DELETE marks it unread, where the rewrite moves the path's item id into the `id` query; PUT with no `id` marks every item their Inbox lists read. */
  INBOX_READ: "/api/inbox/read",
  /** GET reads what waits on the developer across the account's tasks past `after`. */
  INBOX: "/api/inbox",
  /** GET serves one attachment of an inbox item, an image block's picture; the rewrite moves the item id into the `id` query and the attachment id into `attachment`. */
  INBOX_ATTACHMENT: "/api/inbox/attachment",
  /** GET serves one picture a tool answered the agent, or one of its workers where the query names the delegation call; the rewrite moves the agent id into the `id` query, the call into `call`, and the picture into `picture`. */
  PICTURE: "/api/agents/picture",
  /** GET lists a workspace's agents, newest started first, on one repository where the query names one. */
  OF_WORKSPACE: "/api/agents",
} as const;

/** The most agents a workspace's list answers: enough to choose one an automation's runs go to. */
const WORKSPACE_AGENTS_LIMIT = 50;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PATCH: "PATCH",
  PUT: "PUT",
  DELETE: "DELETE",
} as const;

const QUERY = {
  ID: "id",
  AFTER: "after",
  CALL: "call",
  ATTACHMENT: "attachment",
  PICTURE: "picture",
  SRC: "src",
} as const;

/** The files one message or Start may carry: their base64 together, and each one's name at JSON's widest escape with room for the keys around it. */
const MAXIMUM_ATTACHMENTS_BODY_BYTES =
  base64Chars(CODING_AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES) +
  CODING_AGENT_BOUNDS.MAX_ATTACHMENTS * (6 * CODING_AGENT_BOUNDS.MAX_ATTACHMENT_NAME_CHARS + 128);

/** A Start names a key, a choice, and a task with its files at most: the task's bound at JSON's widest escape, the files, and room for the rest. */
const MAXIMUM_START_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 4_096;

/** An answer is a note, a few short fields, and the files a message may carry: the note's bound at JSON's widest escape, the files, and room for the rest. */
const MAXIMUM_INBOX_ANSWER_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_NOTE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

/**
 * A change to a pull request names the change and its few fields, a
 * review's words the longest of them, so a body past this is no change.
 * Note that each of those words' characters may take six bytes as JSON,
 * a control character escaped as `\u0000`.
 */
const MAXIMUM_PULL_REQUEST_ACTION_BODY_BYTES = PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS * 6 + 4_096;

/** A change names a model, an effort, and a window, a title, an archive, or a pin, at most, so a body past this is no change. */
const MAXIMUM_CHOICE_BODY_BYTES = 4_096;

/** A message is its words, its files, and a key: the bound's characters at JSON's widest escape, the files, and room for the keys around them. */
const MAXIMUM_MESSAGE_BODY_BYTES =
  6 * CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 1_024;

export interface CodingAgentsAppSeams extends EveReach {
  resolveUserId: UserIdResolver;
  /** The model a Start from another agent summarizes the steps it cannot keep on; the deployment's own (`coder-host/replay-summary.ts`) where none is named. */
  summaryModel?: SummaryModelOf;
}

/** What the routes may require of the function that stands them. */
export type CodingAgentsAppServices =
  | DatabaseServices
  | GitHubApp
  | HttpClient.HttpClient
  | ModelCatalog
  | HostedEnvironment;

type AgentsServices = CodingAgentsAppServices | HttpServerRequest.HttpServerRequest;

/** The one id the path named under `id`. */
const idOf = (request: Request) => uuidOf(request, QUERY.ID);

/** The one attachment the path named under `attachment`. */
const attachmentIdOf = (request: Request) => uuidOf(request, QUERY.ATTACHMENT);

/** The one picture the path named under `picture`. */
const pictureIdOf = (request: Request) => uuidOf(request, QUERY.PICTURE);

/** The delegation call the path named under `query`, or not found for one that is no call id. */
const callIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const call = new URL(request.url).searchParams.get(QUERY.CALL) ?? "";
  const read = readEither(codingAgentCallIdSchema)(unparsedWire(call));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The cursor the request reads past, or the start where it names none; refused where it names something else. */
const cursorOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const after = readEither(codingAgentCursorSchema)(
    unparsedWire(new URL(request.url).searchParams.get(QUERY.AFTER) ?? CODING_AGENT_CURSOR_START),
  );
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return after.success;
});

/**
 * What a read of an ended agent, or of its worker, waits on for a title:
 * the worker named, or the agent's own or any of its workers' where none
 * is; nothing on a deployment that generates no titles, which is one
 * without Luke's Anthropic key, the title model's (`coder-host/model.ts`).
 */
const titleAwaitedOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  parent: ConversationTarget,
  childConversationId?: string,
): Effect.fn.Return<TitleAwaited, never, HostedEnvironment> {
  const environment = yield* HostedEnvironment;
  return environment.anthropicKey === undefined
    ? NO_TITLE_AWAITED
    : titleMayLand(parent, childConversationId);
});

/** A page of a transcript as the wire answers it. */
function transcriptResponse(
  page: TranscriptPage,
  title: string | null,
): HttpServerResponse.HttpServerResponse {
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    messages: page.messages,
    cursor: cursorToWire(page.cursor),
    status: page.status,
    ...(page.runStartedAt === undefined ? undefined : { runStartedAt: page.runStartedAt }),
    ...(page.delegations === undefined ? undefined : { delegations: page.delegations }),
    ...(page.subagentTitles === undefined ? undefined : { subagentTitles: page.subagentTitles }),
    ...(page.subagents === undefined ? undefined : { subagents: page.subagents }),
    title,
    ...(page.failureReason === undefined ? undefined : { failureReason: page.failureReason }),
    ...(page.usage === undefined ? undefined : { usage: page.usage }),
    ...(page.context === undefined ? undefined : { context: page.context }),
  });
}

/** A choice the catalog refused is an invalid request, on the wire. */
const choiceOrInvalid = <A, E, R>(
  effect: Effect.Effect<A, E | ModelChoiceRefused, R>,
): Effect.Effect<A, E | HostedRefusal, R> =>
  Effect.catchTag(effect, "ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST));

/**
 * POST: an agent started on the task, or the one a retry under the same key
 * already started, on the one start path (`packages/service/src/agents/coder-host/start.ts`),
 * reaching eve as the developer.
 */
const startEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  request: Request,
  userId: string,
  taskId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const body = yield* readJsonBodyEffect(MAXIMUM_START_BODY_BYTES);
  const asked = readEither(codingAgentStartRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const {
    idempotencyKey,
    model,
    effort,
    contextWindow,
    prompt,
    attachments,
    disabledServers,
    from,
    note,
  } = asked.success;
  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on,
  // and a window without them is a window of no model.
  if (
    (model === undefined) !== (effort === undefined) ||
    (contextWindow !== undefined && model === undefined)
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const choice =
    model !== undefined && effort !== undefined
      ? { model, effort, ...(contextWindow === undefined ? undefined : { contextWindow }) }
      : undefined;
  const environment = yield* HostedEnvironment;
  const summaryModel: SummaryModelOf =
    seams.summaryModel ??
    ((owner, chosen, effort) =>
      productionSummaryModel(owner, chosen, effort).pipe(
        Effect.provideService(HostedEnvironment, environment),
      ));
  const { agent, created } = yield* choiceOrInvalid(
    startCodingAgent(eveFor(seams, request), userId, {
      taskId,
      idempotencyKey,
      choice,
      prompt,
      attachments,
      disabledServers,
      from,
      // Note that the wire takes a note only beside a source, and an empty one is no note: its files carry it alone.
      note: note === "" ? undefined : note,
      summaryModel,
    }),
  );
  if (!created) {
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { agent: yield* summaryOf(userId, agent) });
  }
  const names = yield* hostedStoreOrUnavailable(readAccountNames(summaryAccounts(agent)));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, {
    agent: codingAgentSummary(
      agent,
      { turn: undefined, awaitingLineAt: undefined },
      yield* Clock.currentTimeMillis,
      names,
    ),
  });
});

/** Whether a list read asks for the archived agents too; a build from before archiving never does. */
function listsArchived(request: Request): boolean {
  const asked = new URL(request.url).searchParams.get(CODING_AGENT_LIST_QUERY.ARCHIVED);
  return asked === CODING_AGENT_LIST_ARCHIVED.INCLUDE;
}

/** GET lists the task's agents with their status; POST starts one. */
const taskAgentsEndpoint = /* @__PURE__ */ Effect.fn("web/taskAgentsEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.POST) {
    return yield* startEndpoint(seams, request, userId, taskId);
  }
  const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgents(userId, taskId, { includeArchived: listsArchived(request) }),
  );
  const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
  const names = yield* hostedStoreOrUnavailable(readAccountNames(agents.flatMap(summaryAccounts)));
  const continuedBy = yield* continuedByOf(
    userId,
    agents.map((agent) => agent.id),
  );
  const now = yield* Clock.currentTimeMillis;
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agents: agents.map((agent) =>
      codingAgentSummary(agent, standing(agent.conversationId), now, names, continuedBy(agent.id)),
    ),
  });
});

/**
 * GET lists a workspace's agents, on a task or with none, newest started
 * first, the archived ones left out unless `archived=include` asks,
 * narrowed to one repository where the query names one and to agents whose
 * title or task's name holds the query's words where it names some, as the plan list
 * answers them; a workspace the account is not in is not found, as a plan
 * is.
 */
const workspaceAgentsEndpoint = /* @__PURE__ */ Effect.fn("web/workspaceAgentsEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const query = new URL(request.url).searchParams;
  const workspaceId = query.get(CODING_AGENT_WORKSPACE_QUERY.WORKSPACE_ID) ?? "";
  const repository = query.get(CODING_AGENT_WORKSPACE_QUERY.REPOSITORY) ?? undefined;
  const words = query.get(CODING_AGENT_WORKSPACE_QUERY.WORDS)?.trim();
  if (
    workspaceId === "" ||
    repository === "" ||
    words === "" ||
    (words?.length ?? 0) > CODING_AGENT_BOUNDS.MAX_SEARCH_CHARS
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const userId = yield* resolvedUserId(seams, request);
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const agents = yield* hostedStoreOrUnavailable(
    listWorkspaceCodingAgents(userId, workspaceId, {
      ...(repository === undefined ? undefined : { repository }),
      ...(words === undefined ? undefined : { words }),
      includeArchived: listsArchived(request),
      limit: WORKSPACE_AGENTS_LIMIT,
    }),
  );
  const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
  const names = yield* hostedStoreOrUnavailable(readAccountNames(agents.flatMap(summaryAccounts)));
  const continuedBy = yield* continuedByOf(
    userId,
    agents.map((agent) => agent.id),
  );
  const now = yield* Clock.currentTimeMillis;
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agents: agents.map((agent) =>
      codingAgentSummary(agent, standing(agent.conversationId), now, names, continuedBy(agent.id)),
    ),
  });
});

/** Why a message body was not read as one: its words run past the bound, or it is not a message at all. */
function messageRefusal(body: UnparsedWireValue): HostedRefusal {
  if (isRecord(body) && isWireString(body.text)) {
    if (body.text.trim().length > CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS) {
      return HOSTED_REFUSAL.MESSAGE_TOO_LONG;
    }
  }
  return HOSTED_REFUSAL.INVALID_REQUEST;
}

/**
 * POST sends the agent a message: the developer's words handed to the
 * session the agent runs in under the developer's own bearer, through the
 * one steer path the voice brain's tool shares (`coder-host/steer.ts`),
 * with the client's own key for the send.
 */
const sendMessageEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const { userId, agent } = yield* reachedAgent(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_MESSAGE_BODY_BYTES);
  const asked = readEither(codingAgentMessageRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(messageRefusal(body));
  const eve = yield* eveFor(seams, request);
  yield* steerCodingAgent(eve, writer, userId, agent, {
    ...asked.success,
    sender: { kind: MESSAGE_SENDER.MEMBER, userId },
  });
  return hostedJsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, {
    agent: yield* summaryOf(userId, agent),
  });
});

/** GET reads the agent's transcript past the cursor, held open while the agent is starting or runs, with the agent's status as the page was read; POST sends the agent a message. */
const messagesEndpoint = /* @__PURE__ */ Effect.fn("web/agentMessagesEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  if (incoming.method === HTTP_METHOD.POST) {
    return yield* sendMessageEndpoint(seams, writer, request);
  }
  const after = yield* cursorOf(request);
  const { userId, agent, target } = yield* reachedAgent(seams, request);
  const titleAwaited = yield* titleAwaitedOf(target);
  const page = yield* hostedStoreOrUnavailable(
    transcriptPast(target, CODER_TOOL_SET, cursorOfWire(after), agent, agent, titleAwaited),
  );
  // The title is read after the page, since it lands after a turn ends, which a held read may span.
  const titled = yield* hostedStoreOrUnavailable(readCodingAgent(userId, agent.id));
  return transcriptResponse(
    page,
    Option.match(titled, { onNone: () => agent.title, onSome: (now) => now.title }),
  );
});

/** GET reads a worker's transcript past the cursor, held open while the worker runs as the agent's own is: the child conversation of the delegation call named, where the account's agent recorded one, with the worker's title once one landed. A call recorded nowhere yet while the agent runs is waited for (`delegationPast`), and past the wait answers the empty page of a worker still starting, so a tab opened the moment the call was requested keeps reading. */
const subagentMessagesEndpoint = /* @__PURE__ */ Effect.fn("web/agentSubagentMessagesEndpoint")(
  function* (
    seams: CodingAgentsAppSeams,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const after = yield* cursorOf(request);
    const callId = yield* callIdOf(request);
    const { agent, target } = yield* reachedAgent(seams, request);
    const conversationId = childConversationId(agent.conversationId, callId);
    const read = yield* hostedStoreOrUnavailable(delegationPast(target, conversationId, agent));
    if (read.delegation === undefined) {
      if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return transcriptResponse(
        { messages: [], cursor: cursorOfWire(after), status: CODING_AGENT_STATUS.STARTING },
        null,
      );
    }
    const titleAwaited = yield* titleAwaitedOf(target, conversationId);
    const page = yield* hostedStoreOrUnavailable(
      transcriptPast(
        { userId: agent.userId, conversationId },
        CODER_TOOL_SET,
        cursorOfWire(after),
        { createdAt: read.delegation.createdAt },
        undefined,
        titleAwaited,
      ),
    );
    // The title is read after the page, since it lands beside the worker's start, which a held read may span.
    const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));
    return transcriptResponse(page, titles.get(conversationId) ?? null);
  },
);

/**
 * PATCH changes the agent for what follows, and answers it as it then
 * stands. A body naming a title renames it: the title written whole on the
 * row, or cleared where the title is empty, so the tab falls back to the
 * model's name. A body naming a model and effort, and the standard context
 * window where it is chosen, changes what its next step runs on, a body
 * naming no window putting the agent back on the model's whole one: the choice checked
 * against the catalog as a Start checks its own,
 * written on the row the steps read; the account's default is untouched.
 * A body naming `archived` archives the agent, stopping a turn still
 * running first as a Stop does, or brings it back. A body naming `pinned`
 * pins the agent for the asking member alone, or unpins it, which the plan
 * list's agents with no plan then carry as that member's. A body naming
 * `disabledServers` replaces the list of MCP servers switched off for the
 * agent, which its next turn reads as it starts.
 */
const changeEndpoint = /* @__PURE__ */ Effect.fn("web/agentChangeEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.PATCH) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* reachedAgent(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_CHOICE_BODY_BYTES);
  const rename = readEither(codingAgentRenameRequestSchema)(body);
  if (Result.isSuccess(rename)) {
    const { title } = rename.success;
    const renamed = yield* hostedStoreOrUnavailable(
      renameCodingAgent(userId, agent.id, title.length === 0 ? null : title),
    );
    if (Option.isNone(renamed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: yield* summaryOf(userId, renamed.value),
    });
  }
  const archive = readEither(codingAgentArchiveRequestSchema)(body);
  if (Result.isSuccess(archive)) {
    const { archived } = archive.success;
    if (archived) {
      // An archived agent works on unseen, so a turn still running is stopped before the stamp.
      yield* stoppedForGood(seams, writer, request, agent);
    }
    const changed = yield* hostedStoreOrUnavailable(archiveCodingAgent(userId, agent.id, archived));
    if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: yield* summaryOf(userId, changed.value),
    });
  }
  const pin = readEither(codingAgentPinRequestSchema)(body);
  if (Result.isSuccess(pin)) {
    const pinned = yield* hostedStoreOrUnavailable(
      pinCodingAgent(userId, agent.id, pin.success.pinned, pin.success.position),
    );
    if (Option.isNone(pinned)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: yield* summaryOf(userId, pinned.value),
    });
  }
  const servers = readEither(codingAgentServersRequestSchema)(body);
  if (Result.isSuccess(servers)) {
    const changed = yield* hostedStoreOrUnavailable(
      updateCodingAgentServers(userId, agent.id, servers.success.disabledServers),
    );
    if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      agent: yield* summaryOf(userId, changed.value),
    });
  }
  const asked = readEither(modelChoiceSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const choice = yield* choiceOrInvalid(acceptedAgentChoice(userId, asked.success));
  const changed = yield* hostedStoreOrUnavailable(
    updateCodingAgentChoice(userId, agent.id, choice),
  );
  if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agent: yield* summaryOf(userId, changed.value),
  });
});

/** GET reads the agent as its own page, an agent with no task as much as one on a task; PATCH changes it as `changeEndpoint` does. */
const agentEndpoint = /* @__PURE__ */ Effect.fn("web/agentEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) return yield* changeEndpoint(seams, writer);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* reachedAgent(seams, request);
  const standing = yield* standingsOf([agent.conversationId]);
  const names = yield* hostedStoreOrUnavailable(readAccountNames(pageAccounts(agent)));
  const continuedBy = yield* continuedByOf(userId, [agent.id]);
  const now = yield* Clock.currentTimeMillis;
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    agent: codingAgentPage(
      agent,
      standing(agent.conversationId),
      now,
      names,
      continuedBy(agent.id),
    ),
  });
});

/** POST stops the agent: eve's cancel of the turn under way, then the row's stamp; an agent with no turn running is answered as it stands. */
const stopEndpoint = /* @__PURE__ */ Effect.fn("web/agentStopEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* reachedAgent(seams, request);
  yield* stoppedTurn(seams, writer, request, agent);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { agent: yield* summaryOf(userId, agent) });
});

/** What the agent published, from the instance's kept answers, its failures as the refusals a route answers. */
const keptPublished = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: PublishedCache,
  userId: string,
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentPullRequestAnswer, HostedRefusal, AgentsServices> {
  // Whether the agent has ended is part of the key, so the first ask after its turn ends reads GitHub afresh.
  const status = yield* statusOf(agent);
  const ended = status !== CODING_AGENT_STATUS.STARTING && status !== CODING_AGENT_STATUS.RUNNING;
  return yield* Cache.get(published, new PublishedKey({ userId, agentId: agent.id, ended })).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        // The row stood a statement ago; an agent gone between the two is not found, as it would be on the next ask.
        case "NoSuchAgent":
          return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        case "SqlError":
        case "EffectDrizzleQueryError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
});

/**
 * The instance's kept answers for the agent let go, every member's and on
 * either side of its end, so the next ask on this instance reads GitHub
 * afresh whoever asks. Note that another instance keeps its own for at most
 * `CODER.PUBLISHED_TTL`, as it keeps one past a change made on GitHub itself.
 */
const forgetPublished = (published: PublishedCache, agentId: string) =>
  Effect.flatMap(Cache.keys(published), (keys) =>
    Effect.forEach(
      [...keys].filter((key) => key.agentId === agentId),
      (key) => Cache.invalidate(published, key),
      { discard: true },
    ),
  );

/** GET reads what the agent published: its branch and pull request as GitHub holds them, from the instance's kept answers. */
const pullRequestEndpoint = /* @__PURE__ */ Effect.fn("web/agentPullRequestEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  published: PublishedCache,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* reachedAgent(seams, request);
  const answer = yield* keptPublished(published, userId, agent);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

/**
 * GET reads the agent's changes: the files of the pull request its kept
 * published answer names, who it names (`github-people.ts`), and the
 * commits its changed images are read at (`imageCommits`), read from
 * GitHub afresh on a token minted for the agent's repository on its task's
 * workspace installation, with who its row says it writes as, or none
 * where it names no pull request yet.
 */
const changesEndpoint = /* @__PURE__ */ Effect.fn("web/agentChangesEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  published: PublishedCache,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* reachedAgent(seams, request);
  const { pullRequest } = yield* keptPublished(published, userId, agent);
  if (pullRequest === null) return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { pullRequest });
  const listed = yield* Effect.gen(function* () {
    const { token } = yield* agentPullRequestReach(userId, agent);
    // Note that the pull request itself is read beside its files for its head and base, which its changed images are read at; a read that does not land names neither.
    const [files, people, whole] = yield* Effect.all(
      [
        pullRequestFiles(token, agent.repository, pullRequest),
        changesPeople(token, agent, pullRequest.number),
        Effect.orElseSucceed(pullRequestByNumber(token, agent.repository, pullRequest.number), () =>
          Option.none(),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const commits = yield* imageCommits(token, agent.repository, whole, files.files);
    return { ...commits, ...files, ...people };
  }).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        case "SqlError":
        case "EffectDrizzleQueryError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    pullRequest: {
      url: pullRequest.url,
      ...listed,
      ...(agent.author === null ? undefined : { writtenAs: agent.author }),
    },
  });
});

/** One of the overview's reads of the agent's pull request, on the token minted for its repository; null where GitHub holds no such pull request. */
type OverviewRead<A> = (
  token: Redacted.Redacted,
  agent: CodingAgent,
  pullRequest: CodingAgentPullRequest,
  /** The member reading, whose own reads mark what is theirs. */
  userId: string,
) => Effect.Effect<A | null, PullRequestReadFailure, AgentsServices>;

/**
 * GET reads one part of the agent's pull request's overview: the pull
 * request its kept published answer names, read from GitHub afresh on a
 * token minted for the agent's repository; none where it names no pull
 * request yet. Each part is a route of its own, so each lands on its own.
 */
const overviewPart = /* @__PURE__ */ Effect.fnUntraced(function* <A>(
  seams: CodingAgentsAppSeams,
  published: PublishedCache,
  read: OverviewRead<A>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { userId, agent } = yield* reachedAgent(seams, request);
  const { pullRequest } = yield* keptPublished(published, userId, agent);
  if (pullRequest === null) return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { pullRequest });
  const part = yield* Effect.gen(function* () {
    const { token } = yield* agentPullRequestReach(userId, agent);
    return yield* read(token, agent, pullRequest, userId);
  }).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        case "SqlError":
        case "EffectDrizzleQueryError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
  // Note that a part may carry what is the reader's own, such as the reactions they gave, which every hosted answer's `private, no-store` keeps from anyone else.
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { pullRequest: part });
});

/** Whether the pull request was open as last read, which is when the stack it stands in is worth a read of GitHub's open pull requests. */
function stackable(pullRequest: CodingAgentPullRequest): boolean {
  return (
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT
  );
}

/**
 * GET reads the agent's pull request itself: its description, branches,
 * mergeability, who opened it, who it asks for a review, its labels, and,
 * while it was open as last read, the stack it stands in, its people named
 * against the workspace's members and its stack by their agents
 * (`github-people.ts`), with who its row says it writes as; none where the
 * repository no longer holds it.
 */
const overviewPullRequestEndpoint = /* @__PURE__ */ Effect.fn(
  "web/agentOverviewPullRequestEndpoint",
)(function* (seams: CodingAgentsAppSeams, published: PublishedCache) {
  return yield* overviewPart(seams, published, (token, agent, pullRequest) =>
    Effect.gen(function* () {
      const [read, merging] = yield* Effect.all(
        [
          pullRequestOverview(token, agent.repository, pullRequest.number, stackable(pullRequest)),
          mergingOrNone(token, agent.repository, pullRequest.number),
        ],
        { concurrency: "unbounded" },
      );
      if (Option.isNone(read)) return null;
      const named = yield* namedOverviewPullRequest(agent, read.value);
      return Option.isNone(merging) ? named : { ...named, merging: merging.value };
    }),
  );
});

/**
 * How the pull request may be merged, for its merge box; none where GitHub
 * would not say, logged by its kind, since the header it rides with stands
 * without it.
 */
const mergingOrNone = (token: Redacted.Redacted, repository: string, number: number) =>
  pullRequestMerging(token, repository, number).pipe(
    Effect.catch((failure) =>
      Effect.as(logGitHubReadFailure(failure), Option.none<PullRequestMerging>()),
    ),
  );

/**
 * GET reads the checks on the agent's pull request's head, failures first,
 * up to the bound, and its head's deployments beside them: three requests
 * to GitHub at once whatever their number, the check runs, the commit
 * statuses, and the deployments.
 */
const overviewChecksEndpoint = /* @__PURE__ */ Effect.fn("web/agentOverviewChecksEndpoint")(
  function* (seams: CodingAgentsAppSeams, published: PublishedCache) {
    return yield* overviewPart(seams, published, (token, agent, pullRequest) =>
      Effect.map(
        Effect.all(
          [
            pullRequestChecks(token, agent.repository, pullRequest.number),
            pullRequestDeployments(token, agent.repository, pullRequest.number),
          ],
          { concurrency: "unbounded" },
        ),
        ([checks, deployments]) => ({ checks, deployments }),
      ),
    );
  },
);

/** Which reactions the member gave on the pull request, read on their own token; none where they hold none GitHub takes. */
const memberReactions = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(undefined) : viewerReactionsOf(token, repository, number),
  );

/**
 * GET reads the agent's pull request's conversation: its comments, its
 * reviews and their threads, and where each reviewer stands by their
 * reviews, its people named against the workspace's members; and, read
 * beside it on the member's own token, which reactions are theirs.
 */
const overviewConversationEndpoint = /* @__PURE__ */ Effect.fn(
  "web/agentOverviewConversationEndpoint",
)(function* (seams: CodingAgentsAppSeams, published: PublishedCache) {
  return yield* overviewPart(seams, published, (token, agent, pullRequest, userId) =>
    Effect.flatMap(
      pullRequestConversation(
        token,
        agent.repository,
        pullRequest,
        memberReactions(userId, agent.repository, pullRequest.number),
      ),
      (read) => namedOverviewConversation(agent, pullRequest.number, read),
    ),
  );
});

/** The changes made by the pull request's number on GitHub's REST API, its requested reviewers and labels, which GraphQL cannot take a reviewer off of. */
type RestActionRequest = Extract<
  PullRequestActionRequest,
  {
    readonly action:
      | typeof PULL_REQUEST_ACTION.REQUEST_REVIEW
      | typeof PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST
      | typeof PULL_REQUEST_ACTION.ADD_LABEL
      | typeof PULL_REQUEST_ACTION.REMOVE_LABEL;
  }
>;

/** The write a change makes on the pull request, on the member's token, by the pull request's GraphQL id. */
function writeOf(
  request: Exclude<PullRequestActionRequest, RestActionRequest>,
  token: Redacted.Redacted,
  id: string,
): Effect.Effect<void, GitHubWriteFailure, HttpClient.HttpClient> {
  switch (request.action) {
    case PULL_REQUEST_ACTION.READY_FOR_REVIEW:
      return setPullRequestDraft(token, id, false);
    case PULL_REQUEST_ACTION.CONVERT_TO_DRAFT:
      return setPullRequestDraft(token, id, true);
    case PULL_REQUEST_ACTION.MERGE:
      return mergePullRequest(token, id, request.method, request.headSha);
    case PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE:
      return setAutoMerge(token, id, { method: request.method, headSha: request.headSha });
    case PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE:
      return setAutoMerge(token, id, undefined);
    case PULL_REQUEST_ACTION.DEQUEUE:
      return takeOutOfMergeQueue(token, id);
    case PULL_REQUEST_ACTION.CLOSE:
      return setPullRequestOpen(token, id, false);
    case PULL_REQUEST_ACTION.REOPEN:
      return setPullRequestOpen(token, id, true);
    case PULL_REQUEST_ACTION.EDIT_TITLE:
      return setPullRequestTitle(token, id, request.title);
    case PULL_REQUEST_ACTION.SUBMIT_REVIEW:
      return submitPullRequestReview(token, id, request);
    case PULL_REQUEST_ACTION.REPLY_TO_THREAD:
      return replyToReviewThread(token, id, request);
    case PULL_REQUEST_ACTION.RESOLVE_THREAD:
    case PULL_REQUEST_ACTION.UNRESOLVE_THREAD:
      return setReviewThreadResolved(
        token,
        id,
        request.threadId,
        request.action === PULL_REQUEST_ACTION.RESOLVE_THREAD,
      );
    case PULL_REQUEST_ACTION.ADD_REACTION:
    case PULL_REQUEST_ACTION.REMOVE_REACTION:
      return reactOnPullRequest(token, id, {
        subject: request.subject,
        content: GRAPHQL_REACTION_OF[request.content],
        add: request.action === PULL_REQUEST_ACTION.ADD_REACTION,
      });
  }
}

/** The write a change makes on the pull request, on the member's token. */
function actionWrite(
  request: PullRequestActionRequest,
): (
  pullRequest: MemberPullRequest,
) => Effect.Effect<void, GitHubWriteFailure, HttpClient.HttpClient> {
  return ({ token, repository, number }) => {
    switch (request.action) {
      case PULL_REQUEST_ACTION.REQUEST_REVIEW:
      case PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST:
        return setReviewRequested(
          token,
          repository,
          number,
          request.reviewer,
          request.action === PULL_REQUEST_ACTION.REQUEST_REVIEW,
        );
      case PULL_REQUEST_ACTION.ADD_LABEL:
      case PULL_REQUEST_ACTION.REMOVE_LABEL:
        return setLabelled(
          token,
          repository,
          number,
          request.label,
          request.action === PULL_REQUEST_ACTION.ADD_LABEL,
        );
      default:
        return Effect.flatMap(pullRequestNodeId(token, repository, number), (id) =>
          writeOf(request, token, id),
        );
    }
  };
}

/**
 * POST makes one change to the pull request the agent's kept published
 * answer names, as the asking member on their own GitHub sign-in
 * (`pull-request-write.ts`), and answers how GitHub took it; not found
 * where it names no pull request yet. Whatever GitHub answered, the kept
 * answer is let go, so the reads after it ask GitHub afresh.
 */
const pullRequestActionEndpoint = /* @__PURE__ */ Effect.fn("web/agentPullRequestActionEndpoint")(
  function* (
    seams: CodingAgentsAppSeams,
    published: PublishedCache,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const { userId, agent } = yield* reachedAgent(seams, request);
    const body = yield* readJsonBodyEffect(MAXIMUM_PULL_REQUEST_ACTION_BODY_BYTES);
    const asked = readEither(pullRequestActionRequestSchema)(body);
    if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const { pullRequest } = yield* keptPublished(published, userId, agent);
    if (pullRequest === null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const written = yield* memberPullRequestWrite(
      userId,
      agent,
      pullRequest.number,
      actionWrite(asked.success),
    ).pipe(Effect.ensuring(forgetPublished(published, agent.id)));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, writeAnswerOf(written));
  },
);

/**
 * GET reads one image the agent's pull request's overview names, by the
 * address GitHub's rendering spelled (`src`): an upload re-signed on a token
 * minted for the agent's repository, a file of that repository read through
 * its contents on the same token, or a public image on GitHub's image proxy
 * (`github/github-images.ts`); refused as invalid for any address that is
 * none of them, and not found where GitHub answers no image the window
 * draws, a file of any other repository among them.
 */
const githubImageEndpoint = /* @__PURE__ */ Effect.fn("web/agentGitHubImageEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const image = githubImageOf(new URL(request.url).searchParams.get(QUERY.SRC) ?? "");
  if (image === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { userId, agent } = yield* reachedAgent(seams, request);
  const read = yield* Effect.gen(function* () {
    const { token } = yield* agentPullRequestReach(userId, agent);
    return yield* githubImage(token, agent.repository, image);
  }).pipe(
    Effect.catch((failure) => {
      switch (failure._tag) {
        case "RepositoryNotReachable":
          return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
        case "SqlError":
        case "EffectDrizzleQueryError":
        case "SchemaError":
          return hostedStoreOrUnavailable(Effect.fail(failure));
        default:
          return githubReadOrRefusal(Effect.fail(failure));
      }
    }),
  );
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(read.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: read.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

/**
 * GET reads what the reviewer and label pickers offer, of the agent's
 * repository rather than its pull request, on a token minted for it: its
 * labels, its collaborators named against the workspace's members, and the
 * teams that reach it.
 */
const reviewOptionsEndpoint = /* @__PURE__ */ Effect.fn("web/agentReviewOptionsEndpoint")(
  function* (
    seams: CodingAgentsAppSeams,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const { userId, agent } = yield* reachedAgent(seams, request);
    const options = yield* Effect.gen(function* () {
      const { token } = yield* agentPullRequestReach(userId, agent);
      return yield* namedReviewOptions(
        agent,
        yield* pullRequestReviewOptions(token, agent.repository),
      );
    }).pipe(
      Effect.catch((failure) => {
        switch (failure._tag) {
          case "RepositoryNotReachable":
            return Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
          case "SqlError":
          case "EffectDrizzleQueryError":
          case "SchemaError":
            return hostedStoreOrUnavailable(Effect.fail(failure));
          default:
            return githubReadOrRefusal(Effect.fail(failure));
        }
      }),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, options);
  },
);

/** The inbox cursor the request reads past, or the start where it names none; refused where it names something else. */
const inboxCursorOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const after = readEither(inboxCursorSchema)(
    unparsedWire(new URL(request.url).searchParams.get(QUERY.AFTER) ?? INBOX_CURSOR_START),
  );
  if (Result.isFailure(after)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return after.success;
});

/** GET reads the task's inbox past the cursor: every item its agents posted, held open while nothing changed. */
const taskInboxEndpoint = /* @__PURE__ */ Effect.fn("web/taskInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const taskId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const page = yield* hostedStoreOrUnavailable(taskInboxPast(userId, taskId, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads one agent's inbox past the cursor: every item it posted, held open while nothing changed, for any member of its workspace. */
const agentInboxEndpoint = /* @__PURE__ */ Effect.fn("web/agentInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const { userId, agent } = yield* reachedAgent(seams, request);
  const page = yield* hostedStoreOrUnavailable(agentInboxPast(userId, agent.id, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads what waits on the developer across the account's tasks past the cursor: every open item, held open while nothing changed. */
const accountInboxEndpoint = /* @__PURE__ */ Effect.fn("web/accountInboxEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const after = yield* inboxCursorOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const page = yield* hostedStoreOrUnavailable(accountInboxPast(userId, after));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/**
 * GET serves one attachment of an inbox item, an image block's picture or a
 * file the developer's answer carried, as its bytes under the media type
 * the service sniffed a picture to be or a file travelled as, to the
 * members of the item's workspace alone: an attachment of another
 * workspace's, or of another item's, is not found, as an item is.
 */
const inboxAttachmentEndpoint = /* @__PURE__ */ Effect.fn("web/inboxAttachmentEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const itemId = yield* idOf(request);
  const attachmentId = yield* attachmentIdOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const found = yield* hostedStoreOrUnavailable(readInboxAttachment(userId, itemId, attachmentId));
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

/**
 * GET serves one picture a tool answered an agent, kept beside its
 * transcript (`brain-host/relay-pictures.ts`), as its bytes under the media
 * type the service sniffed them to be, to whoever may read the agent; one of
 * its workers' where the path names the delegation call, read from that
 * worker's own transcript. A picture of another agent's transcript, or of
 * another worker's, is not found, as an agent the account cannot reach is.
 */
const pictureEndpoint = /* @__PURE__ */ Effect.fn("web/agentPictureEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const pictureId = yield* pictureIdOf(request);
  const worker = new URL(request.url).searchParams.has(QUERY.CALL);
  const callId = worker ? yield* callIdOf(request) : undefined;
  const { agent } = yield* reachedAgent(seams, request);
  const conversationId =
    callId === undefined ? agent.conversationId : childConversationId(agent.conversationId, callId);
  const found = yield* hostedStoreOrUnavailable(readConversationPicture(conversationId, pictureId));
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

/** An item as an answer comes back with it, and whether the answer was taken. */
function inboxAnswered(item: InboxItem, taken: boolean): HttpServerResponse.HttpServerResponse {
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { item, taken });
}

/** Whether a hand-off was refused because the agent's session has ended for good, so no message will ever reach it. */
function retiredRefusal(refusal: HostedRefusal): boolean {
  return refusal.error === HOSTED_REFUSAL.AGENT_RETIRED.error;
}

/**
 * POST answers one item of a task of the account's workspaces, whichever
 * member started its agent. An answer naming a
 * revision the agent has since moved on from, or an item no longer open,
 * is answered with the item as it stands and not taken. Otherwise the
 * answer is taken first, at the revision it names, with the files it
 * carries kept as the item's, and only then, where the item asks to be
 * heard back or the developer typed a note or attached a file, handed to
 * the agent as one of the developer's messages, its files with it, under
 * the answer's own key through the one steer
 * path (`coder-host/steer.ts`), so an answer the item no longer takes
 * never reaches the agent. A hand-off that fails, is interrupted, or dies
 * takes the answer back, so an item never reads answered while the agent
 * was not told; and an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once,
 * so a hand-off cut short by the function's own end is finished by the
 * retry rather than reported done. An agent whose session has ended for
 * good can hear nothing again, so its item keeps the answer rather than
 * waiting on the developer for ever.
 */
const inboxAnswerEndpoint = /* @__PURE__ */ Effect.fn("web/inboxAnswerEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const itemId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
  if (Option.isNone(stored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_ANSWER_BODY_BYTES);
  const asked = readEither(inboxAnswerRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { revision, clientKey, attachments = [], ...reply } = asked.success;
  const taken = yield* takenAnswer(userId, stored.value, {
    revision,
    clientKey,
    reply,
    attachments,
  });
  if (taken === undefined) {
    // Not taken: the item moved on, or another answer settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return inboxAnswered(now.value.item, now.value.answerKey === clientKey);
  }
  if (taken.answer === undefined || !inboxAnswerHeard(taken, taken.answer, taken.answerFiles)) {
    return inboxAnswered(taken, true);
  }
  const answer = taken.answer;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(taken, answer),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxAnswer(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  return inboxAnswered(taken, true);
});

/** A message is its words and the files a message may carry: the words' bound at JSON's widest escape, the files, and room for the key. */
const MAXIMUM_INBOX_MESSAGE_BODY_BYTES =
  6 * INBOX_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 2_048;

/**
 * POST writes a member's message on the thread of one item of the account's
 * workspaces, open or settled, whichever member started its agent, and
 * answers with the item as it then stands. The message is written first,
 * with its files, moving the item's last change and nothing else of it,
 * and then handed to the agent as one of the developer's messages, under
 * its own lead and its files with it, through the one steer path
 * (`coder-host/steer.ts`), which opens a turn for an agent that stopped as
 * a message typed in its tab does. A hand-off that fails, is interrupted,
 * or dies takes the message back off the thread, so the thread never shows
 * a message the agent was not told, where this send wrote it; a message sent again under its key is the one already
 * written and handed off again, which the steer's own key makes reach the
 * agent once, and another message under a key already taken, by another
 * member or with other words or files, is refused. An agent whose session has ended for good can
 * hear nothing again, so its item keeps the message.
 */
const inboxMessageEndpoint = /* @__PURE__ */ Effect.fn("web/inboxMessageEndpoint")(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const itemId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_MESSAGE_BODY_BYTES);
  const asked = readEither(inboxMessageRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { text, clientKey, attachments = [] } = asked.success;
  const posted = yield* hostedStoreOrUnavailable(
    postInboxMessage(userId, itemId, { text, clientKey, files: attachments }),
  );
  if (Option.isNone(posted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = posted.value;
  if (outcome === INBOX_MESSAGE_OUTCOME.KEY_REUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  // Note that a repeat leaves the message standing on failure, because the write that wrote it decides whether it stays.
  const unheard =
    outcome === INBOX_MESSAGE_OUTCOME.WRITTEN
      ? withdrawInboxMessage(userId, itemId, clientKey)
      : Effect.void;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, item.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxThreadMessage(item, text),
      attachments,
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() => unheard.pipe(Effect.tapError(logStoreFailure), Effect.ignore)),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { item });
});

/** A request to mark every item read names at most a workspace, so a few hundred bytes hold it. */
const MAXIMUM_INBOX_READ_ALL_BODY_BYTES = 1_024;

/**
 * The member's own read state on the Inbox, which no other member's moves.
 * Where the path names an item, PUT marks it read, which is what opening
 * it does and writes nothing where it stands read already, and DELETE
 * marks it unread until they read it again; each answers the item's id and
 * its read state, and an item of a workspace the account is not in is not
 * found. Where the path names none, PUT marks every item their Inbox lists
 * read, in the workspace the body names or in all of theirs, and answers
 * how many were unread.
 */
const inboxReadEndpoint = /* @__PURE__ */ Effect.fn("web/inboxReadEndpoint")(function* (
  seams: CodingAgentsAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.has(QUERY.ID);
  const method = incoming.method;
  if (method !== HTTP_METHOD.PUT && !(named && method === HTTP_METHOD.DELETE)) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  if (!named) {
    const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_READ_ALL_BODY_BYTES);
    const asked = readEither(inboxReadAllRequestSchema)(body);
    if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const userId = yield* resolvedUserId(seams, request);
    const marked = yield* hostedStoreOrUnavailable(
      markInboxRead(userId, asked.success.workspaceId),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { marked });
  }
  const itemId = yield* idOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const unread = method === HTTP_METHOD.DELETE;
  const found = yield* hostedStoreOrUnavailable(
    unread ? markInboxItemUnread(userId, itemId) : markInboxItemRead(userId, itemId),
  );
  if (!found) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { id: itemId, unread });
});

/**
 * The item with the answer standing on it under the request's key: taken
 * now where the item is open at the revision named and takes the answer,
 * or as an earlier send under the same key took it; nothing where it was
 * not taken. Refused where the answer does not fit the item.
 */
const takenAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredInboxItem,
  asked: {
    readonly revision: number;
    readonly clientKey: string;
    readonly reply: InboxReply;
    readonly attachments: readonly CodingAgentAttachment[];
  },
): Effect.fn.Return<InboxItem | undefined, HostedRefusal, DatabaseServices> {
  const { item, answerKey } = stored;
  if (answerKey === asked.clientKey) return item;
  if (item.status !== INBOX_STATUS.OPEN || item.revision !== asked.revision) return undefined;
  if (inboxReplyRefusal(item, asked.reply, asked.attachments) !== undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxItem(
      userId,
      item.id,
      asked.revision,
      asked.reply,
      asked.clientKey,
      asked.attachments,
    ),
  );
  return Option.getOrUndefined(answered);
});

/** The group: its paths, and the hosted vocabulary's own refusal for any other. */
export function codingAgentsApp(seams: CodingAgentsAppSeams): WebRoutes<CodingAgentsAppServices> {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return Layer.unwrap(
    withPublishedCache((published) =>
      Layer.mergeAll(
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.OF_TASK, hostedRefusing(taskAgentsEndpoint(seams))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.OF_WORKSPACE,
          hostedRefusing(workspaceAgentsEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.MESSAGES,
          hostedRefusing(messagesEndpoint(seams, writer)),
        ),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.AGENT, hostedRefusing(agentEndpoint(seams, writer))),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.STOP, hostedRefusing(stopEndpoint(seams, writer))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.PULL_REQUEST,
          hostedRefusing(pullRequestEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.CHANGES,
          hostedRefusing(changesEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.OVERVIEW_PULL_REQUEST,
          hostedRefusing(overviewPullRequestEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.OVERVIEW_CHECKS,
          hostedRefusing(overviewChecksEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.OVERVIEW_CONVERSATION,
          hostedRefusing(overviewConversationEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.PULL_REQUEST_ACTION,
          hostedRefusing(pullRequestActionEndpoint(seams, published)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.GITHUB_IMAGE,
          hostedRefusing(githubImageEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.REVIEW_OPTIONS,
          hostedRefusing(reviewOptionsEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.SUBAGENT_MESSAGES,
          hostedRefusing(subagentMessagesEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_OF_TASK,
          hostedRefusing(taskInboxEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_OF_AGENT,
          hostedRefusing(agentInboxEndpoint(seams)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_ITEM,
          hostedRefusing(inboxAnswerEndpoint(seams, writer)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_MESSAGES,
          hostedRefusing(inboxMessageEndpoint(seams, writer)),
        ),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_READ,
          hostedRefusing(inboxReadEndpoint(seams)),
        ),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.INBOX, hostedRefusing(accountInboxEndpoint(seams))),
        HttpRouter.add(
          ANY_METHOD,
          AGENTS_PATH.INBOX_ATTACHMENT,
          hostedRefusing(inboxAttachmentEndpoint(seams)),
        ),
        HttpRouter.add(ANY_METHOD, AGENTS_PATH.PICTURE, hostedRefusing(pictureEndpoint(seams))),
        hostedNotFoundRoute,
      ),
    ),
  );
}
