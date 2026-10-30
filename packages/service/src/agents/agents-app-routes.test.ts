/**
 * agents-app-routes.test.ts -- the coding-agent routes' Start, list, transcript, and Stop, a blank agent, and an agent's pictures, over a fake eve and a real dialect.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { GITHUB_ACCOUNT_TYPE } from "@luke/database/github-installation-vocabulary";
import { readAccountPreferences } from "@luke/database/models/account-store";
import {
  archiveAgent,
  readAgent,
  readAgentByKey,
  renameAgent,
  updateAgentBranch,
} from "@luke/database/models/agent-store";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import { rewindConversation } from "@luke/database/models/conversation-rewind";
import { registerDevice } from "@luke/database/models/device-store";
import { childConversationId } from "@luke/database/models/ids";
import { writePage } from "@luke/database/models/plan-pages";
import { createTask } from "@luke/database/models/task-store";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { storeWriter } from "@luke/database/models/writer";
import { agentTable } from "@luke/database/schemas/agent";
import { user } from "@luke/database/schemas/auth";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { conversations, messages } from "@luke/database/schemas/storage";
import { task as taskTable } from "@luke/database/schemas/task";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  DEVICE_LAYOUT,
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
  startTask,
} from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  AGENT_BOUNDS,
  AGENT_BRIEF,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentTranscriptMessage,
  agentAnswerSchema,
  agentListAnswerSchema,
  agentMessagesAnswerSchema,
  agentNewestAnswerSchema,
  agentOlderAnswerSchema,
  agentPartAnswerSchema,
  LOCAL_AGENT_REFUSAL,
  PART_CUT_FIELD,
  TRANSCRIPT_PARTS_QUERY,
} from "@luke/features/agent-wire";
import { INBOX_IMAGE_TYPE, inboxAnswerSchema } from "@luke/features/inbox-wire";
import { transcriptNowAnswerSchema } from "@luke/features/live-wire";
import { MENTION_KIND, mentionMarkdown } from "@luke/features/mention-link";
import { AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import { PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { PULL_REQUEST_ACTION } from "@luke/features/pull-request-write-wire";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import { TASK_STATUS, taskListAnswerSchema, taskStartAnswerSchema } from "@luke/features/task-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { and, eq, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import {
  isRecord,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  RUN_EVENT,
  RUN_TURN_ORIGIN,
  sessionKey,
  TURN_ORIGIN,
  TURN_TRIGGER,
} from "../core.js";
import { LINK_OUTCOME, linkInstallation } from "../github/github-installations.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  AGENT_GITHUB_IMAGE,
  AGENT_MESSAGES,
  AGENT_NEWEST,
  AGENT_OVERVIEW,
  AGENT_PICTURE,
  AGENT_PULL_REQUEST,
  AGENT_PULL_REQUEST_ACTION,
  AGENT_PULL_REQUEST_VIEWED,
  type Answer,
  deploymentFor,
  drivenWhileStarting,
  fakeEve,
  freshInstallation,
  ORIGIN,
  openTask,
  PUBLISHED,
  picture,
  publishedPullRequest,
  RELAY,
  RELAY_FULL_NAME,
  reachRequests,
  readAnswer,
  refusal,
  request,
  SAVED,
  SCRIPTED_SVG,
  SNAPSHOT,
  SOL,
  SUBAGENT_MESSAGES,
  SUBAGENT_NEWEST,
  sessionCookieOf,
  standing,
  startAs,
  startedAgent,
  startedAgentOf,
  TASK,
  TASK_AGENTS,
  TASK_INBOX,
  TASKS,
  text,
  transcriptRow,
  WORKSPACE_AGENTS,
  WORKSPACE_STARTS,
} from "../testing/agents-app-support.js";
import { openedPagePolicy, SANDBOXED_PAGE } from "../testing/content-policy.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { CODER } from "./coder-host/bounds.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { EVE_HOST_TURN } from "./eve-host/bounds.js";

it.layer(getTestDB())("the coding-agent routes", (it) => {
  it.effect(
    "a Start whose prompt mentions a page the store cannot read is refused before any agent is made, so a retry under its key starts afresh",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const shown = yield* writePage(
          owner,
          taskPageOwner(task.id),
          { title: "Chart", html: "<h1>Chart</h1>" },
          { kind: PAGE_SHOWER.LUKE },
        );
        assert.ok(Option.isSome(shown));
        const prompt = `Build ${mentionMarkdown({ kind: MENTION_KIND.PAGE, taskId: task.id, pageId: shown.value.id }, "Chart", { workspace: "acme", repository: task.repository })}.`;
        const idempotencyKey = randomUUID();
        const sql = yield* SqlClient.SqlClient;
        // The pages' table is moved aside for the Start alone, so the store's read of the page fails.
        const answered = yield* Effect.ensuring(
          Effect.andThen(
            sql.unsafe("ALTER TABLE plan_page_version RENAME TO plan_page_version_aside"),
            ask(startAs(owner, task.id, { idempotencyKey, task: prompt })),
          ),
          Effect.orDie(
            sql.unsafe("ALTER TABLE plan_page_version_aside RENAME TO plan_page_version"),
          ),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
        assert.ok(Option.isNone(yield* readAgentByKey(owner, idempotencyKey)));
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a workspace's agents are listed newest first for a member, narrowed to a repository whatever its case, and refused for an account outside it or a list naming no workspace",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const start = () =>
          Effect.map(
            ask(
              request(TASK_AGENTS, owner, {
                method: "POST",
                id: task.id,
                body: { idempotencyKey: randomUUID() },
              }),
            ),
            (started) =>
              readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).agent.id,
          );
        const first = yield* start();
        yield* TestClock.adjust(Duration.seconds(1));
        const second = yield* start();
        const listed = (by: string, query: Readonly<Record<string, string>>) => {
          const url = new URL(WORKSPACE_AGENTS, ORIGIN);
          for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
          return ask(new Request(url, { headers: { authorization: `Bearer ${by}` } }));
        };
        const ids = (answered: Answer) =>
          readAnswer(agentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agents.map(
            (agent) => agent.id,
          );

        assert.deepEqual(ids(yield* listed(owner, { workspaceId: task.workspaceId })), [
          second,
          first,
        ]);
        assert.deepEqual(
          ids(yield* listed(owner, { workspaceId: task.workspaceId, repository: "acme/relay" })),
          [second, first],
        );
        assert.deepEqual(
          ids(yield* listed(owner, { workspaceId: task.workspaceId, repository: "acme/other" })),
          [],
        );
        assert.deepEqual(
          [
            (yield* listed(other, { workspaceId: task.workspaceId })).status,
            (yield* listed(owner, {})).status,
          ],
          [HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_HTTP_STATUS.BAD_REQUEST],
        );
      }),
  );

  it.effect(
    "a workspace's list leaves an archived agent out, and lists it marked as archived where archived=include asks",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const kept = yield* startedAgentOf(owner, task.id, ask);
        const put = yield* startedAgentOf(owner, task.id, ask);
        yield* archiveAgent(owner, put.agent.id, true);
        const listed = (query: Readonly<Record<string, string>>) => {
          const url = new URL(WORKSPACE_AGENTS, ORIGIN);
          url.searchParams.set("workspaceId", task.workspaceId);
          for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
          return Effect.map(
            ask(new Request(url, { headers: { authorization: `Bearer ${owner}` } })),
            (answered) =>
              readAnswer(agentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).agents.map(
                (agent) => [agent.id, agent.archivedAt !== undefined],
              ),
          );
        };

        assert.deepEqual(yield* listed({}), [[kept.agent.id, false]]);
        assert.deepEqual(
          (yield* listed({ archived: "include" })).toSorted(([first], [second]) =>
            String(first).localeCompare(String(second)),
          ),
          [
            [kept.agent.id, false],
            [put.agent.id, true],
          ].toSorted(([first], [second]) => String(first).localeCompare(String(second))),
        );
      }),
  );

  it.effect(
    "a workspace's list finds the agents whose title or task's name holds the words, whatever their case, a wildcard in them matched as itself",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const titled = yield* startedAgentOf(owner, task.id, ask);
        const other = yield* startedAgentOf(owner, task.id, ask);
        yield* renameAgent(owner, titled.agent.id, "Ledger 100% sweep");
        yield* renameAgent(owner, other.agent.id, "Unrelated");
        const found = (words: string) => {
          const url = new URL(WORKSPACE_AGENTS, ORIGIN);
          url.searchParams.set("workspaceId", task.workspaceId);
          url.searchParams.set("words", words);
          return Effect.map(
            ask(new Request(url, { headers: { authorization: `Bearer ${owner}` } })),
            (answered) =>
              readAnswer(agentListAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .agents.map((agent) => agent.id)
                .toSorted(),
          );
        };

        assert.deepEqual(yield* found("LEDGER"), [titled.agent.id]);
        assert.deepEqual(yield* found("100%"), [titled.agent.id]);
        assert.deepEqual(yield* found("10_%"), []);
        assert.deepEqual(
          yield* found("teammate invitations"),
          [titled.agent.id, other.agent.id].toSorted(),
          "the task's name finds every agent on it",
        );
      }),
  );

  it.effect(
    "a Start with no choice runs on the account's default, snapshots the plan as Copy would, and opens the session as the developer with the snapshot first",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const key = randomUUID();

        const started = yield* ask(
          request(TASK_AGENTS, owner, {
            method: "POST",
            id: task.id,
            body: { idempotencyKey: key },
          }),
        );

        const { agent } = readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.planId, task.id);
        assert.equal(agent.model, AGENT_DEFAULT_CHOICE.model);
        assert.equal(agent.effort, AGENT_DEFAULT_CHOICE.effort);
        assert.equal(agent.status, AGENT_STATUS.STARTING);
        assert.equal(agent.turnId, null);
        assert.equal(agent.brief, AGENT_BRIEF.PLAN);
        const stored = yield* readAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        assert.equal(stored.value.planSnapshot, SNAPSHOT);
        assert.equal(stored.value.prompt, null);
        assert.equal(stored.value.repository, RELAY_FULL_NAME);
        assert.deepEqual(eve.opened, [
          {
            authorization: `Bearer ${owner}`,
            message: {
              conversationId: stored.value.conversationId,
              turn: EVE_HOST_TURN.TYPED,
              message: SNAPSHOT,
            },
            sessionId: eve.opened[0]?.sessionId ?? "",
          },
        ]);
        // The default stands: nothing was chosen.
        assert.equal(yield* readAccountPreferences(owner), undefined);
      }),
  );

  it.effect(
    "a task's start naming an agent makes the task with an empty plan and starts the agent on it with the prompt, opening its session as the developer, reaching the repository on GitHub once for both, and answers the task in progress",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, installation, github, ask } = yield* openTask();
        const prompt = "Expire invitations after a week.";
        const asked = github.sent.length;

        const started = yield* ask(
          request(TASKS, owner, {
            method: "POST",
            body: {
              workspaceId: task.workspaceId,
              repository: RELAY_FULL_NAME,
              agent: { idempotencyKey: randomUUID(), prompt },
            },
          }),
        );

        const { plan, agent, agentRefusal, txid } = readAnswer(
          taskStartAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          started,
        );
        assert.equal(agentRefusal, undefined);
        assert.ok(agent !== undefined);
        assert.notEqual(plan.id, task.id);
        const db = yield* Database;
        const [written] = yield* db
          .select({ xmin: sql<string>`xmin::text` })
          .from(taskTable)
          .where(eq(taskTable.id, plan.id));
        assert.equal(txid, written?.xmin, "the start answers its last write, the task's standing");
        assert.equal(plan.repository, RELAY_FULL_NAME);
        assert.equal(plan.document.body, "");
        assert.equal(
          plan.status,
          TASK_STATUS.IN_PROGRESS,
          "the task its agent started on is under way",
        );
        assert.equal(agent.planId, plan.id);
        assert.equal(agent.brief, AGENT_BRIEF.PROMPT);
        assert.equal(agent.status, AGENT_STATUS.STARTING);
        assert.deepEqual(
          eve.opened.map((opened) => [opened.authorization, opened.message.message]),
          [[`Bearer ${owner}`, prompt]],
        );
        assert.deepEqual(reachRequests(github.sent.slice(asked), installation.id), {
          installationReads: 1,
          listings: 1,
          listingMints: 1,
          repositoryMints: 0,
        });
      }),
  );

  it.effect(
    "over a browser's session cookie an agent's Start and a task's start naming an agent open the session as the deployment acting for the cookie's account, which no other account's cookie reaches",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, eve, ask } = yield* openTask();
        const cookie = sessionCookieOf(owner);
        const prompt = "Expire invitations after a week.";

        const started = yield* ask(
          request(TASK_AGENTS, undefined, {
            method: "POST",
            id: task.id,
            cookie,
            body: { idempotencyKey: randomUUID() },
          }),
        );
        const withTask = yield* ask(
          request(TASKS, undefined, {
            method: "POST",
            cookie,
            body: {
              workspaceId: task.workspaceId,
              repository: RELAY_FULL_NAME,
              agent: { idempotencyKey: randomUUID(), prompt },
            },
          }),
        );
        const stranger = yield* ask(
          request(TASK_AGENTS, undefined, {
            method: "POST",
            id: task.id,
            cookie: sessionCookieOf(other),
            body: { idempotencyKey: randomUUID() },
          }),
        );

        assert.equal(
          readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).agent.planId,
          task.id,
        );
        assert.equal(
          readAnswer(taskStartAnswerSchema, HOSTED_HTTP_STATUS.CREATED, withTask).agentRefusal,
          undefined,
        );
        assert.deepEqual(
          stranger,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          eve.opened.map((opened) => [opened.authorization, opened.message.message]),
          [
            [deploymentFor(owner), SNAPSHOT],
            [deploymentFor(owner), prompt],
          ],
        );
      }),
  );

  it.effect(
    "a task's start retried under its agent's key answers the task and the agent the first made, and starts neither again; the key named for another workspace is refused",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const team = yield* openWorkspace(owner);
        const body = {
          name: "Invitation expiry",
          workspaceId: task.workspaceId,
          repository: RELAY_FULL_NAME,
          agent: { idempotencyKey: randomUUID(), prompt: "Expire invitations after a week." },
        };
        const startOnce = (status: number) =>
          Effect.map(ask(request(TASKS, owner, { method: "POST", body })), (answered) =>
            readAnswer(taskStartAnswerSchema, status, answered),
          );

        const first = yield* startOnce(HOSTED_HTTP_STATUS.CREATED);
        const again = yield* startOnce(HOSTED_HTTP_STATUS.OK);
        const elsewhere = yield* ask(
          request(TASKS, owner, { method: "POST", body: { ...body, workspaceId: team } }),
        );
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner)),
        );

        assert.equal(again.plan.id, first.plan.id);
        assert.equal(again.agent?.id, first.agent?.id);
        assert.deepEqual(
          elsewhere,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(eve.opened.length, 1);
        assert.deepEqual(
          listed.plans.filter((each) => each.name === body.name).map((each) => each.id),
          [first.plan.id],
        );
      }),
  );

  it.effect(
    "a task's start whose agent eve does not take answers the task it made with the agent's refusal, and the task stands",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask({ eve: fakeEve({ reachable: false }) });

        const started = readAnswer(
          taskStartAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            request(TASKS, owner, {
              method: "POST",
              body: {
                workspaceId: task.workspaceId,
                repository: RELAY_FULL_NAME,
                agent: { idempotencyKey: randomUUID(), prompt: "Expire invitations." },
              },
            }),
          ),
        );
        const opened = yield* ask(request(TASK(started.plan.id), owner));

        assert.equal(started.agent, undefined);
        assert.deepEqual(started.agentRefusal, { error: HOSTED_API_ERROR.UNAVAILABLE });
        assert.equal(opened.status, HOSTED_HTTP_STATUS.OK);
      }),
  );

  it.effect(
    "a workspace's Start makes an agent on no task in that workspace, in the repository it names or in none, and one of a workspace the account is not in is not found",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, eve, ask } = yield* openTask();
        const startIn = (bearer: string, body: WireBoundaryInput) =>
          ask(request(WORKSPACE_STARTS, bearer, { method: "POST", id: task.workspaceId, body }));
        const placeOf = (answer: Answer) =>
          Effect.gen(function* () {
            const { agent } = readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answer);
            const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
            return [stored.taskId, stored.organizationId, stored.repository];
          });

        const inRepository = yield* startIn(owner, {
          idempotencyKey: randomUUID(),
          task: "Sweep the flaky tests.",
          repository: RELAY_FULL_NAME,
        });
        const inNone = yield* startIn(owner, {
          idempotencyKey: randomUUID(),
          task: "Talk the release through.",
        });
        const stranger = yield* startIn(other, {
          idempotencyKey: randomUUID(),
          task: "Sweep the flaky tests.",
        });
        // A Start from an agent goes by that agent's own path, never into a workspace place it may not stand in.
        const fromAgent = yield* startIn(owner, {
          idempotencyKey: randomUUID(),
          from: { agentId: randomUUID() },
          repository: RELAY_FULL_NAME,
        });

        assert.deepEqual(yield* placeOf(inRepository), [null, task.workspaceId, RELAY_FULL_NAME]);
        assert.deepEqual(yield* placeOf(inNone), [null, task.workspaceId, null]);
        assert.deepEqual(
          stranger,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          fromAgent,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(eve.opened.length, 2);
      }),
  );

  it.effect(
    "a task's start naming an agent is refused with nothing made where it names no repository, as an agent's Start on such a task is, or asks for planning beside it",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask();
        const agent = { idempotencyKey: randomUUID(), prompt: "Expire invitations." };
        const startWith = (body: WireBoundaryInput) =>
          ask(request(TASKS, owner, { method: "POST", body }));

        const answered = [
          yield* startWith({ name: "No repository", workspaceId: task.workspaceId, agent }),
          yield* startWith({
            name: "Null repository",
            workspaceId: task.workspaceId,
            repository: null,
            agent,
          }),
          yield* startWith({
            name: "Planned",
            workspaceId: task.workspaceId,
            repository: RELAY_FULL_NAME,
            planning: true,
            agent,
          }),
        ];
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner)),
        );

        assert.deepEqual(answered, [
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NO_REPOSITORY),
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NO_REPOSITORY),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        ]);
        assert.deepEqual(
          listed.plans.map((each) => each.id),
          [task.id],
        );
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start naming a model runs that agent on it and leaves the account's default as it stands, which only Settings writes",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();

        const started = yield* ask(
          startAs(owner, task.id, { idempotencyKey: randomUUID(), model: SOL, effort: "low" }),
        );

        const { agent } = readAnswer(agentAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started);
        assert.equal(agent.model, SOL);
        assert.equal(agent.effort, "low");
        assert.equal((yield* readAccountPreferences(owner))?.agent, undefined);
      }),
  );

  it.effect(
    "a Start on a plan whose workspace's account since reinstalled the App under an id GitHub does not know is refused as a connection that lapsed, and opens nothing",
    () =>
      Effect.gen(function* () {
        const { owner, task, installation, eve, ask } = yield* openTask();
        const linked = yield* linkInstallation(task.workspaceId, {
          installationId: installation.id + 10_000,
          accountId: installation.accountId ?? 50_000 + installation.id,
          accountLogin: installation.login,
          accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
          suspended: false,
        });
        assert.equal(linked, LINK_OUTCOME.LINKED);

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(started, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.CONNECTION_LAPSED,
              repository: RELAY_FULL_NAME,
            },
          },
        });
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start on a task that runs on another member's device is refused on the route, naming the device and its owner, and no agent is made for the teammate",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, eve, ask } = yield* openTask();
        yield* joinWorkspace(task.workspaceId, other);
        const studio = randomUUID();
        yield* registerDevice(owner, {
          id: studio,
          name: "Studio",
          ...DEVICE_LAYOUT,
          signedIn: { claudeCode: true },
        });
        const onStudio = yield* createTask(owner, {
          organizationId: task.workspaceId,
          name: "On the Studio",
          repository: RELAY_FULL_NAME,
          runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: studio },
        });

        const theirKey = randomUUID();
        const byTeammate = yield* ask(startAs(other, onStudio.id, { idempotencyKey: theirKey }));
        assert.deepEqual(byTeammate, {
          status: HOSTED_HTTP_STATUS.CONFLICT,
          body: {
            error: HOSTED_API_ERROR.LOCAL_AGENT_REFUSED,
            localAgentRefusal: LOCAL_AGENT_REFUSAL.NOT_OWNER,
            refusedDevice: { name: "Studio", owner: "Test User" },
          },
        });
        assert.ok(Option.isNone(yield* readAgentByKey(other, theirKey)));
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start on a plan whose workspace has nothing connected names the owner's other workspace connected to the repository's owner, where the plan can move, and a teammate hears only that nothing is connected",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const task = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        yield* joinWorkspace(task.workspaceId, teammate);
        const team = yield* openWorkspace(owner);
        const installation = freshInstallation();
        assert.equal(yield* connectWorkspaceGitHub(team, installation), LINK_OUTCOME.LINKED);
        const eve = fakeEve();
        const { ask } = yield* standing(
          new Map([
            [`Bearer ${owner}`, owner],
            [`Bearer ${teammate}`, teammate],
          ]),
          githubReaching([installation]),
          eve,
        );

        const byOwner = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));
        const byTeammate = yield* ask(startAs(teammate, task.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(byOwner, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
              repository: RELAY_FULL_NAME,
              workspace: { id: team, name: "Test Workspace" },
            },
          },
        });
        assert.deepEqual(byTeammate, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY_FULL_NAME },
          },
        });
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start that names the owner's own first workspace as where the plan can move names it by the owner's name as it stands now",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const task = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        const personal = yield* ensurePersonalWorkspace(owner, yield* fakeWorkspaceSeams);
        assert.ok(Option.isSome(personal));
        const installation = freshInstallation();
        assert.equal(
          yield* connectWorkspaceGitHub(personal.value, installation),
          LINK_OUTCOME.LINKED,
        );
        yield* Database.use((db) =>
          db.update(user).set({ name: "Ada Lovelace" }).where(eq(user.id, owner)),
        );
        const { ask } = yield* standing(
          new Map([[`Bearer ${owner}`, owner]]),
          githubReaching([installation]),
          fakeEve(),
        );

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(started, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: {
              reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
              repository: RELAY_FULL_NAME,
              workspace: { id: personal.value, name: "Ada Lovelace" },
            },
          },
        });
      }),
  );

  it.effect(
    "a Start names no other workspace whose installation on the repository's owner was not given the repository",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const task = yield* startTask(owner, {
          name: "Teammate invitations",
          repository: RELAY_FULL_NAME,
        });
        const team = yield* openWorkspace(owner);
        const ledgerOnly = freshInstallation([{ owner: RELAY.owner, name: "Ledger" }]);
        assert.equal(yield* connectWorkspaceGitHub(team, ledgerOnly), LINK_OUTCOME.LINKED);
        const eve = fakeEve();
        const { ask } = yield* standing(
          new Map([[`Bearer ${owner}`, owner]]),
          githubReaching([ledgerOnly]),
          eve,
        );

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(started, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: {
            error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
            unreached: { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: RELAY_FULL_NAME },
          },
        });
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "a Start while GitHub does not answer is refused as GitHub unanswered, which a retry may get past, and opens nothing",
    () =>
      Effect.gen(function* () {
        const { owner, task, eve, ask } = yield* openTask({
          github: (sent) =>
            new URL(sent.url).pathname.startsWith("/app/installations/")
              ? Response.json({ message: "Service Unavailable" }, { status: 503 })
              : undefined,
        });

        const started = yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() }));

        assert.deepEqual(
          started,
          refusal(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.GITHUB_UNANSWERED),
        );
        assert.deepEqual(eve.opened, []);
      }),
  );

  it.effect(
    "the list reads each agent's status from its newest turn, in the order started, and is the owner's alone",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const first = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        yield* TestClock.adjust(Duration.minutes(1));
        const second = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = yield* readAgent(owner, second.id);
        assert.ok(Option.isSome(stored));
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const target = { userId: owner, conversationId: stored.value.conversationId };
        yield* writer.enqueueTurn(target, { origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });

        const listed = readAnswer(
          agentListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASK_AGENTS, owner, { id: task.id })),
        );
        assert.deepEqual(
          listed.agents.map((agent) => [agent.id, agent.status]),
          // The first has no turn yet, but its Start's line awaits the one eve opens on it.
          [
            [first.id, AGENT_STATUS.RUNNING],
            [second.id, AGENT_STATUS.RUNNING],
          ],
        );
        assert.deepEqual(
          yield* ask(request(TASK_AGENTS, other, { id: task.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a plan's agents and inbox are read without its plan's history, so a revision this build cannot read leaves them answering, while an account outside its workspace and a plan that is none are refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const now = yield* DateTime.nowAsDate;
        // A revision a later build wrote, by a kind of writer this build has no name for.
        yield* Database.use((db) =>
          db.insert(planRevision).values({
            taskId: task.id,
            seq: 1_000,
            actor: sql`'a-later-writer'`,
            document: SAVED,
            changes: 1,
            startedAt: now,
            at: now,
          }),
        );
        // The whole read, which reads who wrote each section, cannot answer the plan.
        assert.equal(
          (yield* ask(request(TASK(task.id), owner))).status,
          HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
        );
        const reads = (bearer: string, id: string) =>
          [request(TASK_AGENTS, bearer, { id }), request(TASK_INBOX, bearer, { id })] as const;

        const [agents, inbox] = reads(owner, task.id);
        readAnswer(agentListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(agents));
        readAnswer(inboxAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(inbox));
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        for (const refused of [...reads(other, task.id), ...reads(owner, randomUUID())]) {
          assert.deepEqual(yield* ask(refused), notFound, refused.url);
        }
      }),
  );

  it.effect(
    "the transcript answers the conversation's rows past the cursor, with the cursor to read on from, and a cursor outside its shape is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const agent = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = yield* readAgent(owner, agent.id);
        assert.ok(Option.isSome(stored));
        const target = { userId: owner, conversationId: stored.value.conversationId };
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        // Before any turn the Start's line awaits it: a read past the line is held rather than
        // spinning, and lets go at the hold with the status the page was read at.
        const opening = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: "0:0" })),
        );
        assert.equal(opening.messages.length, 1);
        const starting = yield* Effect.forkChild(
          ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: opening.cursor })),
        );
        yield* TestClock.adjust(CODER.MESSAGES_POLL);
        assert.equal(starting.pollUnsafe(), undefined);
        yield* TestClock.adjust(CODER.MESSAGES_HOLD);
        const empty = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* drivenWhileStarting(starting),
        );
        assert.deepEqual(empty.messages, []);
        assert.equal(empty.status, AGENT_STATUS.RUNNING);
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.TYPED,
          eveTurnId: "turn_0",
        });
        yield* writer.consume(target, {
          kind: RUN_EVENT.TURN_STARTED,
          conversationId: sessionKey(target.conversationId),
          turnId,
          sequence: 1,
          origin: RUN_TURN_ORIGIN.TYPED,
          trigger: TURN_TRIGGER.ASK,
          at: 0,
        });
        // eve's receipt takes the Start's line into the turn, as the relay does.
        yield* writer.takeAwaitingLine(target, { text: SNAPSHOT, turnId });

        const page = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        );
        assert.equal(page.messages.length, 1);
        assert.equal(page.messages[0]?.role, MESSAGE_ROLE.USER);
        assert.notEqual(page.cursor, "0:0");
        assert.equal(page.status, AGENT_STATUS.RUNNING);

        assert.deepEqual(
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: "later" })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(AGENT_MESSAGES, other, { id: agent.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a page asked cut carries a 2 MB command output as its two ends, its size, and the part's place, and the part is read whole by its owner and by no other account",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const { agent } = yield* startedAgent(owner, task.id, ask);
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const output = "built one more file\n".repeat(100_000);
        const half = AGENT_BOUNDS.MAX_PART_CHARS / 2;
        const command = {
          type: "tool-bash",
          toolCallId: "call-1",
          state: "output-available",
          input: { command: "pnpm build" },
          output,
        };
        const thought = "Weigh the build again. ".repeat(500);
        const thinking = { type: "reasoning", text: thought, state: "done" };
        // An answer the window reads for what it means is carried whole, however long.
        const read = {
          type: "tool-read_agent",
          toolCallId: "call-2",
          state: "output-available",
          input: { agentId: agent.id },
          output: { agent: { id: agent.id, title: "Builder" }, tail: "x".repeat(10_000) },
        };
        const journal = yield* transcriptRow(stored, 2, MESSAGE_ROLE.ASSISTANT, [
          text("Building."),
          command,
          thinking,
          read,
        ]);

        const answered = yield* ask(
          request(AGENT_MESSAGES, owner, { id: agent.id, parts: TRANSCRIPT_PARTS_QUERY.CUT }),
        );
        assert.ok(JSON.stringify(answered.body).length < 20_000);
        // The Start's line stands ahead of the journal.
        const [, cutJournal] = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          answered,
        ).messages;
        assert.deepEqual(cutJournal?.cutParts, [
          {
            index: 1,
            field: PART_CUT_FIELD.OUTPUT,
            bytes: 2_000_000,
            head: output.slice(0, half),
            tail: output.slice(-half),
          },
          {
            index: 2,
            field: PART_CUT_FIELD.TEXT,
            bytes: 11_500,
            head: thought.slice(0, half),
            tail: thought.slice(-half),
          },
        ]);
        const { output: _output, ...withoutOutput } = command;
        const { text: _text, ...withoutText } = thinking;
        assert.deepEqual(cutJournal?.parts, [text("Building."), withoutOutput, withoutText, read]);
        // A reader that asks no cut, as a released desktop, is answered the part whole.
        const [, wholeJournal] = readAnswer(
          agentMessagesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id })),
        ).messages;
        assert.deepEqual(wholeJournal?.parts, [text("Building."), command, thinking, read]);
        assert.equal(wholeJournal?.cutParts, undefined);
        // The read back from the end cuts the same parts where it is asked to.
        const [, newestJournal] = readAnswer(
          agentNewestAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT_NEWEST, owner, { id: agent.id, parts: TRANSCRIPT_PARTS_QUERY.CUT }),
          ),
        ).messages;
        assert.deepEqual(newestJournal?.cutParts, cutJournal?.cutParts);

        const part = (bearer: string, index: number) =>
          ask(request(`/api/agents/${agent.id}/messages/${journal}/parts/${index}`, bearer));
        assert.deepEqual(
          readAnswer(agentPartAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* part(owner, 1)),
          { part: command },
        );
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(yield* part(other, 1), notFound);
        assert.deepEqual(yield* part(owner, 4), notFound);
        assert.deepEqual(
          yield* ask(request(`/api/agents/${agent.id}/messages/not-an-id/parts/1`, owner)),
          notFound,
        );
      }),
  );

  it.effect(
    "an agent's pull request overview, its three reads asked at once and then again, reaches the repository through its installation once and mints one token for it, and a read past the token's hour mints afresh",
    () =>
      Effect.gen(function* () {
        const { owner, task, installation, github, ask } = yield* openTask({
          github: publishedPullRequest,
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);
        yield* updateAgentBranch(owner, agent.id, PUBLISHED.branch);
        // Note that the Start reached the repository itself, so the reads begin past every kept answer.
        yield* TestClock.adjust(Duration.hours(2));
        const asked = github.sent.length;
        const overview = () =>
          Effect.all(
            AGENT_OVERVIEW.map((path) => ask(request(path, owner, { id: agent.id }))),
            { concurrency: "unbounded" },
          );

        const cold = yield* overview();
        const warm = yield* overview();

        for (const read of cold) {
          assert.equal(read.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(read.body));
        }
        assert.deepEqual(warm, cold);
        assert.deepEqual(reachRequests(github.sent.slice(asked), installation.id), {
          installationReads: 1,
          listings: 1,
          listingMints: 1,
          repositoryMints: 1,
        });

        const later = github.sent.length;
        yield* TestClock.adjust(Duration.hours(1));
        assert.deepEqual(yield* overview(), cold);
        assert.equal(reachRequests(github.sent.slice(later), installation.id).repositoryMints, 1);
      }),
  );

  it.effect(
    "an agent whose repository its workspace's installation no longer reaches answers each of its Pull request tab's reads and a change as out of reach, byte for byte, with no reason beside it",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask, fetch } = yield* openTask({ github: publishedPullRequest });
        const { agent } = yield* startedAgent(owner, task.id, ask);
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({ repository: "Acme/Former" })
            .where(eq(agentTable.id, agent.id)),
        );
        const unreached = {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          contentType: "application/json",
          cacheControl: null,
          text: '{"error":"repository-not-reachable"}',
        };
        const asked = [
          ...[AGENT_PULL_REQUEST, AGENT_PULL_REQUEST_VIEWED, ...AGENT_OVERVIEW].map((path) =>
            request(path, owner, { id: agent.id, number: "12" }),
          ),
          request(AGENT_PULL_REQUEST_ACTION, owner, {
            method: "POST",
            id: agent.id,
            number: "12",
            body: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
          }),
        ];
        for (const sent of asked) {
          const answered = yield* fetch(sent);
          assert.deepEqual(
            {
              status: answered.status,
              contentType: answered.headers.get("content-type"),
              cacheControl: answered.headers.get("cache-control"),
              text: yield* Effect.promise(() => answered.text()),
            },
            unreached,
          );
        }
      }),
  );

  it.effect(
    "an SVG of the agent's own repository that its pull request's overview names is served as its bytes, sandboxed so it never runs as a page of the service",
    () =>
      Effect.gen(function* () {
        const contents = `/repos/${RELAY_FULL_NAME}/contents/docs/diagram.svg`;
        const { owner, task, ask, fetch } = yield* openTask({
          github: (sent) =>
            new URL(sent.url).pathname === contents
              ? new Response(SCRIPTED_SVG, {
                  headers: { "content-type": "application/vnd.github.raw" },
                })
              : undefined,
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);

        const served = yield* fetch(
          request(AGENT_GITHUB_IMAGE, owner, {
            id: agent.id,
            src: `https://raw.githubusercontent.com/${RELAY_FULL_NAME}/main/docs/diagram.svg`,
          }),
        );

        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.headers.get("content-type"), "image/svg+xml");
        assert.deepEqual(openedPagePolicy(served.headers), SANDBOXED_PAGE);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        // No other site's page may embed it, since its <img> would load it with the viewer's cookie.
        assert.equal(served.headers.get("cross-origin-resource-policy"), "same-origin");
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          SCRIPTED_SVG,
        );
      }),
  );
});

it.layer(getTestDB())("a blank agent and the calls into an agent", (it) => {
  /** A call an earlier version took into the agent: one line by each speaker, as its voice wrote them into the agent's conversation, each placed at the instant its words began; answers the call's id and its start. */
  const callInto = (
    agent: { readonly id: string; readonly conversationId: string },
    starter: string,
    words: readonly [developer: string, agent: string],
  ) =>
    Effect.gen(function* () {
      const voiceSessionId = randomUUID();
      const startedAt = Date.parse("2026-10-20T12:00:00Z");
      const developerRow = randomUUID();
      const agentRow = randomUUID();
      const db = yield* Database;
      yield* db.insert(messages).values([
        {
          userId: starter,
          conversationId: agent.conversationId,
          seq: 1_000,
          clientId: developerRow,
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: words[0], state: "done" }],
          metadata: {
            author: MESSAGE_AUTHOR.DEVELOPER,
            channel: MESSAGE_CHANNEL.VOICE,
            voice_session_id: voiceSessionId,
            from_ms: 0,
            to_ms: 900,
          },
          placedAt: new Date(startedAt),
          finishedAt: new Date(startedAt + 900),
        },
        {
          userId: starter,
          conversationId: agent.conversationId,
          seq: 1_001,
          clientId: agentRow,
          role: MESSAGE_ROLE.ASSISTANT,
          parts: [{ type: "text", text: words[1], state: "done" }],
          metadata: {
            author: MESSAGE_AUTHOR.VOICE_MODEL,
            channel: MESSAGE_CHANNEL.VOICE,
            voice_session_id: voiceSessionId,
            from_ms: 1_500,
            to_ms: 2_400,
          },
          placedAt: new Date(startedAt + 1_500),
          finishedAt: new Date(startedAt + 2_400),
        },
      ]);
      return { voiceSessionId, startedAt, developerRow, agentRow };
    });

  it.effect(
    "an agent's transcript carries the lines an earlier version said on calls into it in the order said, each on the voice channel naming its call and at the instant its words began, the agent's own with no turn's record though it was read aloud from one, and a line said awaits no turn",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask({ repository: null });
        const started = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID(), blank: true })),
        ).agent;
        const agent = Option.getOrThrow(yield* readAgent(owner, started.id));
        const call = yield* callInto(agent, owner, ["What did you change?", "I moved the export."]);
        const read = Effect.map(ask(request(AGENT_MESSAGES, owner, { id: agent.id })), (answered) =>
          readAnswer(agentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
        );

        const page = yield* read;
        assert.deepEqual(
          page.messages.map((message) => ({
            role: message.role,
            words: message.parts.map((part) => (isRecord(part) ? part.text : undefined)),
            channel: isRecord(message.metadata) ? message.metadata.channel : undefined,
            call: isRecord(message.metadata) ? message.metadata.voice_session_id : undefined,
            sentAt: message.sentAt,
          })),
          [
            {
              role: MESSAGE_ROLE.USER,
              words: ["What did you change?"],
              channel: MESSAGE_CHANNEL.VOICE,
              call: call.voiceSessionId,
              sentAt: call.startedAt,
            },
            {
              role: MESSAGE_ROLE.ASSISTANT,
              words: ["I moved the export."],
              channel: MESSAGE_CHANNEL.VOICE,
              call: call.voiceSessionId,
              sentAt: call.startedAt + 1_500,
            },
          ],
        );
        // A line the voice answered itself opened no turn and waits on none.
        assert.equal(page.status, AGENT_STATUS.COMPLETED);

        // The store names the turn the agent's words were read aloud from; the line still carries no turn's record.
        const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
        const turnId = randomUUID();
        const target = { userId: owner, conversationId: agent.conversationId };
        yield* writer.enqueueTurn(target, {
          turnId,
          origin: TURN_ORIGIN.SPOKEN,
          eveTurnId: "turn_0",
        });
        const db = yield* Database;
        yield* db
          .update(messages)
          .set({ turnId })
          .where(
            and(
              eq(messages.conversationId, agent.conversationId),
              eq(messages.clientId, call.agentRow),
            ),
          );
        const spoken = (yield* read).messages.find(
          (message) => message.role === MESSAGE_ROLE.ASSISTANT,
        );
        assert.ok(spoken !== undefined);
        assert.deepEqual(
          { startedAt: spoken.startedAt, model: spoken.model, sentAt: spoken.sentAt },
          { startedAt: undefined, model: undefined, sentAt: call.startedAt + 1_500 },
        );
      }),
  );
});

