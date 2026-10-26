/**
 * agent-fixture.ts -- the synthetic coding agent a fixture run's agent profiles open, and the answers its tabs read in place of the service's.
 *
 * The tasks fixture (`tasks-fixture.ts`) draws a task with no agent, since
 * a fixture run reads nothing. Under an agent profile (`RUN_PROFILE.AGENT_*`)
 * the same task holds one agent, finished, whose pull request waits second
 * in its merge queue with its checks passed, an approval, and a bot's review
 * with a thread on a line; the side panel opens on that pull request's
 * overview, its checks, its Files changed, or its Chapters, on a file of its
 * repository, or on its Terminal in one of the states the tab draws. Every
 * person, repository, and line here is invented; nothing is read from an
 * account.
 *
 * Each read the tabs ask is answered here, through the act door
 * (`act.ts`), as main would answer it with the service behind it. A Terminal
 * attached is answered as main answers one too: a port posted to the window
 * under the terminal channel, carrying the shell's bytes and the state the
 * profile stages.
 */

import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import {
  CHANGED_FILE_STATUS,
  CHECK_STATE,
  CHECK_SUMMARY,
  CODING_AGENT_AUTHOR,
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  CONVERSATION_ENTRY,
  type CodingAgentChangedFile,
  type CodingAgentMessage,
  type CodingAgentSummary,
  DEPLOYMENT_STATE,
  DIFF_SIDE,
  type GitHubPerson,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  REVIEW_DECISION,
  REVIEW_STATE,
} from "@luke/features/coding-agent-wire";
import { CHAPTER_KIND, CHAPTER_RISK, LINE_REF_SIDE } from "@luke/features/pull-request-chapters";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import {
  FILE_VIEWED_STATE,
  MERGE_METHOD,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@luke/features/pull-request-write-wire";
import {
  TASK_FILE_REFUSAL,
  TASK_TREE_ENTRY,
  type TaskSummary,
  type TaskTreeEntry,
} from "@luke/features/task-wire";
import type { TasksView } from "@luke/features/tasks-view";
import {
  TERMINAL_CONNECTION,
  TERMINAL_PORT_CHANNEL,
  TERMINAL_PORT_MESSAGE,
  TERMINAL_REFUSAL,
  type TerminalConnection,
  type TerminalPortOutbound,
} from "@luke/features/terminal-acts";
import { SANDBOX_STATE, type SandboxState } from "@luke/features/terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind, PortActPayload, PortActResult } from "@luke/host/contract";
import { FIXTURE_IDS, FIXTURE_PAGE } from "@luke/host/fixture-stage";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { AsyncIteratorClass } from "@orpc/client";
import { longRunPicture, longRunStream } from "./agent-long-run-fixture.js";
import {
  PULL_REQUEST_VIEW,
  type PullRequestView,
  SIDE_PANEL_TAB,
  type SidePanelState,
  type StagedSidePanel,
} from "./use-side-panel.js";

/** The fixture task's repository (`tasks-fixture.ts`), which the agent works in. */
const REPOSITORY = "ada/relay";

/** The agent's id, its turn's, and its shell's. */
export const FIXTURE_AGENT_ID = FIXTURE_IDS.AGENT;
const TURN_ID = "5d9f3b7c-2e4a-4f6b-8c8d-3e5f7a9b1c2d";
const SHELL_ID = "6e0a4c8d-3f5b-4a7c-9d9e-4f6a8b0c2d3e";

/** When the agent began, and its turn's steps after it, by the service's clock. */
const STARTED_AT = Date.parse("2026-10-07T16:42:00Z");
const MINUTE = 60_000;

/** The pull request it opened, from its branch, and the commits its head and base stand at. */
const PULL_REQUEST = {
  number: 214,
  title: "feat(members): invite a teammate by email",
  url: `https://github.com/${REPOSITORY}/pull/214`,
  head: "luke/teammate-invitations",
  base: "main",
  headSha: "3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e3b5d7f9a",
  baseSha: "8b2d4f6a0c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d",
} as const;

/** The people on the pull request: the developer who started the agent, a teammate who approved it, and a review bot. */
const ADA: GitHubPerson = { login: "ada", bot: false };
const GRACE: GitHubPerson = { login: "grace", bot: false };
const REVIEW_BOT: GitHubPerson = { login: "review-bot[bot]", bot: true };

/** The new file the agent wrote, as its File tab and its diff both read it. */
const INVITE_LINES: readonly string[] = [
  'import { db } from "../db.js";',
  'import { sendInviteEmail } from "../email/invite.js";',
  "",
  "const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;",
  "",
  "// An invite is a pending membership, so removing a member covers it too.",
  "export async function inviteMember(workspaceId: string, email: string) {",
  '  const membership = await db.memberships.add({ workspaceId, email, state: "pending" });',
  "  await sendInviteEmail(email, membership.token);",
  "  return membership;",
  "}",
  "",
  "export async function acceptInvite(token: string) {",
  "  const invite = await db.memberships.findPending(token);",
  "  if (!invite || Date.now() - invite.createdAt > SEVEN_DAYS) {",
  '    throw new InviteError("no-longer-valid");',
  "  }",
  '  return db.memberships.update(invite.id, { state: "active" });',
  "}",
];

const INVITE_TEST_LINES: readonly string[] = [
  'import { expect, it } from "vitest";',
  'import { acceptInvite, inviteMember } from "./invite.js";',
  "",
  'it("accepts an invite once", async () => {',
  '  const invite = await inviteMember("workspace-1", "grace@example.com");',
  "  await acceptInvite(invite.token);",
  '  await expect(acceptInvite(invite.token)).rejects.toThrow("no-longer-valid");',
  "});",
];

/** The schema and the removal as the agent left them, which their diffs below end at. */
const MEMBERSHIPS_LINES: readonly string[] = [
  'import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";',
  "",
  'export const memberships = pgTable("memberships", {',
  '  id: uuid("id").primaryKey().defaultRandom(),',
  '  workspaceId: uuid("workspace_id").notNull(),',
  '  userId: uuid("user_id"),',
  '  email: text("email"),',
  '  state: text("state", { enum: ["pending", "active"] }).notNull().default("active"),',
  '  role: text("role").notNull(),',
  '  createdAt: timestamp("created_at").notNull().defaultNow(),',
  "});",
];

const REMOVE_LINES: readonly string[] = [
  'import { db } from "../db.js";',
  'import { MemberError } from "./errors.js";',
  "",
  "/**",
  " * Removes a member from a workspace, a pending invite among them.",
  " */",
  "export async function removeMember(workspaceId: string, userId: string) {",
  "  const membership = await db.memberships.find(workspaceId, userId);",
  '  if (!membership) throw new MemberError("not-a-member");',
  "  // A pending invite is a membership too, so withdrawing one is a removal.",
  "  await db.memberships.delete(membership.id);",
  "  return membership;",
  "}",
];

const PACKAGE_LINES: readonly string[] = [
  "{",
  '  "name": "relay",',
  '  "private": true,',
  '  "type": "module",',
  '  "scripts": { "test": "vitest run" }',
  "}",
];

/** Every file of the agent's branch a File tab can read, by path, which its tree lists. */
const FILES: ReadonlyMap<string, readonly string[]> = new Map([
  ["package.json", PACKAGE_LINES],
  ["src/db/schema/memberships.ts", MEMBERSHIPS_LINES],
  ["src/members/invite.test.ts", INVITE_TEST_LINES],
  ["src/members/invite.ts", INVITE_LINES],
  ["src/members/remove.ts", REMOVE_LINES],
]);

/** A whole new file's patch, as GitHub writes one. */
function addedPatch(lines: readonly string[]): string {
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
}

/** A changed file with the counts its patch holds. */
function changedFile(
  path: string,
  status: CodingAgentChangedFile["status"],
  patch: string,
): CodingAgentChangedFile {
  const lines = patch.split("\n").slice(1);
  return {
    path,
    previousPath: null,
    status,
    additions: lines.filter((line) => line.startsWith("+")).length,
    deletions: lines.filter((line) => line.startsWith("-")).length,
    patch,
    omitted: null,
  };
}

/** The pull request's files: the schema's pending state, the invite module and its test, and the removal that now covers invites. */
const CHANGED_FILES: readonly CodingAgentChangedFile[] = [
  changedFile(
    "src/db/schema/memberships.ts",
    CHANGED_FILE_STATUS.MODIFIED,
    [
      '@@ -4,6 +4,8 @@ export const memberships = pgTable("memberships", {',
      '   id: uuid("id").primaryKey().defaultRandom(),',
      '   workspaceId: uuid("workspace_id").notNull(),',
      '-  userId: uuid("user_id").notNull(),',
      '+  userId: uuid("user_id"),',
      '+  email: text("email"),',
      '+  state: text("state", { enum: ["pending", "active"] }).notNull().default("active"),',
      '   role: text("role").notNull(),',
      '   createdAt: timestamp("created_at").notNull().defaultNow(),',
      " });",
    ].join("\n"),
  ),
  changedFile("src/members/invite.ts", CHANGED_FILE_STATUS.ADDED, addedPatch(INVITE_LINES)),
  changedFile(
    "src/members/invite.test.ts",
    CHANGED_FILE_STATUS.ADDED,
    addedPatch(INVITE_TEST_LINES),
  ),
  changedFile(
    "src/members/remove.ts",
    CHANGED_FILE_STATUS.MODIFIED,
    [
      "@@ -8,5 +8,6 @@ export async function removeMember(workspaceId: string, userId: string) {",
      "   const membership = await db.memberships.find(workspaceId, userId);",
      '   if (!membership) throw new MemberError("not-a-member");',
      "-  await db.memberships.delete(membership.id);",
      "+  // A pending invite is a membership too, so withdrawing one is a removal.",
      "+  await db.memberships.delete(membership.id);",
      "   return membership;",
      " }",
    ].join("\n"),
  ),
];

const ADDITIONS = CHANGED_FILES.reduce((sum, file) => sum + file.additions, 0);
const DELETIONS = CHANGED_FILES.reduce((sum, file) => sum + file.deletions, 0);

/** The agent as the task's list and its tab hold it. */
function agentSummary(taskId: string, running = false): CodingAgentSummary {
  return {
    id: FIXTURE_AGENT_ID,
    planId: taskId,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Add teammate invitations",
    createdAt: STARTED_AT,
    status: running ? CODING_AGENT_STATUS.RUNNING : CODING_AGENT_STATUS.COMPLETED,
    turnId: TURN_ID,
    runStartedAt: STARTED_AT,
    brief: CODING_AGENT_BRIEF.PROMPT,
  };
}

/** A tool's call as the transcript stores it, answered. */
function toolPart(tool: string, callId: string, input: WireRecord, output: WireRecord) {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** The developer's ask that began the agent's one turn. */
const ASK: CodingAgentMessage = {
  id: "fixture-agent-ask",
  turnId: TURN_ID,
  role: MESSAGE_ROLE.USER,
  parts: [
    {
      type: "text",
      text: "Build teammate invitations from the plan: a member invites by email, and the link joins the workspace.",
    },
  ],
  sentAt: STARTED_AT,
};

/** The agent's reads, its edit, its tests, and the pull request it opened, answering the ask. */
const WORK: CodingAgentMessage = {
  id: "fixture-agent-work",
  turnId: TURN_ID,
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    {
      type: "text",
      text: "I'll model an invite as a pending membership, as the plan settled, so removal covers both.",
    },
    toolPart(
      "read_file",
      "fixture-read",
      { filePath: "src/db/schema/memberships.ts" },
      { content: "export const memberships = pgTable(…)" },
    ),
    toolPart(
      "apply_patch",
      "fixture-patch",
      { patchText: "*** Begin Patch\n*** Add File: src/members/invite.ts\n*** End Patch" },
      { output: "Done." },
    ),
    toolPart(
      "bash",
      "fixture-test",
      { command: "pnpm test src/members", description: "Run the members tests" },
      {
        stdout: " ✓ src/members/invite.test.ts (1 test)\n\n Tests  1 passed",
        stderr: "",
        exitCode: 0,
      },
    ),
    toolPart(
      "open_pull_request",
      "fixture-open",
      { title: PULL_REQUEST.title, head: PULL_REQUEST.head },
      { number: PULL_REQUEST.number, url: PULL_REQUEST.url },
    ),
    {
      type: "text",
      text: `Opened #${PULL_REQUEST.number}. An invite expires after seven days, and a used or withdrawn link reads "This invite is no longer valid".`,
    },
  ],
  startedAt: STARTED_AT,
  finishedAt: STARTED_AT + 6 * MINUTE,
};

/** The agent's one turn: the developer's ask, then its work. */
const MESSAGES: readonly CodingAgentMessage[] = [ASK, WORK];

/** The first turn's id where later turns followed it, the newest of which is `TURN_ID`. */
const FIRST_TURN_ID = "3b7d1f5a-0c2e-4d4f-8a6b-1c3e5f7a9b0d";

/** One follow-up turn: the developer's ask at `at`, then the agent's work on it, `parts`, done two minutes later. */
function followUp(input: {
  readonly id: string;
  readonly turnId: string;
  readonly at: number;
  readonly ask: string;
  readonly parts: CodingAgentMessage["parts"];
}): readonly CodingAgentMessage[] {
  return [
    {
      id: `${input.id}-ask`,
      turnId: input.turnId,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: input.ask }],
      sentAt: input.at,
    },
    {
      id: `${input.id}-work`,
      turnId: input.turnId,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: input.parts,
      startedAt: input.at,
      finishedAt: input.at + 2 * MINUTE,
    },
  ];
}

