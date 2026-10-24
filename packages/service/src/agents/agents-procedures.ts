/**
 * agents-procedures.ts -- a coding agent as the desktop lists, starts, reads, changes, and stops it, its changes, its review options, and its shells, on the hosted oRPC router.
 *
 * Every procedure resolves the caller before it reads its input, and every
 * row it touches is one of a workspace the caller's account is a member
 * of: a task or an agent of any other workspace answers exactly as one
 * that names nothing, and an id that is no UUID names nothing too
 * (`agent-reach.ts`). What each answers is said of it in
 * `coding-agents-app.ts`'s header, the group these moved from, and of the
 * shells below.
 *
 * A Start (`POST /api/plans/{id}/agents`) takes the one path a start takes
 * (`coder-host/start.ts`), reaching eve as the request's own caller
 * (`coder-host/stop.ts`'s `eveFor`), and answers 201 for the agent it made
 * or 200 for the one a retry under the same key made before; a blank one
 * hands the agent nothing and reaches no eve. A Start from an agent
 * (`POST /api/agents/{id}/agents`) takes the same path in the place that
 * agent stands in, its task or, with none, its workspace and repository,
 * and answers alike. The asking member's operator in a workspace
 * (`PUT /api/workspaces/{id}/operator`) is ensured on that same path
 * (`coder-host/operator.ts`), or reset and ensured afresh where the body
 * asks, and answered by its id; it reaches no eve, since an operator is
 * made with no session. The calls into an agent
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
import type { DatabaseServices } from "@luke/database/core/query";
import {
  archiveCodingAgentCommitted,
  type CodingAgent,
  type CodingAgentCommitted,
  type CodingAgentLine,
  deleteCodingAgent,
  hasRepository,
  listCodingAgentLines,
  listWorkspaceCodingAgentLines,
  nativeRuntimesOfReached,
  operatorReplaced,
  pinCodingAgentCommitted,
  renameCodingAgentCommitted,
  updateCodingAgentChoice,
  updateCodingAgentServers,
} from "@luke/database/models/coding-agent-store";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { readTaskWorkspace } from "@luke/database/models/task-store";
import { readAgentTranscript } from "@luke/database/models/transcript-store";
import { isWorkspaceMember, readAccountNames } from "@luke/database/models/workspace-store";
import { storeWriter } from "@luke/database/models/writer";
import { runtimeChoiceRefusal } from "@luke/features/agent-runtime-models";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_LIST_ARCHIVED,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { AGENT_START_STATUS } from "@luke/features/contract";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { Clock, Duration, Effect, type Layer, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
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
import { accountMiddleware, hosted } from "../orpc/base.js";
import type { ModelChoiceRefused } from "../providers/model-catalog.js";
import { controlsAgent, reachedAgentById } from "./agent-reach.js";
import { askedPullRequest, githubReadRefusal, pullRequestNumberOf } from "./asked-pull-request.js";
import type { EveTypedTurn } from "./brain-host/eve-sessions.js";
import { ensureOperator } from "./coder-host/operator.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedReach,
} from "./coder-host/published.js";
import { productionSummaryModel, type SummaryModelOf } from "./coder-host/replay-summary.js";
import { rewoundAgent } from "./coder-host/rewind.js";
import { runnerChoiceApplied } from "./coder-host/runtime-sessions.js";
import {
  acceptedAgentChoice,
  placeOfAgent,
  requestedChoice,
  startedFromBefore,
  startRequestedAgent,
} from "./coder-host/start.js";
import {
  codingAgentPage,
  codingAgentSummary,
  pageAccounts,
  startedBlank,
  summaryAccounts,
} from "./coder-host/status.js";
import {
  continuedByOf,
  type EveReach,
  eveFor,
  standingsOf,
  standsStopped,
  stoppedForGood,
  stoppedTurn,
  summaryOf,
} from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { retiredBeforeDelete, retiringReach } from "./retire-sessions.js";
import { type SandboxStopReach, stoppedInBackground } from "./session-sandboxes.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./terminal/agent-sandbox.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

export interface AgentsProcedureSeams extends EveReach, PublishedReach, SandboxStopReach {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the shells reach it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient>;
  /** The model a Start from another agent summarizes the steps it cannot keep on; the deployment's own (`coder-host/replay-summary.ts`) where none is named. */
  summaryModel?: SummaryModelOf;
}

/** The most agents a workspace's list answers: enough to choose one an automation's runs go to. */
const WORKSPACE_AGENTS_LIMIT = 50;

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
  return archived === CODING_AGENT_LIST_ARCHIVED.INCLUDE;
}

