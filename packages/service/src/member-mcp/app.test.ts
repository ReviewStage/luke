import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import type { Client } from "@modelcontextprotocol/client";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createAgent, readAgent } from "@repo/database/models/agent-store";
import {
  createAutomation,
  listAutomationRuns,
  readAutomation,
} from "@repo/database/models/automation-store";
import { listMemories, rememberMemory } from "@repo/database/models/memory-store";
import {
  PLAN_COMMENT_OUTCOME,
  readPlanCommentThreads,
  startPlanCommentThread,
} from "@repo/database/models/plan-comments";
import { listRevisions } from "@repo/database/models/plan-revisions";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import { createTask, readTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  openInboxItem,
  openTaskAgent,
  openWorkspace,
} from "@repo/database/testing";
import { AGENT_ARCHIVER, AGENT_PAYER } from "@repo/features/agent-wire";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { INBOX_ANSWER_LEAD, INBOX_ASK, INBOX_REPLY, INBOX_STATUS } from "@repo/features/inbox-wire";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
} from "@repo/features/plan-comment-wire";
import { NOTE_KIND } from "@repo/features/plan-notes";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import { PLAN_ACTOR, TASK_STATUS } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { settleJsonSchemaGolden } from "@repo/wire/testing";
import { eq, sql } from "drizzle-orm";
import { Clock, DateTime, Effect, Option, Result, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { readWorkspaceMemories, WORKSPACE_MEMORY } from "../accounts/workspace-memories.js";
import { recordMemberPlanNotes } from "../agents/coder-host/plan-edit.js";
import { DESKTOP_OAUTH_CLIENT } from "../auth/oauth-clients.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread, readInboxItem } from "../inbox/inbox-store.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import {
  fakeEve,
  freshInstallation,
  type GraphqlCall,
  graphqlAnswering,
  mutationOf,
  openAskOf,
  openTask,
  PUBLISHED,
  PULL_REQUEST_NODE_ID,
  publishedPullRequestDrafted,
  RELAY_FULL_NAME,
  startedAgent,
} from "../testing/agents-app-support.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  signInWithGitHub,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import {
  connected,
  MCP_CLIENT,
  MEMBER_MCP_TEST,
  memberMcpStanding,
  mintedToken,
  OTHER_RESOURCE,
  post,
  RESOURCE,
  REVISION,
  signUp,
} from "../testing/member-mcp-auth.js";
import { harnessFor } from "../testing/native-harness-fake.js";
import { MEMBER_MCP_METADATA_ROUTE, memberMcpIssuer } from "./app.js";
import { MEMBER_MCP_PATH, MEMBER_MCP_SCOPE } from "./resource.js";
import { LIST_WORKSPACES_TOOL, MEMBER_MCP_TOOL, MEMBER_MCP_TOOLS } from "./tools.js";

/**
 * The member MCP server, answered by its group the way a function answers
 * it, over the auth service and the migrated PGlite the tools read too. The tokens are the
 * provider's own, minted through a seeded test client linked to the
 * resource: a signed-up account authorizes it, as a client's sign-in will,
 * and the client exchanges its code (`../testing/member-mcp-auth.ts`, the
 * harness the sign-in test shares). The SDK's own client
 * drives the server at both revisions it serves. GitHub is reached by no
 * call here but a change to a pull request's, which answers from a script
 * as the Pull request tab's own tests script it, an agent's harness is a
 * recording one that takes every message, and the model catalog offers
 * nothing. An answer's hand-off to the agent that asked is driven apart,
 * over the agents' own test world (`../testing/agents-app-support.ts`): a
 * started agent on a fake eve, its server admitted on the world's bearers.
 * Synthetic accounts and tokens.
 */

/** The member's own GitHub token, as their sign-in through the App left it. */
const MEMBER_GITHUB_TOKEN = "ghu_member";

const decodeMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    resource: Schema.String,
    authorization_servers: Schema.Array(Schema.String),
    scopes_supported: Schema.Array(Schema.String),
    bearer_methods_supported: Schema.Array(Schema.String),
  }),
);
/** The rows of a list read by their ids alone. */
const IdsSchema = Schema.Array(Schema.Struct({ id: Schema.String }));
const decodeTasks = Schema.decodeUnknownSync(Schema.Struct({ tasks: IdsSchema }));
/** The inbox read, each thread by its id, the ask it holds open, and its messages' asks by their options. */
const decodeInbox = Schema.decodeUnknownSync(
  Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        askId: Schema.optionalKey(Schema.String),
        waitsOnMember: Schema.Boolean,
        thread: Schema.Array(
          Schema.Struct({
            from: Schema.String,
            ask: Schema.optionalKey(
              Schema.Struct({
                options: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String }))),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);
/** A write's answer: the thread as it then stands. */
const decodeWritten = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.Struct({ status: Schema.String }) }),
);
const decodeAgents = Schema.decodeUnknownSync(Schema.Struct({ agents: IdsSchema }));
const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaces: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        slug: Schema.String,
        name: Schema.String,
        role: Schema.String,
      }),
    ),
  }),
);

