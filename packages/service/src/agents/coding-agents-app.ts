import type { DatabaseServices } from "@luke/database/core/query";
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
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { ACCOUNT_INBOX_ARCHIVED, ACCOUNT_INBOX_QUERY } from "@luke/features/account-inbox-wire";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_LIST_ARCHIVED,
  CODING_AGENT_LIST_QUERY,
  CODING_AGENT_STATUS,
  CODING_AGENT_WORKSPACE_QUERY,
  type CodingAgentAttachment,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  codingAgentArchiveRequestSchema,
  codingAgentCallIdSchema,
  codingAgentPinRequestSchema,
  codingAgentRenameRequestSchema,
  codingAgentServersRequestSchema,
  codingAgentStartRequestSchema,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
} from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import { githubPullRequestNumberSchema } from "@luke/features/github-repositories-wire";
import {
  INBOX_BOUNDS,
  INBOX_CURSOR_START,
  INBOX_STATUS,
  type InboxAnswers,
  type InboxItem,
  type InboxReply,
  inboxAnswerHeard,
  inboxAnswerMessage,
  inboxAnswerRequestSchema,
  inboxAnswersReply,
  inboxClosedMessage,
  inboxCloseRequestSchema,
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
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestViewedAnswer,
  pullRequestActionRequestSchema,
} from "@luke/features/pull-request-write-wire";
import { readEither } from "@luke/wire/effect";
import { Cache, Clock, Effect, Layer, Option, type Redacted, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
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
  addLineComment,
  commentOnPullRequest,
  discardPendingReview,
  type GitHubWriteFailure,
  mergePullRequest,
  pullRequestNodeId,
  pullRequestViewedStates,
  reactOnPullRequest,
  replyToReviewThread,
  setAutoMerge,
  setFileViewed,
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
  viewerPendingReviewOf,
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
  answerInboxAsk,
  answerInboxItem,
  closeInboxItemAsMember,
  INBOX_ASK_ANSWER,
  INBOX_MESSAGE_OUTCOME,
  inboxItemArchived,
  markInboxItemRead,
  markInboxItemUnread,
  markInboxRead,
  postInboxMessage,
  readInboxAttachment,
  readInboxItem,
  type StoredInboxItem,
  withdrawInboxAnswer,
  withdrawInboxClose,
  withdrawInboxMessage,
} from "../inbox/inbox-store.js";
import type { ModelCatalog, ModelChoiceRefused } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { reachedAgent, resolvedUserId, uuidOf } from "./agent-reach.js";
import { accountInboxPast, agentInboxPast, taskInboxPast } from "./coder-host/inbox-page.js";
import {
  agentPullRequestOfNumber,
  agentPullRequestReach,
  type PublishedCache,
  PublishedKey,
  withPublishedCache,
} from "./coder-host/published.js";
import { productionSummaryModel, type SummaryModelOf } from "./coder-host/replay-summary.js";
import {
  acceptedAgentChoice,
  MAXIMUM_ATTACHMENTS_BODY_BYTES,
  MAXIMUM_START_BODY_BYTES,
  startRequestedAgent,
} from "./coder-host/start.js";
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
 * its place, as the first message, here as the request's own caller so eve's
 * door admits it as the developer: over the developer's bearer, or, for a
 * browser's session cookie, as the deployment acting for the account the
 * cookie named (`coder-host/stop.ts`'s `eveFor`), which the coder channel
 * mints as the developer's own principal. A retry carrying the same key is
 * the same agent, and opens nothing again. The list (`GET /api/plans/{id}/agents`) reads each agent's
 * status from its newest turn. The transcript and a message to the agent
 * (`/api/agents/{id}/messages`), and a worker's transcript, are the hosted
 * oRPC router's (`messages-procedures.ts`). A change of model (`PATCH /api/agents/{id}`) writes the
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
 * review, submitting a review, replying on or resolving a review thread,
 * or commenting on it, is made on GitHub as the member who asks, on their own GitHub
 * sign-in and never the App's, through the one seam every such change takes
 * (`pull-request-write.ts`), and answers how GitHub took it; the agent's kept
 * published answer is let go, so the next read asks GitHub afresh. What the
 * reviewer and label pickers offer (`GET /api/agents/{id}/review-options`),
 * the repository's labels, collaborators, and teams, is read on a token for
 * the agent's repository, as the overview is. Which of its files the member
 * marked viewed on GitHub, a mark GitHub keeps for each account, is read
 * through the member's own sign-in (`GET /api/agents/{id}/pull-request/viewed`),
 * and set by two of the changes. An image
 * those words name (`GET /api/agents/{id}/github-image`) is
 * read on a token for the agent's repository too, an upload re-signed by its
 * asset's id (`github/github-images.ts`), and answered as bytes.
 */

const AGENTS_PATH = {
  /** GET lists the task's agents, the archived ones too where `archived=include` asks; POST starts one; the rewrite moves the path's task id into the `id` query. */
  OF_TASK: "/api/plans/agents",
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
  PULL_REQUEST_VIEWED: "/api/agents/pull-request-viewed",
  /** GET reads what the reviewer and label pickers of the agent's Pull request tab offer; the rewrite moves the path's agent id into the `id` query. */
  REVIEW_OPTIONS: "/api/agents/review-options",
  /** GET reads one image its pull request's overview names, by its address in the `src` query; the rewrite moves the path's agent id into the `id` query. */
  GITHUB_IMAGE: "/api/agents/github-image",
  /** GET reads the task's inbox past `after`; the rewrite moves the path's task id into the `id` query. */
  INBOX_OF_TASK: "/api/plans/inbox",
  /** GET reads one agent's inbox past `after`, an agent with no task as much as one on a task; the rewrite moves the path's agent id into the `id` query. */
  INBOX_OF_AGENT: "/api/agents/inbox",
  /** POST answers one inbox item; the rewrite moves the path's item id into the `id` query. */
  INBOX_ITEM: "/api/inbox/item",
  /** POST closes one open inbox item without an answer, as a member; the rewrite moves the path's item id into the `id` query. */
  INBOX_CLOSE: "/api/inbox/close",
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
  NUMBER: "number",
} as const;

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
  const environment = yield* HostedEnvironment;
  const summaryModel: SummaryModelOf =
    seams.summaryModel ??
    ((owner, chosen, effort) =>
      productionSummaryModel(owner, chosen, effort).pipe(
        Effect.provideService(HostedEnvironment, environment),
      ));
  const { agent, created } = yield* startRequestedAgent(
    eveFor(seams, request, userId),
    userId,
    taskId,
    asked.success,
    summaryModel,
  );
  return hostedJsonResponse(created ? HOSTED_HTTP_STATUS.CREATED : HOSTED_HTTP_STATUS.OK, {
    agent,
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
      yield* stoppedForGood(seams, writer, request, userId, agent);
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
  yield* stoppedTurn(seams, writer, request, userId, agent);
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

/** The pull request number the request names under `number`, or none where it names none; refused where it names one off the wire's shape or more than one. */
const pullRequestNumberOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<number | undefined, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(QUERY.NUMBER);
  if (named.length === 0) return undefined;
  const read =
    named.length === 1
      ? readEither(githubPullRequestNumberSchema)(unparsedWire(Number(named[0])))
      : undefined;
  if (read === undefined || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

/**
 * What a read of the agent's Pull request tab is about: the pull request of
 * the agent's repository the request names by its number (`number`), read
 * afresh, as a tab showing a pull request other than the agent's own asks;
 * else what the agent published, from the instance's kept answers.
 */
const askedPublished = /* @__PURE__ */ Effect.fnUntraced(function* (
  published: PublishedCache,
  userId: string,
  agent: CodingAgent,
  request: Request,
): Effect.fn.Return<CodingAgentPullRequestAnswer, HostedRefusal, AgentsServices> {
  const number = yield* pullRequestNumberOf(request);
  if (number === undefined) return yield* keptPublished(published, userId, agent);
  return yield* agentPullRequestOfNumber(userId, agent, number).pipe(
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
});

/** The pull request a read or a change of the agent's Pull request tab is about (`askedPublished`), null where there is none. */
const askedPullRequest = (
  published: PublishedCache,
  userId: string,
  agent: CodingAgent,
  request: Request,
) =>
  Effect.map(
    askedPublished(published, userId, agent, request),
    (answer): CodingAgentPullRequest | null => answer.pullRequest,
  );

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

/** GET reads what the agent published: its branch and pull request as GitHub holds them, from the instance's kept answers; or, where the request names a number, that pull request of its repository (`askedPublished`). */
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
  const answer = yield* askedPublished(published, userId, agent, request);
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
  const pullRequest = yield* askedPullRequest(published, userId, agent, request);
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
  const pullRequest = yield* askedPullRequest(published, userId, agent, request);
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
  // Note that a part may carry what is the reader's own, such as the reactions they gave or the review they hold pending, which every hosted answer's `private, no-store` keeps from anyone else.
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

/** The review the member holds pending on the pull request, read on their own token; none where they hold none, or no sign-in GitHub takes. */
const memberPendingReview = (userId: string, repository: string, number: number) =>
  Effect.flatMap(memberReadToken(userId), (token) =>
    token === undefined ? Effect.succeed(null) : viewerPendingReviewOf(token, repository, number),
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
    Effect.map(
      Effect.all(
        [
          Effect.flatMap(
            pullRequestConversation(
              token,
              agent.repository,
              pullRequest,
              memberReactions(userId, agent.repository, pullRequest.number),
            ),
            (read) => namedOverviewConversation(agent, pullRequest.number, read),
          ),
          memberPendingReview(userId, agent.repository, pullRequest.number),
        ],
        { concurrency: "unbounded" },
      ),
      ([conversation, pendingReview]) =>
        conversation === null ? null : { ...conversation, pendingReview },
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
    case PULL_REQUEST_ACTION.COMMENT:
      return commentOnPullRequest(token, id, request.body);
    case PULL_REQUEST_ACTION.ADD_REACTION:
    case PULL_REQUEST_ACTION.REMOVE_REACTION:
      return reactOnPullRequest(token, id, {
        subject: request.subject,
        content: GRAPHQL_REACTION_OF[request.content],
        add: request.action === PULL_REQUEST_ACTION.ADD_REACTION,
      });
    case PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT: {
      const { action: _action, ...comment } = request;
      return addLineComment(token, id, comment);
    }
    case PULL_REQUEST_ACTION.DISCARD_REVIEW:
      return discardPendingReview(token, id);
    case PULL_REQUEST_ACTION.MARK_FILE_VIEWED:
    case PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED:
      return setFileViewed(
        token,
        id,
        request.path,
        request.action === PULL_REQUEST_ACTION.MARK_FILE_VIEWED,
      );
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
    const pullRequest = yield* askedPullRequest(published, userId, agent, request);
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
 * GET reads which of the files of the pull request the agent's kept
 * published answer names the asking member marked viewed on GitHub, on
 * their own GitHub sign-in (`pull-request-write.ts`), since GitHub keeps the
 * mark for each account alone and the App sees none of it; no files where it
 * names no pull request yet. Nothing is let go, as nothing changed.
 */
const pullRequestViewedEndpoint = /* @__PURE__ */ Effect.fn("web/agentPullRequestViewedEndpoint")(
  function* (
    seams: CodingAgentsAppSeams,
    published: PublishedCache,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const { userId, agent } = yield* reachedAgent(seams, request);
    const pullRequest = yield* askedPullRequest(published, userId, agent, request);
    if (pullRequest === null) {
      const none: PullRequestViewedAnswer = { outcome: PULL_REQUEST_WRITE_OUTCOME.DONE, files: [] };
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, none);
    }
    const read = yield* memberPullRequestWrite(userId, agent, pullRequest.number, (member) =>
      pullRequestViewedStates(member.token, member.repository, member.number),
    );
    const answer: PullRequestViewedAnswer =
      read.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE
        ? { outcome: read.outcome, files: read.value }
        : read;
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
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

/** GET reads what waits on the developer across the account's tasks past the cursor: every open item, held open while nothing changed, the archived tasks holding items listed too where `archived=include` asks. */
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
  const archived =
    new URL(request.url).searchParams.get(ACCOUNT_INBOX_QUERY.ARCHIVED) ===
    ACCOUNT_INBOX_ARCHIVED.INCLUDE;
  const page = yield* hostedStoreOrUnavailable(accountInboxPast(userId, after, { archived }));
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
  // An item put away with its task is read but not answered, whether or not its agent would hear it, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_ANSWER_BODY_BYTES);
  const asked = readEither(inboxAnswerRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { revision, clientKey, attachments = [], ...reply } = asked.success;
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    stored.value.answerKey === clientKey
      ? Effect.void
      : recordServerEvent(SERVER_EVENT.INBOX_ANSWER_SEND, userId, {});
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
    yield* counted;
    return inboxAnswered(taken, true);
  }
  const answer = taken.answer;
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
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
  // Counted only once the hand-off stands, since a failed one withdraws the answer above.
  yield* counted;
  return inboxAnswered(taken, true);
});

/** A close is a revision and a key, so a few hundred bytes hold it. */
const MAXIMUM_INBOX_CLOSE_BODY_BYTES = 1_024;

/**
 * POST closes one open item of a task of the account's workspaces without
 * an answer, whichever member started its agent, at the revision the member
 * was shown, and answers as an answer does: the item as it then stands, and
 * whether the close was taken, which it is not where the agent changed the
 * item first or it was settled already. A close taken is handed to the
 * agent, under its own lead, only where the item asks to be heard back, so
 * an agent waiting on it is not left waiting; otherwise the agent reads it
 * the next time it reads its inbox. A hand-off that fails, is interrupted,
 * or dies opens the item again, so it never reads closed while an agent
 * waiting on it was not told; a close sent again under the key it was taken
 * by is handed off again, which the steer's own key makes reach the agent
 * once. An agent whose session has ended for good can hear nothing again,
 * so its item stays closed.
 */
const inboxCloseEndpoint = /* @__PURE__ */ Effect.fn("web/inboxCloseEndpoint")(function* (
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
  // An item put away with its task is read but not closed, as it is not answered, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_INBOX_CLOSE_BODY_BYTES);
  const asked = readEither(inboxCloseRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { revision, clientKey } = asked.success;
  const { item, answerKey } = stored.value;
  // A close sent again is the one taken only while the item still stands as that close left it, never once its agent moved it on.
  const retried =
    answerKey === clientKey &&
    item.status === INBOX_STATUS.CLOSED &&
    item.closedReason === undefined &&
    item.revision === revision;
  const taken = retried
    ? item
    : item.status !== INBOX_STATUS.OPEN || item.revision !== revision
      ? undefined
      : Option.getOrUndefined(
          yield* hostedStoreOrUnavailable(
            closeInboxItemAsMember(userId, itemId, revision, clientKey),
          ),
        );
  if (taken === undefined) {
    // Not taken: the item moved on, or an answer or a close settled it; it is answered as it now stands.
    const now = yield* hostedStoreOrUnavailable(readInboxItem(userId, itemId));
    if (Option.isNone(now)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return inboxAnswered(now.value.item, false);
  }
  if (!taken.needsReply) return inboxAnswered(taken, true);
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, taken.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxClosedMessage(taken),
      attachments: [],
      clientKey,
      sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    });
  });
  yield* handedOver.pipe(
    Effect.catchIf(retiredRefusal, () => Effect.void),
    Effect.onError(() =>
      withdrawInboxClose(userId, itemId, clientKey).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      ),
    ),
  );
  return inboxAnswered(taken, true);
});

/** A message is its words, the files a message may carry, and the answer it may carry: the words' and the answer's picks and values at JSON's widest escape, the files, and room for the key, the ask, and the steps. */
const MAXIMUM_INBOX_MESSAGE_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_MESSAGE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

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
 * hear nothing again, so its item keeps the message. A message that carries
 * the answer to the thread's open ask is the reply that answers it, as
 * `inboxAnswerByReply` takes one; one without is a plain reply, which never
 * answers, even while an ask stands open.
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
  const { text, clientKey, attachments = [], answers } = asked.success;
  if (answers !== undefined) {
    return yield* inboxAnswerByReply(seams, writer, request, userId, itemId, {
      text,
      clientKey,
      attachments,
      answers,
    });
  }
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
    const eve = yield* eveFor(seams, request, userId);
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

/**
 * A member's reply that answers the thread's open ask, as the window sends
 * one from version 5: the answer taken first, with the reply's words and
 * files, as the member's message that carries it (`answerInboxAsk`), and
 * then, by the rule an answer by revision follows (`inboxAnswerHeard`),
 * handed to the agent under the answer's own lead, its files with it, under
 * the reply's key through the one steer path; otherwise kept for the agent
 * to read in its own time. An item put away with its task is not answered.
 * An answer to an ask the thread no longer holds open, to another message,
 * or one the ask does not take is refused, as a message's request is. A
 * hand-off that fails, is interrupted, or dies takes the answer back, as
 * one by revision does, so the thread never reads answered while the agent
 * was not told; an answer sent again under the key it was taken by is
 * handed off again, which the steer's own key makes reach the agent once.
 * An agent whose session has ended for good can hear nothing again, so its
 * item keeps the answer. It answers as a plain reply does: the item as it
 * then stands.
 */
const inboxAnswerByReply = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CodingAgentsAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  itemId: string,
  sent: {
    readonly text: string;
    readonly clientKey: string;
    readonly attachments: readonly CodingAgentAttachment[];
    readonly answers: InboxAnswers;
  },
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, AgentsServices> {
  const { text, clientKey, attachments, answers } = sent;
  // An item put away with its task is read but not answered, as an answer by revision is not, until the task is back.
  if (yield* hostedStoreOrUnavailable(inboxItemArchived(userId, itemId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.TASK_ARCHIVED);
  }
  const answered = yield* hostedStoreOrUnavailable(
    answerInboxAsk(userId, itemId, { answers, text, clientKey, files: attachments }),
  );
  if (Option.isNone(answered)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { item, outcome } = answered.value;
  if (outcome === INBOX_ASK_ANSWER.NOT_OPEN || outcome === INBOX_ASK_ANSWER.REFUSED) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const messaged = hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { item });
  // An answer sent again under the key it was taken under is the same answer, counted once.
  const counted =
    outcome === INBOX_ASK_ANSWER.TAKEN
      ? recordServerEvent(SERVER_EVENT.INBOX_ANSWER_SEND, userId, {})
      : Effect.void;
  const reply = inboxAnswersReply(answers, text);
  if (!inboxAnswerHeard(item, reply, attachments)) {
    yield* counted;
    return messaged;
  }
  const handedOver = Effect.gen(function* () {
    const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, item.agentId));
    if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
    const eve = yield* eveFor(seams, request, userId);
    yield* steerCodingAgent(eve, writer, userId, agent.value, {
      text: inboxAnswerMessage(item, reply),
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
  // Counted only once the hand-off stands, since a failed one withdraws the answer above.
  yield* counted;
  return messaged;
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
          AGENTS_PATH.PULL_REQUEST_VIEWED,
          hostedRefusing(pullRequestViewedEndpoint(seams, published)),
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
          AGENTS_PATH.INBOX_CLOSE,
          hostedRefusing(inboxCloseEndpoint(seams, writer)),
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
