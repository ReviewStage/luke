import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { FeedbackSubmission } from "@repo/features/feedback";
import type { ActSender } from "@repo/host/act-port";
import { type TestActPort, testActPort } from "@repo/host/act-port/testing";
import { WINDOW_SURFACE_ACT_KIND } from "@repo/host/contract";
import { LID_STATE, MICROPHONE_STATUS, MICROPHONE_TRANSPORT } from "@repo/settings/microphone";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { windowSurfaceProcedures } from "./window-surface";

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

const PNG = "iVBORw0KGgo=";
const UNDRAWN_PNG = "AAAA";

const STILL = "data:image/jpeg;base64,AAAA";

const ports: TestActPort<WebContents>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

function fixture() {
  const panelContents = {} as WebContents;
  const otherContents = {} as WebContents;
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
      copyText: (words) => heard.push(`copy:${words}`),
      copyImage: (png) => {
        heard.push(`copy image:${png}`);
        return png !== UNDRAWN_PNG;
      },
      saveFile: async (sender, name, text) => {
        heard.push(`save:${sender === panelContents ? "panel" : "other"}:${name}:${text}`);
        return true;
      },
      deliverFeedback: (submission) =>
        Effect.sync(() => {
          heard.push(`feedback:${submission.message}`);
          return { delivered: true };
        }),
      captureStill: async (sender, rect) => {
        heard.push(
          `still:${sender === panelContents ? "panel" : "other"}:${rect.width}x${rect.height}`,
        );
        return STILL;
      },
      tellUnsavedWork: (sender, holding) =>
        heard.push(`unsaved:${sender === panelContents ? "panel" : "other"}:${holding}`),
      showBuildLabel: (shown) => {
        heard.push(`build label:${shown}`);
        return true;
      },
      tellMenuOffers: (_sender, commands) => heard.push(`offers:${commands.join()}`),
    }),
  );
  ports.push(port);
  const panel: ActSender<WebContents> = {
    sender: panelContents,
    panel: true,
  };
  const other: ActSender<WebContents> = { sender: otherContents, panel: false };
  return { port, panel, other, heard, events };
}

it("the microphone is asked for and counted, and its route is probed afresh, from any window", async () => {
  const { port, other, heard, events } = fixture();

  assert.deepEqual(await port.call(other, KIND.MICROPHONE_REQUEST), {
    answer: MICROPHONE_STATUS.GRANTED,
  });
  assert.deepEqual(await port.call(other, KIND.MICROPHONE_ROUTE), { answer: ROUTE });
  assert.deepEqual(heard, ["probe"]);
  assert.deepEqual(events, [
    { name: "voice:permission", properties: { permission_result: "granted" } },
  ]);
});

it("the panel is focused and a file saved from a panel, and refused from any other window", async () => {
  const { port, panel, other, heard } = fixture();
  const file = { name: "notes.md", text: "# Notes" };

  assert.deepEqual(await port.call(panel, KIND.WINDOW_FOCUS_PANEL), { answer: undefined });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_SAVE_FILE, file), { answer: true });
  assert.deepEqual(await port.call(other, KIND.WINDOW_FOCUS_PANEL), {
    refused: "Could not focus the panel on this system.",
  });
  assert.deepEqual(await port.call(other, KIND.WINDOW_SAVE_FILE, file), {
    refused: "Could not save that file on this system.",
  });
  assert.deepEqual(heard, [`focus:${DISPLAY}`, "save:panel:notes.md:# Notes"]);
});

it("a still is taken of the panel that asks, none of an empty part, and refused from any other window", async () => {
  const { port, panel, other, heard } = fixture();
  const part = { x: 240, y: 0, width: 800, height: 600 };

  assert.deepEqual(await port.call(panel, KIND.WINDOW_CAPTURE, part), { answer: STILL });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_CAPTURE, { ...part, width: 0 }), {
    answer: null,
  });
  assert.deepEqual(await port.call(other, KIND.WINDOW_CAPTURE, part), {
    refused: "Could not take a still of the window.",
  });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_CAPTURE, { ...part, x: -1 }), {
    refused: "Could not take a still of the window.",
  });
  assert.deepEqual(heard, ["still:panel:800x600"]);
});

it("a panel's unsaved work is kept as it tells it, and refused from any other window", async () => {
  const { port, panel, other, heard } = fixture();

  assert.deepEqual(await port.call(panel, KIND.WINDOW_UNSAVED_WORK, { holding: true }), {
    answer: undefined,
  });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_UNSAVED_WORK, { holding: false }), {
    answer: undefined,
  });
  assert.deepEqual(await port.call(other, KIND.WINDOW_UNSAVED_WORK, { holding: true }), {
    refused: "Could not tell this system about unsaved work.",
  });
  assert.deepEqual(heard, ["unsaved:panel:true", "unsaved:panel:false"]);
});

it("a panel hides the build's label, and any other window is refused", async () => {
  const { port, panel, other, heard } = fixture();

  assert.deepEqual(await port.call(panel, KIND.WINDOW_SHOW_BUILD_LABEL, { shown: false }), {
    answer: undefined,
  });
  assert.deepEqual(await port.call(other, KIND.WINDOW_SHOW_BUILD_LABEL, { shown: true }), {
    refused: "Could not show or hide this build's label.",
  });
  assert.deepEqual(heard, ["build label:false"]);
});

it("words are copied, a mail and the settings opened, and feedback carried", async () => {
  const { port, panel, heard } = fixture();

  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_TEXT, { words: "" }), {
    answer: undefined,
  });
  await port.call(panel, KIND.CONTACT_EMAIL);
  await port.call(panel, KIND.NOTIFICATIONS_OPEN_SETTINGS);
  assert.deepEqual(await port.call(panel, KIND.FEEDBACK_SEND, { submission: SUBMISSION }), {
    answer: { delivered: true },
  });
  assert.deepEqual(heard, [
    "copy:",
    "open:mailto:founders@vespin.dev",
    "open:x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    "feedback:The panel is lovely.",
  ]);
});

it("a picture is copied as its PNG, and one the system draws nothing of, or bytes that are not base64, are refused", async () => {
  const { port, panel, heard } = fixture();
  const refused = { refused: "Could not copy that picture to the clipboard on this system." };

  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_IMAGE, { png: PNG }), {
    answer: undefined,
  });
  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_IMAGE, { png: UNDRAWN_PNG }), refused);
  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_IMAGE, { png: "not base64!" }), refused);
  assert.deepEqual(await port.call(panel, KIND.WINDOW_COPY_IMAGE, { png: "" }), refused);
  assert.deepEqual(heard, [`copy image:${PNG}`, `copy image:${UNDRAWN_PNG}`]);
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
