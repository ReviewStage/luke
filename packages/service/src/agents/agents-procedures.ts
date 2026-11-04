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
 * (`PATCH /api/agents/{id}`) names one of a title, an archive, a pin, the
 * MCP servers switched off, or a model and effort, and answers the agent as
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
  archiveAgentCommitted,
  deleteAgent,
  hasRepository,
  listAgentLines,
  listWorkspaceAgentLines,
  nativeRouteOfReached,
  nativeRuntimesOfReached,
  pinAgentCommitted,
  readVisibleAgentWorkspace,
  renameAgentCommitted,
  updateAgentChoiceCommitted,
  updateAgentServersCommitted,
} from "@repo/database/models/agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { heardFromAnotherAccount } from "@repo/database/models/mac-command-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { holdSandbox } from "@repo/database/models/sandbox-terminal-lease";
import { readTaskWorkspace } from "@repo/database/models/task-store";
import { isWorkspaceMember, readAccountNames } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import { runtimeChoiceRefusal } from "@repo/features/agent-runtime-models";
import {
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
import {
  recordServerEvent,
  recordServerEventIn,
  SERVER_AGENT_SETTING,
  SERVER_AGENT_TOOL,
  SERVER_EVENT,
} from "../events/server-events.js";
import { changesPeople, namedReviewOptions } from "../github/github-people.js";
import {
  imageCommits,
  pullRequestByNumber,
  pullRequestFiles,
  pullRequestReviewOptions,
} from "../github/pull-requests.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, writeReceiptMiddleware } from "../orpc/base.js";
import type { ModelChoiceRefused } from "../providers/model-catalog.js";
import { controlsAgent, reachedAgentById } from "./agent-reach.js";
import {
  askedPullRequest,
  githubReadRefusal,
  type PullRequestSubject,
  pullRequestNumberOf,
} from "./asked-pull-request.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedReach,
} from "./coder-host/published.js";
import { productionSummaryModel, type SummaryModelOf } from "./coder-host/replay-summary.js";
import { rewoundAgent } from "./coder-host/rewind.js";
import { routedSessions, runnerChoiceApplied } from "./coder-host/runtime-sessions.js";
import {
  acceptedAgentChoice,
  placeOfAgent,
  requestedChoice,
  startedFromBefore,
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
  stoppedForGood,
  stoppedTurn,
  summaryOf,
} from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import type { EveTypedTurn } from "./eve-host/eve-sessions.js";
import { memoryOnFor } from "./memory-tools.js";
import { retiredBeforeDelete, retiringReach } from "./retire-sessions.js";
import { type SandboxStopReach, stoppedInBackground } from "./session-sandboxes.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./terminal/agent-sandbox.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";
import { offeredWorkspaceTools, runOnMacStanding } from "./workspace-tools.js";

export interface AgentsProcedureSeams extends PublishedReach, SandboxStopReach {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the shells reach it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient | DatabaseServices>;
  /** The model a Start from another agent summarizes the steps it cannot keep on; the deployment's own (`coder-host/replay-summary.ts`) where none is named. */
  summaryModel?: SummaryModelOf;
}

/**
 * How long a developer's resume holds the sandbox it wakes: the Terminal
 * relay's idle bound (`terminal/relay.ts`'s `TERMINAL_RELAY_BOUNDS.IDLE`),
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

/**
 * The agent the path names, still standing: its conversation, which a
 * sandbox's lease is held on, and the eve session its sandbox is tagged
 * with, or none where the agent has not run yet. An archived agent
 * is gone, as its tab is, and one on its starter's own GitHub token gives its
 * sandbox to its starter alone.
 */
const reachedAgentSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<
  { readonly conversationId: string; readonly sessionId: string | undefined },
  HostedRefusal,
  DatabaseServices
> {
  const { agent } = yield* reachedAgentById(userId, id);
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  return { conversationId: agent.conversationId, sessionId: session?.sessionId };
});

/** The eve session alone of the agent the path names, as `reachedAgentSession` reads it. */
const reachedSession = (userId: string, id: string) =>
  Effect.map(reachedAgentSession(userId, id), ({ sessionId }) => sessionId);

/**
 * A sandbox Vercel could not be asked about, as the upstream's refusal a
 * caller may retry, apart from the store's own unavailable, so the tab can
 * say it was the agent's sandbox that did not answer: Vercel Sandbox's API,
 * or tmux in a sandbox that API answered for. The log names the status
 * Vercel answered, where it answered one.
 */
