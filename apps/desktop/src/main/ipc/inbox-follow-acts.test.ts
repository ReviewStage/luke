import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxChanged,
  type CodingAgentInboxScope,
} from "@luke/features/coding-agent-view";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { type InboxFollowActsDependencies, inboxFollowActRows } from "./inbox-follow-acts";

/**
 * A followed inbox as main carries it, over a host that answers from a
 * script: the host follows an inbox once while any panel does, each change
 * it tells reaches the panels following that inbox and no other, a panel
 * coming to an inbox already standing is sent it at once, a follow after a
 * failure asks the host again, the inbox is let go at the host once no panel
 * holds a follow of it, a panel's page going lets go of all of its follows,
 * and only a panel is answered. Synthetic ids throughout.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER_TASK_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PLAN: CodingAgentInboxScope = { kind: "plan", id: TASK_ID };
const OTHER_PLAN: CodingAgentInboxScope = { kind: "plan", id: OTHER_TASK_ID };

const ITEM: InboxItem = {
  id: "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  version: INBOX_WIRE_VERSION,
  key: "deploy-window",
  revision: 1,
  title: "Deploy tonight?",
  blocks: [],
  response: { type: INBOX_RESPONSE.APPROVAL },
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
};

/** One window, by identity alone. */
function panelOf(): ActSender {
  // SAFETY: the rows read a sender by identity alone; one inert object is one window.
  return { sender: {} as WebContents, panel: true, voice: false, call: false };
}

function fixture() {
  const asked: string[] = [];
  const sent: { sender: WebContents; changed: CodingAgentInboxChanged }[] = [];
  const gone = new Map<WebContents, () => void>();
  const pending: Effect.Effect<void>[] = [];
  let told: ((changed: CodingAgentInboxChanged) => void) | undefined;
  const host: InboxFollowActsDependencies["host"] = {
    codingAgentInboxFollow: (scope) =>
      Effect.sync(() => void asked.push(`follow:${scope.kind}:${scope.id}`)),
    codingAgentInboxUnfollow: (scope) =>
      Effect.sync(() => void asked.push(`unfollow:${scope.kind}:${scope.id}`)),
    onInboxChanged: (listener) => {
      told = listener;
      return () => undefined;
    },
  };
  const rows = inboxFollowActRows({
    host,
    deliver: (sender, changed) => void sent.push({ sender, changed }),
    whenGone: (sender, then) => void gone.set(sender, then),
    run: <A>(effect: Effect.Effect<A>) => {
      pending.push(Effect.asVoid(effect));
      return new Promise<A>(() => undefined);
    },
  });
  // SAFETY: the router dispatches only the follow kinds these tests send.
  const router = createActRouter(rows as ActRows);
  const follow = (scope: CodingAgentInboxScope, sender: ActSender) =>
    router.performAct({ kind: ACT_KIND.CODING_AGENTS_INBOX_FOLLOW, payload: scope }, sender);
  const unfollow = (scope: CodingAgentInboxScope, sender: ActSender) =>
    router.performAct({ kind: ACT_KIND.CODING_AGENTS_INBOX_UNFOLLOW, payload: scope }, sender);
  return {
    follow,
    unfollow,
    asked,
    /** What each window was sent, as the test reads it: the window and the inbox. */
    sentTo: (sender: ActSender) =>
      sent.flatMap((each) => (each.sender === sender.sender ? [each.changed] : [])),
    /** The host telling a followed inbox's change, as the operator would hand it up. */
    hostSays: (changed: CodingAgentInboxChanged) => told?.(changed),
    pageGone: (sender: ActSender) => gone.get(sender.sender)?.(),
    /** What the pages' callbacks handed to the runtime, run now. */
    drain: Effect.suspend(() => Effect.all(pending.splice(0), { discard: true })),
  };
}

const standing = (scope: CodingAgentInboxScope, items: readonly InboxItem[]) => ({
  scope,
  inbox: { items },
});

it.effect(
  "the host follows an inbox once however many panels follow it, and each change reaches the panels following it alone, a panel coming late at once",
  () =>
    Effect.gen(function* () {
      const { follow, asked, sentTo, hostSays } = fixture();
      const one = panelOf();
      const other = panelOf();
      const elsewhere = panelOf();

      yield* follow(PLAN, one);
      yield* follow(OTHER_PLAN, elsewhere);
      hostSays(standing(PLAN, [ITEM]));
      yield* follow(PLAN, other);
      const answered = { ...ITEM, revision: 2, status: INBOX_STATUS.ANSWERED };
      hostSays(standing(PLAN, [answered]));

      assert.deepEqual(asked, [`follow:plan:${TASK_ID}`, `follow:plan:${OTHER_TASK_ID}`]);
      assert.deepEqual(sentTo(one), [standing(PLAN, [ITEM]), standing(PLAN, [answered])]);
      assert.deepEqual(sentTo(other), [standing(PLAN, [ITEM]), standing(PLAN, [answered])]);
      assert.deepEqual(sentTo(elsewhere), []);
    }),
);

it.effect(
  "an inbox is let go at the host once no panel holds a follow of it, a panel's follows counted, and a panel's page going lets go of all of them",
  () =>
    Effect.gen(function* () {
      const { follow, unfollow, asked, pageGone, drain, sentTo, hostSays } = fixture();
      const one = panelOf();
      const other = panelOf();

      // The panel follows the plan from two places at once, and lets one go.
      yield* follow(PLAN, one);
      yield* follow(PLAN, one);
      yield* unfollow(PLAN, one);
      assert.deepEqual(asked, [`follow:plan:${TASK_ID}`]);
      yield* unfollow(PLAN, one);
      assert.deepEqual(asked, [`follow:plan:${TASK_ID}`, `unfollow:plan:${TASK_ID}`]);
      hostSays(standing(PLAN, [ITEM]));
      assert.deepEqual(sentTo(one), []);

      yield* follow(PLAN, other);
      yield* follow(OTHER_PLAN, other);
      pageGone(other);
      yield* drain;
      assert.deepEqual(asked.slice(2).toSorted(), [
        `follow:plan:${OTHER_TASK_ID}`,
        `follow:plan:${TASK_ID}`,
        `unfollow:plan:${OTHER_TASK_ID}`,
        `unfollow:plan:${TASK_ID}`,
      ]);
    }),
);

it.effect(
  "a follow of an inbox whose last word was that it could not be read asks the host again",
  () =>
    Effect.gen(function* () {
      const { follow, asked, sentTo, hostSays } = fixture();
      const one = panelOf();
      const failed = {
        scope: PLAN,
        inbox: { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
      } as const;

      yield* follow(PLAN, one);
      hostSays(failed);
      yield* follow(PLAN, one);
      hostSays(standing(PLAN, [ITEM]));

      assert.deepEqual(asked, [`follow:plan:${TASK_ID}`, `follow:plan:${TASK_ID}`]);
      assert.deepEqual(sentTo(one), [failed, standing(PLAN, [ITEM])]);
    }),
);

it.effect("only a panel is answered", () =>
  Effect.gen(function* () {
    const { follow, asked } = fixture();
    const voice: ActSender = { ...panelOf(), panel: false, voice: true };

    assert.deepEqual(yield* follow(PLAN, voice), {
      status: ACT_OUTCOME_STATUS.REFUSED,
      reason: ACT[ACT_KIND.CODING_AGENTS_INBOX_FOLLOW].refusal,
    });
    assert.deepEqual(asked, []);
  }),
);
