/**
 * coding-agent.ts -- the shots' canned coding agents on the "Teammate invitations" plan: a finished one with its transcript, pull request, and changes, a second still at work, and the models they run on.
 *
 * Throwaway (`README.md`). The finished agent, "Add teammate invitations",
 * ran on Claude Opus 5.5 at high effort: it read the plan, kept a to-do
 * list, handed a search to a subagent, wrote the migration and the invite
 * route, ran the members tests, checked the developer's local database on
 * their Mac (`run_on_mac`, so "On your Mac" draws), and opened #214 with its
 * checks passing. Every id is a UUID and every model id is one AI Gateway's
 * catalog lists. Spread {@link codingAgentAnswers} into a shot's answers.
 */

import type {
  CodingAgentChangesAnswerView,
  CodingAgentDefaultAnswer,
  CodingAgentListAnswer,
  CodingAgentMessagesAnswerView,
  CodingAgentModelsAnswer,
  CodingAgentPullRequestAnswerView,
} from "@luke/features/coding-agent-view";
import type { CodingAgentMessage, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { WireRecord, WireValue } from "@luke/wire";
import { ACT_KIND } from "@luke/host/acts";
import { ago } from "./clock";
import {
  AGENT_2_TITLE,
  AGENT_TITLE,
  TASK_NAME,
  TASK_REPOSITORY,
  SHOT_DOCUMENT_TEXT,
  SHOT_ID,
} from "./plan-document";
import { NEVER, type ShotAnswers } from "./shot-spec";

/** The catalog ids the agents run on, as AI Gateway's catalog spells them. */
export const MODEL = {
  OPUS: "anthropic/claude-opus-5.5",
  SONNET: "anthropic/claude-sonnet-5.5",
  HAIKU: "anthropic/claude-haiku-5.5",
  SOL: "openai/gpt-6.1-sol",
  GPT_55: "openai/gpt-5.5",
} as const;

/** The cursor the one page of a transcript ends on. */
const READ_THROUGH = "1:0";

/** The cursor a reader starts from. */
const START = "0:0";

/** The subagent the finished agent handed a search to, by eve's id for the call. */
export const DELEGATE_CALL_ID = "call_7mQ2rWd9";

/** The turn ids, one per agent. */
const TURN_ID = {
  AGENT: "a4c6e8f0-1b3d-4f5a-8c7e-9d0b1c2d3e4f",
  AGENT_2: "b5d7f901-2c4e-4a6b-9d8f-0e1c2d3e4f50",
} as const;

/** The models the menus offer, in the catalog's order. */
export function shotModels(): CatalogModel[] {
  return [
    {
      id: MODEL.OPUS,
      name: "Claude Opus 5.5",
      provider: "anthropic",
      efforts: ["low", "medium", "high", "max"],
    },
    {
      id: MODEL.SONNET,
      name: "Claude Sonnet 5.5",
      provider: "anthropic",
      efforts: ["low", "medium", "high"],
    },
    { id: MODEL.HAIKU, name: "Claude Haiku 5.5", provider: "anthropic", efforts: ["low", "high"] },
    {
      id: MODEL.SOL,
      name: "GPT-6.1 Sol",
      provider: "openai",
      efforts: ["low", "medium", "high", "xhigh"],
    },
    { id: MODEL.GPT_55, name: "GPT-5.5", provider: "openai", efforts: ["low", "medium", "high"] },
  ];
}

/** The plan's two agents, in the order started: the finished one, then the one at work. */
export function shotAgents(): CodingAgentSummary[] {
  return [
    {
      id: SHOT_ID.AGENT,
      taskId: SHOT_ID.TASK,
      model: MODEL.OPUS,
      effort: "high",
      title: AGENT_TITLE,
      createdAt: ago(31),
      status: "completed",
      turnId: TURN_ID.AGENT,
      runStartedAt: ago(31),
      brief: "plan",
    },
    {
      id: SHOT_ID.AGENT_2,
      taskId: SHOT_ID.TASK,
      model: MODEL.SOL,
      effort: "high",
      title: AGENT_2_TITLE,
      createdAt: ago(6),
      status: "running",
      turnId: TURN_ID.AGENT_2,
      runStartedAt: ago(6),
      brief: "task",
    },
  ];
}

/** One finished tool call, as the SDK stores its part. */
function toolPart(
  tool: string,
  toolCallId: string,
  input: WireRecord,
  output: WireValue,
): WireRecord {
  return { type: `tool-${tool}`, toolCallId, state: "output-available", input, output };
}

/** A command the sandbox ran, answered as eve's bash tool answers. */
function bash(
  toolCallId: string,
  command: string,
  stdout: string,
  description?: string,
): WireRecord {
  return toolPart(
    "bash",
    toolCallId,
    description === undefined ? { command } : { command, description },
    { status: "completed", exitCode: 0, stdout, stderr: "", truncated: false },
  );
}

/** The to-do list as the agent left it: every item done. */
const TODOS = [
  "Add `state` to memberships with a `pending` value",
  "POST /invites: create the pending membership and mail the link",
  "Accept link: /invites/:token turns the membership active",
  "Filter pending invites out of member queries",
  "Tests for invite, accept, and withdraw",
  "Open the pull request",
];

const MIGRATION_PATCH = [
  "*** Begin Patch",
  "*** Add File: src/db/migrations/20261013_memberships_state.sql",
  "+ALTER TABLE memberships ADD COLUMN state text NOT NULL DEFAULT 'active';",
  "+ALTER TABLE memberships ADD COLUMN invite_token text UNIQUE;",
  "+ALTER TABLE memberships ADD COLUMN invited_by uuid REFERENCES users(id);",
  "*** Update File: src/db/schema/memberships.ts",
  "@@",
  "   role: text('role').notNull(),",
  "+  state: text('state', { enum: ['pending', 'active'] }).notNull().default('active'),",
  "+  inviteToken: text('invite_token').unique(),",
  "*** Add File: src/members/invite.ts",
  "+export async function inviteMember(workspaceId: string, email: string) {",
  "+  const token = randomToken();",
  "+  const membership = await db.memberships.insert({ workspaceId, email, state: 'pending', inviteToken: token });",
  "+  await mail.invite(email, acceptUrl(token));",
  "+  return membership;",
  "+}",
  "*** End Patch",
].join("\n");

const TEST_OUTPUT = [
  " RUN  v3.2.4 /workspace/repository",
  "",
  " ✓ src/members/invite.test.ts (6 tests) 412ms",
  " ✓ src/members/accept.test.ts (4 tests) 298ms",
  " ✓ src/members/remove.test.ts (5 tests) 187ms",
  "",
  " Test Files  3 passed (3)",
  "      Tests  15 passed (15)",
].join("\n");

/** The finished agent's transcript: its brief, then the one turn that did the work. */
export function shotAgentMessages(): CodingAgentMessage[] {
  return [
    {
      id: "m-plan",
      role: "user",
      parts: [{ type: "text", text: `# ${TASK_NAME}\n\n${SHOT_DOCUMENT_TEXT}` }],
    },
    {
      id: "m-turn-1",
      role: "assistant",
      startedAt: ago(31),
      finishedAt: ago(12),
      model: MODEL.OPUS,
      effort: "high",
      tokens: { inputTokens: 1_284_220, outputTokens: 19_870, cachedInputTokens: 1_151_400 },
      parts: [
        { type: "step-start" },
        {
          type: "reasoning",
          text: "The plan models an invite as a pending membership. Before touching anything, read the memberships schema and how removal works, since invites should follow it.",
        },
        toolPart(
          "write_todos",
          "call_1a",
          { todos: TODOS.map((content) => ({ content, status: "done" })) },
          { ok: true },
        ),
        bash(
          "call_2b",
          'grep -rn "memberships" src/db/schema src/members',
          "src/db/schema/memberships.ts:4:export const memberships = pgTable('memberships', {\n" +
            "src/members/remove.ts:12:  await db.delete(memberships).where(eq(memberships.id, id));\n" +
            "src/members/list.ts:8:  return db.select().from(memberships).where(eq(memberships.workspaceId, id));",
        ),
        toolPart(
          "read_file",
          "call_3c",
          { filePath: "/workspace/repository/src/members/remove.ts" },
          {
            content:
              "export async function removeMember(member: Member, by: Member) {\n  assertAdmin(by);\n  await db.delete(memberships).where(eq(memberships.id, member.id));\n}\n",
          },
        ),
        toolPart(
          "delegate",
          DELEGATE_CALL_ID,
          {
            task: "Find every query that reads memberships without filtering on state, so a pending invite never counts as a member.",
            model: MODEL.SONNET,
            effort: "medium",
          },
          {
            model: MODEL.SONNET,
            effort: "medium",
            result:
              "Three reads need a state filter: src/members/list.ts:8, src/billing/seats.ts:21, and src/auth/workspace-access.ts:34.",
          },
        ),
        toolPart(
          "apply_patch",
          "call_5e",
          { root: "/workspace/repository", patchText: MIGRATION_PATCH },
          {
            files: [
              { operation: "add", path: "src/db/migrations/20261013_memberships_state.sql" },
              { operation: "update", path: "src/db/schema/memberships.ts" },
              { operation: "add", path: "src/members/invite.ts" },
            ],
          },
        ),
        bash("call_6f", "pnpm test src/members", TEST_OUTPUT, "Run the members tests"),
        toolPart(
          "run_on_mac",
          "call_7g",
          {
            command: 'psql relay_dev -c "select state, count(*) from memberships group by state"',
            description: "Check the local database's memberships",
          },
          {
            stdout: " state  | count\n--------+-------\n active |    42\n(1 row)\n",
            stderr: "",
            exitCode: 0,
          },
        ),
        bash(
          "call_8h",
          'gh pr create --title "Add teammate invitations" --fill',
          "https://github.com/acme/relay/pull/214\n",
        ),
        { type: "step-start" },
        {
          type: "text",
          text:
            "Opened [#214](https://github.com/acme/relay/pull/214). An invite is a `memberships` row with `state = pending`; " +
            "`POST /invites` creates it and mails a one-time link, and `/invites/:token` turns it active once the visitor signs in. " +
            "The three reads that counted members now skip pending rows. `pnpm test src/members` passes, and so do the checks.",
        },
      ],
    },
  ];
}

/** The subagent's own transcript, under the finished agent. */
function shotWorkerMessages(): CodingAgentMessage[] {
  return [
    {
      id: "w-turn-1",
      role: "assistant",
      startedAt: ago(27),
      finishedAt: ago(25),
      model: MODEL.SONNET,
      effort: "medium",
      parts: [
        { type: "step-start" },
        bash(
          "call_w1",
          'grep -rn "from(memberships)" src',
          "src/members/list.ts:8\nsrc/billing/seats.ts:21\nsrc/auth/workspace-access.ts:34",
        ),
        {
          type: "text",
          text: "Three reads need a state filter: src/members/list.ts:8, src/billing/seats.ts:21, and src/auth/workspace-access.ts:34.",
        },
      ],
    },
  ];
}

/** The agent still at work: its task, and the first steps of its turn. */
function shotRunningMessages(): CodingAgentMessage[] {
  return [
    {
      id: "r-task",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Send the invite email through Postmark, with the workspace's name in the subject.",
        },
      ],
    },
    {
      id: "r-turn-1",
      role: "assistant",
      startedAt: ago(6),
      parts: [
        { type: "step-start" },
        bash(
          "call_r1",
          'grep -rn "postmark" src',
          "src/mail/client.ts:3:import { ServerClient } from 'postmark';",
        ),
      ],
    },
  ];
}

