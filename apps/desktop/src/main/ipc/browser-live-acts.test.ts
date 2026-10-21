import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  BROWSER_LIVE_PORT_MESSAGE,
  type BrowserLivePortOutbound,
  type BrowserLivePortTicket,
} from "@luke/features/browser-live-acts";
import type { ActSender } from "@luke/host/act-port";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import { ACT_KIND } from "@luke/host/acts";
import type { HostOperator } from "@luke/host/host-operator";
import type { WireBoundaryInput } from "@luke/wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import {
  type BrowserLiveActsDependencies,
  browserLiveProcedures,
  type MainBrowserLivePort,
} from "./browser-live-acts";

/**
 * A cloud Browser tab's live view as main carries it, over a host and ports
 * that answer from a script: an attach posts a port to the asking panel
 * alone, under the panel's ticket, and has the host open the tab's socket;
 * what the host hears on that connection reaches that port and no other,
 * and its close closes the port after saying so; what the panel sends on it
 * reaches the host by connection; a detach and the page's end let the
 * connection go; and only a panel with the Browser tab experiment on is
 * answered. Synthetic ids and frames throughout.
 */

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const TAB_ID = "5a0e1f2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b";
const ATTACH = { viewId: "view-a", taskId: TASK_ID, tabId: TAB_ID };
const REFUSED = { refused: "Could not show that tab." };

// SAFETY: the rows read a sender by identity alone; one inert object is one window.
const panelOf = (): ActSender<WebContents> => ({
  sender: {} as WebContents,
  panel: true,
  voice: false,
  call: false,
});

/** One port main opened, as the test watches it: where it went, what main posted on it, and whether it closed. */
interface ScriptedPort {
  readonly sender: WebContents;
  readonly ticket: BrowserLivePortTicket;
  readonly posted: BrowserLivePortOutbound[];
  closed: boolean;
  send(message: WireBoundaryInput): void;
}

function fixture(options: { experimentOn?: boolean } = {}) {
  const asked: string[] = [];
  const opened: ScriptedPort[] = [];
  const gone = new Map<WebContents, () => void>();
  const pending: Effect.Effect<unknown>[] = [];
  let messageListener: Parameters<HostOperator["onBrowserLiveMessage"]>[0] | undefined;
  let closedListener: Parameters<HostOperator["onBrowserLiveClosed"]>[0] | undefined;
  let ids = 0;
  const host: BrowserLiveActsDependencies["host"] = {
    browserLiveConnect: ({ connectionId, taskId, tabId }) =>
      Effect.sync(() => {
        asked.push(`connect:${connectionId}:${taskId}:${tabId}`);
        return true;
      }),
    browserLiveSend: ({ connectionId, text }) =>
      Effect.sync(() => void asked.push(`send:${connectionId}:${text}`)),
    browserLiveDisconnect: ({ connectionId }) =>
      Effect.sync(() => void asked.push(`disconnect:${connectionId}`)),
    onBrowserLiveMessage: (listener) => {
      messageListener = listener;
      return () => undefined;
    },
    onBrowserLiveClosed: (listener) => {
      closedListener = listener;
      return () => undefined;
    },
  };
  const actPort = testActPort(
    browserLiveProcedures({
      host,
      ports: {
        open: (sender, ticket): MainBrowserLivePort => {
          let heard: ((message: WireBoundaryInput) => void) | undefined;
          const port: ScriptedPort = {
            sender,
            ticket,
            posted: [],
            closed: false,
            send: (message) => heard?.(message),
          };
          opened.push(port);
          return {
            post: (message) => void port.posted.push(message),
            onMessage: (listener) => {
              heard = listener;
            },
            close: () => {
              port.closed = true;
            },
          };
        },
        whenGone: (sender, then) => void gone.set(sender, then),
      },
      experimentOn: () => options.experimentOn ?? true,
      createId: () => `connection-${++ids}`,
      run: <A>(effect: Effect.Effect<A>) => {
        pending.push(effect);
        return new Promise<A>(() => undefined);
      },
    }),
  );
  ports.push(actPort);
  return {
    actPort,
    asked,
    opened,
    hostSays: {
      message: (connectionId: string, text: string) => messageListener?.({ connectionId, text }),
      closed: (connectionId: string, code: number) => closedListener?.({ connectionId, code }),
    },
    pageGone: (sender: WebContents) => gone.get(sender)?.(),
    drain: Effect.suspend(() => Effect.all(pending.splice(0), { discard: true })),
  };
}

