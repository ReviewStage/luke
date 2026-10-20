import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { it } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { testNotifications } from "./notifications-press.js";

/**
 * Settings' Test notification, pressed: the shell's grantor is asked inside
 * the press, before the test leaves for the host, because a browser such as
 * Safari prompts only for an ask made there; a shell that asks nothing, the
 * Mac app, still posts the test.
 */

/** Settles every act the press sent. */
const sent = () => new Promise<void>((settle) => queueMicrotask(settle));

it("a shell that asks for permission is asked inside the press, before the test is sent", async () => {
  const happened: string[] = [];
  fakeAppPlatform({ askNotificationsPermission: () => happened.push("asked") });
  fakeActPort({
    [ACT_KIND.NOTIFICATIONS_TEST]: async () => {
      happened.push("tested");
    },
  });

  testNotifications();
  const duringPress = [...happened];
  await sent();

  assert.equal(duringPress[0], "asked");
  assert.deepEqual(happened, ["asked", "tested"]);
});

it("a shell that asks nothing, as the Mac app, still has the test sent", async () => {
  const tested: string[] = [];
  fakeAppPlatform({});
  fakeActPort({
    [ACT_KIND.NOTIFICATIONS_TEST]: async () => {
      tested.push("tested");
    },
  });

  testNotifications();
  await sent();

  assert.deepEqual(tested, ["tested"]);
});
