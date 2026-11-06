/**
 * agent-inbox-procedures.test.ts -- the Inbox's acts and hold, through the act port.
 *
 * Every declared act of the Inbox is the panel's alone, refused to any other
 * window in its own sentence before the service is asked; and a panel's
 * inbox stream follows the inbox at the host while any stream of it stands,
 * and any other window is refused one. What the relay does for every act
 * is `declared-acts.test.ts`'s, and what each handler does is its
 * composer's (`compose-agents.test.ts`).
 */

import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { type AgentInboxScope, INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { INBOX_REPLY } from "@repo/features/inbox-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { AGENT_INBOX_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import {
  type AgentInboxProceduresDependencies,
  agentInboxProcedures,
} from "./agent-inbox-procedures.js";
import type { ActSender } from "./base.js";
import { type TestActPort, testActPort } from "./testing.js";

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const ITEM_ID = "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a";

/** The account the host stands signed in to, so an act a panel asked would reach the service. */
const SIGNED_IN = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  id: "user-dana",
  email: "dana@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

/** Every declared act of the Inbox, with a payload its schema takes and the sentence the window drew for its refusal before it was declared. */
const DECLARED: readonly {
  readonly kind: (typeof AGENT_INBOX_ACT_KIND)[keyof typeof AGENT_INBOX_ACT_KIND];
  readonly payload: WireBoundaryInput;
  readonly refusal: string;
}[] = [
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ANSWER,
    payload: { itemId: ITEM_ID, revision: 2, reply: INBOX_REPLY.ACKNOWLEDGED, clientKey: "nod-1" },
    refusal: "Could not acknowledge the inbox item on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_CLOSE,
    payload: { itemId: ITEM_ID, revision: 2, clientKey: "close-1" },
    refusal: "Could not close the inbox item on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_CLOSE_RELEASE,
    payload: { clientKey: "close-1", send: false },
    refusal: "Could not undo resolving the inbox item on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_MESSAGE,
    payload: { itemId: ITEM_ID, text: "Also page on-call.", clientKey: "message-1" },
    refusal: "Could not send the message on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_START,
    payload: { agentId: AGENT_ID, text: "Draft it.", clientKey: "start-1" },
    refusal: "Could not start the thread on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_STATE,
    payload: { itemId: ITEM_ID, unread: true },
    refusal: "Could not mark the inbox item on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_REMIND,
    payload: { itemId: ITEM_ID, until: 5_000 },
    refusal: "Could not set the inbox item's reminder on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ITEM_HOME,
    payload: { itemId: ITEM_ID },
    refusal: "Could not find the inbox item on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_READ_ALL,
    payload: { itemIds: [ITEM_ID] },
    refusal: "Could not mark the inbox read on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_INBOX_ATTACHMENT,
    payload: { itemId: ITEM_ID, attachmentId: "attachment-1" },
    refusal: "Could not read the inbox item's image on this system.",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.AGENTS_PICTURE,
    payload: { agentId: AGENT_ID, pictureId: "4fb17055-c16e-4293-bea5-7a8b9cadbec5" },
    refusal: "Could not read the agent's picture on this system.",
  },
];

type HostAsk = AgentInboxProceduresDependencies["host"];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

it.effect.each(DECLARED)(
  "$kind is refused to a window that is not a panel in its own sentence, and the service is not asked",
  (act) =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort({ account: SIGNED_IN });

      const refused = yield* port.perform(act, OTHER_WINDOW);

      assert.deepEqual(refused, { refused: act.refusal });
      assert.deepEqual(
        requests.filter((request) => request.method !== "GET"),
        [],
      );
    }),
);

/** Turns the event loop until `ready` holds, as a page waits on its port. */
async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn += 1) await nextTurn();
}

it("a panel's hold on an inbox follows it at the host once for every stream of it, hears nothing down the hold, and lets it go once its last stream closes", async () => {
  const asked: string[] = [];
  const follows: Pick<HostAsk, "agentInboxFollow" | "agentInboxUnfollow"> = {
    agentInboxFollow: () => Effect.sync(() => void asked.push("follow")),
    agentInboxUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
  };
  // SAFETY: the hold reaches the follow asks alone.
  const host = follows as HostAsk;
  const port = testActPort(agentInboxProcedures({ host }));
  ports.push(port);
  const client = port.as(PANEL);
  const scope: AgentInboxScope = { kind: INBOX_SCOPE_KIND.PLAN, id: TASK_ID };

  const one = await client[AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW](scope);
  const two = await client[AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW](scope);
  const first = one.next();
  await until(() => asked.length === 1);
  assert.deepEqual(asked, ["follow"], "the host follows the inbox once for both streams");

  await one.return(undefined);
  await nextTurn();
  assert.deepEqual(asked, ["follow"], "the first stream closing lets nothing go");
  await two.return(undefined);
  await until(() => asked.length === 2);
  assert.deepEqual(asked, ["follow", "unfollow"]);
  assert.deepEqual(await first, { done: true, value: undefined }, "the hold carried nothing");
});

it("a window that is not a panel is refused an inbox stream, and the host follows nothing", async () => {
  const asked: string[] = [];
  // SAFETY: the stream reaches the follow asks alone.
  const host = {
    agentInboxFollow: () => Effect.sync(() => void asked.push("follow")),
    agentInboxUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
  } as unknown as HostAsk;
  const port = testActPort(agentInboxProcedures({ host }));
  ports.push(port);
  await assert.rejects(
    port.as(OTHER_WINDOW)[AGENT_INBOX_ACT_KIND.AGENTS_INBOX_FOLLOW]({
      kind: INBOX_SCOPE_KIND.PLAN,
      id: TASK_ID,
    }),
  );
  assert.deepEqual(asked, []);
});