function sandboxOrUpstream<A, R>(
  effect: Effect.Effect<A, SandboxUnavailable, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    Effect.andThen(
      Effect.logWarning(`a terminal's sandbox call failed: ${failure.message}`),
      Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
    ),
  );
}

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
 * and the commits its changed images are read at (`imageCommits`), read
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
    // Note that the pull request itself is read beside its files for its head and base, which its changed images are read at; a read that does not land names neither.
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
    const commits = yield* imageCommits(token, subject.repository, whole, files.files);
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
  // Which of our own tools the agent is offered, by the rules its runtime narrows them by, and whether its `run_on_mac` would run now.
  const workspaceToolsOf = (userId: string, agentId: string) =>
    Effect.gen(function* () {
      const { agent, target } = yield* reachedAgentById(userId, agentId);
      // A member who reaches the agent but not its task reads it as not found, since its transcript is the task's to show.
      const visible = yield* hostedStoreOrUnavailable(readVisibleAgentWorkspace(userId, agent.id));
      if (Option.isNone(visible)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const runtimes = yield* hostedStoreOrUnavailable(
        nativeRuntimesOfReached([agent.conversationId]),
      );
      const memoryOn = yield* memoryOnFor(agent.userId);
      const heard = yield* hostedStoreOrUnavailable(heardFromAnotherAccount(target));
      return {
        tools: offeredWorkspaceTools({
          agent,
          native: runtimes.has(agent.conversationId),
          memoryOn,
          heardFromAnotherAccount: heard,
        }),
        runOnMac: yield* hostedStoreOrUnavailable(runOnMacStanding(target)),
      };
    });
  return {
    /**
     * A workspace's agents, on a task or with none, newest started first,
     * the archived ones left out unless `archived=include` asks, narrowed to
     * one repository where the query names one and to agents whose title or
     * task's name holds the query's words where it names some, as the plan
     * list answers them; a workspace the account is not in is not found, as
     * a plan is.
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
      const agents = yield* hostedStoreOrUnavailable(
        listWorkspaceAgentLines(context.userId, workspaceId, {
          ...(repository === undefined ? undefined : { repository }),
          ...(words === undefined ? undefined : { words }),
          includeArchived: listsArchived(input.archived),
          limit: AGENT_BOUNDS.MAX_WORKSPACE_AGENTS,
        }),
      );
      return yield* listedSummaries(context.userId, agents);
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
     * reaching eve as the developer.
     */
    start: signedIn.start.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      const started = yield* startRequestedAgent(
        routedSessions<EveTypedTurn>(context.userId),
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
      const place = placeOfAgent(source);
      if (place === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
      const started = yield* startRequestedAgent(
        routedSessions<EveTypedTurn>(context.userId),
        context.userId,
        place,
        input.body,
        yield* summaryModelOf,
      );
      return startAnswer(started);
    }),
    /** The agent as its own page, an agent with no task as much as one on a task. */
    read: signedIn.read.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
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
     * `disabledServers` replaces the list of MCP servers switched off for
     * it, which its next turn reads as it starts. A model and effort, and the
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
        const { title } = body;
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            renameAgentCommitted(userId, agent.id, title.length === 0 ? null : title),
          ),
        );
      }
      if ("archived" in body) {
        if (body.archived) {
          // An archived agent works on unseen, so a turn still running is stopped before the stamp.
          yield* stoppedForGood(writer, userId, agent);
        }
        const archived = yield* hostedStoreOrUnavailable(
          archiveAgentCommitted(userId, agent.id, body.archived),
        );
        // The sandbox is stopped, not deleted, once the archive stands, so an unarchive resumes it from its snapshot.
        if (body.archived && Option.isSome(archived)) {
          yield* stoppedInBackground(seams, [agent]);
          // Counted only where this write archived an agent standing unarchived, under the member who archived it.
          if (archived.value.archivedNow) {
            yield* recordServerEvent(
              SERVER_EVENT.AGENT_ARCHIVE,
              { userId, workspaceId: agent.organizationId },
              {
                agent_kind: agent.kind,
              },
            );
          }
        }
        return yield* committedAgent(userId, archived);
      }
      if ("pinned" in body) {
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            pinAgentCommitted(userId, agent.id, body.pinned, body.position),
          ),
        );
      }
      if ("disabledServers" in body) {
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            updateAgentServersCommitted(userId, agent.id, body.disabledServers),
          ),
        );
      }
      const route = Option.getOrUndefined(
        yield* hostedStoreOrUnavailable(nativeRouteOfReached(agent.conversationId)),
      );
      if (runtimeChoiceRefusal(route?.runtime, body, route?.payer) !== undefined) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const choice = yield* choiceOrInvalid(acceptedAgentChoice(userId, body));
      const changed = yield* hostedStoreOrUnavailable(
        updateAgentChoiceCommitted(userId, agent.id, choice),
      );
      if (Option.isSome(changed)) {
        yield* runnerChoiceApplied(changed.value.agent);
        // Counted for each of the two the member's change moved, under the member; a window alone counts none.
        if (choice.model !== agent.model) {
          yield* recordServerEvent(
            SERVER_EVENT.AGENT_SETTINGS_CHANGE,
            { userId, workspaceId: agent.organizationId },
            {
              changed: SERVER_AGENT_SETTING.MODEL,
            },
          );
        }
        if (choice.effort !== agent.effort) {
          yield* recordServerEvent(
            SERVER_EVENT.AGENT_SETTINGS_CHANGE,
            { userId, workspaceId: agent.organizationId },
            {
              changed: SERVER_AGENT_SETTING.EFFORT,
            },
          );
        }
      }
      return yield* committedAgent(userId, changed);
    }),
    /**
     * The agent deleted for good, by the steps a task's delete takes for
     * each of its agents (`tasks-procedures.ts`): stopped for good first,
     * then, under its conversation's lock, its eve session retired
     * (`retire-sessions.ts`), the words said on its calls deleted, its row
     * deleted, and its conversation stamped deleted for the purge. Any
     * member who reaches the agent may delete it, as any member may delete
     * a task. An eve that refuses the Stop, an agent with a turn still
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
    /** The agent stopped: eve's cancel of the turn under way, then the row's stamp; an agent with no turn running is answered as it stands. */
    stop: signedIn.stop.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      const stopped = yield* stoppedTurn(writer, userId, agent);
      // Counted only where the Stop stopped a turn, under the member who pressed it.
      if (stopped) {
        yield* recordServerEvent(
          SERVER_EVENT.AGENT_STOP,
          { userId, workspaceId: agent.organizationId },
          { agent_kind: agent.kind },
        );
      }
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
     * names (`github-people.ts`), and the commits its changed images are read
     * at (`imageCommits`), read from GitHub afresh on a token minted for the
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
