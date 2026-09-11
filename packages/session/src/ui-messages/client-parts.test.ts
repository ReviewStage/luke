import assert from "node:assert/strict";
import { MESSAGE_AUTHOR, MESSAGE_ROLE } from "@sidecar/wire";
import { test } from "vitest";
import { clientUIMessage, REPLAY_PROVIDER_KEY } from "./client-parts.js";
import type { StoredUIMessage } from "./validate.js";

const REPLAY = { itemId: "rs_1", reasoningEncryptedContent: "b3BhcXVl" };

function reply(parts: StoredUIMessage["parts"]): StoredUIMessage {
  return {
    id: "m",
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts,
  };
}

test("the replay slot is cut from every part and the summary text stays", () => {
  const stored = reply([
    { type: "step-start" },
    {
      type: "reasoning",
      text: "Read the tail first.",
      state: "done",
      providerMetadata: { [REPLAY_PROVIDER_KEY]: REPLAY },
    },
    {
      type: "text",
      text: "It is waiting.",
      state: "done",
      providerMetadata: { [REPLAY_PROVIDER_KEY]: { itemId: "msg_1" } },
    },
  ]);
  const client = clientUIMessage(stored);
  assert.deepEqual(client.parts, [
    { type: "step-start" },
    { type: "reasoning", text: "Read the tail first.", state: "done" },
    { type: "text", text: "It is waiting.", state: "done" },
  ]);
  for (const part of client.parts) assert.equal("providerMetadata" in part, false);
});

test("another provider's metadata is left as written", () => {
  const stored = reply([
    {
      type: "reasoning",
      text: "Thought.",
      state: "done",
      providerMetadata: { [REPLAY_PROVIDER_KEY]: REPLAY, other: { trace: "t" } },
    },
    { type: "text", text: "Said.", state: "done", providerMetadata: { other: { trace: "u" } } },
  ]);
  assert.deepEqual(clientUIMessage(stored).parts, [
    {
      type: "reasoning",
      text: "Thought.",
      state: "done",
      providerMetadata: { other: { trace: "t" } },
    },
    { type: "text", text: "Said.", state: "done", providerMetadata: { other: { trace: "u" } } },
  ]);
});

test("the stored message is not changed by shaping the client's copy", () => {
  const stored = reply([
    {
      type: "reasoning",
      text: "Thought.",
      state: "done",
      providerMetadata: { [REPLAY_PROVIDER_KEY]: REPLAY },
    },
    {
      type: "tool-read_transcript",
      toolCallId: "call_1",
      state: "output-available",
      input: { providerId: "conductor" },
      output: { lines: [] },
    },
  ]);
  const before = structuredClone(stored);
  const client = clientUIMessage(stored);
  assert.deepEqual(stored, before);
  assert.deepEqual(client.parts[1], stored.parts[1]);
  assert.deepEqual(client, { ...stored, parts: client.parts });
});
