import assert from "node:assert/strict";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";
import { afterEach, test, vi } from "vitest";
import { electronNoticeDoors } from "./notice-doors";

/**
 * Settings' test notification as macOS meets it: posted through the same
 * door as an agent's, whose answer from macOS says whether notifications
 * are on for Luke, and whose click brings Luke forward.
 *
 * Note that Electron's module is replaced whole, because it is the operating
 * system's door and answers nothing outside an Electron process.
 */

const { posted, FakeNotification } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const posted: InstanceType<typeof FakeNotification>[] = [];
  /** A notification as macOS holds it: shown once asked, and answering with Electron's events. */
  class FakeNotification extends EventEmitter {
    static isSupported = () => true;
    shown = false;
    constructor(readonly options: { title: string; body: string }) {
      super();
      posted.push(this);
    }
    show(): void {
      this.shown = true;
    }
  }
  return { posted, FakeNotification };
});

vi.mock("electron", () => ({
  app: { setBadgeCount: () => true },
  Notification: FakeNotification,
}));

const ignore = () => undefined;

/** The doors, with every answer from macOS they hand on gathered. */
function doors() {
  const answers: NotificationsStatus[] = [];
  const surface = electronNoticeDoors({
    toPanels: ignore,
    inboxToPanels: ignore,
    failedRunToPanels: ignore,
    chatToPanels: ignore,
    onAnswered: (status) => answers.push(status),
    report: ignore,
  });
  return { surface, answers };
}

afterEach(() => {
  posted.splice(0);
});

test("the test notification is shown by macOS at once, saying Luke's notifications are on", () => {
  const { surface } = doors();

  surface.postTest(ignore);

  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.options.title, "Luke notifications are on");
  assert.equal(posted[0]?.shown, true);
});

test("macOS refusing the test notification says notifications are off, and showing it says on", () => {
  const { surface, answers } = doors();

  surface.postTest(ignore);
  posted[0]?.emit("failed", {}, "Notifications are not allowed for this application");
  surface.postTest(ignore);
  posted[1]?.emit("show");

  assert.deepEqual(answers, [NOTIFICATIONS_STATUS.OFF, NOTIFICATIONS_STATUS.ON]);
});

test("a click on the test notification brings Luke forward", () => {
  const { surface } = doors();
  let focused = false;

  surface.postTest(() => {
    focused = true;
  });
  posted[0]?.emit("click");

  assert.equal(focused, true);
});
