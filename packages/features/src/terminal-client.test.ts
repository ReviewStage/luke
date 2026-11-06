import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi } from "@repo/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { HostedTerminalClient, terminalRelayAddress } from "./terminal-client.js";
import { SANDBOX_STATE } from "./terminal-wire.js";

/**
 * A coding agent's terminals as the host asks the service for them, over a
 * service that answers from a script: each call travels to its own path
 * with its own body and answers what the service said; and the relay
 * address names the agent, the shell, and the size on the socket origin.
 * Synthetic ids throughout.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const SHELL_ID = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL = { id: SHELL_ID, title: "server", command: "node", cwd: "/workspace", running: true };
const LISTED = { sandbox: SANDBOX_STATE.RUNNING, terminals: [SHELL] };

function client(): HostedTerminalClient {
  return new HostedTerminalClient({
    serviceBaseUrl: "https://vespin.dev",
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
    }),
  });
}

it.effect(
  "each call travels to its own path with its own body and answers what the service said",
  () =>
    Effect.gen(function* () {
      const terminals = `/api/agents/${AGENT_ID}/terminals`;
      const api = fakeCloudApi({
        [`GET ${terminals}`]: { answer: () => LISTED },
        [`POST ${terminals}`]: { answer: () => ({ terminal: SHELL }), status: 201 },
        [`PATCH ${terminals}/${SHELL_ID}`]: { answer: () => LISTED },
        [`DELETE ${terminals}/${SHELL_ID}`]: {
          answer: () => ({ sandbox: SANDBOX_STATE.RUNNING, terminals: [] }),
        },
        [`POST /api/agents/${AGENT_ID}/sandbox/resume`]: {
          answer: () => ({ sandbox: SANDBOX_STATE.RUNNING }),
        },
      });
      const terminal = client();

      const listed = yield* Effect.provide(terminal.list(AGENT_ID), api.layer);
      const created = yield* Effect.provide(terminal.create(AGENT_ID, "server"), api.layer);
      const unnamed = yield* Effect.provide(terminal.create(AGENT_ID, undefined), api.layer);
      const renamed = yield* Effect.provide(
        terminal.rename(AGENT_ID, SHELL_ID, "server"),
        api.layer,
      );
      const killed = yield* Effect.provide(terminal.kill(AGENT_ID, SHELL_ID), api.layer);
      const resumed = yield* Effect.provide(terminal.resume(AGENT_ID), api.layer);

      assert.deepEqual(listed, LISTED);
      assert.deepEqual(created, { terminal: SHELL });
      assert.deepEqual(unnamed, { terminal: SHELL });
      assert.deepEqual(renamed, LISTED);
      assert.deepEqual(killed, { sandbox: SANDBOX_STATE.RUNNING, terminals: [] });
      assert.deepEqual(resumed, { sandbox: SANDBOX_STATE.RUNNING });
      assert.deepEqual(
        api.requests().map((request) => [request.method, request.pathname, request.body ?? ""]),
        [
          ["GET", terminals, ""],
          ["POST", terminals, '{"title":"server"}'],
          ["POST", terminals, "{}"],
          ["PATCH", `${terminals}/${SHELL_ID}`, '{"title":"server"}'],
          ["DELETE", `${terminals}/${SHELL_ID}`, ""],
          ["POST", `/api/agents/${AGENT_ID}/sandbox/resume`, ""],
        ],
      );
    }),
);

it("the relay address names the agent, the shell, and the size on the socket origin", () => {
  const address = new URL(
    terminalRelayAddress("wss://vespin.dev", {
      agentId: AGENT_ID,
      terminalId: SHELL_ID,
      cols: 120,
      rows: 32,
    }),
  );

  assert.equal(address.origin, "wss://vespin.dev");
  assert.equal(address.pathname, "/api/terminal/sessions");
  assert.deepEqual(Object.fromEntries(address.searchParams), {
    agent: AGENT_ID,
    terminal: SHELL_ID,
    cols: "120",
    rows: "32",
  });
});
