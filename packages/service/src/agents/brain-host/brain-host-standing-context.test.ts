import assert from "node:assert/strict";
import { changeIssue, createIssue } from "@luke/database/models/issue-store";
import {
  actOnPlanCommentThread,
  startPlanCommentThread,
} from "@luke/database/models/plan-comments";
import { openTaskConversation, savePlanText } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  insertMessage,
  linearIssueLink,
  openHostedStoreTestDatabase,
  startTask,
} from "@luke/database/testing";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_SCOPE,
} from "@luke/features/plan-comment-wire";
import { TASK_ISSUE_PROVIDER, TASK_ISSUE_RELATION } from "@luke/features/task-issue-wire";
import { Effect, Option, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { MESSAGE_AUTHOR, MESSAGE_ROLE } from "../../core.js";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { sessionAuthFor } from "./auth.js";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "./bounds.js";
import { conversationReachableBy, runtimeSessionReachableBy } from "./conversation.js";
import { brainHost } from "./host.js";
import type { BrainHostSeams } from "./production.js";

/**
 * The standing context as the host answers it to the eve project's prompt
 * resolver on each turn, over the real migrations on PGlite: the task's name
 * and its saved document, read again from the row each turn, and nothing of
 * the conversation's own words, which are the eve session's history and the
 * rotation seed's. Synthetic accounts, tasks, and words throughout.
 */

const NOW = 1_800_000_000_000;
const TASK_NAME = "Teammate invitations";
const SAID = "Any member should be able to invite, not only admins.";

const FIRST = "## Open questions\n\n- Who may invite?\n";

const SECOND =
  "## Rules\n\n- Any member may invite.\n\n## Assumptions\n\n- Invites reuse `memberships` with a `pending` state.\n";

/** The saved document as the standing context hands it: the plan's text as its body. */
function handed(text: string): string {
  return JSON.stringify({ body: text, assumptions: [] });
}

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));

function unreached(name: string): () => never {
  return () => {
    throw new Error(`${name} reached in a test that offers it nothing`);
  };
}

const seams: BrainHostSeams = {
  writer: () => Effect.succeed(writer),
  userInfo: () => Effect.succeed(undefined),
  ownership: {
    reachesSession: (userId, sessionId) =>
      database.run(runtimeSessionReachableBy(userId, sessionId)),
    reachesConversation: (userId, conversationId) =>
      database.run(conversationReachableBy(userId, conversationId)),
  },
  openAi: () => undefined,
  deploymentSecret: () => undefined,
  eveOrigin: () => undefined,
  titleModel: () => undefined,
  scriptedModel: () => true,
  spend: unreached("spend"),
  now: () => NOW,
};

let minted = 0;

function sessionId(): string {
  minted += 1;
  return `wrun_01M${String(minted).padStart(22, "0")}`;
}

/** The seat a request takes at the door: its conversation and turn, and the time zone its header names where it names one. */
function seat(target: ConversationTarget, timeZone?: string): SessionAuth {
  const caller: SessionAuthContext = {
    principalId: target.userId,
    principalType: "user",
    authenticator: "test",
    attributes: {},
  };
  const request = new Request("https://luke.test/eve/v1/session", {
    method: "POST",
    headers: {
      [BRAIN_HOST_HEADER.CONVERSATION]: target.conversationId,
      [BRAIN_HOST_HEADER.TURN]: BRAIN_HOST_TURN.TYPED,
      ...(timeZone === undefined ? undefined : { [BRAIN_HOST_HEADER.TIME_ZONE]: timeZone }),
    },
  });
  const own = sessionAuthFor(caller, request);
  return { current: own, initiator: own };
}

