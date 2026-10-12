import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { electronNoticeDoors } from "./notice-doors";

/** Electron's notification as macOS answers it: each one posted is kept, for the test to answer as macOS would. */
const { FakeNotification, shown } = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  const shown: InstanceType<typeof FakeNotification>[] = [];
  class FakeNotification extends EventEmitter {
    static isSupported(): boolean {
      return true;
    }
    constructor(readonly options: { title: string; body: string }) {
      super();
    }
    show(): void {
      shown.push(this);
    }
  }
  return { FakeNotification, shown };
});

vi.mock("electron", () => ({ Notification: FakeNotification }));

function doors() {
  const refused: boolean[] = [];
  const reported: string[] = [];
  const clicked: string[] = [];
  const surface = electronNoticeDoors({
    toPanels: () => undefined,
    onRefused: (next) => refused.push(next),
    report: (line) => reported.push(line),
  });
  const post = (body: string) =>
    surface.post({ title: "Teammate invitations", body, onClick: () => clicked.push(body) });
  return { post, refused, reported, clicked };
}

test("a notification macOS refuses says notifications are off for Luke, and one it shows says they are on again", () => {
  shown.length = 0;
  const d = doors();
  d.post("Opus 5.5 finished");
  d.post("Opus 5.5 failed");
  const [refusedOne, shownOne] = shown;
  assert.ok(refusedOne && shownOne, "each end is shown as its own notification");
  assert.deepEqual(refusedOne.options, {
    title: "Teammate invitations",
    body: "Opus 5.5 finished",
  });

  refusedOne.emit("failed", {}, "Notifications are not allowed for this application");
  assert.deepEqual(d.refused, [true]);
  assert.deepEqual(d.reported, [
    "macOS did not show the agent's notification: Notifications are not allowed for this application",
  ]);

  shownOne.emit("show", {});
  shownOne.emit("click", {});
  assert.deepEqual(d.refused, [true, false]);
  assert.deepEqual(d.clicked, ["Opus 5.5 failed"]);
});