const decodeMade = Schema.decodeUnknownSync(
  Schema.Struct({ task: Schema.Struct({ id: Schema.String }) }),
);
const decodeAutomation = Schema.decodeUnknownSync(
  Schema.Struct({ automation: Schema.Struct({ id: Schema.String }) }),
);

/** A weekly schedule, as an automation's trigger. */
const WEEKLY = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 9 * * 1",
  timezone: "Europe/London",
} as const;

const decodeThread = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.String, state: Schema.String }),
);
const decodeThreads = Schema.decodeUnknownSync(
  Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        thread: Schema.String,
        on: Schema.String,
        comments: Schema.Array(Schema.Struct({ words: Schema.String })),
      }),
    ),
  }),
);
const decodeKept = Schema.decodeUnknownSync(
  Schema.Struct({ memory: Schema.Struct({ id: Schema.String }) }),
);
const decodeFound = Schema.decodeUnknownSync(
  Schema.Struct({ memories: Schema.Array(Schema.Struct({ id: Schema.String })) }),
);

/** The plan a stranger's task and a member's both hold, and the words a thread stands on in it. */
const PLAN_NOTE = { kind: NOTE_KIND.ADD, section: "Problem", text: "Seats drift." } as const;

/** Plans turned on or off for the account, as Settings › Experimental turns it. */
const plansFor = (userId: string, on: boolean) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.PLANS]: on } });

/** Memory turned on for the account, as Settings › Experimental turns it on. */
const memoryOn = (userId: string) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });

/** An agent on the task, on Claude Code, its session standing, so a comment handed to it is taken by the recording harness. */
const standingAgent = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const { agent } = Option.getOrThrow(
      yield* createAgent(userId, {
        taskId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        planSnapshot: null,
        prompt: "Size the seats.",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        payer: AGENT_PAYER.API_KEY,
      }),
    );
    const claimed = yield* claimRuntimeSession(
      { userId, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    assert.ok(claimed, "the agent's session stands");
    return agent.id;
  });

/** The JSON Schema goldens of the server's tools, where a tool's input a model is shown is recorded. */
const GOLDEN_ROOT = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/json-schema/member-mcp",
);

/** The golden a tool's input is recorded under: its name, hyphenated, as the package's goldens are named. */
function goldenOf(toolName: string): string {
  return `${toolName.replaceAll("_", "-")}-input`;
}

/** The head commit a changes read answers its pull request at. */
const decodeHead = Schema.decodeUnknownSync(
  Schema.Struct({ pullRequest: Schema.Struct({ headSha: Schema.String }) }),
);

/** A tool's answer as the agent reads it: whether it is the tool's error, and its JSON text read. */
const decodeAnswer = Schema.decodeUnknownSync(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    content: Schema.Tuple([Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })]),
  }),
);

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = MEMBER_MCP_TEST.ORIGIN;

/** The server over its seeded rows and a GitHub nobody reaches, as most tests here stand it up. */
const standing = memberMcpStanding();

