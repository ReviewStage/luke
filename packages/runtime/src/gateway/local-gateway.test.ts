import assert from "node:assert/strict";
import test from "node:test";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_HANDSHAKE_HEADER,
  GATEWAY_HANDSHAKE_REFUSAL,
  GATEWAY_METHOD,
  GATEWAY_PROTOCOL_VERSION,
  type GatewayBuildIdentity,
  type GatewayClientIdentity,
  type GatewayEvent,
} from "@sidecar/runtime-contracts";
import { WebSocket } from "ws";
import { GatewayClient } from "./client.js";
import { createGatewayToken, GATEWAY_LOOPBACK_HOST } from "./discovery.js";
import { GATEWAY_REFUSAL_HEADER, LocalGatewayHost } from "./local-host.js";
import { connectLocalGateway } from "./local-transport.js";
import { GatewayServer, gatewayError, gatewayOk } from "./server.js";
import { GATEWAY_CONNECT_FAILURE } from "./supervisor.js";

const BUILD: GatewayBuildIdentity = {
  protocolVersion: GATEWAY_PROTOCOL_VERSION,
  buildVersion: "1.0.0",
};
const OPERATOR: GatewayClientIdentity = {
  clientId: "desktop",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};

interface Hosted {
  host: LocalGatewayHost;
  server: GatewayServer;
  token: string;
  port: number;
  shutdowns: number;
  effects: string[];
  close: () => Promise<void>;
}

async function hosted(build = BUILD): Promise<Hosted> {
  const token = createGatewayToken();
  const effects: string[] = [];
  const state = { shutdowns: 0 };
  let ids = 0;
  const server = new GatewayServer({
    methods: {
      [GATEWAY_METHOD.RUN_LIST]: () => gatewayOk({ runs: [] }),
      [GATEWAY_METHOD.RUN_SUBMIT]: (params) => {
        effects.push(String(params.question));
        return gatewayOk({ runId: `run-${effects.length}` });
      },
      [GATEWAY_METHOD.SHUTDOWN]: () => {
        state.shutdowns += 1;
        return gatewayOk({ accepted: true });
      },
      [GATEWAY_METHOD.MEMORY_STATUS]: () => gatewayError(GATEWAY_ERROR.REFUSED, "no"),
    },
    configurationRevision: () => 1,
    sessionRevision: () => "gen-1",
    snapshot: () => ({ runs: [] }),
    now: () => 0,
    createEventId: () => {
      ids += 1;
      return `event-${ids}`;
    },
  });
  const host = new LocalGatewayHost({ server, token, build });
  const port = await host.listen();
  return {
    host,
    server,
    token,
    port,
    effects,
    get shutdowns() {
      return state.shutdowns;
    },
    close: () => host.close(),
  };
}

function connect(h: Hosted, overrides: { token?: string; build?: GatewayBuildIdentity } = {}) {
  return connectLocalGateway({
    record: { host: GATEWAY_LOOPBACK_HOST, port: h.port, token: overrides.token ?? h.token },
    client: OPERATOR,
    build: overrides.build ?? BUILD,
    timeoutMs: 2_000,
  });
}

test("the host binds the loopback address on an ephemeral port and carries requests, answers, and events", async () => {
  const h = await hosted();
  try {
    const result = await connect(h);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.connection.hostBuild, BUILD);
    const client = new GatewayClient({
      transport: result.connection,
      createId: () => crypto.randomUUID(),
    });
    const seen: GatewayEvent[] = [];
    client.on(GATEWAY_EVENT.RUNS_CHANGED, (event) => seen.push(event));
    const listed = await client.call(GATEWAY_METHOD.RUN_LIST);
    assert.deepEqual(listed, { ok: true, result: { runs: [] } });
    const submitted = await client.call(GATEWAY_METHOD.RUN_SUBMIT, { question: "hello" });
    assert.equal(submitted.ok, true);
    assert.deepEqual(h.effects, ["hello"]);
    h.server.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.sequence, 1);
    const refused = await client.call(GATEWAY_METHOD.MEMORY_STATUS);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error.code, GATEWAY_ERROR.REFUSED);
    result.connection.close();
  } finally {
    await h.close();
  }
});

