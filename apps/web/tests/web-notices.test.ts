// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";
import { Context, Effect, Layer } from "effect";
import { afterEach, beforeEach, test, vi } from "vitest";
import { composeWeb, WebHostTag } from "../src/app/web-host";
import { onTabShownChanged, webNoticeDoors } from "../src/app/web-notices";
import { fakeService } from "./support/fake-service";

/**
 * A browser tab's notices: the browser's notification posted only while the
 * tab is hidden, its click opening the place it names, permission asked for
 * only on Settings' test and never as the tab loads, and the count before
 * the tab's title. The browser's `Notification` and the tab's visibility
 * are the operating system's, so both are faked at that boundary.
 */

/** A notification as the fake browser was asked to show it. */
interface ShownNotification {
  readonly title: string;
  readonly body: string | undefined;
  readonly click: () => void;
}

/** What the fake browser was asked: each notification shown, and each time permission was asked for. */
interface FakeBrowser {
  readonly shown: ShownNotification[];
  permissionAsks: number;
}

let browser: FakeBrowser;
let visibility: DocumentVisibilityState;

/** Stands the fake `Notification` in the tab, whose permission stands as given and whose ask answers as given. */
function fakeNotifications(options: {
  readonly permission: NotificationPermission;
  readonly answer?: NotificationPermission;
}): FakeBrowser {
  const seen: FakeBrowser = { shown: [], permissionAsks: 0 };
  class FakeNotification {
    static permission: NotificationPermission = options.permission;
    static requestPermission(): Promise<NotificationPermission> {
      seen.permissionAsks += 1;
      FakeNotification.permission = options.answer ?? FakeNotification.permission;
      return Promise.resolve(FakeNotification.permission);
    }
    onclick: (() => void) | null = null;
    constructor(title: string, init?: NotificationOptions) {
      seen.shown.push({ title, body: init?.body, click: () => this.onclick?.() });
    }
    close(): void {}
  }
  vi.stubGlobal("Notification", FakeNotification);
  return seen;
}

/** The doors with toasts that go nowhere, and each status the browser answered. */
function doorsAnswering() {
  const answered: NotificationsStatus[] = [];
  const ignore = () => undefined;
  const doors = webNoticeDoors({
    toasts: { toast: ignore, toastInbox: ignore, toastFailedRun: ignore, toastChat: ignore },
    onAnswered: (status) => answered.push(status),
  });
  return { doors, answered };
}

/** The host stood up in a scope of its own over the fake given, its acts run on the test's own services. */
const standingHost = (service: ReturnType<typeof fakeService>) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const built = yield* Layer.build(
      composeWeb({
        httpClient: service.layer,
        run: (effect) => Effect.runPromiseWith(services)(effect),
      }),
    );
    return Context.get(built, WebHostTag);
  });

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.title = "";
});

test("a notice while the tab is hidden shows the browser's notification, in the notice's words", () => {
  browser = fakeNotifications({ permission: "granted" });
  const { doors } = doorsAnswering();
  visibility = "hidden";

  doors.post({ title: "Billing export", body: "Opus finished", onClick: () => undefined });

  assert.deepEqual(
    browser.shown.map(({ title, body }) => ({ title, body })),
    [{ title: "Billing export", body: "Opus finished" }],
  );
});

test("a click on the notification opens the place it names", () => {
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
  browser = fakeNotifications({ permission: "granted" });
  const { doors } = doorsAnswering();
  visibility = "hidden";
  const opened: string[] = [];

  doors.post({
    title: "Billing export",
    body: "Opus finished",
    onClick: () => opened.push("agent-1"),
  });
  browser.shown[0]?.click();

  assert.deepEqual(opened, ["agent-1"]);
});