/** The metadata document's address a challenge must name for the resource (RFC 9728). */
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource${MEMBER_MCP_PATH}`;

it.effect(
  "no token, the desktop's opaque token, and a token for another resource are each refused with the challenge naming the metadata; a token without the scope is refused for its scope; a browser's origin is refused",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));
      const desktop = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: DESKTOP_OAUTH_CLIENT.id,
          scope: DESKTOP_OAUTH_CLIENT.scopes,
        }),
      );
      const elsewhere = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: OTHER_RESOURCE,
        }),
      );
      const unscoped = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );

      for (const bearer of [undefined, desktop, elsewhere]) {
        const refused = yield* post(fetch, bearer);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.equal(refused.challenge, `Bearer resource_metadata="${METADATA_URL}"`);
      }
      const forbidden = yield* post(fetch, unscoped);
      assert.equal(forbidden.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.match(
        forbidden.challenge ?? "",
        /^Bearer error="insufficient_scope", scope="vespin:mcp"/u,
      );
      const page = yield* post(fetch, undefined, "https://page.test");
      assert.equal(page.status, HOSTED_HTTP_STATUS.FORBIDDEN);
    }),
);

it.effect.each(Object.values(REVISION))(
  "an SDK client at %s lists every tool as its golden shows it, with its annotations, and runs list_workspaces as the member",
  (revision) =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const { userId, cookie } = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(userId).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );
      const { client, transport } = yield* connected(fetch, token, revision);

      const listed = yield* Effect.promise(() => client.listTools());
      const called = yield* Effect.promise(() =>
        client.callTool({ name: LIST_WORKSPACES_TOOL.name, arguments: {} }),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(transport.protocolVersion, revision);
      const goldens = yield* Effect.forEach(MEMBER_MCP_TOOLS, ({ name, annotations }) =>
        Effect.promise(async () => ({
          name,
          inputSchema: JSON.parse(
            await fs.readFile(path.join(GOLDEN_ROOT, `${goldenOf(name)}.json`), "utf8"),
          ),
          annotations,
        })),
      );
      assert.deepEqual(
        listed.tools.map(({ name, inputSchema, annotations }) => ({
          name,
          inputSchema,
          annotations,
        })),
        goldens,
      );
      assert.notEqual(called.isError, true, JSON.stringify(called));
      const [content] = called.content;
      assert.ok(content?.type === "text");
      assert.deepEqual(decodeListed(JSON.parse(content.text)), {
        workspaces: [
          {
            id: workspaceId,
            slug: `workspace-${workspaceId}`,
            name: "Test Workspace",
            role: WORKSPACE_ROLE.OWNER,
          },
        ],
      });
    }),
);

it.effect(
  "a member with several workspaces lists the one a list names, reads their own tasks, agents, and inbox, and reads, answers, or changes nothing of a workspace they are not in, an agent's pull request among it",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        const second = yield* openWorkspace(member.userId);
        const elsewhere = yield* openWorkspace(stranger.userId);
        const ownTask = yield* createTask(member.userId, {
          organizationId: own,
          name: "Seat billing",
        });
        const strangerTask = yield* createTask(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's task",
        });
        const ownAgent = yield* openTaskAgent(member.userId, own, ownTask.id);
        const strangerAgent = yield* openTaskAgent(stranger.userId, elsewhere, strangerTask.id);
        return {
          own,
          second,
          elsewhere,
          ownTask: ownTask.id,
          strangerTask: strangerTask.id,
          ownAgent,
          strangerAgent,
          ownItem: yield* openInboxItem(member.userId, own, ownTask.id, ownAgent, true),
          strangerItem: yield* openInboxItem(
            stranger.userId,
            elsewhere,
            strangerTask.id,
            strangerAgent,
            true,
          ),
        };
      }).pipe(Effect.provide(services));
      const strangerAsk = yield* readInboxItem(stranger.userId, rows.strangerItem).pipe(
        Effect.map((stored) => Option.getOrThrow(stored).item),
        Effect.provide(services),
      );
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, text: answer.content[0].text };
        });
      const slugOf = (workspaceId: string) => `workspace-${workspaceId}`;

      const unnamed = yield* call(MEMBER_MCP_TOOL.LIST_TASKS, {});
      const tasks = yield* call(MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.own) });
      const agents = yield* call(MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.own) });
      const inbox = yield* call(MEMBER_MCP_TOOL.READ_INBOX, { workspace: slugOf(rows.own) });
      const strangers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.strangerTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_INBOX, { workspace: slugOf(rows.elsewhere) }],
          [
            MEMBER_MCP_TOOL.ANSWER_ASK,
            {
              threadId: rows.strangerItem,
              askId: openAskOf(strangerAsk),
              reply: INBOX_REPLY.CHOSE,
              choices: ["Approve"],
            },
          ],
          [MEMBER_MCP_TOOL.REPLY_TO_THREAD, { threadId: rows.strangerItem, text: "Approve it." }],
          [
            MEMBER_MCP_TOOL.CLOSE_THREAD,
            { threadId: rows.strangerItem, revision: strangerAsk.revision },
          ],
          [
            MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
            {
              agentId: rows.strangerAgent,
              change: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
            },
          ],
        ] as const,
        ([name, args]) => call(name, args),
      );
      const owns = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.ownTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.ownAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.ownAgent }],
        ] as const,
        ([name, args]) => call(name, args),
      );
      yield* Effect.promise(() => client.close());

      // A list that names no workspace is refused where the member has two, naming both and no other.
      assert.equal(unnamed.refused, true);
      assert.ok(
        unnamed.text.includes(slugOf(rows.own)) && unnamed.text.includes(slugOf(rows.second)),
      );
      assert.ok(!unnamed.text.includes(slugOf(rows.elsewhere)));
      assert.deepEqual(
        decodeTasks(JSON.parse(tasks.text)).tasks.map(({ id }) => id),
        [rows.ownTask],
      );
      assert.deepEqual(
        decodeAgents(JSON.parse(agents.text)).agents.map(({ id }) => id),
        [rows.ownAgent],
      );
      assert.deepEqual(
        decodeInbox(JSON.parse(inbox.text)).threads.map(({ id }) => id),
        [rows.ownItem],
      );
      for (const refused of strangers) {
        assert.equal(refused.refused, true, refused.text);
        assert.ok(
          !refused.text.includes(rows.strangerTask) && !refused.text.includes(rows.elsewhere),
        );
      }
      for (const read of owns) assert.equal(read.refused, false, read.text);
      // The stranger's thread stands as it was, its ask open and its thread its agent's alone.
      const after = yield* readInboxItem(stranger.userId, rows.strangerItem).pipe(
        Effect.map((stored) => Option.getOrThrow(stored).item),
        Effect.provide(services),
      );
      assert.deepEqual(after, strangerAsk);
    }),
);

it.effect(
  "a member makes, starts, messages, stops, changes, plans, comments, remembers, and runs nothing in a workspace they are not in",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* memoryOn(member.userId);
        const elsewhere = yield* openWorkspace(stranger.userId);
        const task = yield* createTask(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's task",
        });
        const sectionId = randomUUID();
        yield* writeTaskSections(stranger.userId, {
          kind: TASK_SECTION_WRITE.CREATE,
          id: sectionId,
          workspaceId: elsewhere,
          title: "A stranger's section",
        });
        const automation = yield* createAutomation(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's automation",
          trigger: WEEKLY,
          action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Sweep." },
          guards: AUTOMATION_DEFAULT_GUARDS,
          nextRunAt: null,
          webhookSecretHash: null,
        });
        yield* recordMemberPlanNotes(
          { userId: stranger.userId, taskId: task.id },
          { notes: [PLAN_NOTE] },
        );
        const { text } = Option.getOrThrow(yield* readTask(stranger.userId, task.id));
        const from = text.indexOf(PLAN_NOTE.text);
        const started = yield* startPlanCommentThread(
          { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: stranger.userId },
          task.id,
          {
            clientKey: randomUUID(),
            scope: PLAN_COMMENT_SCOPE.WORDS,
            quote: PLAN_NOTE.text,
            anchor: { from, to: from + PLAN_NOTE.text.length },
            text,
            words: "A stranger's comment.",
          },
        );
        assert.ok(started.status === PLAN_COMMENT_OUTCOME.DONE && "thread" in started.answer);
        const kept = yield* rememberMemory(
          elsewhere,
          stranger.userId,
          "A stranger's convention.",
          undefined,
        );
        assert.ok("memory" in kept);
        return {
          own,
          elsewhere,
          text,
          taskId: task.id,
          sectionId,
          threadId: started.answer.thread.id,
          memoryId: kept.memory.id,
          automationId: Option.getOrThrow(automation).id,
          agentId: yield* openTaskAgent(stranger.userId, elsewhere, task.id),
        };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const workspace = `workspace-${rows.elsewhere}`;
      const { taskId, agentId, threadId, memoryId, automationId } = rows;

      const answers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.CREATE_TASK, { workspace, name: "Planted" }],
          [MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, name: "Renamed" }],
          [
            MEMBER_MCP_TOOL.EDIT_PLAN,
            { taskId, notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Planted." }] },
          ],
          [MEMBER_MCP_TOOL.CREATE_SECTION, { workspace, title: "Planted" }],
          [MEMBER_MCP_TOOL.DELETE_SECTION, { sectionId: rows.sectionId }],
          [MEMBER_MCP_TOOL.START_AGENT, { taskId }],
          [MEMBER_MCP_TOOL.START_AGENT, { workspace, prompt: "Go." }],
          [MEMBER_MCP_TOOL.START_AGENT, { from: { agentId } }],
          [MEMBER_MCP_TOOL.MESSAGE_AGENT, { agentId, text: "Hello." }],
          [MEMBER_MCP_TOOL.STOP_AGENT, { agentId }],
          [MEMBER_MCP_TOOL.UPDATE_AGENT, { agentId, archived: true }],
          [MEMBER_MCP_TOOL.READ_COMMENTS, { taskId }],
          [MEMBER_MCP_TOOL.COMMENT_ON_PLAN, { taskId, quote: PLAN_NOTE.text, words: "Planted." }],
          [MEMBER_MCP_TOOL.REPLY_TO_COMMENT, { taskId, thread: threadId, words: "Planted." }],
          [MEMBER_MCP_TOOL.UPDATE_COMMENT, { taskId, thread: threadId, resolved: true }],
          [MEMBER_MCP_TOOL.SEARCH_MEMORY, { workspace }],
          [MEMBER_MCP_TOOL.SAVE_MEMORY, { workspace, text: "Planted." }],
          // Note that the member's own workspace holds no memory of that id, so a correction of it is refused.
          [
            MEMBER_MCP_TOOL.SAVE_MEMORY,
            { workspace: `workspace-${rows.own}`, text: "Planted.", replaces: memoryId },
          ],
          [MEMBER_MCP_TOOL.FORGET_MEMORY, { workspace, memoryId }],
          [MEMBER_MCP_TOOL.LIST_AUTOMATIONS, { workspace }],
          [MEMBER_MCP_TOOL.LIST_AUTOMATIONS, { automationId }],
          [
            MEMBER_MCP_TOOL.CREATE_AUTOMATION,
            { workspace, name: "Planted", prompt: "Go.", trigger: WEEKLY },
          ],
          [MEMBER_MCP_TOOL.UPDATE_AUTOMATION, { automationId, name: "Renamed" }],
          [MEMBER_MCP_TOOL.RUN_AUTOMATION, { automationId }],
          [MEMBER_MCP_TOOL.DELETE_AUTOMATION, { automationId }],
        ] as const,
        ([name, args]) =>
          Effect.promise(async () => {
            const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
            return { name, refused: answer.isError === true, text: answer.content[0].text };
          }),
      );
      // A forget in the member's own workspace of a memory of another's forgets nothing there.
      yield* Effect.promise(() =>
        client.callTool({
          name: MEMBER_MCP_TOOL.FORGET_MEMORY,
          arguments: { workspace: `workspace-${rows.own}`, memoryId },
        }),
      );
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: yield* readTask(stranger.userId, taskId),
          sections: yield* listTaskSections(stranger.userId),
          agent: yield* readAgent(stranger.userId, agentId),
          threads: yield* readPlanCommentThreads(stranger.userId, taskId),
          memories: yield* listMemories(rows.elsewhere),
          ownMemories: yield* listMemories(rows.own),
          automation: yield* readAutomation(stranger.userId, automationId),
          runs: yield* listAutomationRuns(stranger.userId, automationId),
        };
      }).pipe(Effect.provide(services));

      // A delete of a section the member keeps none of is deleted as nothing, as the sidebar's is.
      for (const answer of answers) {
        const deletes = answer.name === MEMBER_MCP_TOOL.DELETE_SECTION;
        assert.equal(answer.refused, !deletes, `${answer.name}: ${answer.text}`);
        assert.ok(
          !answer.text.includes(taskId) &&
            !answer.text.includes(rows.elsewhere) &&
            !answer.text.includes("A stranger's"),
        );
      }
      const task = Option.getOrThrow(after.task);
      assert.equal(task.task.name, "A stranger's task");
      assert.equal(task.text, rows.text);
      assert.deepEqual(
        Option.getOrThrow(after.threads).map((thread) => ({
          status: thread.status,
          comments: thread.entries.map(({ words }) => words),
        })),
        [{ status: PLAN_COMMENT_STATUS.OPEN, comments: ["A stranger's comment."] }],
      );
      assert.deepEqual(
        after.memories.map(({ text }) => text),
        ["A stranger's convention."],
      );
      assert.deepEqual(after.ownMemories, []);
      assert.deepEqual(
        after.sections.sections.map(({ id }) => id),
        [rows.sectionId],
      );
      assert.equal(Option.getOrThrow(after.agent).archivedAt, null);
      assert.equal(Option.getOrThrow(after.automation).name, "A stranger's automation");
      assert.deepEqual(after.runs, []);
    }),
);

it.effect(
  "a task a member makes, its plan's notes, an agent they archive, and an automation they make, change, run, and delete are the member's own, as the desktop shows them",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const agentId = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* plansFor(member.userId, true);
        return yield* openTaskAgent(member.userId, own, null);
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
          return JSON.parse(answer.content[0].text);
        });

      const made = decodeMade(
        yield* call(MEMBER_MCP_TOOL.CREATE_TASK, {
          name: "Seat billing",
          plan: "## Problem\n\nSeats drift.",
        }),
      );
      const taskId = made.task.id;
      yield* call(MEMBER_MCP_TOOL.EDIT_PLAN, {
        taskId,
        notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Invoices lag too." }],
      });
      yield* call(MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, status: TASK_STATUS.IN_PROGRESS });
      yield* call(MEMBER_MCP_TOOL.UPDATE_AGENT, { agentId, archived: true, reason: "Done." });
      const automationId = decodeAutomation(
        yield* call(MEMBER_MCP_TOOL.CREATE_AUTOMATION, {
          name: "Weekly sweep",
          prompt: "Sweep.",
          trigger: WEEKLY,
        }),
      ).automation.id;
      yield* call(MEMBER_MCP_TOOL.UPDATE_AUTOMATION, { automationId, name: "Monday sweep" });
      yield* call(MEMBER_MCP_TOOL.RUN_AUTOMATION, { automationId });
      const automations = yield* Effect.gen(function* () {
        return {
          made: Option.getOrThrow(yield* readAutomation(member.userId, automationId)),
          runs: yield* listAutomationRuns(member.userId, automationId),
        };
      }).pipe(Effect.provide(services));
      yield* call(MEMBER_MCP_TOOL.DELETE_AUTOMATION, { automationId });
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: Option.getOrThrow(yield* readTask(member.userId, taskId)),
          revisions: yield* listRevisions(member.userId, taskId),
          agent: Option.getOrThrow(yield* readAgent(member.userId, agentId)),
          automation: yield* readAutomation(member.userId, automationId),
        };
      }).pipe(Effect.provide(services));

      assert.equal(after.task.ownerId, member.userId);
      assert.equal(after.task.task.status, TASK_STATUS.IN_PROGRESS);
      assert.equal(after.task.text, "## Problem\n\nSeats drift.\n\nInvoices lag too.");
      // The plan's first text and the note are the member's own, as their window writes it, and no agent's.
      assert.deepEqual(
        [...new Set(after.revisions.revisions.map(({ lastEdit }) => lastEdit.actor))],
        [PLAN_ACTOR.DEVELOPER],
      );
      assert.deepEqual(after.agent.archivedBy, {
        by: AGENT_ARCHIVER.MEMBER,
        userId: member.userId,
        reason: "Done.",
      });
      // The automation is the member's, in no repository since they work in none, and its run is their Run now.
      assert.deepEqual(
        [automations.made.userId, automations.made.name, automations.made.repositories],
        [member.userId, "Monday sweep", []],
      );
      assert.deepEqual(
        automations.runs.map(({ firing }) => firing),
        [{ kind: AUTOMATION_FIRING.MANUAL, userId: member.userId }],
      );
      assert.ok(Option.isNone(after.automation));
    }),
);

it.effect(
  "an outside agent marks the member's agent's draft ready and merges it against the head read_agent_changes answered, on the member's own GitHub sign-in as the Pull request tab does, and a teammate with no GitHub sign-in is told to sign in, with nothing made",
  () =>
    Effect.gen(function* () {
      const calls: GraphqlCall[] = [];
      const drafted = publishedPullRequestDrafted(() => true);
      const installation = freshInstallation();
      const github = githubReaching(
        [installation],
        undefined,
        undefined,
        graphqlAnswering(calls, undefined, (sent) =>
          new URL(sent.url).pathname === `/repos/${RELAY_FULL_NAME}/pulls/${PUBLISHED.number}/files`
            ? Response.json([])
            : drafted(sent),
        ),
      );
      const { auth, fetch, services } = yield* memberMcpStanding({ github: github.layer });
      const member = yield* Effect.promise(() => signUp(auth));
      const teammate = yield* Effect.promise(() => signUp(auth));
      const agentId = yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* signInWithGitHub(member.userId, {
          ...standingGithubRow(now),
          accessToken: MEMBER_GITHUB_TOKEN,
        });
        const workspaceId = yield* openWorkspace(member.userId);
        yield* joinWorkspace(workspaceId, teammate.userId);
        yield* connectWorkspaceGitHub(workspaceId, installation);
        const task = yield* createTask(member.userId, {
          organizationId: workspaceId,
          name: "Teammate invitations",
        });
        const id = yield* openTaskAgent(member.userId, workspaceId, task.id);
        // The agent pushed its branch to the repository the installation reaches, from which its draft stands open.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({
              repository: RELAY_FULL_NAME,
              branch: PUBLISHED.branch,
            })
            .where(eq(agentTable.id, id)),
        );
        return id;
      }).pipe(Effect.provide(services));
      const clientOf = (cookie: string) =>
        Effect.flatMap(
          Effect.promise(() =>
            mintedToken(auth, cookie, {
              clientId: MCP_CLIENT.id,
              scope: [MEMBER_MCP_SCOPE.MCP],
              resource: RESOURCE,
            }),
          ),
          (token) => Effect.map(connected(fetch, token, REVISION.MODERN), ({ client }) => client),
        );
      const memberClient = yield* clientOf(member.cookie);
      const teammateClient = yield* clientOf(teammate.cookie);
      const act = (client: Client, change: Record<string, string>) =>
        Effect.promise(async () =>
          decodeAnswer(
            await client.callTool({
              name: MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
              arguments: { agentId, change },
            }),
          ),
        );

      const unsigned = yield* act(teammateClient, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW });
      const ready = yield* act(memberClient, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW });
      const changes = yield* Effect.promise(async () =>
        decodeAnswer(
          await memberClient.callTool({
            name: MEMBER_MCP_TOOL.READ_AGENT_CHANGES,
            arguments: { agentId },
          }),
        ),
      );
      const { headSha } = decodeHead(JSON.parse(changes.content[0].text)).pullRequest;
      const merged = yield* act(memberClient, {
        action: PULL_REQUEST_ACTION.MERGE,
        method: "squash",
        headSha,
      });
      yield* Effect.promise(() => Promise.all([memberClient.close(), teammateClient.close()]));

      assert.equal(unsigned.isError, true);
      assert.match(unsigned.content[0].text, /sign in with GitHub/u);
      for (const answer of [ready, merged]) {
        assert.notEqual(answer.isError, true, answer.content[0].text);
        assert.deepEqual(JSON.parse(answer.content[0].text), { status: "accepted" });
      }
      assert.equal(headSha, PUBLISHED.headSha);
      const id = PULL_REQUEST_NODE_ID;
      assert.deepEqual(
        calls.flatMap((call) => {
          const mutation = mutationOf(call);
          return mutation === undefined ? [] : [[mutation, call.variables, call.authorization]];
        }),
        [
          ["markPullRequestReadyForReview", { id }, `Bearer ${MEMBER_GITHUB_TOKEN}`],
          [
            "mergePullRequest",
            { id, method: "SQUASH", head: PUBLISHED.headSha },
            `Bearer ${MEMBER_GITHUB_TOKEN}`,
          ],
        ],
      );
    }),
);

it.layer(getTestDB())("the member's inbox over a started agent", (it) => {
  it.effect(
    "an outside agent reads the decide ask waiting on the member, answers it, and the agent that asked takes the answer up as the member's",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, mcpFetch } = yield* openTask({ eve });
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const sessionId = eve.opened[0]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        const posted = yield* postInboxThread(
          { userId: owner, taskId: task.id, agentId: agent.id },
          {
            key: "invite-expiry",
            title: "How long should an invitation stand?",
            body: "An invitation nobody accepts expires after this.",
            ask: { type: INBOX_ASK.DECIDE, options: [{ label: "7 days" }, { label: "30 days" }] },
          },
        );
        assert.ok(Result.isSuccess(posted));
        const askId = openAskOf(posted.success);
        const before = eve.sent.length;
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.promise(async () =>
            decodeAnswer(await client.callTool({ name, arguments: args })),
          );

        const read = yield* call(MEMBER_MCP_TOOL.READ_INBOX, {});
        const answered = yield* call(MEMBER_MCP_TOOL.ANSWER_ASK, {
          threadId: posted.success.id,
          askId,
          reply: INBOX_REPLY.CHOSE,
          choices: ["30 days"],
        });
        yield* Effect.promise(() => client.close());

        assert.notEqual(read.isError, true, read.content[0].text);
        const [waiting] = decodeInbox(JSON.parse(read.content[0].text)).threads;
        assert.deepEqual(
          [
            waiting?.id,
            waiting?.askId,
            waiting?.waitsOnMember,
            waiting?.thread.at(-1)?.ask?.options?.map(({ label }) => label),
          ],
          [posted.success.id, askId, true, ["7 days", "30 days"]],
        );
        assert.notEqual(answered.isError, true, answered.content[0].text);
        assert.equal(
          decodeWritten(JSON.parse(answered.content[0].text)).thread.status,
          INBOX_STATUS.ANSWERED,
        );
        // The answer is handed to the session the agent runs in, as the member's message its next turn opens on.
        assert.deepEqual(
          eve.sent.slice(before).map((each) => [each.authorization, each.sessionId]),
          [[harnessFor(owner), sessionId]],
        );
        const handed = JSON.stringify(eve.sent.at(-1)?.message.message);
        assert.ok(handed.includes(INBOX_ANSWER_LEAD) && handed.includes("30 days"), handed);
      }),
  );
});

it.effect(
  "a member's thread and reply are their own and reach the agent in the thread as the window's do, and resolving settles it; with Plans off no thread is started on the plan",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services, heard } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const { taskId, agentId } = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* plansFor(member.userId, true);
        yield* connectAgentApiKeys(member.userId);
        const task = yield* createTask(member.userId, { organizationId: own, name: "Seats" });
        yield* recordMemberPlanNotes(
          { userId: member.userId, taskId: task.id },
          { notes: [PLAN_NOTE] },
        );
        return { taskId: task.id, agentId: yield* standingAgent(member.userId, task.id) };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
          return JSON.parse(answer.content[0].text);
        });
      const mention = `[@Seats](https://vespin.dev/acme/plan/${taskId}/agent/${agentId})`;

      const { thread } = decodeThread(
        yield* call(MEMBER_MCP_TOOL.COMMENT_ON_PLAN, {
          taskId,
          quote: PLAN_NOTE.text,
          words: `${mention} do seats still drift?`,
        }),
      );
      yield* call(MEMBER_MCP_TOOL.REPLY_TO_COMMENT, { taskId, thread, words: "Invoices too." });
      const open = decodeThreads(yield* call(MEMBER_MCP_TOOL.READ_COMMENTS, { taskId }));
      const resolved = decodeThread(
        yield* call(MEMBER_MCP_TOOL.UPDATE_COMMENT, { taskId, thread, resolved: true }),
      );
      yield* plansFor(member.userId, false).pipe(Effect.provide(services));
      const planless = decodeAnswer(
        yield* Effect.promise(() =>
          client.callTool({
            name: MEMBER_MCP_TOOL.COMMENT_ON_PLAN,
            arguments: { taskId, quote: PLAN_NOTE.text, words: "Still drifting?" },
          }),
        ),
      );
      yield* Effect.promise(() => client.close());
      const lines = yield* Effect.gen(function* () {
        const db = yield* Database;
        return yield* db
          .select({ words: sql<string>`${messages.metadata} ->> 'words'` })
          .from(messages)
          .where(sql`${messages.metadata} ->> 'thread_id' = ${thread}`);
      }).pipe(Effect.provide(services));
      const stored = yield* readPlanCommentThreads(member.userId, taskId).pipe(
        Effect.provide(services),
      );

      assert.deepEqual(
        open.threads.map((read) => ({
          thread: read.thread,
          on: read.on,
          comments: read.comments.map(({ words }) => words),
        })),
        [
          {
            thread,
            on: PLAN_NOTE.text,
            comments: [`${mention} do seats still drift?`, "Invoices too."],
          },
        ],
      );
      assert.equal(resolved.state, PLAN_COMMENT_STATUS.RESOLVED);
      assert.equal(planless.isError, true);
      assert.match(planless.content[0].text, /has Plans off/u);
      // The thread was handed to the agent once for each comment, as the member's words, as a reply in the window hands it.
      assert.deepEqual(
        lines.map(({ words }) => words),
        [`${mention} do seats still drift?`, "Invoices too."],
      );
      assert.deepEqual(
        heard.map(({ account }) => account),
        [member.userId, member.userId],
      );
      const entries = Option.getOrThrow(stored)[0]?.entries ?? [];
      assert.deepEqual(
        entries
          .filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT)
          .map((entry) => [entry.writer.actor, entry.writer.by?.userId]),
        [
          [PLAN_COMMENT_ACTOR.MEMBER, member.userId],
          [PLAN_COMMENT_ACTOR.MEMBER, member.userId],
        ],
      );
    }),
);

