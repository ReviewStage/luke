import assert from "node:assert/strict";
import { NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import { normalizeSession, SESSION_STATUS, type SessionIdentity } from "@sidecar/session";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { test } from "vitest";
import { BRAIN_TOOL } from "./names.js";
import {
  offeredSessions,
  PLAN_READS_INPUT,
  PLAN_READS_MAXIMUM,
  PLAN_READS_TOOL,
  PLAN_READS_TOOL_NAME,
  PREFETCH_READ_KIND,
  planReadsFromCall,
} from "./prefetch-tool.js";

const ABC: SessionIdentity = { providerId: "claude-code", providerSessionId: "abc" };
const DEF: SessionIdentity = { providerId: "claude-code", providerSessionId: "def" };
const OFFERED = [ABC, DEF];

function plan(reads: readonly unknown[]): string {
  return JSON.stringify({ reads });
}

test("the tool is named once, declares its schema, and names the two reads by the tools they become", () => {
  assert.equal(PLAN_READS_TOOL.name, PLAN_READS_TOOL_NAME);
  assert.equal(PLAN_READS_TOOL.inputSchema, PLAN_READS_INPUT);
  assert.equal(PREFETCH_READ_KIND.TRANSCRIPT, BRAIN_TOOL.READ_TRANSCRIPT);
  assert.equal(PREFETCH_READ_KIND.MEMORY, NOTEBOOK_MEMORY_TOOL.SEARCH);
  const node = emitJsonSchema(PLAN_READS_INPUT);
  assert.ok("required" in node);
  assert.deepEqual(node.required, ["reads"]);
  assert.equal(PLAN_READS_MAXIMUM, 2);
});

test("a valid plan resolves each position to the identity offered there, in the order named", () => {
  assert.deepEqual(
    planReadsFromCall(
      plan([
        { kind: PREFETCH_READ_KIND.MEMORY, query: "release date" },
        { kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 2 },
      ]),
      OFFERED,
    ),
    [
      { kind: PREFETCH_READ_KIND.MEMORY, query: "release date" },
      { kind: PREFETCH_READ_KIND.TRANSCRIPT, identity: DEF },
    ],
  );
  assert.deepEqual(planReadsFromCall(plan([]), OFFERED), []);
});

test("a position past the offered sessions, a third read, an unknown kind, or arguments that are not a plan refuse the whole plan", () => {
  assert.equal(
    planReadsFromCall(plan([{ kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 3 }]), OFFERED),
    undefined,
  );
  assert.equal(
    planReadsFromCall(plan([{ kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 0 }]), OFFERED),
    undefined,
  );
  assert.equal(
    planReadsFromCall(plan([{ kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 1 }]), []),
    undefined,
  );
  assert.equal(
    planReadsFromCall(
      plan([
        { kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 1 },
        { kind: PREFETCH_READ_KIND.MEMORY, query: "a" },
        { kind: PREFETCH_READ_KIND.MEMORY, query: "b" },
      ]),
      OFFERED,
    ),
    undefined,
  );
  assert.equal(planReadsFromCall(plan([{ kind: "shell", command: "ls" }]), OFFERED), undefined);
  assert.equal(planReadsFromCall(plan([{ kind: PREFETCH_READ_KIND.MEMORY }]), OFFERED), undefined);
  assert.equal(planReadsFromCall("not json", OFFERED), undefined);
  assert.equal(planReadsFromCall("[]", OFFERED), undefined);
});

test("a second read of a kind already named is dropped, so a plan carries at most one of each", () => {
  assert.deepEqual(
    planReadsFromCall(
      plan([
        { kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 1 },
        { kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 2 },
      ]),
      OFFERED,
    ),
    [{ kind: PREFETCH_READ_KIND.TRANSCRIPT, identity: ABC }],
  );
});

test("the sessions are offered numbered from one in roster order, each position resolving to its identity", () => {
  const provider = { id: "claude-code", displayName: "Claude Code" };
  const sessions = [ABC, DEF].map((identity) =>
    normalizeSession(provider, {
      providerSessionId: identity.providerSessionId,
      title: `Title ${identity.providerSessionId}`,
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1_800_000_000_000,
    }),
  );
  const offered = offeredSessions(sessions);
  assert.deepEqual(
    offered.options.map((option) => option.option),
    [1, 2],
  );
  assert.deepEqual(
    offered.options.map((option) => option.title),
    ["Title abc", "Title def"],
  );
  assert.deepEqual(
    offered.options.map((option) => option.status),
    [SESSION_STATUS.WORKING, SESSION_STATUS.WORKING],
  );
  assert.deepEqual(offered.identities, OFFERED);
  assert.deepEqual(offeredSessions([]), { options: [], identities: [] });
});