it.layer(getTestDB())("an agent's pictures", (it) => {
  it.effect(
    "a picture a tool answered an agent or its worker is served as its bytes, not to be sniffed, not to be cached, and never to run as a page, to whoever may read the agent, and through its own transcript alone",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask, fetch } = yield* openTask();
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const callId = "call-worker";
        const workerConversation = childConversationId(target.conversationId, callId);
        const db = yield* Database;
        yield* db.insert(conversations).values({
          id: workerConversation,
          userId: owner,
          kind: CONVERSATION_KIND.CHILD,
          parentConversationId: target.conversationId,
        });
        const agentPicture = Option.getOrThrow(yield* keepConversationPicture(target, picture(1)));
        const workerPicture = Option.getOrThrow(
          yield* keepConversationPicture(
            { userId: owner, conversationId: workerConversation },
            picture(2),
          ),
        );
        const at = (bearer: string | undefined, pictureId: string, call?: string) =>
          request(AGENT_PICTURE, bearer, {
            id: agent.id,
            picture: pictureId,
            ...(call === undefined ? undefined : { call }),
          });
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        const served = yield* fetch(at(owner, agentPicture.id));
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(served.headers.get("content-type"), INBOX_IMAGE_TYPE.PNG);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(openedPagePolicy(served.headers), SANDBOXED_PAGE);
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => served.arrayBuffer())),
          picture(1).bytes,
        );
        const workerServed = yield* fetch(at(owner, workerPicture.id, callId));
        assert.deepEqual(
          new Uint8Array(yield* Effect.promise(() => workerServed.arrayBuffer())),
          picture(2).bytes,
        );

        assert.deepEqual(yield* ask(at(other, agentPicture.id)), notFound, "not a member");
        assert.deepEqual(
          yield* ask(at(owner, workerPicture.id)),
          notFound,
          "a worker's picture is not the agent's",
        );
        assert.deepEqual(
          yield* ask(at(owner, agentPicture.id, callId)),
          notFound,
          "the agent's picture is not its worker's",
        );
        assert.deepEqual(yield* ask(at(owner, randomUUID())), notFound);
        assert.deepEqual(yield* ask(at(owner, "members.png")), notFound);
        assert.deepEqual(
          yield* ask(at(undefined, agentPicture.id)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );

        yield* joinWorkspace(task.workspaceId, other);
        const teammate = yield* fetch(at(other, agentPicture.id));
        assert.equal(teammate.status, HOSTED_HTTP_STATUS.OK, "a member of the agent's workspace");
      }),
  );

  it.effect(
    "a transcript read with wait=none is answered at once, never held, with whether the held read would have held on it: the agent's own and a worker's whose call is not recorded yet",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const agent = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const opening = readAnswer(
          transcriptNowAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: "0:0", wait: "none" })),
        );
        assert.equal(opening.messages.length, 1);
        // Nothing stands past the Start's line, which awaits the turn eve opens on it, so the held read
        // would hold on it; this answers at once.
        const own = readAnswer(
          transcriptNowAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT_MESSAGES, owner, { id: agent.id, after: opening.cursor, wait: "none" }),
          ),
        );
        assert.deepEqual(own.messages, []);
        assert.equal(own.status, AGENT_STATUS.RUNNING);
        assert.equal(own.holds, true);

        const worker = readAnswer(
          transcriptNowAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(SUBAGENT_MESSAGES, owner, {
              id: agent.id,
              call: "call-7",
              after: "0:0",
              wait: "none",
            }),
          ),
        );
        assert.deepEqual(worker.messages, []);
        assert.equal(worker.status, AGENT_STATUS.STARTING);
        assert.equal(worker.holds, true);

        assert.deepEqual(
          yield* ask(request(AGENT_MESSAGES, other, { id: agent.id, wait: "none" })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a transcript read back from its end answers its newest page first, each page below it in turn with no row missed or repeated, and the cursor a follow from it hears the next row by; another account's agent answers nothing",
    () =>
      Effect.gen(function* () {
        const { owner, other, task, ask } = yield* openTask();
        const agent = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        const PAGE = AGENT_BOUNDS.MESSAGES_PAGE;
        // Two pages and some, so the oldest page is the short one that ends the read.
        const total = 2 * PAGE + 37;
        const said = Array.from({ length: total }, (_, at) => `Step ${at}.`);
        yield* Database.use((db) =>
          db.insert(messages).values(
            said.map((words, at) => ({
              userId: stored.userId,
              conversationId: stored.conversationId,
              seq: at + 2,
              clientId: randomUUID(),
              role: MESSAGE_ROLE.ASSISTANT,
              // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes them.
              parts: [text(words)] as never,
              metadata: { author: MESSAGE_AUTHOR.MODEL },
              placedAt: new Date(),
            })),
          ),
        );
        const wordsOf = (page: { readonly messages: readonly AgentTranscriptMessage[] }) =>
          page.messages.map((message) =>
            message.parts
              .map((part) => (isRecord(part) && isWireString(part.text) ? part.text : ""))
              .join(""),
          );

        const newest = readAnswer(
          agentNewestAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_NEWEST, owner, { id: agent.id })),
        );
        assert.deepEqual(wordsOf(newest), said.slice(-PAGE), "the newest page, oldest first");
        // The Start's line awaits the first turn.
        assert.equal(newest.status, AGENT_STATUS.RUNNING);
        assert.notEqual(newest.before, undefined, "a full page says more stands below it");

        const read = [...wordsOf(newest)];
        let before = newest.before;
        let pages = 1;
        while (before !== undefined) {
          const older = readAnswer(
            agentOlderAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(AGENT_NEWEST, owner, { id: agent.id, before })),
          );
          read.unshift(...wordsOf(older));
          before = older.before;
          pages += 1;
        }
        assert.deepEqual(
          read,
          [SNAPSHOT, ...said],
          "every row once, in order, the Start's line first",
        );
        assert.equal(pages, 3);

        // A row written after the newest page was read is heard by the follow from its cursor, and nothing before it.
        yield* transcriptRow(stored, total + 2, MESSAGE_ROLE.ASSISTANT, [text("Done.")]);
        const followed = readAnswer(
          transcriptNowAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT_MESSAGES, owner, { id: agent.id, after: newest.cursor, wait: "none" }),
          ),
        );
        assert.deepEqual(wordsOf(followed), ["Done."]);

        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(yield* ask(request(AGENT_NEWEST, other, { id: agent.id })), notFound);
        assert.deepEqual(
          yield* ask(request(AGENT_NEWEST, other, { id: agent.id, before: "100" })),
          notFound,
        );
        assert.deepEqual(
          yield* ask(request(AGENT_NEWEST, owner, { id: agent.id, before: "-1" })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "a short transcript read back from its end is its newest page alone, and a worker's whose call is not recorded yet is an empty page of a starting worker",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const agent = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        // The Start's own line is the transcript's one row.
        const newest = readAnswer(
          agentNewestAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_NEWEST, owner, { id: agent.id })),
        );
        assert.equal(newest.messages.length, 1);
        assert.equal(newest.before, undefined, "nothing older stands");

        const worker = readAnswer(
          agentNewestAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(SUBAGENT_NEWEST, owner, { id: agent.id, call: "call-7" })),
        );
        assert.deepEqual(worker.messages, []);
        assert.equal(worker.status, AGENT_STATUS.STARTING);
        assert.equal(worker.before, undefined);
      }),
  );

  it.effect(
    "a rewound transcript says so on every page, and a cursor read before the rewind is answered at once, so its reader reads the newest page afresh",
    () =>
      Effect.gen(function* () {
        const { owner, task, ask } = yield* openTask();
        const agent = readAnswer(
          agentAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(startAs(owner, task.id, { idempotencyKey: randomUUID() })),
        ).agent;
        const stored = Option.getOrThrow(yield* readAgent(owner, agent.id));
        yield* transcriptRow(stored, 2, MESSAGE_ROLE.USER, [text("Expire invitations.")]);
        yield* transcriptRow(stored, 3, MESSAGE_ROLE.ASSISTANT, [text("Expired.")]);
        const dropped = yield* transcriptRow(stored, 4, MESSAGE_ROLE.USER, [text("And emails.")]);
        yield* transcriptRow(stored, 5, MESSAGE_ROLE.ASSISTANT, [text("Emailed.")]);
        const newest = () =>
          Effect.map(ask(request(AGENT_NEWEST, owner, { id: agent.id })), (answered) =>
            readAnswer(agentNewestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const before = yield* newest();

        yield* rewindConversation(stored, dropped);
        const after = yield* newest();
        const past = readAnswer(
          transcriptNowAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_MESSAGES, owner, { id: agent.id, after: before.cursor })),
        );

        assert.equal(before.rewound, undefined);
        assert.equal(after.messages.length, 3);
        assert.notEqual(after.rewound, undefined);
        // Note that the read past the stale cursor asked to be held, and was answered at once all the same.
        assert.equal(past.rewound, after.rewound);
      }),
  );
});
