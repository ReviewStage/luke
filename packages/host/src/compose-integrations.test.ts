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
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@repo/gateway";
import type { WireRecord, WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { AppIntegrations } from "./app-state.js";
import { composeIntegrations, type IntegrationsClient } from "./compose-integrations.js";
import { INTEGRATION_SETTLE_EVERY } from "./integrations-follow.js";
import { polledLive } from "./testing/polled-live.js";
import { windowFocus } from "./window-focus.js";

/**
 * The account's integrations as the host asks the service for them: behind
 * a closed account gate nothing is asked or opened; a server's tools a
 * window holds are kept from their last read; and where the integrations
 * stand, which a window holds, is followed live, the service asked to
 * settle a sign-in only while a row stands pending, and a disconnect
 * answered only once that read carries it. Synthetic accounts and rows
 * throughout.
 */

/** The sign-in address the service answers, which must reach the browser and no window. */
const SIGN_IN = "https://vercel.com/connect/authorize/request-1";

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

/** The transaction the service deletes a disconnected account in. */
const DISCONNECT_TXID = "4815";

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
}

/** The service as a script over one account's connection and its live rows, and what it was asked about. */
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
      Effect.sync(() => {
        asked.push(provider);
        return {
          account: { provider, connection, label, primary: false, status: script.status },
        };
      }),
  };
  return { client, opened, asked, live, settles: () => settles };
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
    const composer = yield* composeIntegrations({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => {
          if (kind === GATEWAY_EVENT.INTEGRATION_TOOLS_CHANGED) told.push(payload);
          // SAFETY: the host tells its own slice as built, in this process.
          if (kind === GATEWAY_EVENT.INTEGRATIONS_CHANGED)
            integrations.push(payload as AppIntegrations);
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: () => USER_ID,
      client: service.client,
      focus,
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
    return { ...service, call, told, integrations, focus };
  });
}

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
        const { call, opened, asked } = yield* subject(script, options);
        for (const method of [
          GATEWAY_METHOD.INTEGRATIONS_CONNECT,
          GATEWAY_METHOD.INTEGRATIONS_CANCEL,
          GATEWAY_METHOD.INTEGRATIONS_DISCONNECT,
        ]) {
          assert.deepEqual(yield* call(method, LINEAR), {
            failure: INTEGRATION_CALL_FAILURE.UNANSWERED,
          });
        }
        yield* call(GATEWAY_METHOD.INTEGRATIONS_TOOLS_FOLLOW, LINEAR);
        yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
        yield* after(INTEGRATION_SETTLE_EVERY);
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

it.effect("the held integrations are settled only while a row stands pending", () =>
  Effect.gen(function* () {
    const { call, integrations, settles, live } = yield* subject({
      status: INTEGRATION_STATUS.CONNECTED,
    });
    const drawn = () =>
      integrations.at(-1)?.[USER_ID]?.rows?.integrations[INTEGRATION_PROVIDER.LINEAR];
    live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] });
    yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
    yield* after(Duration.times(INTEGRATION_SETTLE_EVERY, 3));
    assert.equal(drawn(), INTEGRATION_STATUS.CONNECTED);
    assert.equal(settles(), 0, "nothing pending, nothing settled");

    live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "pending")] });
    yield* after(Duration.millis(500));
    assert.equal(drawn(), INTEGRATION_STATUS.PENDING);
    yield* after(INTEGRATION_SETTLE_EVERY);
    yield* after(INTEGRATION_SETTLE_EVERY);
    assert.equal(settles(), 2, "settled once each interval while the row stands pending");

    live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] });
    yield* after(Duration.millis(500));
    assert.equal(drawn(), INTEGRATION_STATUS.CONNECTED);
    yield* after(Duration.times(INTEGRATION_SETTLE_EVERY, 3));
    assert.equal(settles(), 2, "a sign-in settled is settled no more");
    yield* call(GATEWAY_METHOD.INTEGRATIONS_UNFOLLOW);
  }),
);

it.effect(
  "a disconnect answers only once the held read carries its transaction, gone from it",
  () =>
    Effect.gen(function* () {
      const { call, integrations, live } = yield* subject({ status: INTEGRATION_STATUS.CONNECTED });
      const listed = () =>
        integrations.at(-1)?.[USER_ID]?.rows?.accounts?.map((account) => account.connection) ?? [];
      live.set({ connections: [row("linear", INTEGRATION_PROVIDER.LINEAR, "connected")] }, ["1"]);
      yield* call(GATEWAY_METHOD.INTEGRATIONS_FOLLOW);
      yield* after(Duration.millis(500));
      assert.deepEqual(listed(), ["linear"]);

      let answered = false;
      const disconnecting = yield* Effect.forkChild(
        Effect.tap(call(GATEWAY_METHOD.INTEGRATIONS_DISCONNECT, LINEAR), () =>
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
