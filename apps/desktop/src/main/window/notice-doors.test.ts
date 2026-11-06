import assert from "node:assert/strict";
import { type AgentNotice, NOTICE_KIND } from "@repo/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@repo/settings/settings-controls";
import { afterEach, test, vi } from "vitest";
import { electronNoticeDoors } from "./notice-doors";

const { posted, FakeNotification } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const posted: InstanceType<typeof FakeNotification>[] = [];
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

function askNotice(askId: string, onClick: () => void = ignore): AgentNotice {
  return {
    subject: { kind: NOTICE_KIND.MAC_COMMAND_ASK, askId },
    title: "Run a command on your Mac?",
    body: "An agent is waiting for you to allow or deny a command.",
    onClick,
  };
}

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

test("a click on a notification brings Vespin forward", () => {
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
