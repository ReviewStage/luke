import assert from "node:assert/strict";
import { test } from "vitest";
import coder from "../coder/connections/linear";
import coderWorker from "../coder/subagents/worker/connections/linear";
import planning from "../eve/connections/linear";
import planningWorker from "../eve/subagents/worker/connections/linear";
import { INTEGRATION } from "../server/hosted/integrations";

/**
 * Each of the four agents registers Linear's one connection under its own
 * ownership check, since eve hands a declared worker none of its parent's:
 * the planning model, the planning worker, the coding agent, and the coding
 * agent's worker. Which check each runs under is the token read's to show
 * (`integration-connection.test.ts`); this holds that each registers the
 * same server, every tool on it, and a credential resolved per session.
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
    assert.equal(definition.url, INTEGRATION.linear.MCP_URL);
    assert.equal(definition.description, INTEGRATION.linear.DESCRIPTION);
    assert.equal(definition.tools, undefined);
    assert.equal(definition.approval, undefined);
    assert.ok(definition.auth instanceof Function);
  },
);