/**
 * The agent's turn and the three the developer asked after it, as an agent
 * kept at a pull request reads: more than the window holds, so its
 * transcript scrolls. The newest is the summary's turn.
 */
const LONG_MESSAGES: readonly CodingAgentMessage[] = [
  { ...ASK, turnId: FIRST_TURN_ID },
  { ...WORK, turnId: FIRST_TURN_ID },
  ...followUp({
    id: "fixture-agent-pending",
    turnId: "4c8e2a6b-1d3f-4e5a-9b7c-2d4e6f8a0b2e",
    at: STARTED_AT + 10 * MINUTE,
    ask: "The members list shows invited addresses as members. Skip a pending membership there and in the access check.",
    parts: [
      toolPart(
        "read_file",
        "fixture-pending-read",
        { filePath: "src/members/list.ts" },
        { content: "export async function listMembers(…)" },
      ),
      toolPart(
        "apply_patch",
        "fixture-pending-patch",
        {
          patchText:
            "*** Begin Patch\n*** Update File: src/members/list.ts\n*** Update File: src/workspaces/access.ts\n*** End Patch",
        },
        { output: "Done." },
      ),
      {
        type: "text",
        text: "Listing members and checking access both skip a pending membership now, so an invited address reads as a member only once it joins.",
      },
    ],
  }),
  ...followUp({
    id: "fixture-agent-race",
    turnId: "5d9f3b7c-2e4a-4f6b-8c8d-3e5f7a9b1c3f",
    at: STARTED_AT + 20 * MINUTE,
    ask: "What happens if two people open the same link at once?",
    parts: [
      {
        type: "text",
        text: "Both would read the invite before either marked it accepted, so both would join. I'll mark it accepted in the same update that checks `acceptedAt`, so only one of them wins.",
      },
      toolPart(
        "apply_patch",
        "fixture-race-patch",
        { patchText: "*** Begin Patch\n*** Update File: src/members/invite.ts\n*** End Patch" },
        { output: "Done." },
      ),
      toolPart(
        "bash",
        "fixture-race-test",
        { command: "pnpm test src/members", description: "Run the members tests" },
        {
          stdout: " ✓ src/members/invite.test.ts (2 tests)\n\n Tests  2 passed",
          stderr: "",
          exitCode: 0,
        },
      ),
      {
        type: "text",
        text: "A second accept of the same link now reads as no longer valid, and a test opens one link twice at once.",
      },
    ],
  }),
  ...followUp({
    id: "fixture-agent-label",
    turnId: TURN_ID,
    at: STARTED_AT + 30 * MINUTE,
    ask: "Rename the expired page's button to Ask for a new invite, then push.",
    parts: [
      toolPart(
        "apply_patch",
        "fixture-label-patch",
        { patchText: "*** Begin Patch\n*** Update File: src/pages/invite.tsx\n*** End Patch" },
        { output: "Done." },
      ),
      toolPart(
        "bash",
        "fixture-label-push",
        { command: "git push", description: "Push the branch" },
        { stdout: "", stderr: "To github.com:ada/relay.git", exitCode: 0 },
      ),
      {
        type: "text",
        text: `Pushed to #${PULL_REQUEST.number}. The expired page's button reads "Ask for a new invite".`,
      },
    ],
  }),
];

