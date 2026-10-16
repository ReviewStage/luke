import assert from "node:assert/strict";
import { openPlanConversation, savePlanText } from "@luke/database/models/plan-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import { insertMessage, openHostedStoreTestDatabase, startPlan } from "@luke/database/testing";
import { Effect, Option, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { MESSAGE_AUTHOR, MESSAGE_ROLE } from "../../core.js";
import { HOSTED_TOOL_SET } from "../../plans/brain-tool-set.js";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "./bounds.js";
import { conversationReachableBy, runtimeSessionReachableBy } from "./conversation.js";
import { brainHost } from "./host.js";
import type { BrainHostSeams } from "./production.js";

/**
 * The standing context as the host answers it to the eve project's prompt
 * resolver on each turn, over the real migrations on PGlite: the plan's name
 * and its saved document, read again from the row each turn, and nothing of
 * the conversation's own words, which are the eve session's history and the
 * rotation seed's. Synthetic accounts, plans, and words throughout.
 */

const NOW = 1_800_000_000_000;
const PLAN_NAME = "Teammate invitations";
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

function seat(target: ConversationTarget): SessionAuth {
  const own: SessionAuthContext = {
    principalId: target.userId,
    principalType: "user",
    authenticator: "test",
    attributes: {
      [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: target.conversationId,
      [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
    },
  };
  return { current: own, initiator: own };
}

/** The standing context the host hands a turn of the conversation, through the same admission the resolver runs. */
async function standingContextOf(target: ConversationTarget): Promise<string> {
  const host = brainHost(seams);
  const id = sessionId();
  const auth = seat(target);
  const starting = await database.run(host.admitStarting(auth, id));
  assert.ok(Result.isSuccess(starting));
  if (!Result.isSuccess(starting)) throw new Error("not admitted");
  assert.equal(await database.run(host.sessionStarted(starting.success, id)), true);
  const admitted = await database.run(host.admit(auth, id));
  assert.ok(Result.isSuccess(admitted));
  if (!Result.isSuccess(admitted)) throw new Error("not admitted");
  return database.run(host.standingContext(admitted.success));
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
  const plan = await database.run(startPlan(userId, { name: PLAN_NAME }));
  const conversationId = Option.getOrThrow(
    await database.run(openPlanConversation(userId, plan.id)),
  ).conversationId;
  const target = { userId, conversationId };
  await said(target, SAID);
  await database.run(savePlanText(userId, plan.id, FIRST));

  const first = await standingContextOf(target);
  assert.ok(first.includes(`Name: ${PLAN_NAME}`));
  assert.ok(first.includes(handed(FIRST)));
  assert.equal(first.includes(SAID), false);

  await database.run(savePlanText(userId, plan.id, SECOND));

  const second = await standingContextOf(target);
  assert.ok(second.includes(handed(SECOND)));
  assert.equal(second.includes(handed(FIRST)), false);
});

test("a plan started from a Linear issue hands every turn the issue as it was read then, beside the plan's name", async () => {
  const issue = {
    identifier: "ENG-42",
    title: "Start a plan from Linear",
    url: "https://linear.app/acme/issue/ENG-42",
    description: "Pick an issue and plan it at once.",
  };
  const userId = await database.createUser();
  const plan = await database.run(startPlan(userId, { name: issue.title, linearIssue: issue }));
  const plain = await database.run(startPlan(userId, { name: PLAN_NAME }));
  const targetOf = async (planId: string) => ({
    userId,
    conversationId: Option.getOrThrow(await database.run(openPlanConversation(userId, planId)))
      .conversationId,
  });

  const started = await standingContextOf(await targetOf(plan.id));
  const other = await standingContextOf(await targetOf(plain.id));

  assert.ok(started.includes(`[linear issue the plan was started from]\n${JSON.stringify(issue)}`));
  assert.equal(other.includes("[linear issue"), false);
});
