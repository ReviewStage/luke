/**
 * agent-inbox-procedures.test.ts -- the Inbox's acts, through the act port.
 *
 * What a task's coding agents need of the developer, through the act port
 * as a window calls them: only a panel of this build's own renderer asks;
 * the voice and call windows, and a frame this build does not trust, are
 * refused in each kind's own words before the host is asked; a panel's ask
 * reaches the host with its payload as the panel sent it, and what the host
 * answers is the panel's; a host that fails answers the kind's own
 * sentence; and a panel's inbox stream follows the inbox at the host while
 * any stream of it stands.
 */

import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxChanged,
  type CodingAgentInboxScope,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import {
  INBOX_ASK_STATUS,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect } from "effect";
import { AGENT_INBOX_ACT_KIND, type PortActKind } from "../contract/index.js";
import {
  type AgentInboxProceduresDependencies,
  agentInboxProcedures,
} from "./agent-inbox-procedures.js";
import type { ActSender } from "./base.js";
import { type TestActPort, testActPort } from "./testing.js";

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PICTURE_ID = "4fb17055-c16e-4293-bea5-7a8b9cadbec5";

const ITEM: InboxItem = {
  id: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
  agentId: AGENT_ID,
  key: "push-access",
  revision: 2,
  version: INBOX_WIRE_VERSION,
  title: "Push to the release branch?",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_800_000_000_000,
  updatedAt: 1_800_000_060_000,
};

const PICTURE = { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw0KGgo=" };

const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER]:
    "Could not acknowledge the inbox item on this system.",
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE]:
    "Could not close the inbox item on this system.",
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE]: "Could not send the message on this system.",
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]:
    "Could not mark the inbox item on this system.",
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT]:
    "Could not read the inbox item's image on this system.",
  [AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE]:
    "Could not read the agent's picture on this system.",
} as const;

type HostAsk = AgentInboxProceduresDependencies["host"];

/** Every kind, each with a payload its schema admits and the host ask it reaches. */
const ACTS: readonly {
  kind: keyof typeof REFUSAL;
  payload: WireBoundaryInput;
  ask: keyof HostAsk;
}[] = [
  {
    kind: AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER,
    payload: { itemId: ITEM.id, revision: 2, reply: INBOX_REPLY.ACKNOWLEDGED, clientKey: "nod-1" },
    ask: "codingAgentInboxAnswer",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE,
    payload: { itemId: ITEM.id, revision: 2, clientKey: "close-1" },
    ask: "codingAgentInboxClose",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE,
    payload: { itemId: ITEM.id, text: "Also page on-call.", clientKey: "message-1" },
    ask: "codingAgentInboxMessage",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE,
    payload: { itemId: ITEM.id, unread: true },
    ask: "codingAgentInboxReadState",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT,
    payload: { itemId: ITEM.id, attachmentId: "attachment-1" },
    ask: "codingAgentInboxAttachment",
  },
  {
    kind: AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE,
    payload: { agentId: AGENT_ID, pictureId: PICTURE_ID },
    ask: "codingAgentPicture",
  },
];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** What the host is asked to answer, by its ask, where a test answers one otherwise than unanswered. */
type Answers = Partial<Record<keyof HostAsk, () => Effect.Effect<unknown>>>;

/**
 * A window's act port, opened as the bridge opens one: the host answering
 * each ask unanswered unless `answers` says otherwise, and the window
 * standing as `actor`.
 */
function windowPort(
  actor: ActSender,
  options: { trusted?: boolean; answers?: Answers; fallback?: () => Effect.Effect<unknown> } = {},
) {
  const asked: unknown[] = [];
  const ask =
    (name: keyof HostAsk) =>
    (...params: unknown[]) =>
      Effect.suspend(() => {
        asked.push([name, params[0]]);
        const answer =
          options.answers?.[name] ?? options.fallback ?? (() => Effect.succeed(UNANSWERED));
        return answer();
      });
  // SAFETY: each fake answers what its test hands it; the port's output schema checks it.
  const host = Object.fromEntries(ACTS.map((act) => [act.ask, ask(act.ask)])) as unknown as HostAsk;
  const port = testActPort(agentInboxProcedures({ host }));
  ports.push(port);
  const trusted = options.trusted ?? true;
  /** One kind called as this window, settled to its answer or the sentence of its refusal. */
  const call = (kind: PortActKind, payload: WireBoundaryInput) =>
    port.call(actor, kind, payload, { trusted });
  return { call, asked };
}

it("the voice and call windows are refused every inbox act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { call, asked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await call(act.kind, act.payload), { refused: REFUSAL[act.kind] });
    }
    assert.deepEqual(asked, []);
  }
});