/** The agent's transcript, as its stream opens on it: the whole turn, caught up. */
const TRANSCRIPT_PAGE: CodingAgentTranscriptPage = {
  messages: MESSAGES,
  cursor: "1:0",
  status: CODING_AGENT_STATUS.COMPLETED,
  runStartedAt: STARTED_AT,
  title: "Add teammate invitations",
  newest: true,
  caughtUp: true,
};

/** A check on the pull request's head, run by GitHub Actions. */
function check(name: string, state: (typeof CHECK_STATE)[keyof typeof CHECK_STATE], took: number) {
  const startedAt = STARTED_AT + 7 * MINUTE;
  return {
    name,
    app: "GitHub Actions",
    state,
    url: `https://github.com/${REPOSITORY}/actions/runs/${name}`,
    startedAt: state === CHECK_STATE.SKIPPED ? null : startedAt,
    completedAt: state === CHECK_STATE.SKIPPED ? null : startedAt + took,
  };
}

/** The review bot's thread on the invite's expiry, answered by the developer. */
const EXPIRY_THREAD = {
  path: "src/members/invite.ts",
  line: 15,
  startLine: null,
  originalLine: 15,
  originalStartLine: null,
  side: DIFF_SIDE.RIGHT,
  startSide: null,
  diffHunk: addedPatch(INVITE_LINES.slice(0, 15)),
  resolved: false,
  outdated: false,
  comments: [
    {
      by: REVIEW_BOT,
      html: "<p>An invite created just under seven days ago passes here and expires mid-accept. Consider reading the clock once.</p>",
      body: "An invite created just under seven days ago passes here and expires mid-accept. Consider reading the clock once.",
      at: STARTED_AT + 9 * MINUTE,
      url: `${PULL_REQUEST.url}#discussion_r1`,
    },
    {
      by: ADA,
      html: "<p>Fine as it is: the update either lands or the link reads as no longer valid.</p>",
      body: "Fine as it is: the update either lands or the link reads as no longer valid.",
      at: STARTED_AT + 14 * MINUTE,
      url: `${PULL_REQUEST.url}#discussion_r2`,
    },
  ],
  more: 0,
};

