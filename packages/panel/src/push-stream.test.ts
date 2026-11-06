import assert from "node:assert/strict";
import { LINK_PLACE } from "@repo/features/link-grammar";
import {
  type ActSender,
  actPortHandlerOf,
  pushProcedures,
  WindowPushes,
} from "@repo/host/act-port";
import { PUSH } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";
import { Context } from "effect";
import { afterEach, it } from "vitest";
import { openPushStream } from "./app-bridge.js";
import { stateWith } from "./testing/app-state.js";

const WINDOW = Symbol("window");
const PANEL: ActSender = { sender: WINDOW, panel: true };

const LINK = { workspace: "workspace-1", place: { kind: LINK_PLACE.TASK, planId: "task-1" } };
const OTHER_LINK = { ...LINK, place: { kind: LINK_PLACE.TASK, planId: "task-2" } };

const opened: MessagePort[] = [];

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

function mainProcess() {
  const pushes = new WindowPushes();
  const handler = actPortHandlerOf(pushProcedures(pushes));
  const page = (actor: ActSender) => {
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    handler.upgrade(port1, {
      context: () => ({ actor, trusted: true, "effect/context": Context.empty() }),
    });
    port1.start();
    const stream = openPushStream(createORPCClient(new RPCLink({ port: port2 })));
    port2.start();
    return { ...stream, close: () => port2.close() };
  };
  return { pushes, page };
}

function hearing<Heard>() {
  const heard: Heard[] = [];
  const waits: { count: number; resolve: () => void }[] = [];
  const hear = (value: Heard) => {
    heard.push(value);
    for (const wait of waits.filter((each) => heard.length >= each.count)) wait.resolve();
  };
  const until = (count: number) =>
    heard.length >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => waits.push({ count, resolve }));
  return { heard, hear, until };
}

async function eventually(holds: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000 && !holds(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(holds());
}

it("each push reaches the listeners on its own method, with the payload main pushed, and no other", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const commands = hearing<unknown>();
  const links = hearing<unknown>();
  panel.listeners.onMenuCommand(commands.hear);
  panel.listeners.onShowLink(links.hear);

  main.pushes.push(WINDOW, PUSH.MENU_COMMAND, APP_COMMAND.SETTINGS);
  main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK);
  await Promise.all([commands.until(1), links.until(1)]);

  assert.deepEqual(commands.heard, [APP_COMMAND.SETTINGS]);
  assert.deepEqual(links.heard, [LINK]);
});

it("a link is never overtaken by the command sent after it, even behind a burst of commands", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const heard = hearing<unknown>();
  panel.listeners.onMenuCommand(heard.hear);
  panel.listeners.onShowLink(() => heard.hear("link"));

  for (let press = 0; press < 200; press += 1) {
    main.pushes.push(WINDOW, PUSH.MENU_COMMAND, APP_COMMAND.TOGGLE_SIDEBAR);
  }
  main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK);
  main.pushes.push(WINDOW, PUSH.MENU_COMMAND, APP_COMMAND.SETTINGS);
  await heard.until(202);

  assert.deepEqual(heard.heard.slice(-2), ["link", APP_COMMAND.SETTINGS]);
});

it("a document pushed the moment the stream opens is heard, and a burst of them is heard once, as the newest", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  const versions = hearing<number>();
  const shown = hearing<unknown>();
  panel.listeners.onAppState((delivery) => versions.hear(delivery.version));
  panel.listeners.onShowLink(shown.hear);
  await panel.opened;

  for (const version of [1, 2, 3]) {
    main.pushes.pushState(WINDOW, stateWith({}, { version }));
  }
  main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK);
  await shown.until(1);

  assert.deepEqual(versions.heard, [3]);
});

it("a payload its push's guard refuses is dropped, and the pushes after it still arrive", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const shown = hearing<unknown>();
  panel.listeners.onShowLink(shown.hear);

  main.pushes.push(WINDOW, PUSH.SHOW_LINK, { workspace: "workspace-1" } as never);
  main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK);
  await shown.until(1);

  assert.deepEqual(shown.heard, [LINK]);
});

it("a listener that unsubscribed hears nothing more, and one that throws keeps no other from hearing", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  const kept = hearing<unknown>();
  const dropped = hearing<unknown>();
  panel.listeners.onShowLink(() => {
    throw new Error("a listener's own failure");
  });
  const stop = panel.listeners.onShowLink(dropped.hear);
  panel.listeners.onShowLink(kept.hear);
  stop();

  main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK);
  main.pushes.push(WINDOW, PUSH.SHOW_LINK, OTHER_LINK);
  await kept.until(2);

  assert.deepEqual(kept.heard, [LINK, OTHER_LINK]);
  assert.deepEqual(dropped.heard, []);
});

it("a window that closes leaves no listener in main, and a push to it is dropped", async () => {
  const main = mainProcess();
  const panel = main.page(PANEL);
  await panel.opened;
  assert.equal(main.pushes.listening(WINDOW), true);

  panel.close();
  await eventually(() => !main.pushes.listening(WINDOW));

  assert.equal(main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK), false);
});

it("a reloaded window is heard on its new page, and leaves no listener once that page closes too", async () => {
  const main = mainProcess();
  const before = main.page(PANEL);
  await before.opened;
  const after = main.page(PANEL);
  await after.opened;
  const shown = hearing<unknown>();
  after.listeners.onShowLink(shown.hear);

  before.close();
  main.pushes.push(WINDOW, PUSH.SHOW_LINK, LINK);
  await shown.until(1);
  assert.deepEqual(shown.heard, [LINK]);

  after.close();
  await eventually(() => !main.pushes.listening(WINDOW));
});
