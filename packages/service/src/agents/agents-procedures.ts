/**
 * agents-procedures.ts -- a coding agent as the desktop lists, starts, reads, changes, and stops it, its changes, its review options, and its shells, on the hosted oRPC router.
 *
 * Every procedure resolves the caller before it reads its input, and every
 * row it touches is one of a workspace the caller's account is a member
 * of: a task or an agent of any other workspace answers exactly as one
 * that names nothing, and an id that is no UUID names nothing too
 * (`agent-reach.ts`). What each answers is said of it in
 * `agents-app.ts`'s header, the group these moved from, and of the
 * shells below.
 *
 * A Start (`POST /api/plans/{id}/agents`) takes the one path a start takes
 * (`coder-host/start.ts`), reaching the agent's sessions for the account
 * the request resolved to (`coder-host/runtime-sessions.ts`), and answers
 * 201 for the agent it made or 200 for the one a retry under the same key
 * made before; a blank one hands the agent nothing. A Start from an agent
 * (`POST /api/agents/{id}/agents`) takes the same path in the place that
 * agent stands in, its task or, with none, its workspace and repository,
 * and answers alike. The calls into an agent
 * (`GET /api/agents/{id}/calls`) are read as a task's are, by the agent. A change
 * (`PATCH /api/agents/{id}`) names one of a title, an archive, a pin, a
 * read mark, the MCP servers switched off, or a model and effort, and answers the agent as
 * it then stands. A delete (`DELETE /api/agents/{id}`) takes the agent for
 * good by the task delete's own steps, for any member who reaches it.
 *
 * The shells (`/api/agents/{id}/terminals`) are the agent's Terminal tab's:
 * listed, started, named, and ended in its sandbox, and the sandbox resumed
 * on the developer's click and nothing else; a list never wakes a stopped
 * sandbox, a shell starts only in a running one, and an archived agent's
 * shells are gone. Nothing here reads or writes a byte of what a shell
 * printed: a list is each shell's name, foreground command, and folder,
 * read from tmux in the sandbox (`terminal/`).
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { agentOwnerFactsOf } from "@repo/database/models/agent-owners";
import {
  type Agent,
  type AgentCommitted,
  type AgentLine,
  deleteAgent,
  hasRepository,
  listAgentLines,
  listWorkspaceAgentLines,
  markAgentReadCommitted,
  nativeRouteOfReached,
  readVisibleAgentWorkspace,
} from "@repo/database/models/agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { readTaskWorkspace } from "@repo/database/models/task-store";
import { isWorkspaceMember, readAccountNames } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import { runtimeChoiceRefusal } from "@repo/features/agent-runtime-models";
import {
  AGENT_ARCHIVER,
  AGENT_BOUNDS,
  AGENT_LIST_ARCHIVED,
  type AgentPullRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { AGENT_START_STATUS } from "@repo/features/contract";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import { Clock, Duration, Effect, type Layer, Option, type Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import { recordServerEventIn, SERVER_AGENT_TOOL, SERVER_EVENT } from "../events/server-events.js";
import { changesPeople, namedReviewOptions } from "../github/github-people.js";
import {
  pullRequestByNumber,
  pullRequestFiles,
  pullRequestReviewOptions,
  readCommits,
} from "../github/pull-requests.js";
import { afterResponse } from "../http/after-response.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";
import type { ModelChoiceRefused } from "../providers/model-catalog.js";
import { archivedAgent, changedAgent } from "./agent-change.js";
import { reachedAgentById } from "./agent-reach.js";
import {
  askedPullRequest,
  githubReadRefusal,
  type PullRequestSubject,
  pullRequestNumberOf,
} from "./asked-pull-request.js";
import { queueAtTouch } from "./coder-host/agent-queue.js";
import { addAgentRepository } from "./coder-host/agent-repository-add.js";
import { settleLapsedRunner } from "./coder-host/lapsed-runner.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedReach,
} from "./coder-host/published.js";
import { productionSummaryModel, type SummaryModelOf } from "./coder-host/replay-summary.js";
import { rewoundAgent } from "./coder-host/rewind.js";
import { routedSessions } from "./coder-host/runtime-sessions.js";
import {
  acceptedAgentChoice,
  placeOfAgent,
  requestedChoice,
  startRequestedAgent,
} from "./coder-host/start.js";
import {
  agentPage,
  agentSummary,
  pageAccounts,
  startedBlank,
  summaryAccounts,
  summaryDevices,
} from "./coder-host/status.js";
import {
  continuedByOf,
  standingsOf,
  standsStopped,
  stoppedAgent,
  stoppedForGood,
  summaryOf,
} from "./coder-host/stop.js";
import { startedFromBefore } from "./coder-host/takeover.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { retiredBeforeDelete, retiringReach } from "./retire-sessions.js";
import type { SandboxStopReach } from "./session-sandboxes.js";
import type { TypedTurn } from "./sessions/agent-sessions.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";
import { listedPage } from "./workspace-agents.js";
import { runOnMacStanding } from "./workspace-tools.js";

export interface AgentsProcedureSeams extends PublishedReach, SandboxStopReach {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the shells reach it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient | DatabaseServices>;
  /** The model a Start from another agent summarizes the steps it cannot keep on; the deployment's own (`coder-host/replay-summary.ts`) where none is named. */
  summaryModel?: SummaryModelOf;
}