/** The standing context the host hands a turn of the conversation, through the same admission the resolver runs. */
async function standingContextOf(target: ConversationTarget, timeZone?: string): Promise<string> {
  const host = brainHost(seams);
  const id = sessionId();
  const auth = seat(target, timeZone);
  const starting = await database.run(host.admitStarting(auth, id));
  assert.ok(Result.isSuccess(starting));
  if (!Result.isSuccess(starting)) throw new Error("not admitted");
  assert.equal(await database.run(host.sessionStarted(starting.success, id)), true);
  const admitted = await database.run(host.admit(auth, id));
  assert.ok(Result.isSuccess(admitted));
  if (!Result.isSuccess(admitted)) throw new Error("not admitted");
  return (await database.run(host.standingContext(admitted.success))).text;
}

/** The developer's words said in the conversation, as a finished row of its history. */
async function said(target: ConversationTarget, words: string): Promise<void> {
  await insertMessage(database.run, {
    userId: target.userId,
    conversationId: target.conversationId,
    seq: 1,
    clientId: `said-${target.conversationId}`,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: words }],
    metadata: { author: MESSAGE_AUTHOR.DEVELOPER },
    createdAt: new Date(NOW),
    finishedAt: new Date(NOW),
  });
}

test("a turn of a plan's conversation is handed the plan's name and the document saved as it starts, and none of the conversation's words", async () => {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: TASK_NAME }));
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(userId, task.id)),
  ).conversationId;
  const target = { userId, conversationId };
  await said(target, SAID);
  await database.run(savePlanText(userId, task.id, FIRST));

  const first = await standingContextOf(target);
  assert.ok(first.includes(`Name: ${TASK_NAME}`));
  assert.ok(first.includes(handed(FIRST)));
  assert.equal(first.includes(SAID), false);

  await database.run(savePlanText(userId, task.id, SECOND));

  const second = await standingContextOf(target);
  assert.ok(second.includes(handed(SECOND)));
  assert.equal(second.includes(handed(FIRST)), false);
});

test("a turn whose request named the developer's time zone is handed their day and time in it, and today as a date mention, where UTC's day is already the next", async () => {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: TASK_NAME }));
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(userId, task.id)),
  ).conversationId;

  // NOW is 08:00 UTC on Friday, January 15, 2027: 10 PM the evening before in Honolulu.
  const standing = await standingContextOf({ userId, conversationId }, "Pacific/Honolulu");

  assert.ok(
    standing.includes(
      "[the developer's time] Thursday, January 14, 2027, 10:00 PM Pacific/Honolulu (UTC 08:00), offset -10:00. Today is [@Jan 14, 2027](luke://date/2027-01-14).",
    ),
    standing,
  );
});

test("a turn whose request named no time zone, or one that stands nowhere, reads the day in UTC and says the zone is unknown", async () => {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: TASK_NAME }));
  const target = {
    userId,
    conversationId: Option.getOrThrow(await database.run(openTaskConversation(userId, task.id)))
      .conversationId,
  };
  const utc =
    "[the developer's time] Friday, January 15, 2027, 8:00 AM UTC (UTC 08:00), offset +00:00. Today is [@Jan 15, 2027](luke://date/2027-01-15). Their time zone is unknown, so read it as UTC.";

  for (const timeZone of [undefined, "Mars/Olympus_Mons"]) {
    const standing = await standingContextOf(target, timeZone);
    assert.ok(standing.includes(utc), `${timeZone}: ${standing}`);
  }
});

test("a task that links a Linear issue hands every turn the issue as it read when it was linked, beside the plan's name", async () => {
  const issue = {
    identifier: "ENG-42",
    title: "Start a plan from Linear",
    url: "https://linear.app/acme/issue/ENG-42",
    description: "Pick an issue and plan it at once.",
  };
  const userId = await database.createUser();
  const task = await database.run(
    startTask(userId, { name: issue.title, issueLinks: [linearIssueLink(issue)] }),
  );
  const plain = await database.run(startTask(userId, { name: TASK_NAME }));
  const targetOf = async (taskId: string) => ({
    userId,
    conversationId: Option.getOrThrow(await database.run(openTaskConversation(userId, taskId)))
      .conversationId,
  });

  const started = await standingContextOf(await targetOf(task.id));
  const other = await standingContextOf(await targetOf(plain.id));

  const linked = [
    {
      provider: TASK_ISSUE_PROVIDER.LINEAR,
      key: issue.identifier,
      title: issue.title,
      url: issue.url,
      relation: TASK_ISSUE_RELATION.CLOSES,
      description: issue.description,
    },
  ];
  assert.ok(started.includes(`[issues the task links]\n${JSON.stringify(linked)}`));
  assert.equal(other.includes("[issues the task links]"), false);
});