test("a notice is never a reason to ask for permission: one posted before it was granted is dropped", () => {
  browser = fakeNotifications({ permission: "default", answer: "granted" });
  const { doors, answered } = doorsAnswering();
  visibility = "hidden";

  doors.post({ title: "Billing export", body: "Opus finished", onClick: () => undefined });

  assert.equal(browser.permissionAsks, 0);
  assert.deepEqual(browser.shown, []);
  assert.deepEqual(answered, [NOTIFICATIONS_STATUS.UNKNOWN]);
});

it.effect(
  "the tab asks for permission only on Settings' test, never as it loads, then shows the test",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        browser = fakeNotifications({ permission: "default", answer: "granted" });
        const { bridge } = yield* standingHost(fakeService({ signedIn: true }));
        const loaded = yield* Effect.promise(() => bridge.requestAppState());

        assert.equal(browser.permissionAsks, 0, "nothing asks as the tab loads");
        assert.ok(loaded.run.capabilities.includes(HOST_CAPABILITY.NOTIFICATIONS));
        assert.equal(loaded.notifications.status, NOTIFICATIONS_STATUS.UNKNOWN);

        const outcome = yield* Effect.promise(() =>
          bridge.act({ kind: ACT_KIND.NOTIFICATIONS_TEST }),
        );
        const after = yield* Effect.promise(() => bridge.requestAppState());

        assert.equal(outcome.status, ACT_OUTCOME_STATUS.DONE);
        assert.equal(browser.permissionAsks, 1);
        assert.deepEqual(
          browser.shown.map(({ title }) => title),
          ["Luke notifications are on"],
        );
        assert.equal(after.notifications.status, NOTIFICATIONS_STATUS.ON);
      }),
    ),
);

it.effect("a permission the browser refuses on the test says notifications are off", () =>
  Effect.scoped(
    Effect.gen(function* () {
      browser = fakeNotifications({ permission: "default", answer: "denied" });
      const { bridge } = yield* standingHost(fakeService({ signedIn: true }));

      yield* Effect.promise(() => bridge.act({ kind: ACT_KIND.NOTIFICATIONS_TEST }));
      const after = yield* Effect.promise(() => bridge.requestAppState());

      assert.deepEqual(browser.shown, []);
      assert.equal(after.notifications.status, NOTIFICATIONS_STATUS.OFF);
    }),
  ),
);

it.effect("a browser that posts no notifications offers no Notifications page", () =>
  Effect.scoped(
    Effect.gen(function* () {
      // jsdom, like a browser without them, has no `Notification` at all.
      const { bridge } = yield* standingHost(fakeService({ signedIn: true }));
      const loaded = yield* Effect.promise(() => bridge.requestAppState());

      assert.ok(!loaded.run.capabilities.includes(HOST_CAPABILITY.NOTIFICATIONS));
    }),
  ),
);

test("the tab is said shown as the listener stands, and hidden as it goes behind", () => {
  const said: boolean[] = [];
  const stop = onTabShownChanged((shown) => said.push(shown));

  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  stop();
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));

  assert.deepEqual(said, [true, false]);
});

test("the count stands before the tab's title as the panel renames it, and leaves at none", async () => {
  fakeNotifications({ permission: "granted" });
  const { doors } = doorsAnswering();
  document.title = "Luke";

  doors.badge(2);
  assert.equal(document.title, "(2) Luke");

  document.title = "Inbox — Acme";
  await vi.waitFor(() => assert.equal(document.title, "(2) Inbox — Acme"));

  doors.badge(0);
  assert.equal(document.title, "Inbox — Acme");
  doors.close();
});

test("a notice posted after the permission was granted in the browser's own settings says notifications are on", () => {
  browser = fakeNotifications({ permission: "granted" });
  const { doors, answered } = doorsAnswering();
  visibility = "hidden";

  doors.post({ title: "Billing export", body: "Opus finished", onClick: () => undefined });

  assert.deepEqual(answered, [NOTIFICATIONS_STATUS.ON]);
  assert.equal(browser.shown.length, 1);
});