/** The pull request's tab, read by read, as the service answers each. */
const OVERVIEW_PULL_REQUEST = {
  pullRequest: {
    number: PULL_REQUEST.number,
    title: PULL_REQUEST.title,
    url: PULL_REQUEST.url,
    state: PULL_REQUEST_STATE.OPEN,
    html: [
      "<h2>Summary</h2>",
      "<p>A member invites a teammate by email; the link joins the workspace. An invite is a ",
      "<code>memberships</code> row with <code>state = pending</code>, so removing a member covers invites too.</p>",
      "<h2>Testing</h2>",
      '<ul class="contains-task-list"><li class="task-list-item">',
      '<input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> An invite is accepted once</li>',
      '<li class="task-list-item">',
      '<input type="checkbox" class="task-list-item-checkbox" disabled="" checked=""> A link past seven days reads as no longer valid</li></ul>',
    ].join(""),
    base: PULL_REQUEST.base,
    head: PULL_REQUEST.head,
    createdAt: STARTED_AT + 6 * MINUTE,
    mergedAt: null,
    merge: MERGE_STATE.CLEAN,
    author: ADA,
    writtenAs: CODING_AGENT_AUTHOR.DEVELOPER,
    requested: [],
    merging: {
      methods: [MERGE_METHOD.SQUASH],
      autoMergeAllowed: true,
      queue: true,
      queued: { position: 2 },
      autoMerge: null,
      headSha: PULL_REQUEST.headSha,
      review: REVIEW_DECISION.APPROVED,
      checks: CHECK_SUMMARY.PASSING,
    },
    labels: [{ name: "enhancement", color: "a2eeef" }],
  },
};