/**
 * How long a developer's resume holds the sandbox it wakes: five minutes,
 * since a resume is a Terminal about to attach, whose own lease takes over
 * within seconds; one that never attaches is stopped by the lease sweep once
 * this lapses past its grace, rather than at Vercel's timeout.
 */
const RESUME_HOLD = Duration.minutes(5);

/** A choice the catalog refused is an invalid request, on the wire. */
const choiceOrInvalid = <A, E, R>(
  effect: Effect.Effect<A, E | ModelChoiceRefused, R>,
): Effect.Effect<A, E | HostedRefusal, R> =>
  Effect.catchTag(effect, "ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST));

/** Whether a list read asks for the archived agents too; a build from before archiving never does. */
function listsArchived(archived: string | undefined): boolean {
  return archived === AGENT_LIST_ARCHIVED.INCLUDE;
}

/** The agents listed, each read as its line, with its status, who it names, and what continued it, as the lists answer them. */
const listedSummaries = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agents: readonly AgentLine[],
): Effect.fn.Return<{ agents: AgentSummary[] }, HostedRefusal, DatabaseServices> {
  const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
  const names = yield* hostedStoreOrUnavailable(readAccountNames(agents.flatMap(summaryAccounts)));
  const continuedBy = yield* continuedByOf(
    userId,
    agents.map((agent) => agent.id),
  );
  const macs = yield* hostedStoreOrUnavailable(devicesNamed(summaryDevices(agents)));
  const owners = yield* hostedStoreOrUnavailable(agentOwnerFactsOf(agents));
  const now = yield* Clock.currentTimeMillis;
  return {
    agents: agents.map((agent) =>
      agentSummary(
        agent,
        standing(agent.conversationId),
        now,
        names,
        owners,
        continuedBy(agent.id),
        macs,
      ),
    ),
  };
});

/**
 * An agent as a write left it, answered with the transaction the write
 * committed in where it changed a row, as Neon's mutations guide says, so a
 * desktop following the task list waits for it to arrive before it
 * confirms the write.
 */
const committedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  changed: Option.Option<AgentCommitted>,
): Effect.fn.Return<{ agent: AgentSummary; txid?: string }, HostedRefusal, DatabaseServices> {
  if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const agent = yield* summaryOf(userId, changed.value.agent);
  const { txid } = changed.value;
  return txid === undefined ? { agent } : { agent, txid };
});

/** The session alone of the agent the path names, as `reachedAgentSession` reads it. */
const reachedSession = (userId: string, id: string) =>
  Effect.map(reachedAgentSession(userId, id), ({ sessionId }) => sessionId);

/** Why a shell could not be had, as the refusal the route answers. */
function shellRefusal(refusal: ShellRefusal): HostedRefusal {
  if (refusal.kind === SHELL_REFUSAL.NOT_FOUND) return HOSTED_REFUSAL.NOT_FOUND;
  return refusal.sandbox === SANDBOX_STATE.STARTING
    ? HOSTED_REFUSAL.AGENT_NOT_READY
    : HOSTED_REFUSAL.SANDBOX_STOPPED;
}

/** The agent's shells as they stand now, the answer every change returns too. */
const listedShells = /* @__PURE__ */ Effect.fnUntraced(function* (sessionId: string | undefined) {
  if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING, terminals: [] };
  const sandbox = yield* AgentSandbox;
  return yield* sandboxOrUpstream(sandbox.terminals(sessionId));
});

