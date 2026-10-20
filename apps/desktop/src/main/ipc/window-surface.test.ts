import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { FeedbackSubmission } from "@luke/features/feedback";
import { type TestActPort, testActPort } from "@luke/host/act-port/testing";
import type { ActSender } from "@luke/host/act-router";
import { WINDOW_SURFACE_ACT_KIND } from "@luke/host/contract";
import { LID_STATE, MICROPHONE_STATUS, MICROPHONE_TRANSPORT } from "@luke/voice/audio";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { windowSurfaceProcedures } from "./window-surface";

/**
 * What a window asks of the system it is drawn on, called on the act port as
 * a window calls it: the microphone asked for and counted, its route probed
 * afresh, the panel focused and a file saved from a panel alone, words
 * copied, a mail and the notification settings opened, the test
 * notification posted, and feedback carried. A sender this build does not
 * trust, a key a payload does not name, and a payload sent to a kind that
 * takes none are each refused in the kind's own words. Synthetic values
 * throughout.
 */

const KIND = WINDOW_SURFACE_ACT_KIND;

const DISPLAY = 7;

const ROUTE = {
  defaultTransport: MICROPHONE_TRANSPORT.BLUETOOTH,
  lid: LID_STATE.OPEN,
  builtInName: "MacBook Pro Microphone",
};

const SUBMISSION = {
  kind: "feedback",
  message: "The panel is lovely.",
  images: [],
} satisfies FeedbackSubmission;

/** Every act port a fixture opened, closed once its test is done. */
const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** The system as the test scripts it, writing down everything it was asked. */
function fixture() {
  // SAFETY: the procedures read a sender by identity alone; one inert object is one window.
  const panelContents = {} as WebContents;
  // SAFETY: as above, a second window.
  const voiceContents = {} as WebContents;
  const heard: string[] = [];
  const events: unknown[] = [];
  const port = testActPort(
    windowSurfaceProcedures({
      panels: {
        displayIdFor: (sender) => (sender === panelContents ? DISPLAY : undefined),
        focusIfExpanded: (displayId) => heard.push(`focus:${displayId}`),
      },
      requestMicrophone: async () => MICROPHONE_STATUS.GRANTED,
      microphoneRoute: () => ROUTE,
      microphoneRouteWatcher: () => ({
        start: () => true,
        stop: () => undefined,
        probe: () => void heard.push("probe"),
      }),
      recordProductEvent: (name, properties) => events.push({ name, properties }),
      openExternal: async (url) => {
        heard.push(`open:${url}`);
      },
      testNotification: () => heard.push("test notification"),
      copyText: (words) => heard.push(`copy:${words}`),
      saveFile: async (sender, name, text) => {
        heard.push(`save:${sender === panelContents ? "panel" : "other"}:${name}:${text}`);
        return true;
      },
      deliverFeedback: (submission) =>
        Effect.sync(() => {
          heard.push(`feedback:${submission.message}`);
          return { delivered: true };
        }),
    }),
  );
  ports.push(port);
  const panel: ActSender<WebContents> = {
    sender: panelContents,
    panel: true,
    voice: false,
    call: false,
  };
  const voice: ActSender<WebContents> = {
    sender: voiceContents,
    panel: false,
    voice: true,
    call: false,
  };
  return { port, panel, voice, heard, events };
}

it("the microphone is asked for and counted, and its route is probed afresh, from any window", async () => {
  const { port, voice, heard, events } = fixture();

  assert.deepEqual(await port.call(voice, KIND.MICROPHONE_REQUEST), {
    answer: MICROPHONE_STATUS.GRANTED,
  });
  assert.deepEqual(await port.call(voice, KIND.MICROPHONE_ROUTE), { answer: ROUTE });
  assert.deepEqual(heard, ["probe"]);
  assert.deepEqual(events, [
    { name: "voice:permission", properties: { permission_result: "granted" } },
  ]);
});

it("the panel is focused and a file saved from a panel, and refused from any other window", async () => {
  const { port, panel, voice, heard } = fixture();
  const file = { name: "notes.md", text: "# Notes" };

  assert.deepEqual(await port.call(panel, KIND.WINDOW_FOCUS_PANEL), { answer: undefined });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_SAVE_FILE, file), { answer: true });
  assert.deepEqual(await port.call(voice, KIND.WINDOW_FOCUS_PANEL), {
    refused: "Could not focus the panel on this system.",
  });
  assert.deepEqual(await port.call(voice, KIND.WINDOW_SAVE_FILE, file), {
    refused: "Could not save that file on this system.",
  });
  assert.deepEqual(heard, [`focus:${DISPLAY}`, "save:panel:notes.md:# Notes"]);
});

it("words are copied, a mail and the settings opened, a notification posted, and feedback carried", async () => {
  const { port, panel, heard } = fixture();

  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_TEXT, { words: "" }), {
    answer: undefined,
  });
  await port.call(panel, KIND.CONTACT_EMAIL);
  await port.call(panel, KIND.NOTIFICATIONS_OPEN_SETTINGS);
  await port.call(panel, KIND.NOTIFICATIONS_TEST);
  assert.deepEqual(await port.call(panel, KIND.FEEDBACK_SEND, { submission: SUBMISSION }), {
    answer: { delivered: true },
  });
  assert.deepEqual(heard, [
    "copy:",
    "open:mailto:founders@stagereview.app",
    "open:x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    "test notification",
    "feedback:The panel is lovely.",
  ]);
});

it("a sender this build does not trust is refused in each kind's own words", async () => {
  const { port, panel, heard } = fixture();
  const untrusted = { trusted: false };

  assert.deepEqual(await port.call(panel, KIND.MICROPHONE_REQUEST, undefined, untrusted), {
    refused: "Could not ask for the microphone on this system.",
  });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_TEXT, { words: "secret" }, untrusted), {
    refused: "Could not copy that to the clipboard on this system.",
  });
  assert.deepEqual(await port.call(panel, KIND.CONTACT_EMAIL, undefined, untrusted), {
    refused: "Could not open a new email on this system.",
  });
  assert.deepEqual(heard, []);
});

it("a key a payload does not name, a payload a kind takes none of, and a malformed note are refused", async () => {
  const { port, panel, heard } = fixture();

  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_TEXT, { words: "x", extra: 1 }), {
    refused: "Could not copy that to the clipboard on this system.",
  });
  assert.deepEqual(
    await port.call(panel, KIND.FEEDBACK_SEND, { submission: SUBMISSION, sender: "panel" }),
    { refused: "Could not send that on this system." },
  );
  assert.deepEqual(await port.call(panel, KIND.NOTIFICATIONS_TEST, { now: true }), {
    refused: "Could not post a notification on this system.",
  });
  assert.deepEqual(
    await port.call(panel, KIND.FEEDBACK_SEND, { submission: { ...SUBMISSION, message: " " } }),
    { refused: "Could not send that on this system." },
  );
  assert.deepEqual(
    await port.call(panel, KIND.WINDOW_SAVE_FILE, { name: "../notes.md", text: "" }),
    { refused: "Could not save that file on this system." },
  );
  assert.deepEqual(heard, []);
});