const OVERVIEW_CHECKS = {
  pullRequest: {
    checks: [
      check("build", CHECK_STATE.PASSED, 2 * MINUTE),
      check("lint", CHECK_STATE.PASSED, MINUTE),
      check("typecheck", CHECK_STATE.PASSED, 3 * MINUTE),
      check("test", CHECK_STATE.PASSED, 5 * MINUTE),
      check("bench", CHECK_STATE.SKIPPED, 0),
    ],
    deployments: [
      {
        environment: "Preview",
        state: DEPLOYMENT_STATE.READY,
        url: "https://relay-preview.example.com",
      },
    ],
  },
};

const OVERVIEW_CONVERSATION = {
  pullRequest: {
    reviewers: [
      { by: GRACE, state: REVIEW_STATE.APPROVED },
      { by: REVIEW_BOT, state: REVIEW_STATE.COMMENTED },
    ],
    conversation: [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: REVIEW_BOT,
        state: REVIEW_STATE.COMMENTED,
        html: "<p>One note on the expiry check; the rest reads well.</p>",
        body: "One note on the expiry check; the rest reads well.",
        at: STARTED_AT + 9 * MINUTE,
        url: `${PULL_REQUEST.url}#pullrequestreview-1`,
        threads: [EXPIRY_THREAD],
      },
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        by: GRACE,
        state: REVIEW_STATE.APPROVED,
        html: "<p>Reusing memberships keeps removal simple. Ship it.</p>",
        body: "Reusing memberships keeps removal simple. Ship it.",
        at: STARTED_AT + 21 * MINUTE,
        url: `${PULL_REQUEST.url}#pullrequestreview-2`,
      },
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        by: ADA,
        html: "<p>Queued.</p>",
        body: "Queued.",
        at: STARTED_AT + 23 * MINUTE,
        url: `${PULL_REQUEST.url}#issuecomment-3`,
      },
    ],
    earlier: 0,
  },
};

const CHANGES = {
  pullRequest: {
    url: PULL_REQUEST.url,
    headSha: PULL_REQUEST.headSha,
    baseSha: PULL_REQUEST.baseSha,
    files: CHANGED_FILES,
    truncated: false,
    author: ADA,
    writtenAs: CODING_AGENT_AUTHOR.DEVELOPER,
    reviewers: OVERVIEW_CONVERSATION.pullRequest.reviewers,
  },
};

/** The pull request's chapters, made for its head: the pending state first, then the invite itself. */
const CHAPTERS = {
  pullRequest: {
    number: PULL_REQUEST.number,
    headSha: PULL_REQUEST.headSha,
    generatable: true,
    chapters: {
      status: PULL_REQUEST_CHAPTERS_STATE.READY,
      headSha: PULL_REQUEST.headSha,
      baseSha: PULL_REQUEST.baseSha,
      model: "anthropic/claude-sonnet-5.5",
      chapters: [
        {
          kind: CHAPTER_KIND.STORY,
          title: "An invite is a pending membership",
          summary:
            "Memberships gain an email and a state, so an invite needs no table of its own and removal covers it.",
          hunkRefs: [
            { path: "src/db/schema/memberships.ts", oldStart: 4 },
            { path: "src/members/remove.ts", oldStart: 8 },
          ],
          keyChanges: [
            {
              content: "Existing rows default to active, so nothing is backfilled.",
              lineRefs: [
                {
                  path: "src/db/schema/memberships.ts",
                  side: LINE_REF_SIDE.ADDITIONS,
                  startLine: 7,
                  endLine: 8,
                },
              ],
            },
          ],
          risk: CHAPTER_RISK.MEDIUM,
          riskReasons: ["userId becomes nullable, which every reader of memberships must allow."],
        },
        {
          kind: CHAPTER_KIND.STORY,
          title: "Sending and accepting an invite",
          summary:
            "inviteMember adds a pending membership and mails its link; acceptInvite activates it once, within seven days.",
          hunkRefs: [
            { path: "src/members/invite.ts", oldStart: 0 },
            { path: "src/members/invite.test.ts", oldStart: 0 },
          ],
          keyChanges: [
            {
              content: "A used or expired link is refused as no longer valid.",
              lineRefs: [
                {
                  path: "src/members/invite.ts",
                  side: LINE_REF_SIDE.ADDITIONS,
                  startLine: 15,
                  endLine: 17,
                },
              ],
            },
          ],
          risk: CHAPTER_RISK.LOW,
          riskReasons: [],
        },
      ],
    },
  },
};

/** A folder of the agent's branch as a File tab's tree and breadcrumbs read it: what stands in it of the files it holds, its folders first. */
function treeAt(path: string): readonly TaskTreeEntry[] {
  const prefix = path === "" ? "" : `${path}/`;
  const entries = new Map<string, TaskTreeEntry>();
  for (const file of FILES.keys()) {
    if (!file.startsWith(prefix)) continue;
    const [name = "", ...below] = file.slice(prefix.length).split("/");
    const kind = below.length === 0 ? TASK_TREE_ENTRY.FILE : TASK_TREE_ENTRY.FOLDER;
    entries.set(name, { name, kind });
  }
  return [...entries.values()].sort(
    (one, other) =>
      Number(one.kind === TASK_TREE_ENTRY.FILE) - Number(other.kind === TASK_TREE_ENTRY.FILE) ||
      one.name.localeCompare(other.name),
  );
}