it.effect(
  "a member with Memory on keeps a memory Settings › Memory lists as theirs, finds it, corrects it, and forgets it; with Memory off nothing runs",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(member.userId).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          clientId: MCP_CLIENT.id,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, read: JSON.parse(answer.content[0].text) };
        });
      const settings = readWorkspaceMemories(member.userId, workspaceId).pipe(
        Effect.provide(services),
      );

      const off = yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, { text: "Tests run on PGlite." });
      yield* memoryOn(member.userId).pipe(Effect.provide(services));
      const kept = decodeKept(
        (yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, { text: "Tests run on PGlite." })).read,
      );
      const listed = yield* settings;
      const found = decodeFound(
        (yield* call(MEMBER_MCP_TOOL.SEARCH_MEMORY, { query: "pglite" })).read,
      );
      yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, {
        text: "Tests run on PGlite through test:store.",
        replaces: kept.memory.id,
      });
      const corrected = yield* settings;
      const forgot = yield* call(MEMBER_MCP_TOOL.FORGET_MEMORY, { memoryId: kept.memory.id });
      const forgotten = yield* settings;
      yield* Effect.promise(() => client.close());

      assert.equal(off.refused, true);
      assert.ok(listed.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(
        listed.memories.map(({ id, text, keptBy }) => ({ id, text, keptBy: keptBy?.userId })),
        [{ id: kept.memory.id, text: "Tests run on PGlite.", keptBy: member.userId }],
      );
      assert.deepEqual(
        found.memories.map(({ id }) => id),
        [kept.memory.id],
      );
      assert.ok(corrected.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(
        corrected.memories.map(({ id, text }) => ({ id, text })),
        [{ id: kept.memory.id, text: "Tests run on PGlite through test:store." }],
      );
      assert.equal(forgot.refused, false);
      assert.ok(forgotten.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(forgotten.memories, []);
    }),
);

it.effect("the metadata names the resource, the auth service, the scopes, and the header", () =>
  Effect.gen(function* () {
    const { fetch } = yield* standing;
    const answered = yield* Effect.promise(() => fetch(`${ORIGIN}${MEMBER_MCP_METADATA_ROUTE}`));
    assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
    const metadata = decodeMetadata(yield* Effect.promise(() => answered.json()));
    assert.equal(metadata.resource, RESOURCE);
    assert.deepEqual(metadata.authorization_servers, [memberMcpIssuer(ORIGIN)]);
    assert.deepEqual(metadata.scopes_supported, Object.values(MEMBER_MCP_SCOPE));
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  }),
);

it.each(MEMBER_MCP_TOOLS.map((tool) => [tool.name, tool] as const))(
  "%s shows the model the recorded input",
  async (name, tool) => {
    await settleJsonSchemaGolden(GOLDEN_ROOT, goldenOf(name), tool.input);
  },
);
