import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { IntegrationStatusesLiveAnswer } from "@repo/features/integration-live";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@repo/features/integration-wire";
import { MCP_CLIENTS_CALL_FAILURE } from "@repo/features/mcp-client-view";
import type { McpClient } from "@repo/features/mcp-client-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@repo/gateway";
import { entityPool } from "@repo/sync";
import type { WireRecord, WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { AppIntegrations } from "./app-state.js";
import {
  composeIntegrations,
  type IntegrationsClient,
  type McpClientsClient,
} from "./compose-integrations.js";
import { polledLive } from "./testing/polled-live.js";
import { windowFocus } from "./window-focus.js";

/**
 * The account's integrations as the host asks the service for them: behind
 * a closed account gate nothing is asked or opened; a server's tools a
 * window holds are kept from their last read; and where the integrations
 * stand, which a window holds, is followed live, the service asked to
 * settle a pending sign-in as it is drawn and as a window comes forward, and to name an account
 * still to be named once and again as a window comes forward, a disconnect
 * answered only once that read carries it, and a rename drawn over it at
 * once. Synthetic accounts and rows throughout.
 */

/** The sign-in address the service answers, which must reach the browser and no window. */
const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

/** The transaction the service deletes a disconnected account in. */
const DISCONNECT_TXID = "4815";

/** The transaction the service renames an account in. */
const RENAME_TXID = "1623";

/** The account signed in, which the held integrations are followed under. */
const USER_ID = "user-dana";

/** One row as the live statement delivers it. */
function row(connection: string, provider: IntegrationProvider, status: IntegrationStatus) {
  return { id: `id-${connection}`, connection, provider, label: connection, status };
}

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** The tools Linear's server lists, as the service answers them unless a test scripts otherwise. */
const LINEAR_TOOLS = { tools: [{ name: "list_issues", description: "List issues." }] };

interface ServiceScript {
  status: IntegrationStatus;
  connectRefused?: boolean;
  /** What a read of a server's tools answers; Linear's tools where none is given. */
  tools?: IntegrationToolsView;
  /** The outside MCP clients the account allowed, as the service holds them. */
  clients?: McpClient[];
  /** Whether a revoke fails before it finishes, as one whose session lapsed does. */
  revokeFails?: boolean;
  /** Whether a rename is refused, as one the service did not answer is. */
  renameRefused?: boolean;
  /** Where given, a rename is answered only once the test opens it. */
  renameAnswered?: Deferred.Deferred<void>;
}

/** The member MCP server's address, as the service answers it. */
const SERVER_URL = "https://app.test/api/mcp";

/** An outside MCP client a member allowed, as the service lists it. */
const CLAUDE: McpClient = {
  clientId: "client-claude",
  name: "Claude",
  redirectUris: ["https://claude.test/cb"],
  allowedAt: 1_000,
  lastRefreshedAt: null,
};

/** The service as a script over one account's connection, its live rows, and its outside MCP clients, and what it was asked about. */
function fakeService(script: ServiceScript) {
  const opened: string[] = [];
  const asked: IntegrationProvider[] = [];
  let settles = 0;
  const live = polledLive(["connections"] as const);
  const beside = { offered: INTEGRATION_PROVIDER_LIST, multiple: [] };
  const client: IntegrationsClient = {
    statusesLive: (_userId, poll, after) =>
      Effect.map(
        poll ? live.poll(after) : Effect.succeed(live.first()),
        (answer): IntegrationStatusesLiveAnswer => ({ ...answer, ...beside }),
      ),
    settle: () =>
      Effect.sync(() => {
        settles += 1;
      }),
    github: () => Effect.succeed({ status: INTEGRATION_STATUS.DISCONNECTED }),
    connect: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        return script.connectRefused
          ? { failure: INTEGRATION_CALL_FAILURE.UNAVAILABLE }
          : { url: SIGN_IN };
      }),
    tools: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        return script.tools ?? LINEAR_TOOLS;
      }),
    cancel: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        if (script.status === INTEGRATION_STATUS.PENDING)
          script.status = INTEGRATION_STATUS.DISCONNECTED;
        return { status: script.status };
      }),
    disconnect: (provider) =>
      Effect.sync(() => {
        asked.push(provider);
        script.status = INTEGRATION_STATUS.DISCONNECTED;
        return { status: script.status, txid: DISCONNECT_TXID };
      }),
    rename: (provider, connection, label) =>
      Effect.andThen(
        script.renameAnswered === undefined ? Effect.void : Deferred.await(script.renameAnswered),
        Effect.sync(() => {
          asked.push(provider);
          if (script.renameRefused) return { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };
          return {
            account: { provider, connection, label, primary: false, status: script.status },
            txid: RENAME_TXID,
          };
        }),
      ),
  };
  const mcpClients: McpClientsClient = {
    list: () =>
      Effect.sync(() => ({ serverUrl: SERVER_URL, clients: [...(script.clients ?? [])] })),
    revoke: (clientId) =>
      Effect.sync(() => {
        if (script.revokeFails) return { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED };
        script.clients = (script.clients ?? []).filter((each) => each.clientId !== clientId);
        return { serverUrl: SERVER_URL, clients: [...script.clients] };
      }),
  };
  return { client, mcpClients, opened, asked, live, settles: () => settles };
}