it.effect(
  "an attach posts a port to the asking panel and opens the tab's socket; the service's frames reach that port alone, what the panel sends reaches the host, and a close closes the port after saying so",
  () =>
    Effect.gen(function* () {
      const { actPort, asked, opened, hostSays, drain } = fixture();
      const panel = panelOf();
      const other = panelOf();

      yield* actPort.perform({ kind: ACT_KIND.BROWSER_LIVE_ATTACH, payload: ATTACH }, panel);
      yield* actPort.perform(
        { kind: ACT_KIND.BROWSER_LIVE_ATTACH, payload: { ...ATTACH, viewId: "view-b" } },
        other,
      );
      hostSays.message("connection-1", '{"type":"page"}');
      opened[0]?.send({ type: BROWSER_LIVE_PORT_MESSAGE.SEND, text: '{"type":"take-over"}' });
      opened[0]?.send({ type: "unknown" });
      yield* drain;
      hostSays.closed("connection-1", 4000);

      assert.deepEqual(
        opened.map((port) => [port.sender === panel.sender, port.ticket.viewId]),
        [
          [true, "view-a"],
          [false, "view-b"],
        ],
      );
      assert.deepEqual(opened[0]?.posted, [
        { type: BROWSER_LIVE_PORT_MESSAGE.MESSAGE, text: '{"type":"page"}' },
        { type: BROWSER_LIVE_PORT_MESSAGE.CLOSED, code: 4000 },
      ]);
      assert.equal(opened[0]?.closed, true);
      assert.deepEqual(opened[1]?.posted, []);
      assert.deepEqual(asked, [
        `connect:connection-1:${TASK_ID}:${TAB_ID}`,
        `connect:connection-2:${TASK_ID}:${TAB_ID}`,
        'send:connection-1:{"type":"take-over"}',
      ]);
    }),
);

it.effect("a detach and the page's end let the panel's views go", () =>
  Effect.gen(function* () {
    const { actPort, asked, opened, pageGone, drain } = fixture();
    const panel = panelOf();

    yield* actPort.perform({ kind: ACT_KIND.BROWSER_LIVE_ATTACH, payload: ATTACH }, panel);
    yield* actPort.perform(
      { kind: ACT_KIND.BROWSER_LIVE_ATTACH, payload: { ...ATTACH, viewId: "view-b" } },
      panel,
    );
    yield* actPort.perform(
      { kind: ACT_KIND.BROWSER_LIVE_DETACH, payload: { viewId: "view-a" } },
      panel,
    );
    pageGone(panel.sender);
    yield* drain;

    assert.deepEqual(
      opened.map((port) => port.closed),
      [true, true],
    );
    assert.deepEqual(asked.slice(2), ["disconnect:connection-1", "disconnect:connection-2"]);
  }),
);

it.effect("only a panel with the Browser tab experiment on may attach a view", () =>
  Effect.gen(function* () {
    const off = fixture({ experimentOn: false });
    const on = fixture();
    const voice: ActSender<WebContents> = { ...panelOf(), panel: false, voice: true };

    const whileOff = yield* off.actPort.perform(
      { kind: ACT_KIND.BROWSER_LIVE_ATTACH, payload: ATTACH },
      panelOf(),
    );
    const fromVoice = yield* on.actPort.perform(
      { kind: ACT_KIND.BROWSER_LIVE_ATTACH, payload: ATTACH },
      voice,
    );

    assert.deepEqual(whileOff, REFUSED);
    assert.deepEqual(fromVoice, REFUSED);
    assert.deepEqual([...off.asked, ...on.asked], []);
    assert.deepEqual([...off.opened, ...on.opened], [], "no port is posted");
  }),
);