test("a wrong token, a wrong protocol, and a malformed handshake are refused before any request is read", async () => {
  const h = await hosted();
  try {
    const wrongToken = await connect(h, { token: createGatewayToken() });
    assert.deepEqual(wrongToken, { ok: false, failure: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED });
    const raw = (headers: Record<string, string>) =>
      new Promise<string | undefined>((resolve) => {
        const socket = new WebSocket(`ws://${GATEWAY_LOOPBACK_HOST}:${h.port}/`, { headers });
        socket.once("unexpected-response", (_request, response) => {
          response.resume();
          socket.terminate();
          resolve(String(response.headers[GATEWAY_REFUSAL_HEADER]));
        });
        socket.once("open", () => {
          socket.close();
          resolve(undefined);
        });
        socket.once("error", () => resolve("error"));
      });
    const good = {
      [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${h.token}`,
      [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
      [GATEWAY_HANDSHAKE_HEADER.BUILD_VERSION]: BUILD.buildVersion,
      [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: "desktop",
      [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
    };
    assert.equal(
      await raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: "99" }),
      GATEWAY_HANDSHAKE_REFUSAL.UNSUPPORTED_VERSION,
    );
    assert.equal(
      await raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: "root" }),
      GATEWAY_HANDSHAKE_REFUSAL.MALFORMED,
    );
    const { [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: _dropped, ...withoutToken } = good;
    assert.equal(await raw(withoutToken), GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED);
    assert.equal(
      await raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${h.token}x` }),
      GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED,
    );
    assert.equal(await raw(good), undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(h.host.connections(), 0);
  } finally {
    await h.close();
  }
});

test("a client of another build is admitted drain-only: it may ask the host to leave and nothing else", async () => {
  const h = await hosted();
  try {
    const result = await connect(h, { build: { ...BUILD, buildVersion: "2.0.0" } });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.connection.hostBuild.buildVersion, "1.0.0");
    const client = new GatewayClient({
      transport: result.connection,
      createId: () => crypto.randomUUID(),
    });
    const listed = await client.call(GATEWAY_METHOD.RUN_LIST);
    assert.equal(listed.ok, false);
    if (!listed.ok) assert.equal(listed.error.code, GATEWAY_ERROR.INCOMPATIBLE_BUILD);
    const hello = await client.call(GATEWAY_METHOD.HELLO);
    assert.equal(hello.ok, true);
    const shutdown = await client.call(GATEWAY_METHOD.SHUTDOWN);
    assert.equal(shutdown.ok, true);
    assert.equal(h.shutdowns, 1);
    assert.deepEqual(h.effects, []);
    result.connection.close();
  } finally {
    await h.close();
  }
});

test("closing admissions refuses new connections and new mutations while reads and the shutdown still answer", async () => {
  const h = await hosted();
  try {
    const attached = await connect(h);
    assert.equal(attached.ok, true);
    if (!attached.ok) return;
    h.host.closeAdmissions();
    const late = await connect(h);
    assert.deepEqual(late, { ok: false, failure: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN });
    const client = new GatewayClient({
      transport: attached.connection,
      createId: () => crypto.randomUUID(),
    });
    const submit = await client.call(GATEWAY_METHOD.RUN_SUBMIT, { question: "late" });
    assert.equal(submit.ok, false);
    if (!submit.ok) assert.equal(submit.error.code, GATEWAY_ERROR.SHUTTING_DOWN);
    assert.deepEqual(h.effects, []);
    assert.equal((await client.call(GATEWAY_METHOD.RUN_LIST)).ok, true);
    assert.equal((await client.call(GATEWAY_METHOD.SHUTDOWN)).ok, true);
    attached.connection.close();
  } finally {
    await h.close();
  }
});

test("a host that goes away settles every in-flight request as disconnected and tells the connection's listeners", async () => {
  const h = await hosted();
  const result = await connect(h);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  let closed = 0;
  result.connection.onClosed(() => {
    closed += 1;
  });
  await h.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed, 1);
  assert.equal(result.connection.connected(), false);
  const answer = await result.connection.request({
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    id: "r",
    method: GATEWAY_METHOD.RUN_LIST,
    params: {},
  });
  assert.equal(answer.ok, false);
  if (!answer.ok) assert.equal(answer.error.code, GATEWAY_ERROR.DISCONNECTED);
  const unreachable = await connect(h);
  assert.deepEqual(unreachable, { ok: false, failure: GATEWAY_CONNECT_FAILURE.UNREACHABLE });
});