function subject(
  script: ServiceScript,
  options: { signedIn?: boolean; sendsNetwork?: boolean; opens?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(script);
    const focus = yield* windowFocus;
    // Every telling of the servers' tools, and of where the integrations stand, the host holds for the windows, whole, in order.
    const told: WireValue[] = [];
    const integrations: AppIntegrations[] = [];
    // Every telling of the outside MCP clients the host holds for the windows, whole, in order.
    const clients: WireValue[] = [];
    const composer = yield* composeIntegrations({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => {
          if (kind === GATEWAY_EVENT.INTEGRATION_TOOLS_CHANGED) told.push(payload);
          // SAFETY: the host tells its own slice as built, in this process.
          if (kind === GATEWAY_EVENT.INTEGRATIONS_CHANGED)
            integrations.push(payload as AppIntegrations);
          if (kind === GATEWAY_EVENT.MCP_CLIENTS_CHANGED) clients.push(payload);
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: () => USER_ID,
      client: service.client,
      mcpClients: service.mcpClients,
      focus,
      pool: yield* entityPool(),
      openExternal: (url) =>
        Effect.sync(() => {
          service.opened.push(url);
          return options.opens ?? true;
        }),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { ...service, call, acts: composer.acts, told, integrations, clients, focus };
  });
}

/** Long enough for any wait the host keeps to have come round, so a settle on time alone would have been asked. */
const A_WHILE = Duration.minutes(1);

/** Every step a held read has to take, taken: it runs on a fiber of its own. */
const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** Every step a follow has to take, taken, after the clock moved on by `by`. */
const after = (by: Duration.Input) => Effect.andThen(TestClock.adjust(by), settled);

it.effect(
  "behind a closed account gate, or on a run that sends nothing, nothing is asked or opened",
  () =>
    Effect.gen(function* () {
      for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
        const script = { status: INTEGRATION_STATUS.CONNECTED };
        const { call, acts, opened, asked } = yield* subject(script, options);
        for (const act of [
          acts.INTEGRATIONS_CONNECT,
          acts.INTEGRATIONS_CANCEL,
          acts.INTEGRATIONS_DISCONNECT,
        ]) {
          assert.deepEqual(yield* act(LINEAR), {
            failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
          });
        }
        yield* call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW, LINEAR);
        yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
        yield* after(A_WHILE);
        assert.deepEqual(opened, []);
        assert.deepEqual(asked, []);
        assert.equal(script.status, INTEGRATION_STATUS.CONNECTED);
      }
    }),
);