/** The file the File profile opens, read from the agent's branch. */
const OPENED_FILE = "src/members/invite.ts";

/** How a profile stages the agent's Terminal: its sandbox stopped or starting, a list it refuses, an attach no port answers, or a port that says how the connection stands. */
const TERMINAL_STAGE = {
  SANDBOX: "sandbox",
  REFUSED: "refused",
  HELD: "held",
  PORT: "port",
} as const;

type TerminalStage =
  | { readonly kind: typeof TERMINAL_STAGE.SANDBOX; readonly sandbox: SandboxState }
  | { readonly kind: typeof TERMINAL_STAGE.REFUSED }
  | { readonly kind: typeof TERMINAL_STAGE.HELD }
  | {
      readonly kind: typeof TERMINAL_STAGE.PORT;
      readonly after?: TerminalConnection;
      readonly code?: number;
    };

/** How long the agent's transcript runs: its one turn as it ran, or that turn with every step it took, which runs past the window's height. */
const TRANSCRIPT_LENGTH = {
  SHORT: "short",
  LONG: "long",
  /** An orchestrator's days-long run, still written to (`agent-long-run-fixture.ts`). */
  LONG_RUN: "long-run",
} as const;

type TranscriptLength = (typeof TRANSCRIPT_LENGTH)[keyof typeof TRANSCRIPT_LENGTH];

/** What one agent profile opens beside the agent: its Pull request tab on a view, with the transcript as long as it says, a file's tab, the page it showed, its Terminal staged one way, or the task's plan, whose comments the tasks fixture answers. */
type AgentStage =
  | { readonly view: PullRequestView; readonly transcript?: TranscriptLength }
  | { readonly file: string }
  | { readonly page: string }
  | { readonly terminal: TerminalStage }
  | { readonly plan: true };

const AGENT_STAGES: ReadonlyMap<string, AgentStage> = new Map<string, AgentStage>([
  [RUN_PROFILE.AGENT_PULL_REQUEST, { view: PULL_REQUEST_VIEW.CONVERSATION }],
  [
    RUN_PROFILE.AGENT_TRANSCRIPT,
    { view: PULL_REQUEST_VIEW.CONVERSATION, transcript: TRANSCRIPT_LENGTH.LONG },
  ],
  [
    RUN_PROFILE.AGENT_LONG_RUN,
    { view: PULL_REQUEST_VIEW.CONVERSATION, transcript: TRANSCRIPT_LENGTH.LONG_RUN },
  ],
  [RUN_PROFILE.AGENT_CHECKS, { view: PULL_REQUEST_VIEW.CHECKS }],
  [RUN_PROFILE.AGENT_FILES, { view: PULL_REQUEST_VIEW.FILES }],
  [RUN_PROFILE.AGENT_CHAPTERS, { view: PULL_REQUEST_VIEW.CHAPTERS }],
  [RUN_PROFILE.AGENT_FILE, { file: OPENED_FILE }],
  [RUN_PROFILE.AGENT_TERMINAL, { terminal: { kind: TERMINAL_STAGE.PORT } }],
  [RUN_PROFILE.AGENT_TERMINAL_CONNECTING, { terminal: { kind: TERMINAL_STAGE.HELD } }],
  [
    RUN_PROFILE.AGENT_TERMINAL_RECONNECTING,
    { terminal: { kind: TERMINAL_STAGE.PORT, after: TERMINAL_CONNECTION.RECONNECTING } },
  ],
  [
    RUN_PROFILE.AGENT_TERMINAL_IDLE,
    { terminal: { kind: TERMINAL_STAGE.PORT, after: TERMINAL_CONNECTION.IDLE } },
  ],
  [
    RUN_PROFILE.AGENT_TERMINAL_EXITED,
    { terminal: { kind: TERMINAL_STAGE.PORT, after: TERMINAL_CONNECTION.EXITED, code: 0 } },
  ],
  [
    RUN_PROFILE.AGENT_TERMINAL_STOPPED,
    { terminal: { kind: TERMINAL_STAGE.SANDBOX, sandbox: SANDBOX_STATE.STOPPED } },
  ],
  [
    RUN_PROFILE.AGENT_TERMINAL_STARTING,
    { terminal: { kind: TERMINAL_STAGE.SANDBOX, sandbox: SANDBOX_STATE.STARTING } },
  ],
  [RUN_PROFILE.AGENT_TERMINAL_UNREACHABLE, { terminal: { kind: TERMINAL_STAGE.REFUSED } }],
  [RUN_PROFILE.AGENT_PAGE, { page: FIXTURE_PAGE.id }],
  // The plan's threads are the tasks fixture's to answer (`tasks-fixture.ts`); one of them is this agent's.
  [RUN_PROFILE.TASKS_COMMENTS, { plan: true }],
  // The call itself is the host's to stage (`fixture-stage.ts`); beside it the agent's pull request stands.
  [RUN_PROFILE.AGENT_CALL, { view: PULL_REQUEST_VIEW.CONVERSATION }],
  [RUN_PROFILE.AGENT_CALL_VIDEO, { view: PULL_REQUEST_VIEW.CONVERSATION }],
]);

/** The shell the agent's sandbox holds. */
const SHELL = {
  id: SHELL_ID,
  title: "zsh",
  command: "zsh",
  cwd: "/vercel/sandbox/relay",
  running: false,
};