it("a frame this build does not trust is refused every inbox act, even as a panel, and the host is not asked", async () => {
  const { call, asked } = windowPort(PANEL, { trusted: false });
  for (const act of ACTS) {
    assert.deepEqual(await call(act.kind, act.payload), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host once with its payload, and the host's answer is the panel's", async () => {
  const { call, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await call(act.kind, act.payload), { answer: UNANSWERED });
  }
  assert.deepEqual(
    asked,
    ACTS.map((act) => [act.ask, act.payload]),
  );
});

it("a panel answers, closes, and messages on an item, and hears the item as it then stands", async () => {
  const { call, asked } = windowPort(PANEL, {
    answers: {
      codingAgentInboxAnswer: () =>
        Effect.succeed({ item: { ...ITEM, status: INBOX_STATUS.ANSWERED }, taken: true }),
      codingAgentInboxClose: () =>
        Effect.succeed({ item: { ...ITEM, status: INBOX_STATUS.CLOSED }, taken: true }),
      codingAgentInboxMessage: () => Effect.succeed({ item: ITEM }),
    },
  });
  const message = {
    itemId: ITEM.id,
    text: "Also page on-call.",
    attachments: [{ name: "pager.txt", mediaType: "text/plain", data: "b24tY2FsbA==" }],
    clientKey: "message-1",
  };
  const answer = {
    itemId: ITEM.id,
    revision: 2,
    reply: INBOX_REPLY.ACKNOWLEDGED,
    clientKey: "a-1",
  };
  const close = { itemId: ITEM.id, revision: 2, clientKey: "close-1" };

  assert.deepEqual(await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ANSWER, answer), {
    answer: { item: { ...ITEM, status: INBOX_STATUS.ANSWERED }, taken: true },
  });
  assert.deepEqual(await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_CLOSE, close), {
    answer: { item: { ...ITEM, status: INBOX_STATUS.CLOSED }, taken: true },
  });
  assert.deepEqual(await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, message), {
    answer: { item: ITEM },
  });
  assert.deepEqual(asked, [
    ["codingAgentInboxAnswer", answer],
    ["codingAgentInboxClose", close],
    ["codingAgentInboxMessage", message],
  ]);
});

it("a panel's reply that answers the open ask reaches the host with the answer, words or none; an answer naming no message is refused in the kind's own words, and the host is not asked", async () => {
  const { call, asked } = windowPort(PANEL, {
    answers: { codingAgentInboxMessage: () => Effect.succeed({ item: ITEM }) },
  });
  const answers = {
    ask: "7f4d0b2a-3c5e-4a81-9d9f-4e6a8c0d2f3b",
    reply: INBOX_REPLY.CHOSE,
    choices: ["Ship it"],
  };
  const answering = { itemId: ITEM.id, text: "", clientKey: "answer-1", answers };

  assert.deepEqual(await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, answering), {
    answer: { item: ITEM },
  });
  assert.deepEqual(
    await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, {
      ...answering,
      answers: { ...answers, ask: "the deploy question" },
    }),
    { refused: REFUSAL[AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE] },
  );
  assert.deepEqual(asked, [["codingAgentInboxMessage", answering]]);
});

it("a panel marks an inbox item read or unread, and hears the read state", async () => {
  const { call, asked } = windowPort(PANEL, {
    answers: {
      codingAgentInboxReadState: () => Effect.succeed({ id: ITEM.id, unread: true }),
    },
  });

  assert.deepEqual(
    await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, {
      itemId: ITEM.id,
      unread: true,
    }),
    { answer: { id: ITEM.id, unread: true } },
  );
  assert.deepEqual(asked, [["codingAgentInboxReadState", { itemId: ITEM.id, unread: true }]]);
});

it("a panel's read of an inbox image, or an agent's or a worker's picture, reaches the host as asked and hears its bytes", async () => {
  const picture = () => Effect.succeed(PICTURE);
  const { call, asked } = windowPort(PANEL, {
    answers: {
      codingAgentInboxAttachment: picture,
      codingAgentPicture: picture,
    },
  });
  const reads = [
    [
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT,
      { itemId: ITEM.id, attachmentId: "attachment-1" },
    ],
    [AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE, { agentId: AGENT_ID, pictureId: PICTURE_ID }],
    [
      AGENT_INBOX_ACT_KIND.CODING_AGENTS_PICTURE,
      { agentId: AGENT_ID, pictureId: PICTURE_ID, callId: "call-worker" },
    ],
  ] as const;

  for (const [kind, payload] of reads) {
    assert.deepEqual(await call(kind, payload), { answer: PICTURE });
  }
  assert.deepEqual(asked, [
    ["codingAgentInboxAttachment", reads[0][1]],
    ["codingAgentPicture", reads[1][1]],
    ["codingAgentPicture", reads[2][1]],
  ]);
});

it("a host that dies, or answers what the kind cannot carry, is refused in the kind's own words", async () => {
  const died = windowPort(PANEL, { fallback: () => Effect.die(new Error("secret detail")) });
  const malformed = windowPort(PANEL, { fallback: () => Effect.succeed({ items: "none" }) });
  for (const { call } of [died, malformed]) {
    for (const act of ACTS) {
      assert.deepEqual(await call(act.kind, act.payload), { refused: REFUSAL[act.kind] });
    }
  }
});