it.effect(
  "a server's tools are held from their last read, asked again as a window comes forward, and kept where an ask fails",
  () =>
    Effect.gen(function* () {
      const script: ServiceScript = { status: INTEGRATION_STATUS.CONNECTED };
      const { call, asked, told, focus } = yield* subject(script);

      yield* call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW, LINEAR);
      yield* settled;
      assert.deepEqual(told.at(-1), { linear: { rows: LINEAR_TOOLS } });

      script.tools = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED };
      yield* focus.raise;
      yield* settled;
      assert.deepEqual(asked, [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.LINEAR]);
      assert.deepEqual(told.at(-1), { linear: { rows: LINEAR_TOOLS } });

      const mended = {
        tools: [...LINEAR_TOOLS.tools, { name: "save_issue", description: "Save." }],
      };
      script.tools = mended;
      yield* focus.raise;
      yield* settled;
      assert.deepEqual(told.at(-1), { linear: { rows: mended } });
    }),
);

it.effect(
  "a pending sign-in is settled as it is first drawn and as a window comes forward, never on time alone",
  () =>
    Effect.gen(function* () {
      const { call, integrations, settles, live, focus } = yield* subject({
        status: INTEGRATION_STATUS.CONNECTED,
      });
      const drawn = () =>
        integrations.at(-1)?.[USER_ID]?.rows?.integrations[INTEGRATION_PROVIDER.LINEAR];
      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] });
      yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
      yield* after(A_WHILE);
      yield* focus.raise;
      yield* settled;
      assert.equal(drawn(), INTEGRATION_STATUS.CONNECTED);
      assert.equal(settles(), 0, "nothing pending, nothing settled");

      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "pending")] });
      yield* after(Duration.millis(500));
      assert.equal(drawn(), INTEGRATION_STATUS.PENDING);
      assert.equal(settles(), 1, "settled as the pending row is first drawn");
      yield* after(A_WHILE);
      assert.equal(settles(), 1, "not settled again while no window comes forward");

      yield* focus.raise;
      yield* settled;
      assert.equal(settles(), 2, "settled as a window comes forward while the row stands pending");

      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] });
      yield* after(Duration.millis(500));
      assert.equal(drawn(), INTEGRATION_STATUS.CONNECTED);
      yield* focus.raise;
      yield* settled;
      assert.equal(settles(), 2, "a sign-in settled is settled no more");

      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "pending")] });
      yield* after(Duration.millis(500));
      assert.equal(settles(), 3, "a sign-in begun again on the same row is settled as drawn");
      yield* call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW);
    }),
);

it.effect(
  "an account still to be named is settled once, under the service's rule, and again as a window comes forward",
  () =>
    Effect.gen(function* () {
      const { call, settles, live, focus } = yield* subject({
        status: INTEGRATION_STATUS.CONNECTED,
      });
      // Linear answers no account's name, so an empty label there is a grant that named nothing, called by its place.
      const placed = { ...row("linear", INTEGRATION_PROVIDER.LINEAR, "connected"), label: "" };
      live.set({ connections: [placed] });
      yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
      yield* after(Duration.millis(500));
      assert.equal(settles(), 0, "an empty label where the provider names no account is final");

      const unnamed = { ...row("notion", INTEGRATION_PROVIDER.NOTION, "connected"), label: "" };
      live.set({ connections: [placed, unnamed] });
      yield* after(Duration.millis(500));
      assert.equal(settles(), 1, "an empty label where the provider names its accounts is read");
      yield* after(A_WHILE);
      assert.equal(settles(), 1, "asked once while no window comes forward");

      yield* focus.raise;
      yield* settled;
      assert.equal(settles(), 2, "a name the settle did not read is asked for again");
      yield* call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW);
    }),
);

