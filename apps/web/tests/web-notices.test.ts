// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACT_KIND } from "@luke/host/acts";
import { askAct } from "@luke/panel/act";
import { installActPort } from "@luke/panel/app-bridge";
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

/** What the fake browser was asked: each notification shown, those it still shows, and each time permission was asked for. */
interface FakeBrowser {
  readonly shown: ShownNotification[];
  /** The notifications on screen, one per tag: a notification posted under a tag one already shows replaces it, as a browser does. */
  readonly onScreen: Map<string, ShownNotification>;
  permissionAsks: number;
  /** Whether each ask for permission was made while a press was still on the stack. */
  readonly askedInPress: boolean[];
  /** Answers the asks still waiting, where the fake was told to hold them. */
  answer: () => void;
  /** Changes the site's permission from outside the page, as the browser's own settings do. */
  setPermission: (permission: NotificationPermission) => void;
}

/** Whether the test is inside a press's own handler, where a browser such as Safari lets a page ask. */
let pressing = false;

let browser: FakeBrowser;
let visibility: DocumentVisibilityState;

/** Stands the fake `Notification` in the tab, whose permission stands as given and whose ask answers as given. */
function fakeNotifications(options: {
  readonly permission: NotificationPermission;
  readonly answer?: NotificationPermission;
  /** Holds each ask until `answer`, as a prompt the developer has not answered yet. */
  readonly holdAsks?: boolean;
  /** Refuses to build a notification, as Android's Chrome does a page's own. */
  readonly refuses?: boolean;
}): FakeBrowser {
  const waiting: (() => void)[] = [];
  const seen: FakeBrowser = {
    shown: [],
    onScreen: new Map(),
    permissionAsks: 0,
    askedInPress: [],
    answer: () => {
      for (const settle of waiting.splice(0)) settle();
    },
    setPermission: (permission) => {
      FakeNotification.permission = permission;
    },
  };
  class FakeNotification {
    static permission: NotificationPermission = options.permission;
    static requestPermission(): Promise<NotificationPermission> {
      seen.permissionAsks += 1;
      seen.askedInPress.push(pressing);
      const settle = () => {
        FakeNotification.permission = options.answer ?? FakeNotification.permission;
      };
      if (options.holdAsks !== true) {
        settle();
        return Promise.resolve(FakeNotification.permission);
      }
      return new Promise((answered) =>
        waiting.push(() => {
          settle();
          answered(FakeNotification.permission);
        }),
      );
    }
    onclick: (() => void) | null = null;
    constructor(title: string, init?: NotificationOptions) {
      if (options.refuses === true) {
        throw new TypeError(
          "Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.",
        );
      }
      const shown = { title, body: init?.body, click: () => this.onclick?.() };
      seen.shown.push(shown);
      seen.onScreen.set(init?.tag ?? crypto.randomUUID(), shown);
    }
    close(): void {}
  }
  vi.stubGlobal("Notification", FakeNotification);
  return seen;
}

/** The doors with toasts that go nowhere, each status the browser answered, and whether notifications were withdrawn. */
function doorsAnswering() {
  const answered: NotificationsStatus[] = [];
  const heard = { withdrawn: false };
  const ignore = () => undefined;
  const doors = webNoticeDoors({
    toasts: { toast: ignore, toastInbox: ignore, toastFailedRun: ignore, toastChat: ignore },
    onAnswered: (status) => answered.push(status),
    onWithdrawn: () => {
      heard.withdrawn = true;
    },
  });
  return { doors, answered, heard };
}

/** Stands the browser's permission query, whose answer for notifications says each change as the returned function is called. */
function fakePermissionQuery(): () => void {
  const status = new EventTarget();
  vi.stubGlobal("navigator", {
    ...navigator,
    permissions: { query: () => Promise.resolve(status) },
  });
  return () => status.dispatchEvent(new Event("change"));
}

/** Stands the installed app's badge in the browser, recording each count it is set to, and the display mode the site runs in. */
function fakeAppBadge(displayMode: "standalone" | "browser"): number[] {
  const counts: number[] = [];
  vi.stubGlobal("navigator", {
    ...navigator,
    setAppBadge: (count: number) => {
      counts.push(count);
      return Promise.resolve();
    },
    clearAppBadge: () => {
      counts.push(0);
      return Promise.resolve();
    },
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === `(display-mode: ${displayMode})`,
  }));
  return counts;
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
  pressing = false;
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
        const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
        installActPort(actPort);
        const loaded = yield* Effect.promise(() => bridge.requestAppState());

        assert.equal(browser.permissionAsks, 0, "nothing asks as the tab loads");
        assert.ok(loaded.run.capabilities.includes(HOST_CAPABILITY.NOTIFICATIONS));
        assert.equal(loaded.notifications.status, NOTIFICATIONS_STATUS.UNKNOWN);

        const outcome = yield* Effect.promise(() => askAct(ACT_KIND.NOTIFICATIONS_TEST));
        const after = yield* Effect.promise(() => bridge.requestAppState());

        assert.equal(outcome, undefined);
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
      const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
      installActPort(actPort);

      yield* Effect.promise(() => askAct(ACT_KIND.NOTIFICATIONS_TEST));
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