/** The agents listed, each read as its line, with its status, who it names, and what continued it, as the lists answer them. */
const listedSummaries = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agents: readonly CodingAgentLine[],
): Effect.fn.Return<{ agents: CodingAgentSummary[] }, HostedRefusal, DatabaseServices> {
  const standing = yield* standingsOf(agents.map((agent) => agent.conversationId));
  const names = yield* hostedStoreOrUnavailable(readAccountNames(agents.flatMap(summaryAccounts)));
  const continuedBy = yield* continuedByOf(
    userId,
    agents.map((agent) => agent.id),
  );
  const now = yield* Clock.currentTimeMillis;
  return {
    agents: agents.map((agent) =>
      codingAgentSummary(agent, standing(agent.conversationId), now, names, continuedBy(agent.id)),
    ),
  };
});

/** The agent as it then stands, or not found where the row went between the read and the write. */
const changedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  changed: Option.Option<Parameters<typeof summaryOf>[1]>,
): Effect.fn.Return<{ agent: CodingAgentSummary }, HostedRefusal, DatabaseServices> {
  if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return { agent: yield* summaryOf(userId, changed.value) };
});

/**
 * An agent as a write left it, answered with the transaction the write
 * committed in where it changed a row, as Neon's mutations guide says, so a
 * desktop following the task list waits for it to arrive before it
 * confirms the write.
 */
const committedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  changed: Option.Option<CodingAgentCommitted>,
): Effect.fn.Return<{ agent: CodingAgentSummary; txid?: string }, HostedRefusal, DatabaseServices> {
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
function agentStandsStopped(agent: CodingAgent) {
  return standsStopped([
    {
      id: agent.id,
      conversationId: agent.conversationId,
      createdAt: agent.createdAt,
      blank: startedBlank(agent),
    },
  ]);
}

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
    readonly agent: CodingAgentSummary;
    readonly created: boolean;
    readonly txid?: string;
  }) => ({
    status: started.created ? AGENT_START_STATUS.CREATED : AGENT_START_STATUS.STARTED_BEFORE,
    body:
      started.txid === undefined
        ? { agent: started.agent }
        : { agent: started.agent, txid: started.txid },
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
        (words?.length ?? 0) > CODING_AGENT_BOUNDS.MAX_SEARCH_CHARS
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const agents = yield* hostedStoreOrUnavailable(
        listWorkspaceCodingAgentLines(context.userId, workspaceId, {
          ...(repository === undefined ? undefined : { repository }),
          ...(words === undefined ? undefined : { words }),
          includeArchived: listsArchived(input.archived),
          limit: WORKSPACE_AGENTS_LIMIT,
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
        listCodingAgentLines(context.userId, taskId, {
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
        eveFor<EveTypedTurn>(seams, context.request, context.userId),
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
        eveFor<EveTypedTurn>(seams, context.request, context.userId),
        context.userId,
        place,
        input.body,
        yield* summaryModelOf,
      );
      return startAnswer(started);
    }),
    /**
     * The asking member's operator in the workspace the path names, the one
     * standing or one made blank now, after the standing one is archived
     * where the body asks for a Reset, or the member's own archived one
     * the body names brought back in its place (`coder-host/operator.ts`).
     */
    ensureOperator: signedIn.ensureOperator.effect(function* ({ input, context }) {
      const { agent, txid, retired } = yield* ensureOperator(
        eveFor<EveTypedTurn>(seams, context.request, context.userId),
        context.userId,
        input.params.id,
        {
          reset: input.body.reset === true,
          restore: input.body.restore,
          timeZone: input.body.timeZone,
          stopStanding: (standing) =>
            stoppedForGood(seams, writer, context.request, context.userId, standing),
        },
      );
      // The operator a Reset archived has its sandbox stopped, as an archive by hand stops one.
      if (retired !== undefined) yield* stoppedInBackground(seams, [retired]);
      return txid === undefined ? { agentId: agent.id } : { agentId: agent.id, txid };
    }),
    /** The agent as its own page, an agent with no task as much as one on a task. */
    read: signedIn.read.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      const standing = yield* standingsOf([agent.conversationId]);
      const names = yield* hostedStoreOrUnavailable(readAccountNames(pageAccounts(agent)));
      const continuedBy = yield* continuedByOf(userId, [agent.id]);
      const now = yield* Clock.currentTimeMillis;
      return {
        agent: codingAgentPage(
          agent,
          standing(agent.conversationId),
          now,
          names,
          continuedBy(agent.id),
        ),
      };
    }),
    /**
     * What was said on every member's calls into the agent, oldest call
     * first, with each call's record (`readAgentTranscript`): read under
     * the caller's membership of the agent's workspace, so an agent of any
     * other is not found, as one that is no agent is.
     */
    calls: signedIn.calls.effect(function* ({ input, context }) {
      const agentId = yield* pathUuid(input.id);
      const transcript = yield* hostedStoreOrUnavailable(
        readAgentTranscript(context.userId, agentId),
      );
      if (Option.isNone(transcript)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { transcript: transcript.value };
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
    change: signedIn.change.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.params.id);
      const { body } = input;
      if ("title" in body) {
        const { title } = body;
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            renameCodingAgentCommitted(userId, agent.id, title.length === 0 ? null : title),
          ),
        );
      }
      if ("archived" in body) {
        if (body.archived) {
          // An archived agent works on unseen, so a turn still running is stopped before the stamp.
          yield* stoppedForGood(seams, writer, context.request, userId, agent);
        } else if (yield* hostedStoreOrUnavailable(operatorReplaced(userId, agent.id))) {
          // An operator a Reset replaced stays archived while the fresh one stands.
          return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
        }
        const archived = yield* hostedStoreOrUnavailable(
          archiveCodingAgentCommitted(userId, agent.id, body.archived),
        );
        // The sandbox is stopped, not deleted, once the archive stands, so an unarchive resumes it from its snapshot.
        if (body.archived && Option.isSome(archived)) {
          yield* stoppedInBackground(seams, [agent]);
        }
        return yield* committedAgent(userId, archived);
      }
      if ("pinned" in body) {
        return yield* committedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            pinCodingAgentCommitted(userId, agent.id, body.pinned, body.position),
          ),
        );
      }
      if ("disabledServers" in body) {
        return yield* changedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            updateCodingAgentServers(userId, agent.id, body.disabledServers),
          ),
        );
      }
      const runtimes = yield* hostedStoreOrUnavailable(
        nativeRuntimesOfReached([agent.conversationId]),
      );
      if (runtimeChoiceRefusal(runtimes.get(agent.conversationId), body) !== undefined) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      const choice = yield* choiceOrInvalid(acceptedAgentChoice(userId, body));
      const changed = yield* hostedStoreOrUnavailable(
        updateCodingAgentChoice(userId, agent.id, choice),
      );
      if (Option.isSome(changed)) yield* runnerChoiceApplied(changed.value);
      return yield* changedAgent(userId, changed);
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
      const eveAt = yield* retiringReach(seams, context.request, userId);
      yield* stoppedForGood(seams, writer, context.request, userId, agent);
      const deleted = yield* hostedStoreOrUnavailable(
        deleteCodingAgent(userId, agent.id, {
          standsStopped: agentStandsStopped,
          beforeDelete: retiredBeforeDelete(eveAt),
        }).pipe(Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined))),
      );
      if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
      if (Option.isNone(deleted)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deleted: true as const, txid: deleted.value.txid };
    }),
    /** The agent stopped: eve's cancel of the turn under way, then the row's stamp; an agent with no turn running is answered as it stands. */
    stop: signedIn.stop.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      yield* stoppedTurn(seams, writer, context.request, userId, agent);
      return { agent: yield* summaryOf(userId, agent) };
    }),
    /** The agent taken back to just before one of the developer's lines (`rewind.ts`), answered as it then stands. */
    rewind: signedIn.rewind.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.params.id);
      yield* rewoundAgent(seams, writer, context.request, userId, agent, input.body.messageId);
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
      const listed = yield* githubReadRefusal(
        Effect.gen(function* () {
          const { token } = yield* agentPullRequestReach(userId, agent);
          // Note that the pull request itself is read beside its files for its head and base, which its changed images are read at; a read that does not land names neither.
          const [files, people, whole] = yield* Effect.all(
            [
              pullRequestFiles(token, agent.repository, pullRequest),
              changesPeople(token, agent, pullRequest.number),
              Effect.orElseSucceed(
                pullRequestByNumber(token, agent.repository, pullRequest.number),
                () => Option.none(),
              ),
            ],
            { concurrency: "unbounded" },
          );
          const commits = yield* imageCommits(token, agent.repository, whole, files.files);
          return { ...commits, ...files, ...people };
        }),
      );
      return {
        pullRequest: {
          url: pullRequest.url,
          ...listed,
          ...(agent.author === null ? undefined : { writtenAs: agent.author }),
        },
      };
    }),
    /**
     * What the reviewer and label pickers offer, of the agent's repository
     * rather than its pull request, on a token minted for it: its labels, its
     * collaborators named against the workspace's members, and the teams
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
      return yield* inSandbox(
        Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          const started = yield* sandboxOrUpstream(sandbox.start(sessionId, randomUUID(), title));
          if (Result.isFailure(started)) return yield* Effect.fail(shellRefusal(started.failure));
          return { terminal: started.success };
        }),
      );
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