it.effect(
  "a disconnect answers only once the held read carries its transaction, gone from it",
  () =>
    Effect.gen(function* () {
      const { call, acts, integrations, live } = yield* subject({
        status: INTEGRATION_STATUS.CONNECTED,
      });
      const listed = () =>
        integrations.at(-1)?.[USER_ID]?.rows?.accounts?.map((account) => account.connection) ?? [];
      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] }, ["1"]);
      yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
      yield* after(Duration.millis(500));
      assert.deepEqual(listed(), ["linear"]);

      let answered = false;
      const disconnecting = yield* Effect.forkChild(
        Effect.tap(acts.INTEGRATIONS_DISCONNECT(LINEAR), () =>
          Effect.sync(() => {
            answered = true;
          }),
        ),
      );
      yield* after(Duration.seconds(1));
      assert.equal(answered, false, "the read does not carry the disconnect yet");

      live.set({ connections: [] }, [DISCONNECT_TXID]);
      yield* after(Duration.millis(500));
      assert.deepEqual(yield* Fiber.join(disconnecting), {
        status: INTEGRATION_STATUS.DISCONNECTED,
        txid: DISCONNECT_TXID,
      });
      assert.deepEqual(listed(), [], "the answer lands with the account gone from the read");
      yield* call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW);
    }),
);

it.effect(
  "a rename draws its label over the held read at once and stands until the read carries it, and a refused one puts the label back",
  () =>
    Effect.gen(function* () {
      const script: ServiceScript = { status: INTEGRATION_STATUS.CONNECTED };
      const { call, acts, integrations, live } = yield* subject(script);
      const label = () => integrations.at(-1)?.[USER_ID]?.rows?.accounts?.[0]?.label;
      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] }, ["1"]);
      yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
      yield* after(Duration.millis(500));
      assert.equal(label(), "linear");

      const rename = { ...LINEAR, connection: "linear", label: "Work" };
      const answered = yield* Deferred.make<void>();
      script.renameAnswered = answered;
      const renaming = yield* Effect.forkChild(acts.INTEGRATIONS_RENAME(rename));
      yield* settled;
      assert.equal(label(), "Work", "the new label is drawn before the service answers");
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);
      // A poll the rename's transaction did not wake answers the old label.
      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] });
      yield* after(Duration.millis(500));
      assert.equal(
        label(),
        "Work",
        "an answer from before the rename does not put the old one back",
      );

      const renamed = { ...row("linear", INTEGRATION_PROVIDER.LINEAR, "connected"), label: "Work" };
      live.set({ connections: [renamed] }, [RENAME_TXID]);
      yield* after(Duration.millis(500));
      script.renameRefused = true;
      assert.deepEqual(yield* acts.INTEGRATIONS_RENAME({ ...rename, label: "Home" }), {
        failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
      });
      assert.equal(label(), "Work", "a refused rename leaves the label the read carries");
      yield* call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW);
    }),
);

it.effect(
  "a revoke that lands lays the held clients it answered before it answers, and one that did not finish answers so and leaves the client held",
  () =>
    Effect.gen(function* () {
      const script: ServiceScript = { status: INTEGRATION_STATUS.CONNECTED, clients: [CLAUDE] };
      const { call, acts, clients } = yield* subject(script);
      yield* call(GATEWAY_METHOD.MCP_CLIENTS_FOLLOW);
      yield* settled;
      const held = (listed: readonly McpClient[]) => ({
        "user-dana": { rows: { serverUrl: SERVER_URL, clients: listed } },
      });
      assert.deepEqual(clients.at(-1), held([CLAUDE]));

      script.revokeFails = true;
      assert.deepEqual(yield* acts.MCP_CLIENTS_REVOKE({ clientId: CLAUDE.clientId }), {
        failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(clients.at(-1), held([CLAUDE]));

      script.revokeFails = false;
      assert.deepEqual(yield* acts.MCP_CLIENTS_REVOKE({ clientId: CLAUDE.clientId }), {
        serverUrl: SERVER_URL,
        clients: [],
      });
      assert.deepEqual(clients.at(-1), held([]));
    }),
);
