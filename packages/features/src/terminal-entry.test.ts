import assert from "node:assert/strict";
import { test } from "vitest";
import { TERMINAL_ASK, TERMINAL_TARGET, terminalTarget } from "./terminal-entry.js";

/**
 * The new-terminal rules, row by row:
 * which agent ⌘J and New terminal mean from each place a developer can be.
 */

const FIRST = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const SECOND = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";
const BOTH = [FIRST, SECOND];

const agent = (agentId: string) => ({ kind: TERMINAL_TARGET.AGENT, agentId });

test("from an agent's tab, its Changes tab, or its Terminal tab, both mean that agent", () => {
  const context = { here: SECOND, agents: BOTH, lastUsed: FIRST };
  assert.deepEqual(terminalTarget(TERMINAL_ASK.SHOW, context), agent(SECOND));
  assert.deepEqual(terminalTarget(TERMINAL_ASK.NEW, context), agent(SECOND));
});

test("from anywhere else on a plan with one agent, both mean that agent", () => {
  const context = { here: undefined, agents: [FIRST], lastUsed: undefined };
  assert.deepEqual(terminalTarget(TERMINAL_ASK.SHOW, context), agent(FIRST));
  assert.deepEqual(terminalTarget(TERMINAL_ASK.NEW, context), agent(FIRST));
});

test("with several agents, ⌘J goes to the one used last and New terminal asks, that one chosen to begin with", () => {
  const context = { here: undefined, agents: BOTH, lastUsed: SECOND };
  assert.deepEqual(terminalTarget(TERMINAL_ASK.SHOW, context), agent(SECOND));
  assert.deepEqual(terminalTarget(TERMINAL_ASK.NEW, context), {
    kind: TERMINAL_TARGET.PICK,
    chosen: SECOND,
  });
});

test("with several agents and none used yet, both ask", () => {
  const context = { here: undefined, agents: BOTH, lastUsed: undefined };
  const pick = { kind: TERMINAL_TARGET.PICK, chosen: undefined };
  assert.deepEqual(terminalTarget(TERMINAL_ASK.SHOW, context), pick);
  assert.deepEqual(terminalTarget(TERMINAL_ASK.NEW, context), pick);
});

test("with no agent on the plan, both offer to start one", () => {
  const context = { here: undefined, agents: [], lastUsed: undefined };
  assert.deepEqual(terminalTarget(TERMINAL_ASK.SHOW, context), { kind: TERMINAL_TARGET.NO_AGENT });
  assert.deepEqual(terminalTarget(TERMINAL_ASK.NEW, context), { kind: TERMINAL_TARGET.NO_AGENT });
});

test("an agent archived since is offered nowhere: not as where the developer is, nor as the one used last", () => {
  const archived = "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c";
  const context = { here: archived, agents: BOTH, lastUsed: archived };
  assert.deepEqual(terminalTarget(TERMINAL_ASK.SHOW, context), {
    kind: TERMINAL_TARGET.PICK,
    chosen: undefined,
  });
});
