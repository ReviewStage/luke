import assert from "node:assert/strict";
import { test } from "vitest";
import coder from "../coder/connections/linear";
import coderWorker from "../coder/subagents/worker/connections/linear";
import planning from "../eve/connections/linear";
import planningWorker from "../eve/subagents/worker/connections/linear";
import { LINEAR_MCP } from "../server/hosted/linear-connection";

/**
 * Each of the four agents registers the one Linear connection under its own
 * ownership check, since eve hands a declared worker none of its parent's:
 * the planning model, the planning worker, the coding agent, and the coding
 * agent's worker. Which check each runs under is the token read's to show
 * (`linear-connection.test.ts`); this holds that each registers the same
 * server, every tool on it, and a credential resolved per session.
 */

const REGISTERED = {
  planning,
  planningWorker,
  coder,
  coderWorker,
} as const;

test.for(Object.entries(REGISTERED))(
  "the %s registers Linear's own server, whole, credentialed per session",
  ([, definition]) => {
    assert.equal(definition.url, LINEAR_MCP.URL);
    assert.equal(definition.description, LINEAR_MCP.DESCRIPTION);
    assert.equal(definition.tools, undefined);
    assert.equal(definition.approval, undefined);
    assert.ok(definition.auth instanceof Function);
  },
);
