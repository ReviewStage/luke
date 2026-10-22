import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { ActSender } from "@luke/host/act-port";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import { UPDATE_ACT_KIND } from "@luke/host/contract";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import type { WebContents } from "electron";
import { updateProcedures } from "./update-acts";

/**
 * The updater's acts on the act port, over an update service that writes
 * down what it was asked: a check answers where the updater then stands,
 * and the install and the two pages are carried; a sender this build does
 * not trust and a payload sent to a kind that takes none are refused in the
 * kind's own words.
 */

const KIND = UPDATE_ACT_KIND;

const SNAPSHOT: UpdateSnapshot = {
  status: UPDATE_STATUS.DOWNLOADING,
  currentVersion: "1.2.3",
  installSupported: true,
  latestVersion: "1.3.0",
  progress: { percent: 40, transferredBytes: 400, totalBytes: 1_000 },
};

// SAFETY: no procedure here reads the sender; one inert object is one window.
const PANEL: ActSender<WebContents> = {
  sender: {} as WebContents,
  panel: true,
  voice: false,
  call: false,
};

const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

function fixture(answer: UpdateSnapshot = SNAPSHOT) {
  const heard: string[] = [];
  const port = testActPort(
    updateProcedures({
      updates: {
        check: async () => {
          heard.push("check");
          return answer;
        },
        install: () => heard.push("install"),
        openLatestRelease: () => heard.push("release"),
        openChangelog: () => heard.push("changelog"),
      },
    }),
  );
  ports.push(port);
  return { port, heard };
}

it("a check answers where the updater stands, and the install and both pages are carried", async () => {
  const { port, heard } = fixture();

  assert.deepEqual(await port.call(PANEL, KIND.UPDATE_CHECK), { answer: SNAPSHOT });
  await port.call(PANEL, KIND.UPDATE_INSTALL);
  await port.call(PANEL, KIND.UPDATE_OPEN_RELEASE);
  await port.call(PANEL, KIND.UPDATE_OPEN_CHANGELOG);
  assert.deepEqual(heard, ["check", "install", "release", "changelog"]);
});

it("a sender this build does not trust, and a payload a kind takes none of, are refused", async () => {
  const { port, heard } = fixture();

  assert.deepEqual(await port.call(PANEL, KIND.UPDATE_INSTALL, undefined, { trusted: false }), {
    refused: "Could not install that update on this system.",
  });
  assert.deepEqual(await port.call(PANEL, KIND.UPDATE_CHECK, { asked: true }), {
    refused: "Could not check for updates on this system.",
  });
  assert.deepEqual(heard, []);
});

it("a check whose answer is no state of the updater is refused", async () => {
  // SAFETY: a forged answer, as an updater a newer build wrote might give it; no state is spelled so.
  const { port } = fixture({ ...SNAPSHOT, status: "paused" } as unknown as UpdateSnapshot);

  assert.deepEqual(await port.call(PANEL, KIND.UPDATE_CHECK), {
    refused: "Could not check for updates on this system.",
  });
});
