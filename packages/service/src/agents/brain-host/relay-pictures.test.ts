import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { readConversationPicture } from "@luke/database/models/conversation-pictures";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  insertConversation,
  openHostedStoreTestDatabase,
  readMessagesByConversationTyped,
} from "@luke/database/testing";
import { CONNECTION_TOOL } from "@luke/features/agent-tools";
import {
  CONVERSATION_PICTURE_BOUNDS,
  PICTURE_OMISSION,
} from "@luke/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { INTEGRATION_PROVIDER, INTEGRATION_REMOTE_TOOL } from "@luke/features/integration-wire";
import { isRecord, type WireValue } from "@luke/wire";
import { isToolUIPart } from "ai";
import { Effect, Option } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { HOSTED_TOOL_SET } from "../../plans/brain-tool-set.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "./relay.js";

/**
 * The pictures an integration's tool answers, relayed into the record over
 * the real migrations on PGlite: each is kept once beside the conversation
 * and named in the stored output by what was kept, never by its base64, on
 * the call eve ran and the nested call under it alike; one too large is
 * named with its size and not kept; and every other block stands as the
 * tool wrote it. The picture is a real PNG a browser drew at 37 by 23; the
 * events are the shapes eve emits, synthetic throughout.
 */

const NOW = 1_800_000_000_000;

const PNG_37_BY_23 = [
  "iVBORw0KGgoAAAANSUhEUgAAACUAAAAXCAYAAACMLIalAAAAXUlEQVR4AezSsQ0AIQxD0YgxbqCjhFFpGQjWgBV+JA",
  "qCjJTOBX5JKv9Yt02yC58+RZcSR6r1z8jQ5t5cHClvs9N5SVFRSb0nVfM0MrS5N6ebomKSkhQVoDndVGipDQAA//8I",
  "FJ0jAAAABklEQVQDANt9eaw6g4OJAAAAAElFTkSuQmCC",
].join("");

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
const refusals: string[] = [];
const relay = new StreamRelay({
  writer,
  now: () => NOW,
  report: (message) => refusals.push(message),
});

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const LINEAR_REMOTE = INTEGRATION_REMOTE_TOOL[INTEGRATION_PROVIDER.LINEAR];

/** The first bytes of a PDF, a blob no picture, which the record keeps as the tool wrote it. */
const PDF_HEAD = Buffer.from("%PDF-1.7\n").toString("base64");

/** Base64 whose bytes would be one more than a picture may be, never decoded by the relay. */
const TOO_LARGE_BASE64 = "A".repeat(
  Math.ceil(((CONVERSATION_PICTURE_BOUNDS.MAX_BYTES + 1) * 4) / 3) + 4,
);

/** What Linear's tool answered: words, a picture, a picture too large to keep, the picture again as a resource with a type and as one without, and a resource that is no picture. */
const ANSWER: readonly WireValue[] = [
  { type: "text", text: "2 images extracted from NW-482" },
  { type: "image", data: PNG_37_BY_23, mimeType: "image/png" },
  { type: "image", data: TOO_LARGE_BASE64, mimeType: "image/png" },
  {
    type: "resource",
    resource: {
      uri: "https://uploads.linear.app/accept.png",
      mimeType: "image/png",
      blob: PNG_37_BY_23,
    },
  },
  {
    type: "resource",
    resource: { uri: "https://uploads.linear.app/unlabelled", blob: PNG_37_BY_23 },
  },
  { type: "resource", resource: { uri: "https://uploads.linear.app/spec.pdf", blob: PDF_HEAD } },
];

/** One typed turn whose one step runs Linear's tool through `connection_execute`, both answering the same blocks. */
function integrationTurn(turnId: string): MessageStreamEvent[] {
  const sequence = 1;
  const result = (callId: string, toolName: string) =>
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: { kind: "tool-result", callId, toolName, output: ANSWER },
      },
    });
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({
      type: "message.received",
      data: { turnId, sequence, message: "what does NW-482 show?" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-execute",
            toolName: CONNECTION_TOOL.EXECUTE,
            input: { toolName: "linear__extract_images", input: { issueId: "NW-482" } },
          },
        ],
      },
    }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-nested",
            parentCallId: "call-execute",
            toolName: "linear__extract_images",
            input: { issueId: "NW-482" },
          },
        ],
      },
    }),
    result("call-nested", "linear__extract_images"),
    result("call-execute", CONNECTION_TOOL.EXECUTE),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop", message: "The old copy." },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

/** The output each tool part of the conversation's answer was stored with, by tool. */
async function storedOutputs(target: ConversationTarget): Promise<ReadonlyMap<string, unknown>> {
  const rows = await readMessagesByConversationTyped(database.run, target.conversationId);
  const outputs = new Map<string, unknown>();
  for (const row of rows) {
    for (const part of row.parts) {
      if (isToolUIPart(part) && part.state === "output-available")
        outputs.set(part.type, part.output);
    }
  }
  return outputs;
}

it.effect(
  "an integration's pictures are kept beside the conversation and named by id, never carried as base64",
  () =>
    Effect.promise(async () => {
      const userId = await database.createUser();
      const conversationId = await insertConversation(database.run, { userId });
      const target = { userId, conversationId };
      const standing: RelayStanding = {
        sessionId: `wrun_${randomUUID()}`,
        target,
        turn: BRAIN_HOST_TURN.TYPED,
        state: memoryRelayState(),
      };
      for (const event of integrationTurn(randomUUID()))
        await database.run(relay.handle(event, standing));

      const outputs = await storedOutputs(target);
      const nested = outputs.get(`tool-${LINEAR_REMOTE}`);
      const execute = outputs.get(`tool-${CONNECTION_TOOL.EXECUTE}`);
      assert.deepEqual(execute, nested, "the call eve ran and the nested call name the same rows");
      assert.ok(Array.isArray(nested));
      const [words, kept, tooLarge, resource, unlabelled, pdf] = nested;
      assert.deepEqual(words, ANSWER[0], "words stand as the tool wrote them");
      assert.ok(isRecord(kept) && isRecord(kept.picture));
      const picture = kept.picture;
      assert.deepEqual(
        { ...kept, picture: { ...picture, id: "" } },
        {
          type: "image",
          mimeType: "image/png",
          picture: {
            id: "",
            mediaType: INBOX_IMAGE_TYPE.PNG,
            width: 37,
            height: 23,
            byteCount: 168,
          },
        },
      );
      assert.deepEqual(tooLarge, {
        type: "image",
        mimeType: "image/png",
        omitted: PICTURE_OMISSION.TOO_LARGE,
        byteCount: Math.floor((TOO_LARGE_BASE64.length * 3) / 4),
      });
      assert.deepEqual(
        resource,
        {
          type: "resource",
          resource: {
            uri: "https://uploads.linear.app/accept.png",
            mimeType: "image/png",
            picture,
          },
        },
        "the same picture as a resource is the same row",
      );
      assert.deepEqual(
        unlabelled,
        { type: "resource", resource: { uri: "https://uploads.linear.app/unlabelled", picture } },
        "a resource that names no type is a picture where its bytes are one",
      );
      assert.deepEqual(pdf, ANSWER[5], "a blob that is no picture stands as the tool wrote it");
      assert.ok(!JSON.stringify(nested).includes(PNG_37_BY_23.slice(0, 40)), "no base64 is stored");

      const read = await database.run(readConversationPicture(conversationId, String(picture.id)));
      assert.deepEqual(
        Option.map(read, (stored) => Buffer.from(stored.bytes).toString("base64")),
        Option.some(PNG_37_BY_23),
      );
      assert.deepEqual(refusals, []);
    }),
);
