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
  type GatewayClientIdentity,
  type GatewayEvent,
} from "@sidecar/runtime-contracts";
import { WebSocket } from "ws";
import { GatewayClient } from "./client.js";
import {
  bearerAuthentication,
  GATEWAY_REFUSAL_HEADER,
  type GatewayAuthenticate,
  WEB_SOCKET_GATEWAY_DEFAULTS,
  WebSocketTransport,
} from "./local-host.js";
import { connectWebSocketGateway, GATEWAY_UNREACHABLE } from "./local-transport.js";
import { GatewayServer, gatewayError, gatewayOk } from "./server.js";

const TOKEN = "a-shared-secret";
const OPERATOR: GatewayClientIdentity = {
  clientId: "desktop",
  role: GATEWAY_CLIENT_ROLE.OPERATOR,
};

interface Hosted {
  host: WebSocketTransport;
  server: GatewayServer;
  port: number;
  shutdowns: number;
  effects: string[];
  close: () => Promise<void>;
}

async function hosted(
  authenticate: GatewayAuthenticate = bearerAuthentication(TOKEN),
): Promise<Hosted> {
  const effects: string[] = [];
  const state = { shutdowns: 0 };
  let ids = 0;
  const server = new GatewayServer({
    methods: {
      [GATEWAY_METHOD.RUN_LIST]: (_params, context) =>
        gatewayOk({ runs: [], client: context.client.clientId }),
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
  const host = new WebSocketTransport({ server, authenticate, report: () => undefined });
  const port = await host.bind();
  return {
    host,
    server,
    port,
    effects,
    get shutdowns() {
      return state.shutdowns;
    },
    close: () => host.close(),
  };
}

function socketUrl(port: number): string {
  return `ws://${WEB_SOCKET_GATEWAY_DEFAULTS.HOST}:${port}/`;
}

function connect(h: Hosted, overrides: { token?: string } = {}) {
  return connectWebSocketGateway({
    url: socketUrl(h.port),
    headers: {
      [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${overrides.token ?? TOKEN}`,
    },
    client: OPERATOR,
    timeoutMs: 2_000,
  });
}

test("the host binds an ephemeral port and carries requests, answers, and events", async () => {
  const h = await hosted();
  try {
    const result = await connect(h);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const client = new GatewayClient({
      transport: result.connection,
      createId: () => crypto.randomUUID(),
    });
    const seen: GatewayEvent[] = [];
    client.on(GATEWAY_EVENT.RUNS_CHANGED, (event) => seen.push(event));
    const listed = await client.call(GATEWAY_METHOD.RUN_LIST);
    assert.deepEqual(listed, { ok: true, result: { runs: [], client: "desktop" } });
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
    const wrongToken = await connect(h, { token: "another-secret" });
    assert.deepEqual(wrongToken, { ok: false, failure: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED });
    const raw = (headers: Record<string, string>) =>
      new Promise<string | undefined>((resolve) => {
        const socket = new WebSocket(socketUrl(h.port), { headers });
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
      [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
      [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
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
      await raw({ ...good, [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}x` }),
      GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED,
    );
    assert.equal(await raw(good), undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(h.host.connections(), 0);
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
    assert.equal(h.shutdowns, 1);
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
  assert.deepEqual(unreachable, { ok: false, failure: GATEWAY_UNREACHABLE });
});

test("the identity the injected authentication answers is the one the host admits under, and one that cannot decide authorizes no one", async () => {
  const minted = await hosted(() => ({
    admitted: { clientId: "the-account", role: GATEWAY_CLIENT_ROLE.OPERATOR },
  }));
  try {
    const result = await connect(minted);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const client = new GatewayClient({
      transport: result.connection,
      createId: () => crypto.randomUUID(),
    });
    // What the client declared about itself is not what the host admitted it as.
    assert.deepEqual(await client.call(GATEWAY_METHOD.RUN_LIST), {
      ok: true,
      result: { runs: [], client: "the-account" },
    });
    result.connection.close();
  } finally {
    await minted.close();
  }
  const throwing = await hosted(() => {
    throw new Error("the credential authority is unreachable");
  });
  try {
    assert.deepEqual(await connect(throwing), {
      ok: false,
      failure: GATEWAY_HANDSHAKE_REFUSAL.UNAUTHORIZED,
    });
  } finally {
    await throwing.close();
  }
});

test("a handshake still authenticating when admissions close is refused, and a client that drops mid-authentication leaves the host standing", async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const authenticate = bearerAuthentication(TOKEN);
  const h = await hosted(async (headers) => {
    await held;
    return authenticate(headers);
  });
  try {
    const refused = connect(h);
    // The host starts to leave while the credential is still being checked.
    await new Promise((resolve) => setTimeout(resolve, 20));
    h.host.closeAdmissions();
    release?.();
    assert.deepEqual(await refused, {
      ok: false,
      failure: GATEWAY_HANDSHAKE_REFUSAL.SHUTTING_DOWN,
    });
    assert.equal(h.host.connections(), 0);
  } finally {
    await h.close();
  }

  let dropRelease: (() => void) | undefined;
  const dropHeld = new Promise<void>((resolve) => {
    dropRelease = resolve;
  });
  const dropping = await hosted(async (headers) => {
    await dropHeld;
    return authenticate(headers);
  });
  try {
    const socket = new WebSocket(socketUrl(dropping.port), {
      headers: {
        [GATEWAY_HANDSHAKE_HEADER.AUTHORIZATION]: `Bearer ${TOKEN}`,
        [GATEWAY_HANDSHAKE_HEADER.PROTOCOL_VERSION]: String(GATEWAY_PROTOCOL_VERSION),
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ID]: "desktop",
        [GATEWAY_HANDSHAKE_HEADER.CLIENT_ROLE]: GATEWAY_CLIENT_ROLE.OPERATOR,
      },
    });
    socket.once("error", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    socket.terminate();
    dropRelease?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(dropping.host.connections(), 0);
    // The host is still answering: the dropped socket took nothing with it.
    const after = await connect(dropping);
    assert.equal(after.ok, true);
    if (after.ok) after.connection.close();
  } finally {
    await dropping.close();
  }
});

test("a close while a handshake is still authenticating does not wait on the credential authority", async () => {
  const held = new Promise<void>(() => undefined);
  const h = await hosted(async (headers) => {
    await held;
    return bearerAuthentication(TOKEN)(headers);
  });
  const attempt = connect(h);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const outcome = await Promise.race([
    h.close().then(() => "closed"),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 2_000)),
  ]);
  assert.equal(outcome, "closed");
  // The attempt is refused rather than left waiting on a host that has gone.
  assert.equal((await attempt).ok, false);
});
