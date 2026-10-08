import assert from "node:assert/strict";
import type { PlanDocument } from "@sidecar/hosted/plan-wire";
import { Effect, Option, Result } from "effect";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import { afterAll, test } from "vitest";
import { MESSAGE_AUTHOR, MESSAGE_ROLE } from "../server/core";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { conversationOwnedBy, runtimeSessionOwner } from "../server/hosted/brain-host/conversation";
import { brainHost } from "../server/hosted/brain-host/host";
import type { BrainHostSeams } from "../server/hosted/brain-host/production";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { createPlan, openPlanConversation, savePlanDocument } from "../server/hosted/plan-store";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, insertMessage } from "./support/store-rows";

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

const FIRST: PlanDocument = {
  body: "# Teammate invitations\n\n## Open questions\n- Who may invite?\n",
  assumptions: [],
};

const SECOND: PlanDocument = {
  body: "# Teammate invitations\n\n## Rules\n- Any member may invite.\n",
  assumptions: [{ text: "Invites reuse `memberships` with a `pending` state." }],
};

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
    sessionOwner: (sessionId) => database.run(runtimeSessionOwner(sessionId)),
    ownsConversation: (userId, conversationId) =>
      database.run(conversationOwnedBy(userId, conversationId)),
  },
  openAi: () => undefined,
  deploymentSecret: () => undefined,
  eveOrigin: () => undefined,
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
  const plan = await database.run(createPlan(userId, { name: PLAN_NAME }));
  const conversationId = Option.getOrThrow(
    await database.run(openPlanConversation(userId, plan.id)),
  );
  const target = { userId, conversationId };
  await said(target, SAID);
  await database.run(savePlanDocument(userId, plan.id, FIRST));

  const first = await standingContextOf(target);
  assert.ok(first.includes(`Name: ${PLAN_NAME}`));
  assert.ok(first.includes(JSON.stringify(FIRST)));
  assert.equal(first.includes(SAID), false);

  await database.run(savePlanDocument(userId, plan.id, SECOND));

  const second = await standingContextOf(target);
  assert.ok(second.includes(JSON.stringify(SECOND)));
  assert.equal(second.includes(JSON.stringify(FIRST)), false);
});

test("a conversation no plan names is handed no name and no document", async () => {
  const userId = await database.createUser();
  const elsewhere = await database.run(createPlan(userId, { name: PLAN_NAME }));
  await database.run(savePlanDocument(userId, elsewhere.id, FIRST));
  const target = { userId, conversationId: await insertConversation(database.run, { userId }) };

  const context = await standingContextOf(target);

  assert.equal(context.includes(PLAN_NAME), false);
  assert.equal(context.includes(JSON.stringify(FIRST)), false);
});
