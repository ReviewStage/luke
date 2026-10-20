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
 * or 200 for the one a retry under the same key made before. A change
 * (`PATCH /api/agents/{id}`) names one of a title, an archive, a pin, the
 * MCP servers switched off, or a model and effort, and answers the agent as
 * it then stands.
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
  archiveCodingAgent,
  listCodingAgents,
  listWorkspaceCodingAgents,
  pinCodingAgent,
  renameCodingAgent,
  updateCodingAgentChoice,
  updateCodingAgentServers,
} from "@luke/database/models/coding-agent-store";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { readTask } from "@luke/database/models/task-store";
import { isWorkspaceMember, readAccountNames } from "@luke/database/models/workspace-store";
import { storeWriter } from "@luke/database/models/writer";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_LIST_ARCHIVED,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { AGENT_START_STATUS } from "@luke/features/contract";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { Clock, Effect, type Layer, Option, Result } from "effect";
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
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import type { ModelChoiceRefused } from "../providers/model-catalog.js";
import { pathUuid, reachedAgentById } from "./agent-reach.js";
import { askedPullRequest, githubReadRefusal, pullRequestNumberOf } from "./asked-pull-request.js";
import type { EveTypedTurn } from "./brain-host/eve-sessions.js";
import {
  agentPullRequestReach,
  instancePublishedCache,
  type PublishedReach,
} from "./coder-host/published.js";
import { productionSummaryModel, type SummaryModelOf } from "./coder-host/replay-summary.js";
import { acceptedAgentChoice, startRequestedAgent } from "./coder-host/start.js";
import {
  codingAgentPage,
  codingAgentSummary,
  pageAccounts,
  summaryAccounts,
} from "./coder-host/status.js";
import {
  continuedByOf,
  type EveReach,
  eveFor,
  standingsOf,
  stoppedForGood,
  stoppedTurn,
  summaryOf,
} from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./terminal/agent-sandbox.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

export interface AgentsProcedureSeams extends EveReach, PublishedReach {
  resolveUserId: UserIdResolver;
  /** The agent's sandbox as the shells reach it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient>;
  /** The model a Start from another agent summarizes the steps it cannot keep on; the deployment's own (`coder-host/replay-summary.ts`) where none is named. */
  summaryModel?: SummaryModelOf;
}

/** The most agents a workspace's list answers: enough to choose one an automation's runs go to. */
const WORKSPACE_AGENTS_LIMIT = 50;

/** A choice the catalog refused is an invalid request, on the wire. */
const choiceOrInvalid = <A, E, R>(
  effect: Effect.Effect<A, E | ModelChoiceRefused, R>,
): Effect.Effect<A, E | HostedRefusal, R> =>
  Effect.catchTag(effect, "ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST));

/** Whether a list read asks for the archived agents too; a build from before archiving never does. */
function listsArchived(archived: string | undefined): boolean {
  return archived === CODING_AGENT_LIST_ARCHIVED.INCLUDE;
}

/** The agents listed, each with its status, who it names, and what continued it, as the lists answer them. */
const listedSummaries = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agents: readonly Parameters<typeof codingAgentSummary>[0][],
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
 * The agent the path names, still standing, and the eve session its sandbox
 * is tagged with, or none where the agent has not run yet. An archived agent
 * is gone, as its tab is.
 */
const reachedSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<string | undefined, HostedRefusal, DatabaseServices> {
  const { agent } = yield* reachedAgentById(userId, id);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  return session?.sessionId;
});

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

/** The agents resource: every procedure to a signed-in caller, a body read under its own cap. */
export function agentsProcedures(seams: AgentsProcedureSeams) {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  // The kept published answers, shared with the pull request procedures where the router hands them, so a change there lets go of what `changes` read.
  const published = seams.published ?? instancePublishedCache();
  const signedIn = hosted.agents.use(accountMiddleware(seams.resolveUserId));
  const inSandbox = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provide(effect, seams.sandbox);
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
        listWorkspaceCodingAgents(context.userId, workspaceId, {
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
      const task = yield* hostedStoreOrUnavailable(readTask(context.userId, taskId));
      if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const agents = yield* hostedStoreOrUnavailable(
        listCodingAgents(context.userId, taskId, {
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
      const environment = yield* HostedEnvironment;
      const summaryModel: SummaryModelOf =
        seams.summaryModel ??
        ((owner, chosen, effort) =>
          productionSummaryModel(owner, chosen, effort).pipe(
            Effect.provideService(HostedEnvironment, environment),
          ));
      const { agent, created } = yield* startRequestedAgent(
        eveFor<EveTypedTurn>(seams, context.request, context.userId),
        context.userId,
        taskId,
        input.body,
        summaryModel,
      );
      return {
        status: created ? AGENT_START_STATUS.CREATED : AGENT_START_STATUS.STARTED_BEFORE,
        body: { agent },
      };
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
     * account's default is untouched.
     */
    change: signedIn.change.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.params.id);
      const { body } = input;
      if ("title" in body) {
        const { title } = body;
        return yield* changedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            renameCodingAgent(userId, agent.id, title.length === 0 ? null : title),
          ),
        );
      }
      if ("archived" in body) {
        if (body.archived) {
          // An archived agent works on unseen, so a turn still running is stopped before the stamp.
          yield* stoppedForGood(seams, writer, context.request, userId, agent);
        }
        return yield* changedAgent(
          userId,
          yield* hostedStoreOrUnavailable(archiveCodingAgent(userId, agent.id, body.archived)),
        );
      }
      if ("pinned" in body) {
        return yield* changedAgent(
          userId,
          yield* hostedStoreOrUnavailable(
            pinCodingAgent(userId, agent.id, body.pinned, body.position),
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
      const choice = yield* choiceOrInvalid(acceptedAgentChoice(userId, body));
      return yield* changedAgent(
        userId,
        yield* hostedStoreOrUnavailable(updateCodingAgentChoice(userId, agent.id, choice)),
      );
    }),
    /** The agent stopped: eve's cancel of the turn under way, then the row's stamp; an agent with no turn running is answered as it stands. */
    stop: signedIn.stop.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      yield* stoppedTurn(seams, writer, context.request, userId, agent);
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
      if (pullRequest === null) return { pullRequest };
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
      const sessionId = yield* reachedSession(context.userId, input.id);
      if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING };
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
