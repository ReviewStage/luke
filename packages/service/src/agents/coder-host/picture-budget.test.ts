import assert from "node:assert/strict";
import { jsonResponse } from "@luke/wire/testing";
import { generateText, type ModelMessage } from "ai";
import { Redacted, Result, Schema } from "effect";
import { test } from "vitest";
import { coderModel } from "./model.js";

/**
 * A coding agent's step whose transcript holds the screenshots it read, as
 * Anthropic, faked at its fetch, receives it: the newest pictures are sent,
 * at most twenty and inside the byte budget, the oldest left out ten at a
 * time with words in each one's place, and a transcript whose pictures fit
 * is sent as it was. Synthetic keys and pictures throughout.
 */

const WINDOW = 200_000;

const CHOICE = { model: "anthropic/claude-opus-5.5", effort: "high" } as const;

const MIB = 1024 * 1024;

/** Anthropic's answer to any request, whole. */
const MESSAGE = {
  id: "msg_fixture",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "Looked." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** A block of a message as Anthropic received it: a picture's data, or words, wherever it stands. */
interface Block {
  readonly type: string;
  readonly text?: string;
  readonly source?: { readonly data?: string };
  readonly content?: readonly Block[] | string;
}

const BlockSchema: Schema.Codec<Block> = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.Struct({ data: Schema.optionalKey(Schema.String) })),
  content: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.suspend(() => BlockSchema))]),
  ),
});

const readRequest = Schema.decodeUnknownSync(
  Schema.Struct({
    messages: Schema.Array(
      Schema.Struct({ content: Schema.Union([Schema.String, Schema.Array(BlockSchema)]) }),
    ),
  }),
);

/** What one request carried: each picture's data and each block of words, in order, tool results' included. */
interface Received {
  readonly pictures: string[];
  readonly words: string[];
}

function collect(blocks: readonly Block[] | string | undefined, into: Received): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (block.type === "image" && block.source?.data !== undefined)
      into.pictures.push(block.source.data);
    if (block.type === "text" && block.text !== undefined) into.words.push(block.text);
    collect(block.content, into);
  }
}

/** One step over the transcript given, on Luke's key against the fake, and what Anthropic received. */
async function stepOver(messages: ModelMessage[]): Promise<Received> {
  const received: Received = { pictures: [], words: [] };
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    for (const message of readRequest(JSON.parse(String(init?.body))).messages) {
      collect(message.content, received);
    }
    return jsonResponse(MESSAGE);
  };
  const selected = coderModel(
    CHOICE,
    { anthropic: { key: Redacted.make("sk-ant-luke-fixture") }, openAi: undefined, fetch },
    WINDOW,
    async () => undefined,
  );
  if (Result.isFailure(selected)) return assert.fail(`no model: ${selected.failure}`);
  await generateText({ model: selected.success.model, messages, maxRetries: 0 });
  return received;
}

/** A picture's base64 data, told apart by its number and padded to the length given. */
function pictureData(index: number, length = 16): string {
  return `${String(index).padStart(4, "0")}`.padEnd(length, "A");
}

/** A transcript in which the agent read one screenshot per step, with the data given for each. */
function screenshotsRead(pictures: readonly string[]): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "user", content: "Build it and look at it." }];
  pictures.forEach((data, index) => {
    const toolCallId = `call_${index}`;
    const input = { filePath: `/tmp/shot-${index}.png` };
    messages.push(
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId, toolName: "read_file", input }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName: "read_file",
            output: {
              type: "content",
              value: [
                { type: "text", text: `Image /tmp/shot-${index}.png` },
                {
                  type: "file",
                  data: { type: "data", data },
                  mediaType: "image/png",
                  filename: `shot-${index}.png`,
                },
              ],
            },
          },
        ],
      },
    );
  });
  return messages;
}

const leftOutWords = (words: readonly string[]) =>
  words.filter((text) => text.includes("was left out of this request"));

test("a step over more screenshots than Anthropic takes sends the newest, the oldest ten left out with words in their place", async () => {
  const pictures = Array.from({ length: 25 }, (_, index) => pictureData(index));

  const received = await stepOver(screenshotsRead(pictures));

  assert.deepEqual(received.pictures, pictures.slice(10));
  assert.equal(leftOutWords(received.words).length, 10);
  assert.match(leftOutWords(received.words)[0] ?? "", /shot-0\.png/u);
});

test("a step over twenty screenshots sends every one as it was", async () => {
  const pictures = Array.from({ length: 20 }, (_, index) => pictureData(index));

  const received = await stepOver(screenshotsRead(pictures));

  assert.deepEqual(received.pictures, pictures);
  assert.deepEqual(leftOutWords(received.words), []);
});

test("a step over a few large screenshots past the byte budget sends the newest that fit, never none", async () => {
  const pictures = [0, 1, 2].map((index) => pictureData(index, 7 * MIB));

  const received = await stepOver(screenshotsRead(pictures));

  assert.deepEqual(received.pictures, pictures.slice(1));
  assert.equal(leftOutWords(received.words).length, 1);
});