/** One page of a transcript read past `after`: everything at the start, then nothing more. */
function transcriptPage(
  agentId: string,
  after: string,
  callId: string | undefined,
): CodingAgentMessagesAnswerView | typeof NEVER | undefined {
  const first = after === START;
  if (agentId === SHOT_ID.AGENT && callId === DELEGATE_CALL_ID) {
    return {
      messages: first ? shotWorkerMessages() : [],
      cursor: READ_THROUGH,
      status: "completed",
      title: "Find unfiltered membership reads",
    };
  }
  if (agentId === SHOT_ID.AGENT) {
    return {
      messages: first ? shotAgentMessages() : [],
      cursor: READ_THROUGH,
      status: "completed",
      runStartedAt: ago(31),
      title: AGENT_TITLE,
      subagentTitles: [{ callId: DELEGATE_CALL_ID, title: "Find unfiltered membership reads" }],
      subagents: [
        {
          callId: DELEGATE_CALL_ID,
          status: "completed",
          model: MODEL.SONNET,
          effort: "medium",
          startedAt: ago(27),
        },
      ],
      usage: {
        inputTokens: 1_331_000,
        outputTokens: 21_430,
        cachedInputTokens: 1_190_200,
        costUsd: 4.12,
      },
      turnUsage: {
        inputTokens: 1_284_220,
        outputTokens: 19_870,
        cachedInputTokens: 1_151_400,
        costUsd: 3.86,
      },
    };
  }
  if (agentId === SHOT_ID.AGENT_2) {
    // The running agent's hold never lets go once its page is read.
    if (!first) return NEVER;
    return {
      messages: shotRunningMessages(),
      cursor: READ_THROUGH,
      status: "running",
      runStartedAt: ago(6),
      title: AGENT_2_TITLE,
    };
  }
  return undefined;
}