test("a browser that refuses to build a notification throws nothing back, and withdraws them for the tab", () => {
  browser = fakeNotifications({ permission: "granted", refuses: true });
  const { doors, answered, heard } = doorsAnswering();
  visibility = "hidden";

  doors.post({ title: "Billing export", body: "Opus finished", onClick: () => undefined });
  doors.post({ title: "Billing export", body: "Sonnet finished", onClick: () => undefined });

  assert.ok(heard.withdrawn);
  assert.deepEqual(browser.shown, []);
  assert.deepEqual(
    answered,
    [NOTIFICATIONS_STATUS.ON],
    "nothing is said of a permission after the refusal",
  );
});

it.effect(
  "a test the browser refuses to build answers the press, and the tab offers notifications no more",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        browser = fakeNotifications({ permission: "granted", refuses: true });
        const { bridge, actPort } = yield* standingHost(fakeService({ signedIn: true }));
        installActPort(actPort);
        const loaded = yield* Effect.promise(() => bridge.requestAppState());
        assert.ok(loaded.run.capabilities.includes(HOST_CAPABILITY.NOTIFICATIONS));

        const outcome = yield* Effect.promise(() => askAct(ACT_KIND.NOTIFICATIONS_TEST));
        const after = yield* Effect.promise(() => bridge.requestAppState());

        assert.equal(outcome, undefined);
        assert.ok(!after.run.capabilities.includes(HOST_CAPABILITY.NOTIFICATIONS));
        assert.equal(after.notifications.status, NOTIFICATIONS_STATUS.OFF);
      }),
    ),
);

test("the same notice posted by every hidden tab of the site shows once", () => {
  browser = fakeNotifications({ permission: "granted" });
  const first = doorsAnswering();
  const second = doorsAnswering();
  visibility = "hidden";
  const notice = { title: "Billing export", body: "Opus finished", onClick: () => undefined };

  first.doors.post(notice);
  second.doors.post(notice);
  first.doors.post({ ...notice, body: "Sonnet finished" });

  assert.deepEqual(
    [...browser.onScreen.values()].map(({ body }) => body),
    ["Opus finished", "Sonnet finished"],
  );
});

test("an uninstalled tab counts before its title, though the browser names an app badge", () => {
  const appBadge = fakeAppBadge("browser");
  const { doors } = doorsAnswering();
  document.title = "Luke";

  doors.badge(2);

  assert.equal(document.title, "(2) Luke");
  assert.deepEqual(appBadge, []);
  doors.close();
});

test("the installed app counts on its own badge, and leaves the title alone", () => {
  const appBadge = fakeAppBadge("standalone");
  const { doors } = doorsAnswering();
  document.title = "Luke";

  doors.badge(2);
  doors.close();

  assert.equal(document.title, "Luke");
  assert.deepEqual(appBadge, [2, 0]);
});

it.effect("a permission changed in the browser's own settings reaches Settings as it changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      browser = fakeNotifications({ permission: "default" });
      const changed = fakePermissionQuery();
      const { bridge } = yield* standingHost(fakeService({ signedIn: true }));
      const loaded = yield* Effect.promise(() => bridge.requestAppState());
      assert.equal(loaded.notifications.status, NOTIFICATIONS_STATUS.UNKNOWN);

      browser.setPermission("granted");
      // The browser's answer to the query lands a turn after the host stands, so the change is said until it is heard.
      yield* Effect.promise(() =>
        vi.waitFor(async () => {
          changed();
          const after = await bridge.requestAppState();
          assert.equal(after.notifications.status, NOTIFICATIONS_STATUS.ON);
        }),
      );
    }),
  ),
);

it.effect(
  "the press asks for permission inside its own handler, and the test joins that ask rather than asking again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        browser = fakeNotifications({ permission: "default", answer: "granted", holdAsks: true });
        const { actPort, platform } = yield* standingHost(fakeService({ signedIn: true }));
        installActPort(actPort);

        pressing = true;
        platform.askNotificationsPermission?.();
        const tested = askAct(ACT_KIND.NOTIFICATIONS_TEST);
        pressing = false;
        browser.answer();
        yield* Effect.promise(() => tested);

        assert.deepEqual(browser.askedInPress, [true]);
        assert.deepEqual(
          browser.shown.map(({ title }) => title),
          ["Luke notifications are on"],
        );
      }),
    ),
);