/** What the shell printed before the tab attached, as tmux redraws it. */
const SHELL_SCREEN = [
  "ada@sandbox relay % pnpm test src/members",
  "",
  " ✓ src/members/invite.test.ts (1 test) 12ms",
  "",
  " Test Files  1 passed (1)",
  "      Tests  1 passed (1)",
  "",
  "ada@sandbox relay % ",
].join("\r\n");

/**
 * The end the fixture keeps of the port posted for the shell attached last,
 * held so it is not collected while the tab still reads the other, and
 * closed once the tab detaches or attaches again.
 */
let heldPort: MessagePort | undefined;

function closeHeldPort(): void {
  heldPort?.close();
  heldPort = undefined;
}

/** Posts a shell's port to the window, as main posts one for an attach, saying what the stage says on it. */
function postShellPort(stage: Extract<TerminalStage, { kind: typeof TERMINAL_STAGE.PORT }>): void {
  closeHeldPort();
  const channel = new MessageChannel();
  heldPort = channel.port1;
  const said: TerminalPortOutbound[] = [
    { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
    { type: TERMINAL_PORT_MESSAGE.OUTPUT, data: new TextEncoder().encode(SHELL_SCREEN) },
  ];
  if (stage.after !== undefined) {
    said.push({ type: TERMINAL_PORT_MESSAGE.STATE, state: stage.after, code: stage.code });
  }
  for (const message of said) channel.port1.postMessage(message);
  window.postMessage(
    { channel: TERMINAL_PORT_CHANNEL, ticket: { agentId: FIXTURE_AGENT_ID, terminalId: SHELL_ID } },
    "*",
    [channel.port2],
  );
}

/** The transcript's stream, as main opens one: its one page, as long as the stage says, then its end, as a finished agent's stands. */
function transcriptStream(stage: AgentStage): AsyncIteratorClass<CodingAgentTranscriptPage, void> {
  if (longRun(stage)) return longRunStream();
  const page =
    "view" in stage && stage.transcript === TRANSCRIPT_LENGTH.LONG
      ? { ...TRANSCRIPT_PAGE, messages: LONG_MESSAGES }
      : TRANSCRIPT_PAGE;
  let told = false;
  return new AsyncIteratorClass<CodingAgentTranscriptPage, void>(
    async () => {
      if (told) return { done: true, value: undefined };
      told = true;
      return { done: false, value: page };
    },
    async () => undefined,
  );
}

/** Whether the profile stages the orchestrator's long run. */
function longRun(stage: AgentStage): boolean {
  return "view" in stage && stage.transcript === TRANSCRIPT_LENGTH.LONG_RUN;
}

/** The agent's Terminal stage, where the profile stages one. */
function terminalStage(stage: AgentStage): TerminalStage | undefined {
  return "terminal" in stage ? stage.terminal : undefined;
}

/** One kind's answer, from its payload and the profile's stage. */
type StagedAnswer<Kind extends PortActKind> = (
  payload: PortActPayload<Kind>,
  stage: AgentStage,
) => PortActResult<Kind>;

/** Every read the agent's tabs ask, answered as the service would answer it for this agent. */
const ANSWERS: { readonly [Kind in PortActKind]?: StagedAnswer<Kind> } = {
  [ACT_KIND.CODING_AGENTS_LIST]: ({ taskId }, stage) => ({
    agents: [agentSummary(taskId, longRun(stage))],
  }),
  [ACT_KIND.CODING_AGENTS_TRANSCRIPT]: (_payload, stage) => transcriptStream(stage),
  [ACT_KIND.CODING_AGENTS_TRANSCRIPT_OLDER]: () => ({
    failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND,
  }),
  [ACT_KIND.CODING_AGENTS_PICTURE]: () => longRunPicture(),
  [ACT_KIND.CODING_AGENTS_CALLS]: () => ({ transcript: { calls: [], earlierOmitted: false } }),
  [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: () => ({
    repository: REPOSITORY,
    branch: PULL_REQUEST.head,
    pullRequest: {
      number: PULL_REQUEST.number,
      title: PULL_REQUEST.title,
      url: PULL_REQUEST.url,
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: ADDITIONS,
      deletions: DELETIONS,
      changedFiles: CHANGED_FILES.length,
      queued: true,
    },
  }),
  [ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: () => OVERVIEW_PULL_REQUEST,
  [ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS]: () => OVERVIEW_CHECKS,
  [ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION]: () => OVERVIEW_CONVERSATION,
  [ACT_KIND.CODING_AGENTS_REVIEW_OPTIONS]: () => ({
    labels: OVERVIEW_PULL_REQUEST.pullRequest.labels,
    users: [ADA, GRACE],
    teams: [],
  }),
  [ACT_KIND.CODING_AGENTS_CHANGES]: () => CHANGES,
  [ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED]: () => ({
    outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
    files: [{ path: "src/db/schema/memberships.ts", state: FILE_VIEWED_STATE.VIEWED }],
  }),
  [ACT_KIND.CHAPTERS_READ]: () => CHAPTERS,
  [ACT_KIND.TASKS_FILE]: ({ path, firstLine, lastLine, raw }) => {
    const lines = FILES.get(path);
    if (lines === undefined) return { refusal: TASK_FILE_REFUSAL.MISSING };
    const place = { path, repository: REPOSITORY, branch: PULL_REQUEST.head };
    if (raw === true) return { text: { ...place, text: `${lines.join("\n")}\n` } };
    return {
      file: {
        ...place,
        commit: PULL_REQUEST.headSha,
        firstLine,
        lineCount: lines.length,
        lines: lines.slice(firstLine - 1, lastLine),
      },
    };
  },
  [ACT_KIND.TASKS_TREE]: ({ path }) => ({
    folder: {
      path,
      repository: REPOSITORY,
      branch: PULL_REQUEST.head,
      entries: treeAt(path),
      truncated: false,
    },
  }),
  [ACT_KIND.TERMINAL_LIST]: (_payload, stage) => {
    const terminal = terminalStage(stage);
    if (terminal?.kind === TERMINAL_STAGE.REFUSED) {
      return { refused: TERMINAL_REFUSAL.SANDBOX_UNANSWERED };
    }
    if (terminal?.kind === TERMINAL_STAGE.SANDBOX)
      return { sandbox: terminal.sandbox, terminals: [] };
    return { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] };
  },
  [ACT_KIND.TERMINAL_ATTACH]: (_payload, stage) => {
    const terminal = terminalStage(stage);
    if (terminal?.kind === TERMINAL_STAGE.PORT) postShellPort(terminal);
  },
  [ACT_KIND.TERMINAL_DETACH]: () => closeHeldPort(),
};

/**
 * The task as an agent profile draws it, from the open task the tasks
 * profiles draw: holding the agent, its row naming the agent and its pull
 * request, and the page it showed, with no call under way and no code
 * shown on one; none under any other profile.
 */
export function agentTasksView(profile: string, open: TasksView): TasksView | undefined {
  const taskId = open.activeTaskId;
  if (!AGENT_STAGES.has(profile) || taskId === undefined) return undefined;
  const agent = agentSummary(taskId, longRun(AGENT_STAGES.get(profile) ?? { plan: true }));
  const agents: TaskSummary["agents"] = {
    total: 1,
    working: 0,
    activityAt: STARTED_AT + 23 * MINUTE,
    agents: [
      {
        id: agent.id,
        title: agent.title,
        model: agent.model,
        effort: agent.effort,
        status: agent.status,
        at: STARTED_AT,
      },
    ],
    pullRequestTotal: 1,
    pullRequests: [
      {
        number: PULL_REQUEST.number,
        title: PULL_REQUEST.title,
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.PASSING,
        additions: ADDITIONS,
        deletions: DELETIONS,
        url: PULL_REQUEST.url,
        agentId: agent.id,
        queued: true,
      },
    ],
  };
  const { html: _html, ...pageLine } = FIXTURE_PAGE;
  // Note that the call's work and the code Luke showed on it are left out, because they are of the tasks profiles' call, not this agent's.
  const { activity: _activity, shownCode: _shownCode, ...still } = open;
  return {
    ...still,
    tasks: open.tasks.map((task) => (task.id === taskId ? { ...task, agents } : task)),
    taskAgents: [agent],
    pages: [pageLine],
  };
}

/**
 * The side panel an agent profile opens with, from the panel the tasks
 * profiles open: the agent's Pull request tab on the profile's view, the
 * file's tab, the page's, or the agent's Terminal; none under any other
 * profile.
 */
export function agentSidePanel(
  profile: string,
  panel: SidePanelState,
  taskId: string,
): StagedSidePanel | undefined {
  const stage = AGENT_STAGES.get(profile);
  if (stage === undefined) return undefined;
  if ("view" in stage) {
    const pullRequest = { changes: FIXTURE_AGENT_ID };
    return {
      ...panel,
      tasks: { [taskId]: { opened: [], closed: [], changes: [pullRequest] } },
      tab: pullRequest,
      pullRequestViews: new Map([[FIXTURE_AGENT_ID, new Map([[undefined, stage.view]])]]),
    };
  }
  if ("file" in stage) {
    return {
      ...panel,
      tab: { file: stage.file },
      files: [{ path: stage.file, range: undefined, opened: 1, browsedOn: taskId }],
    };
  }
  if ("page" in stage) {
    const page = { page: stage.page };
    return { ...panel, tab: page, pages: [page] };
  }
  if ("plan" in stage) return { ...panel, tab: SIDE_PANEL_TAB.PLAN };
  const terminal = { terminal: FIXTURE_AGENT_ID };
  return { ...panel, tab: terminal, terminals: [terminal] };
}

/**
 * What an agent profile answers an act with, in place of main, held in a
 * box so an act that answers nothing is told from one left to main; none
 * for a kind its tabs do not read, and under any other profile.
 */
export function agentActAnswer(
  profile: string,
  kind: PortActKind,
  payload: PortActPayload<PortActKind>,
): { readonly answer: PortActResult<PortActKind> } | undefined {
  const stage = AGENT_STAGES.get(profile);
  if (stage === undefined) return undefined;
  // SAFETY: the table is keyed by kind, each answer taking that kind's payload and answering its result.
  const answer = ANSWERS[kind] as StagedAnswer<PortActKind> | undefined;
  return answer === undefined ? undefined : { answer: answer(payload, stage) };
}