/** What the finished agent published: its branch and #214, open, its checks passing. */
export function shotPullRequest(agentId: string): CodingAgentPullRequestAnswerView {
  if (agentId === SHOT_ID.AGENT_2) {
    return {
      repository: TASK_REPOSITORY,
      branch: "luke/invite-emails",
      pullRequest: {
        number: 216,
        title: "Send invite emails through Postmark",
        url: "https://github.com/acme/relay/pull/216",
        state: "draft",
        checks: "pending",
        additions: 96,
        deletions: 4,
        changedFiles: 3,
      },
    };
  }
  return {
    repository: TASK_REPOSITORY,
    branch: "luke/teammate-invitations",
    pullRequest: {
      number: 214,
      title: "Add teammate invitations",
      url: "https://github.com/acme/relay/pull/214",
      state: "open",
      checks: "passing",
      additions: 412,
      deletions: 38,
      changedFiles: 9,
    },
  };
}

/** One changed file with its patch. */
function changed(
  path: string,
  status: "added" | "modified",
  additions: number,
  deletions: number,
  patch: string,
) {
  return { path, previousPath: null, status, additions, deletions, patch, omitted: null };
}

/** #214's files, the totals the pull request names; E's shot may replace them with a fuller set. */
export function shotChanges(): CodingAgentChangesAnswerView {
  return {
    pullRequest: {
      url: "https://github.com/acme/relay/pull/214",
      truncated: false,
      files: [
        changed(
          "src/db/migrations/20261013_memberships_state.sql",
          "added",
          3,
          0,
          "@@ -0,0 +1,3 @@\n+ALTER TABLE memberships ADD COLUMN state text NOT NULL DEFAULT 'active';\n+ALTER TABLE memberships ADD COLUMN invite_token text UNIQUE;\n+ALTER TABLE memberships ADD COLUMN invited_by uuid REFERENCES users(id);",
        ),
        changed(
          "src/db/schema/memberships.ts",
          "modified",
          3,
          0,
          "@@ -6,6 +6,9 @@ export const memberships = pgTable('memberships', {\n   workspaceId: uuid('workspace_id').notNull(),\n   userId: uuid('user_id'),\n   role: text('role').notNull(),\n+  state: text('state', { enum: ['pending', 'active'] }).notNull().default('active'),\n+  inviteToken: text('invite_token').unique(),\n+  invitedBy: uuid('invited_by'),\n   createdAt: timestamp('created_at').defaultNow(),\n });",
        ),
        changed(
          "src/members/invite.ts",
          "added",
          58,
          0,
          "@@ -0,0 +1,12 @@\n+import { db } from '../db';\n+import { mail } from '../mail';\n+\n+export async function inviteMember(workspaceId: string, email: string) {\n+  const token = randomToken();\n+  const membership = await db.memberships.insert({ workspaceId, email, state: 'pending', inviteToken: token });\n+  await mail.invite(email, acceptUrl(token));\n+  return membership;\n+}\n+\n+export async function acceptInvite(token: string, userId: string) {\n+  return db.memberships.activate(token, userId);",
        ),
        changed(
          "src/members/list.ts",
          "modified",
          1,
          1,
          "@@ -5,7 +5,7 @@ export function listMembers(id: string) {\n-  return db.select().from(memberships).where(eq(memberships.workspaceId, id));\n+  return db.select().from(memberships).where(and(eq(memberships.workspaceId, id), eq(memberships.state, 'active')));\n }",
        ),
      ],
    },
  };
}

/** The finished agent and its sibling as one plan's answers: list, transcripts, pull requests, changes, models, and the default. */
export function codingAgentAnswers(): ShotAnswers {
  const list: CodingAgentListAnswer = { agents: shotAgents() };
  const models: CodingAgentModelsAnswer = { models: shotModels() };
  const defaultChoice: CodingAgentDefaultAnswer = { choice: { model: MODEL.OPUS, effort: "high" } };
  return {
    [ACT_KIND.CODING_AGENTS_LIST]: (payload) =>
      payload.taskId === SHOT_ID.TASK ? list : { agents: [] },
    [ACT_KIND.CODING_AGENTS_MESSAGES]: (payload) =>
      transcriptPage(payload.agentId, payload.after, payload.callId),
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: (payload) => shotPullRequest(payload.agentId),
    [ACT_KIND.CODING_AGENTS_CHANGES]: (payload) =>
      payload.agentId === SHOT_ID.AGENT ? shotChanges() : { pullRequest: null },
    [ACT_KIND.CODING_AGENTS_MODELS]: () => models,
    [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: () => defaultChoice,
  };
}
