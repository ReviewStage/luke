import assert from "node:assert/strict";
import { TERMINAL_RELAY } from "@luke/features/terminal-wire";
import { test } from "vitest";
import { admitRelayUpgrade, RELAY_UPGRADE_STATUS } from "../server/terminal/service";

/**
 * Which upgrades the terminal relay takes, before any socket stands: only
 * its own path, only a caller that is no browser page, only under a bearer,
 * and only one naming an agent, a shell, and a size it can read.
 */

const AGENT = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
const BEARER = { authorization: "Bearer token-1" };

function address(query: Record<string, string>, path: string = TERMINAL_RELAY.PATH): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

const ASKED = { agent: AGENT, terminal: SHELL, cols: "120", rows: "32" };

test("an upgrade naming its agent, shell, and size under a bearer is taken", () => {
  assert.deepEqual(admitRelayUpgrade(address(ASKED), BEARER), {
    bearer: "Bearer token-1",
    ask: { agentId: AGENT, terminalId: SHELL, cols: 120, rows: 32 },
  });
});

test("another path, a browser's origin, a missing bearer, and an unreadable ask are refused before any socket stands", () => {
  assert.deepEqual(admitRelayUpgrade(address(ASKED, "/api/voice/sessions"), BEARER), {
    status: RELAY_UPGRADE_STATUS.NOT_FOUND,
  });
  assert.deepEqual(admitRelayUpgrade(address(ASKED), { ...BEARER, origin: "https://evil.test" }), {
    status: RELAY_UPGRADE_STATUS.FORBIDDEN,
  });
  assert.deepEqual(admitRelayUpgrade(address(ASKED), {}), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
  assert.deepEqual(admitRelayUpgrade(address(ASKED), { authorization: "Bearer " }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
  for (const unreadable of [
    { ...ASKED, agent: "not-an-id" },
    { ...ASKED, cols: "0" },
    { ...ASKED, rows: "100000" },
    { agent: AGENT, terminal: SHELL },
  ]) {
    assert.deepEqual(admitRelayUpgrade(address(unreadable), BEARER), {
      status: RELAY_UPGRADE_STATUS.BAD_REQUEST,
    });
  }
});
