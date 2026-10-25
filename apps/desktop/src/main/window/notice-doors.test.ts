import assert from "node:assert/strict";
import { type AgentNotice, NOTICE_KIND } from "@luke/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";
import { afterEach, test, vi } from "vitest";
import { electronNoticeDoors } from "./notice-doors";

/**
 * A command ask's notification as macOS meets it: its answer from macOS says
 * whether notifications are on for Luke, and its click brings Luke forward.
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

/** A command waiting on this Mac, announced as `client-notices.ts` announces it, its click handed in. */
function askNotice(askId: string, onClick: () => void = ignore): AgentNotice {
  return {
    subject: { kind: NOTICE_KIND.MAC_COMMAND_ASK, askId },
    title: "Run a command on your Mac?",
    body: "An agent is waiting for you to allow or deny a command.",
    onClick,
  };
}

/** The doors, with every answer from macOS they hand on gathered. */
function doors() {
  const answers: NotificationsStatus[] = [];
  const surface = electronNoticeDoors({
    onAnswered: (status) => answers.push(status),
    report: ignore,
  });
  return { surface, answers };
}

afterEach(() => {
  posted.splice(0);
});

test("macOS refusing a notification says notifications are off, and showing one says on", () => {
  const { surface, answers } = doors();

  surface.post(askNotice("first"));
  posted[0]?.emit("failed", {}, "Notifications are not allowed for this application");
  surface.post(askNotice("second"));
  posted[1]?.emit("show");

  assert.deepEqual(answers, [NOTIFICATIONS_STATUS.OFF, NOTIFICATIONS_STATUS.ON]);
});

test("a click on a notification brings Luke forward", () => {
  const { surface } = doors();
  let focused = false;

  surface.post(
    askNotice("first", () => {
      focused = true;
    }),
  );
  posted[0]?.emit("click");

  assert.equal(focused, true);
});