/** Whether the agent, read again under its conversation's lock, still stands as a Stop left it, as a task's archive reads each of its own. */
function agentStandsStopped(agent: Agent) {
  return standsStopped([
    {
      id: agent.id,
      conversationId: agent.conversationId,
      createdAt: agent.createdAt,
      blank: startedBlank(agent),
    },
  ]);
}

/**
 * A pull request's changes: its files, who it names (`github-people.ts`),
 * and the commits its changed files are read whole at (`readCommits`), read
 * from GitHub afresh on the token minted for its repository, with who its
 * subject says it writes as. Shared with the reads of a pull request by
 * its repository (`github/repository-pull-request-procedures.ts`).
 */
export const pullRequestChangesRead = (
  token: Redacted.Redacted,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
) =>
  Effect.gen(function* () {
    // Note that the pull request itself is read beside its files for its head and base, which its changed files are read whole at; a read that does not land names neither.
    const [files, people, whole] = yield* Effect.all(
      [
        pullRequestFiles(token, subject.repository, pullRequest),
        changesPeople(token, subject, pullRequest.number),
        Effect.orElseSucceed(
          pullRequestByNumber(token, subject.repository, pullRequest.number),
          () => Option.none(),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const commits = yield* readCommits(token, subject.repository, whole, files.files);
    return {
      url: pullRequest.url,
      ...commits,
      ...files,
      ...people,
      ...(subject.author === null ? undefined : { writtenAs: subject.author }),
    };
  });

/** The agents resource: every procedure to a signed-in caller, a body read under its own cap. */
export function agentsProcedures(seams: AgentsProcedureSeams) {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  // The kept published answers, shared with the pull request procedures where the router hands them, so a change there lets go of what `changes` read.
  const published = seams.published ?? instancePublishedCache();
  const signedIn = hosted.agents.use(accountMiddleware(seams.resolveUserId));
  const inSandbox = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provide(effect, seams.sandbox);
  const summaryModelOf = Effect.map(
    HostedEnvironment,
    (environment): SummaryModelOf =>
      seams.summaryModel ??
      ((owner, chosen, effort) =>
        productionSummaryModel(owner, chosen, effort).pipe(
          Effect.provideService(HostedEnvironment, environment),
        )),
  );
  // A Start answers 201 for the agent it made, 200 for the one a retry under its key made before.
  const startAnswer = (started: {
    readonly agent: AgentSummary;
    readonly created: boolean;
    readonly txid?: string;
  }) => ({
    status: started.created ? AGENT_START_STATUS.CREATED : AGENT_START_STATUS.STARTED_BEFORE,
    body: {
      agent: started.agent,
      ...(started.txid === undefined ? undefined : { txid: started.txid }),
    },
  });
  // Whose Mac the agent's `run_on_mac` runs on, and whether it would run there now.
  const workspaceToolsOf = (userId: string, agentId: string) =>
    Effect.gen(function* () {
      const { agent, target } = yield* reachedAgentById(userId, agentId);
      // A member who reaches the agent but not its task reads it as not found, since its transcript is the task's to show.
      const visible = yield* hostedStoreOrUnavailable(readVisibleAgentWorkspace(userId, agent.id));
      if (Option.isNone(visible)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const runOnMac = yield* hostedStoreOrUnavailable(runOnMacStanding(agent, target));
      return runOnMac === undefined ? {} : { runOnMac };
    });
  return {
    /**
     * A workspace's agents, on a task or with none, newest started first,
     * the archived ones left out unless `archived=include` asks, narrowed to
     * one repository where the query names one and to agents whose title or
     * task's name holds the query's words where it names some, as the plan
     * list answers them, a page at a time from the query's `offset` with the
     * next page's offset where more stand, as the agent tools' list pages
     * (`workspace-agents.ts`); a workspace the account is not in is not
     * found, as a plan is.
     */
    listOfWorkspace: signedIn.listOfWorkspace.effect(function* ({ input, context }) {
      const workspaceId = input.workspaceId ?? "";
      const { repository } = input;
      const words = input.words?.trim();
      if (
        workspaceId === "" ||
        repository === "" ||
        words === "" ||
        (words?.length ?? 0) > AGENT_BOUNDS.MAX_SEARCH_CHARS
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const offset = input.offset ?? 0;
      const listed = yield* hostedStoreOrUnavailable(
        listWorkspaceAgentLines(context.userId, workspaceId, {
          ...(repository === undefined ? undefined : { repository }),
          ...(words === undefined ? undefined : { words }),
          includeArchived: listsArchived(input.archived),
          offset,
          // One past the bound tells whether a next page stands.
          limit: AGENT_BOUNDS.MAX_WORKSPACE_AGENTS + 1,
        }),
      );
      const { page, nextOffset } = listedPage(listed, offset, AGENT_BOUNDS.MAX_WORKSPACE_AGENTS);
      const summaries = yield* listedSummaries(context.userId, page);
      return nextOffset === null ? summaries : { ...summaries, nextOffset };
    }),
    /** The task's agents with their status. */
    listOfTask: signedIn.listOfTask.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const workspace = yield* hostedStoreOrUnavailable(readTaskWorkspace(context.userId, taskId));
      if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const agents = yield* hostedStoreOrUnavailable(
        listAgentLines(context.userId, taskId, {
          includeArchived: listsArchived(input.archived),
        }),
      );
      return yield* listedSummaries(context.userId, agents);
    }),
    /**
     * An agent started on the task, or the one a retry under the same key
     * already started, on the one start path (`coder-host/start.ts`),
     * reaching the agent's sessions as the developer.
     */
    start: signedIn.start.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      const started = yield* startRequestedAgent(
        routedSessions<TypedTurn>(context.userId),
        context.userId,
        { taskId },
        input.body,
        yield* summaryModelOf,
      );
      return startAnswer(started);
    }),
    /**
     * An agent started from the one the path names, which the body's `from`
     * must name too, in that agent's own place: its task, or its workspace
     * and repository where it has none, on the one start path, so the reach,
     * the key, and the replay are a task's Start's. A source the account does
     * not reach is not found, as one of another task is.
     */
    startFrom: signedIn.startFrom.effect(function* ({ input, context }) {
      const sourceId = yield* pathUuid(input.params.id);
      if (input.body.from?.agentId !== sourceId) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      // A choice is read first, so a request refused for it is refused on a retry too.
      yield* requestedChoice(input.body);
      // A retry is answered with the agent its key made before the source is read, which may be gone since.
      const made = yield* startedFromBefore(
        context.userId,
        input.body.idempotencyKey,
        {
          agentId: sourceId,
          ...(input.body.from.messageId === undefined
            ? undefined
            : { messageId: input.body.from.messageId }),
        },
        undefined,
      );
      if (Option.isSome(made)) {
        return startAnswer({ agent: yield* summaryOf(context.userId, made.value), created: false });
      }
      const { agent: source } = yield* reachedAgentById(context.userId, sourceId);
      const started = yield* startRequestedAgent(
        routedSessions<TypedTurn>(context.userId),
        context.userId,
        placeOfAgent(source),
        input.body,
        yield* summaryModelOf,
      );
      return startAnswer(started);
    }),
    /** The agent as its own page, an agent with no task as much as one on a task. */
    read: signedIn.read.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      // An open of the agent settles a turn whose runner stopped posting past its answer, which never
      // waits on the machine it asks, since every reader already reads that turn lost. Where it settled
      // none, the queue a hand-off cut off left claimed is handed on once its claim lapsed; a turn it
      // settled hands on, or pauses, the queue through its own end.
      yield* afterResponse(
        "a lapsed runner's settle",
        Effect.flatMap(settleLapsedRunner(agent), (settled) =>
          settled.length === 0 ? queueAtTouch(routedSessions, agent) : Effect.void,
        ),
      );
      const standing = yield* standingsOf([agent.conversationId]);
      const names = yield* hostedStoreOrUnavailable(readAccountNames(pageAccounts(agent)));
      const continuedBy = yield* continuedByOf(userId, [agent.id]);
      const macs = yield* hostedStoreOrUnavailable(devicesNamed(summaryDevices([agent])));
      const owners = yield* hostedStoreOrUnavailable(agentOwnerFactsOf([agent]));
      const now = yield* Clock.currentTimeMillis;
      return {
        agent: agentPage(
          agent,
          standing(agent.conversationId),
          now,
          names,
          owners,
          continuedBy(agent.id),
          macs,
        ),
      };
    }),
    /**
     * The agent changed for what follows, answered as it then stands. A
     * title renames it, written whole, or cleared where it is empty, so the
     * tab falls back to the model's name. `archived` archives the agent,
     * stopping a turn still running first as a Stop does, or brings it back.
     * `pinned` pins it for the asking member alone, or unpins it.
     * `readMark` moves the asking member's own read mark of it.
     * `disabledServers` replaces the list of MCP servers switched off for
     * it, which its next turn reads as it starts. `addRepository` adds a
     * repository beside the ones it works in, checked out and told to it
     * (`agent-repository-add.ts`), refused by why as `update_agent` refuses it. A model and effort, and the
     * standard context window where it is chosen, change what its next step
     * runs on, checked against the catalog as a Start checks its own; a body
     * naming no window puts it back on the model's whole one, and the
     * account's default is untouched. An agent on a provider's own harness
     * takes only what its runtime runs (`agent-runtime-models.ts`), refused
     * as invalid otherwise, and a runner of it that runs is handed the change
     * as a `model` line at once (`runnerChoiceApplied`).
     */
    change: signedIn.change.use(writeReceiptMiddleware).effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.params.id);
      const { body } = input;
      if ("title" in body) {
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(changedAgent(userId, agent, { title: body.title })),
        );
      }
      if ("archived" in body) {
        const why = body.reason === undefined ? undefined : { reason: body.reason };
        return yield* committedAgent(
          userId,
          yield* archivedAgent(seams, writer, userId, agent, body.archived, {
            by: AGENT_ARCHIVER.MEMBER,
            userId,
            ...why,
          }),
        );
      }
      if ("pinned" in body) {
        const { pinned, position } = body;
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(changedAgent(userId, agent, { pinned, position })),
        );
      }
      if ("readMark" in body) {
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(markAgentReadCommitted(userId, agent.id, body.readMark)),
        );
      }
      if ("disabledServers" in body) {
        const { disabledServers } = body;
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(changedAgent(userId, agent, { disabledServers })),
        );
      }
      if ("addRepository" in body) {
        // The member adds it as `update_agent` does, and the agent hears it in its conversation.
        const added = yield* addAgentRepository({ userId }, agent, body.addRepository, {
          agentSessions: yield* routedSessions<TypedTurn>(userId),
          writer,
          clientKey: randomUUID(),
        });
        return { agent: yield* summaryOf(userId, agent), addedCheckout: added.checkout };
      }
      const route = Option.getOrUndefined(
        yield* hostedStoreOrUnavailable(nativeRouteOfReached(agent.conversationId)),
      );
      if (runtimeChoiceRefusal(route?.runtime, body, route?.payer) !== undefined) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const choice = yield* choiceOrInvalid(acceptedAgentChoice(userId, body));
      const changed = yield* hostedStoreOrUnavailable(changedAgent(userId, agent, { choice }));
      return yield* committedAgent(userId, changed);
    }),
    /**
     * The agent deleted for good, by the steps a task's delete takes for
     * each of its agents (`tasks-procedures.ts`): stopped for good first,
     * then, under its conversation's lock, its session retired
     * (`retire-sessions.ts`), the words said on its calls deleted, its row
     * deleted, and its conversation stamped deleted for the purge. Any
     * member who reaches the agent may delete it, as any member may delete
     * a task. A harness that refuses the Stop, an agent with a turn still
     * coming that no Stop can name yet, or one a message woke after the
     * Stop, stands and is refused as not ready.
     */
    delete: signedIn.delete.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      const retiring = yield* retiringReach(userId);
      yield* stoppedForGood(writer, userId, agent);
      const deleted = yield* hostedStoreOrUnavailable(
        deleteAgent(userId, agent.id, {
          standsStopped: agentStandsStopped,
          beforeDelete: retiredBeforeDelete(retiring),
        }).pipe(Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined))),
      );
      if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deleted: true as const, txid: deleted.value.txid };
    }),
    /** The agent stopped: the harness's cancel of the turn under way, then the row's stamp; an agent with no turn running is answered as it stands. */
    stop: signedIn.stop.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      yield* stoppedAgent(writer, userId, agent);
      return { agent: yield* summaryOf(userId, agent) };
    }),
    /** The agent taken back to just before one of the developer's lines (`rewind.ts`), answered as it then stands. */
    rewind: signedIn.rewind.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.params.id);
      yield* rewoundAgent(userId, agent, input.body.messageId);
      return { agent: yield* summaryOf(userId, agent) };
    }),
    /**
     * The agent's changes: the files of the pull request its kept published
     * answer names, or the one of its repository the query numbers, who it
     * names (`github-people.ts`), and the commits its changed files are read
     * whole at (`readCommits`), read from GitHub afresh on a token minted for the
     * agent's repository on its task's workspace installation, with who its
     * row says it writes as; none where it names no pull request yet.
     */
    changes: signedIn.changes.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      const number = yield* pullRequestNumberOf(input.number === undefined ? [] : [input.number]);
      const pullRequest = yield* askedPullRequest(yield* published, userId, agent, number);
      if (pullRequest === null || !hasRepository(agent)) return { pullRequest: null };
      const changes = yield* githubReadRefusal(
        Effect.gen(function* () {
          const { token } = yield* agentPullRequestReach(userId, agent);
          return yield* pullRequestChangesRead(token, agent, pullRequest);
        }),
      );
      return { pullRequest: changes };
    }),
    /**
     * What the reviewer and label pickers offer, of the agent's repository
     * rather than its pull request, on a token minted for it: its labels, its
     * assignable users named against the workspace's members, and the teams
     * that reach it.
     */
    reviewOptions: signedIn.reviewOptions.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      // An agent with no repository has none to offer reviewers or labels of.
      if (!hasRepository(agent)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
      return yield* githubReadRefusal(
        Effect.gen(function* () {
          const { token } = yield* agentPullRequestReach(userId, agent);
          return yield* namedReviewOptions(
            agent,
            yield* pullRequestReviewOptions(token, agent.repository),
          );
        }),
      );
    }),
    /** Which of our own tools the agent is offered, and whether its `run_on_mac` would run now. */
    workspaceTools: signedIn.workspaceTools.effect(function* ({ input, context }) {
      return yield* workspaceToolsOf(context.userId, input.id);
    }),
    /** The agent's sandbox resumed from its snapshot, the developer's click and nothing else, answering where it stands after. */
    sandboxResume: signedIn.sandboxResume.effect(function* ({ input, context }) {
      const { conversationId, sessionId } = yield* reachedAgentSession(context.userId, input.id);
      if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING };
      // The resume is held before it is asked, so a sandbox woken for a Terminal that never attaches is stopped by the lease sweep.
      const now = yield* Clock.currentTimeMillis;
      yield* hostedStoreOrUnavailable(
        holdSandbox(conversationId, new Date(now + Duration.toMillis(RESUME_HOLD))),
      );
      return yield* inSandbox(
        Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          return { sandbox: yield* sandboxOrUpstream(sandbox.resume(sessionId)) };
        }),
      );
    }),
    /** The agent's shells and where its sandbox stands. */
    terminals: signedIn.terminals.effect(function* ({ input, context }) {
      const sessionId = yield* reachedSession(context.userId, input.id);
      return yield* inSandbox(listedShells(sessionId));
    }),
    /** A shell started in the agent's running sandbox, under an id the service mints. */
    openTerminal: signedIn.openTerminal.effect(function* ({ input, context }) {
      const sessionId = yield* reachedSession(context.userId, input.params.id);
      if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      const { title } = input.body;
      const opened = yield* inSandbox(
        Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          const started = yield* sandboxOrUpstream(sandbox.start(sessionId, randomUUID(), title));
          if (Result.isFailure(started)) return yield* Effect.fail(shellRefusal(started.failure));
          return { terminal: started.success };
        }),
      );
      yield* recordServerEventIn(
        SERVER_EVENT.AGENT_TOOL_OPEN,
        context.userId,
        readVisibleAgentWorkspace(context.userId, input.params.id),
        { tool: SERVER_AGENT_TOOL.TERMINAL },
      );
      return opened;
    }),
    /** One shell named anew, answering the shells as they stand after. */
    renameTerminal: signedIn.renameTerminal.effect(function* ({ input, context }) {
      const terminalId = yield* pathUuid(input.params.terminal);
      const sessionId = yield* reachedSession(context.userId, input.params.id);
      if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const { title } = input.body;
      return yield* inSandbox(
        Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          const renamed = yield* sandboxOrUpstream(sandbox.rename(sessionId, terminalId, title));
          if (Result.isFailure(renamed)) return yield* Effect.fail(shellRefusal(renamed.failure));
          return yield* listedShells(sessionId);
        }),
      );
    }),
    /** One shell ended, answering the shells as they stand after. */
    endTerminal: signedIn.endTerminal.effect(function* ({ input, context }) {
      const terminalId = yield* pathUuid(input.terminal);
      const sessionId = yield* reachedSession(context.userId, input.id);
      if (sessionId === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return yield* inSandbox(
        Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          const killed = yield* sandboxOrUpstream(sandbox.kill(sessionId, terminalId));
          if (Result.isFailure(killed)) return yield* Effect.fail(shellRefusal(killed.failure));
          return yield* listedShells(sessionId);
        }),
      );
    }),
  };
}