test("a task started with the developer's brief hands every turn the brief as they wrote it, beside the plan's name", async () => {
  const brief =
    'Let any member invite a teammate, not only admins. "Members" means anyone in the workspace.';
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: TASK_NAME, brief }));
  const plain = await database.run(startTask(userId, { name: TASK_NAME }));
  const targetOf = async (taskId: string) => ({
    userId,
    conversationId: Option.getOrThrow(await database.run(openTaskConversation(userId, taskId)))
      .conversationId,
  });

  const started = await standingContextOf(await targetOf(task.id));
  const other = await standingContextOf(await targetOf(plain.id));

  assert.ok(started.includes(`[the developer's brief for the task]\n${JSON.stringify(brief)}`));
  assert.equal(other.includes("[the developer's brief"), false);
});

test("a plan started from one of the workspace's issues hands every turn the issue as it reads now, by its identifier and its link", async () => {
  const userId = await database.createUser();
  const plain = await database.run(startTask(userId, { name: TASK_NAME }));
  const filed = Option.getOrThrow(
    await database.run(
      createIssue(userId, { organizationId: plain.workspaceId, title: "Invites expire too soon" }),
    ),
  );
  const task = await database.run(startTask(userId, { name: filed.title, issueId: filed.id }));
  await database.run(changeIssue(userId, filed.id, { description: "Steps to reproduce." }));
  const targetOf = async (taskId: string) => ({
    userId,
    conversationId: Option.getOrThrow(await database.run(openTaskConversation(userId, taskId)))
      .conversationId,
  });

  const started = await standingContextOf(await targetOf(task.id));
  const other = await standingContextOf(await targetOf(plain.id));

  const [, handed] = started.split("[workspace issue the task was started from]\n");
  const issue = JSON.parse(handed?.split("\n")[0] ?? "null");
  assert.equal(issue.title, "Invites expire too soon");
  assert.equal(issue.description, "Steps to reproduce.");
  assert.match(issue.identifier, new RegExp(`-${filed.number}$`));
  assert.ok(String(issue.url).endsWith(`/issue/${filed.id}`));
  assert.equal(other.includes("[workspace issue"), false);
});

test("a turn of a task's conversation is handed its plan's open comment threads, each with its words and comments, and no resolved one", async () => {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: TASK_NAME }));
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(userId, task.id)),
  ).conversationId;
  await database.run(savePlanText(userId, task.id, FIRST));
  const words = FIRST.slice(0, 12);
  const start = (comment: string) =>
    database.run(
      startPlanCommentThread({ actor: PLAN_COMMENT_ACTOR.MEMBER, userId }, task.id, {
        clientKey: crypto.randomUUID(),
        scope: PLAN_COMMENT_SCOPE.WORDS,
        quote: words,
        anchor: { from: 0, to: words.length },
        text: FIRST,
        words: comment,
      }),
    );
  await start("Should this be a setting?");
  const resolved = await start("Already settled.");
  if (!("answer" in resolved) || !("thread" in resolved.answer)) throw new Error("not started");
  await database.run(
    actOnPlanCommentThread(
      { actor: PLAN_COMMENT_ACTOR.MEMBER, userId },
      task.id,
      resolved.answer.thread.id,
      {
        action: PLAN_COMMENT_ACTION.RESOLVE,
      },
    ),
  );

  const handedNow = await standingContextOf({ userId, conversationId });

  assert.ok(handedNow.includes("[open comment threads]"));
  assert.ok(handedNow.includes("Should this be a setting?"));
  assert.equal(handedNow.includes("Already settled."), false);
});
