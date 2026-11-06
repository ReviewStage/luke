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
  nativeRuntimesOfReached,
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
import { addAgentRepository } from "./coder-host/agent-repository-add.js";
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
  stoppedAgent,
  stoppedForGood,
  summaryOf,
} from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import type { EveTypedTurn } from "./eve-host/eve-sessions.js";
import { memoryOnFor } from "./memory-tools.js";
import { descriptionsOnFor } from "./descriptions-on.js";
import { retiredBeforeDelete, retiringReach } from "./retire-sessions.js";
import type { SandboxStopReach } from "./session-sandboxes.js";
import { AgentSandbox, SHELL_REFUSAL, type ShellRefusal } from "./terminal/agent-sandbox.js";
import { reachedAgentSession, sandboxOrUpstream } from "./terminal/sandbox-reach.js";
import { listedPage } from "./workspace-agents.js";
import { offeredWorkspaceTools, runOnMacStanding } from "./workspace-tools.js";

export interface AgentsProcedureSeams extends PublishedReach, SandboxStopReach {
  resolveUserId: UserIdResolver;
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient | DatabaseServices>;
  summaryModel?: SummaryModelOf;
}

const RESUME_HOLD = Duration.minutes(5);

const choiceOrInvalid = <A, E, R>(
  effect: Effect.Effect<A, E | ModelChoiceRefused, R>,
): Effect.Effect<A, E | HostedRefusal, R> =>
  Effect.catchTag(effect, "ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST));

function listsArchived(archived: string | undefined): boolean {
  return archived === AGENT_LIST_ARCHIVED.INCLUDE;
}

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

const committedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  changed: Option.Option<AgentCommitted>,
): Effect.fn.Return<{ agent: AgentSummary; txid?: string }, HostedRefusal, DatabaseServices> {
  if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const agent = yield* summaryOf(userId, changed.value.agent);
  const { txid } = changed.value;
  return txid === undefined ? { agent } : { agent, txid };
});

const reachedSession = (userId: string, id: string) =>
  Effect.map(reachedAgentSession(userId, id), ({ sessionId }) => sessionId);

function shellRefusal(refusal: ShellRefusal): HostedRefusal {
  if (refusal.kind === SHELL_REFUSAL.NOT_FOUND) return HOSTED_REFUSAL.NOT_FOUND;
  return refusal.sandbox === SANDBOX_STATE.STARTING
    ? HOSTED_REFUSAL.AGENT_NOT_READY
    : HOSTED_REFUSAL.SANDBOX_STOPPED;
}

const listedShells = /* @__PURE__ */ Effect.fnUntraced(function* (sessionId: string | undefined) {
  if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING, terminals: [] };
  const sandbox = yield* AgentSandbox;
  return yield* sandboxOrUpstream(sandbox.terminals(sessionId));
});

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

export const pullRequestChangesRead = (
  token: Redacted.Redacted,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
) =>
  Effect.gen(function* () {
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

export function agentsProcedures(seams: AgentsProcedureSeams) {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
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
  const workspaceToolsOf = (userId: string, agentId: string) =>
    Effect.gen(function* () {
      const { agent, target } = yield* reachedAgentById(userId, agentId);
      const visible = yield* hostedStoreOrUnavailable(readVisibleAgentWorkspace(userId, agent.id));
      if (Option.isNone(visible)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const runtimes = yield* hostedStoreOrUnavailable(
        nativeRuntimesOfReached([agent.conversationId]),
      );
      const memoryOn = yield* memoryOnFor(agent.userId);
      const descriptionsOn = yield* descriptionsOnFor(agent.userId, agent.kind);
      return {
        tools: offeredWorkspaceTools({
          agent,
          native: runtimes.has(agent.conversationId),
          memoryOn,
          descriptionsOn,
        }),
        runOnMac: yield* hostedStoreOrUnavailable(runOnMacStanding(target)),
      };
    });
  return {
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
          limit: AGENT_BOUNDS.MAX_WORKSPACE_AGENTS + 1,
        }),
      );
      const { page, nextOffset } = listedPage(listed, offset, AGENT_BOUNDS.MAX_WORKSPACE_AGENTS);
      const summaries = yield* listedSummaries(context.userId, page);
      return nextOffset === null ? summaries : { ...summaries, nextOffset };
    }),
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
    startFrom: signedIn.startFrom.effect(function* ({ input, context }) {
      const sourceId = yield* pathUuid(input.params.id);
      if (input.body.from?.agentId !== sourceId) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }
      yield* requestedChoice(input.body);
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
        routedSessions<EveTypedTurn>(context.userId),
        context.userId,
        placeOfAgent(source),
        input.body,
        yield* summaryModelOf,
      );
      return startAnswer(started);
    }),
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
        const added = yield* addAgentRepository({ userId }, agent, body.addRepository, {
          eve: yield* routedSessions<EveTypedTurn>(userId),
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
    stop: signedIn.stop.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
      yield* stoppedAgent(writer, userId, agent);
      return { agent: yield* summaryOf(userId, agent) };
    }),
    rewind: signedIn.rewind.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.params.id);
      yield* rewoundAgent(userId, agent, input.body.messageId);
      return { agent: yield* summaryOf(userId, agent) };
    }),
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
    reviewOptions: signedIn.reviewOptions.effect(function* ({ input, context }) {
      const { userId, agent } = yield* reachedAgentById(context.userId, input.id);
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
    workspaceTools: signedIn.workspaceTools.effect(function* ({ input, context }) {
      return yield* workspaceToolsOf(context.userId, input.id);
    }),
    sandboxResume: signedIn.sandboxResume.effect(function* ({ input, context }) {
      const { conversationId, sessionId } = yield* reachedAgentSession(context.userId, input.id);
      if (sessionId === undefined) return { sandbox: SANDBOX_STATE.STARTING };
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
    terminals: signedIn.terminals.effect(function* ({ input, context }) {
      const sessionId = yield* reachedSession(context.userId, input.id);
      return yield* inSandbox(listedShells(sessionId));
    }),
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