it("an answer's key its kind's view schema does not name is left out of what the panel hears", async () => {
  const { call } = windowPort(PANEL, {
    answers: {
      codingAgentInboxMessage: () =>
        Effect.succeed({ item: { ...ITEM, stray: true }, stray: true }),
    },
  });

  assert.deepEqual(
    await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, {
      itemId: ITEM.id,
      text: "Also page on-call.",
      clientKey: "message-2",
    }),
    { answer: { item: ITEM } },
  );
});

it("a payload carrying a key its kind's schema does not name is refused in the kind's own words, and the host is not asked", async () => {
  const { call, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    // SAFETY: every payload above is an object, which the stray key is added beside.
    const payload = { ...(act.payload as Record<string, WireBoundaryInput>), stray: true };
    assert.deepEqual(await call(act.kind, payload), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a payload its kind's schema refuses, or none where the kind takes one, is refused in the kind's own words, and the host is not asked", async () => {
  const { call, asked } = windowPort(PANEL);
  assert.deepEqual(
    await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE, {
      itemId: ITEM.id,
      unread: "yes",
    }),
    { refused: REFUSAL[AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_READ_STATE] },
  );
  for (const act of ACTS) {
    assert.deepEqual(await call(act.kind, undefined), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("an item whose thread carries an ask of a type this build does not know reaches the panel unchanged, so it draws it as a newer Luke's", async () => {
  const newer = {
    ...ITEM,
    thread: [
      {
        id: "7a1c3e5b-2d4f-4a6c-8e0b-1d3f5a7c9e2b",
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Ship it?",
        ask: { type: "signature", status: INBOX_ASK_STATUS.OPEN },
        createdAt: 1_800_000_000_000,
      },
    ],
  };
  const { call } = windowPort(PANEL, {
    answers: { codingAgentInboxMessage: () => Effect.succeed({ item: newer }) },
  });

  assert.deepEqual(
    await call(AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_MESSAGE, {
      itemId: ITEM.id,
      text: "Ship it.",
      clientKey: "message-3",
    }),
    { answer: { item: newer } },
  );
});

/** Turns the event loop until `ready` holds, as a page waits on its port. */
async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn += 1) await nextTurn();
}

it("a panel's inbox stream follows the inbox at the host, hears each change told of it alone, and lets it go once its last stream closes", async () => {
  const asked: string[] = [];
  const listeners = new Set<(changed: CodingAgentInboxChanged) => void>();
  const follows: Pick<
    HostAsk,
    "codingAgentInboxFollow" | "codingAgentInboxUnfollow" | "onInboxChanged"
  > = {
    codingAgentInboxFollow: () => Effect.sync(() => void asked.push("follow")),
    codingAgentInboxUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
    onInboxChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  // SAFETY: the stream reaches the follow asks alone.
  const host = follows as HostAsk;
  const port = testActPort(agentInboxProcedures({ host }));
  ports.push(port);
  const client = port.as(PANEL);
  const scope: CodingAgentInboxScope = { kind: INBOX_SCOPE_KIND.PLAN, id: TASK_ID };

  const one = await client[AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW](scope);
  const two = await client[AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW](scope);
  const first = one.next();
  const second = two.next();
  await until(() => asked.length === 1);
  for (const listener of [...listeners]) {
    listener({ scope: { kind: INBOX_SCOPE_KIND.AGENT, id: AGENT_ID }, inbox: UNANSWERED });
    listener({ scope, inbox: { items: [ITEM] } });
  }
  assert.deepEqual((await first).value, { items: [ITEM] });
  assert.deepEqual((await second).value, { items: [ITEM] });

  await one.return(undefined);
  await until(() => listeners.size === 1);
  assert.deepEqual(asked, ["follow"], "the host follows the inbox once for both streams");
  await two.return(undefined);
  await until(() => asked.length === 2);
  assert.deepEqual(asked, ["follow", "unfollow"]);
});

it("the voice window is refused an inbox stream, and the host follows nothing", async () => {
  const asked: string[] = [];
  // SAFETY: the stream reaches the follow asks alone.
  const host = {
    codingAgentInboxFollow: () => Effect.sync(() => void asked.push("follow")),
    codingAgentInboxUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
    onInboxChanged: () => () => undefined,
  } as unknown as HostAsk;
  const port = testActPort(agentInboxProcedures({ host }));
  ports.push(port);
  await assert.rejects(
    port.as(VOICE)[AGENT_INBOX_ACT_KIND.CODING_AGENTS_INBOX_FOLLOW]({
      kind: INBOX_SCOPE_KIND.PLAN,
      id: TASK_ID,
    }),
  );
  assert.deepEqual(asked, []);
});
