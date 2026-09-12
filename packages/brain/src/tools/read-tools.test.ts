import assert from "node:assert/strict";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { SessionIdentity } from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { test } from "vitest";
import { BRAIN_TOOL } from "./names.js";
import { READ_TOOLS, type ReadToolContext, readToolNamed } from "./read-tools.js";
import { REFUSAL_REASON } from "./refusals.js";

const ABC: SessionIdentity = { providerId: "claude-code", providerSessionId: "abc" };

/** A turn's standing over a roster of one session, whose transcript reads are recorded. */
function context() {
  const reads: SessionIdentity[] = [];
  const ctx: ReadToolContext = {
    conversationId: MAIN_SESSION_KEY,
    turnId: "run-1",
    runId: "run-1",
    origin: RUN_ORIGIN.OBSERVATION,
    isRevoked: () => false,
    signal: new AbortController().signal,
    roster: { text: "Currently observed sessions:\n- abc", identities: [ABC] },
    readTranscript: async (identity) => {
      reads.push(identity);
      return { status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "whole" };
    },
  };
  return { ctx, reads };
}

test("the two reads are modules named as the catalog names them, each with the schema its fields are declared in", () => {
  assert.deepEqual(
    READ_TOOLS.map((tool) => tool.name),
    [BRAIN_TOOL.LIST_SESSIONS, BRAIN_TOOL.READ_TRANSCRIPT],
  );
  for (const tool of READ_TOOLS) assert.equal(readToolNamed(tool.name), tool);
  assert.equal(readToolNamed(BRAIN_TOOL.ANNOUNCE), undefined);
  const readTranscript = readToolNamed(BRAIN_TOOL.READ_TRANSCRIPT);
  const identity = readTranscript && emitJsonSchema(readTranscript.inputSchema);
  assert.ok(identity && "required" in identity);
  assert.deepEqual([...identity.required].sort(), ["provider_id", "provider_session_id"]);
});

test("list_sessions answers the roster as the host renders it now, and reads nothing else", async () => {
  const { ctx, reads } = context();
  const tool = readToolNamed(BRAIN_TOOL.LIST_SESSIONS);
  assert.ok(tool);
  assert.deepEqual(await tool.execute({}, ctx), { roster: ctx.roster.text });
  assert.deepEqual(reads, []);
});

test("read_transcript reads only a session the roster holds, and refuses every other identity before the host is asked", async () => {
  const { ctx, reads } = context();
  const tool = readToolNamed(BRAIN_TOOL.READ_TRANSCRIPT);
  assert.ok(tool);
  const read = await tool.execute(
    { provider_id: ABC.providerId, provider_session_id: ABC.providerSessionId },
    ctx,
  );
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(reads, [ABC]);
  const refused: WireRecord[] = [
    { provider_id: ABC.providerId, provider_session_id: "ghost" },
    { provider_id: ABC.providerId },
    {},
    { provider_id: 7, provider_session_id: "abc" },
  ];
  for (const input of refused) {
    const answer = await tool.execute(input, ctx);
    assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(answer.reason, REFUSAL_REASON.UNOBSERVED_SESSION);
  }
  assert.equal(reads.length, 1);
});
