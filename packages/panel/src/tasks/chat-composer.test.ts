// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ChatComposer, type ChatComposerMentions } from "./chat-composer.js";

/**
 * Chat's box as the developer works it, alike with the agent's box and the
 * Inbox's: words typed and not sent wait under their channel, and under
 * their thread for a reply, while another is open; a post out holds the
 * box and its send, and the caret comes back once it lands; a post refused
 * says why with Retry beside it; Escape leaves the box; and a Luke address
 * pasted whole is written as its chip.
 */

/** The channels the boxes post in. */
const GENERAL = "c0a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";
const RANDOM = "d1b2c3d4-e5f6-4a70-9b8c-0d1e2f3a4b5c";

/** A plan a pasted address names. */
const PLAN = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";

beforeAll(() => Effect.runPromise(editorBundleLanded));
beforeAll(installEditorLayout);

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

/** What a box standing alone offers: no member, no task, and no channel, only the dates. */
const NO_MENTIONS: ChatComposerMentions = {
  source: { taskId: "", taskName: "", workspace: "", repository: null, text: () => "" },
  members: { people: [], agents: [] },
  channels: [],
  crowded: () => false,
};

/** What a box is drawn with: where it posts, and what its send answers. */
interface Drawn {
  readonly channelId: string;
  readonly replyTo?: number;
  readonly label: string;
  readonly onSend: (text: string) => Promise<string | undefined>;
}

/**
 * Draws the boxes the page would, one window's registry under them all, as
 * Chat draws a channel's box keyed by its channel and a thread's box only
 * while the thread is open; answers a redraw with other boxes.
 */
function page(workspace?: string) {
  const registry = AtomRegistry.make();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const draw = (boxes: readonly Drawn[]) => {
    const drawn = boxes.map((box) =>
      createElement(ChatComposer, {
        key: `${box.channelId}/${box.replyTo ?? ""}`,
        channelId: box.channelId,
        replyTo: box.replyTo,
        label: box.label,
        mentions: NO_MENTIONS,
        keywords: [],
        compact: box.replyTo !== undefined,
        onSend: (text) => box.onSend(text),
      }),
    );
    const held = createElement("div", null, ...drawn);
    act(() =>
      root?.render(
        onRegistry(
          registry,
          workspace === undefined
            ? held
            : createElement(LinkWorkspaceProvider, { value: workspace }, held),
        ),
      ),
    );
  };
  return { container, draw };
}

/** The box whose editor is named `label`. */
function boxNamed(container: HTMLElement, label: string): HTMLElement {
  const box = [...container.querySelectorAll<HTMLElement>(".chat-composer")].find(
    (each) => each.querySelector(`.composer-editor[aria-label="${label}"]`) !== null,
  );
  assert.ok(box, `no box ${label}`);
  return box;
}

/** The words a box holds, as its editor shows them. */
function boxWords(box: HTMLElement): string {
  return (composerEditor(box).textContent ?? "").replaceAll("\u00a0", " ");
}

/** The box's round send. */
function sendOf(box: HTMLElement): HTMLButtonElement {
  const send = box.querySelector<HTMLButtonElement>('button[aria-label="Send"]');
  assert.ok(send, "the box has its send");
  return send;
}

/** A send that answers only when the test says, every post it was handed written down. */
function heldSend() {
  const sent: string[] = [];
  const answers: ((refused: string | undefined) => void)[] = [];
  const onSend = (text: string) => {
    sent.push(text);
    return new Promise<string | undefined>((resolve) => {
      answers.push(resolve);
    });
  };
  const answer = async (refused: string | undefined) => {
    act(() => answers.shift()?.(refused));
    await settle();
  };
  return { sent, onSend, answer };
}

const taken = () => Promise.resolve(undefined);

test("words left in a channel's box wait there while another channel is open, a reply waits under its thread once hidden, and each goes with the post that sends it", async () => {
  const { container, draw } = page();
  const general: Drawn = { channelId: GENERAL, label: "Message #general", onSend: taken };
  const random: Drawn = { channelId: RANDOM, label: "Message #random", onSend: taken };
  const thread: Drawn = {
    channelId: GENERAL,
    replyTo: 48,
    label: "Reply in thread",
    onSend: taken,
  };

  draw([general]);
  typeInComposer(boxNamed(container, "Message #general"), "half a thought");
  draw([random]);
  assert.equal(boxWords(boxNamed(container, "Message #random")), "");
  draw([general]);
  assert.equal(boxWords(boxNamed(container, "Message #general")), "half a thought");

  // A thread's reply is its own, apart from the channel's foot.
  draw([thread, general]);
  assert.equal(boxWords(boxNamed(container, "Reply in thread")), "");
  typeInComposer(boxNamed(container, "Reply in thread"), "on it");
  draw([general]);
  draw([thread, general]);
  const reply = boxNamed(container, "Reply in thread");
  assert.equal(boxWords(reply), "on it");

  pressInComposer(reply, "Enter");
  await settle();
  draw([general]);
  draw([thread, general]);
  assert.equal(boxWords(boxNamed(container, "Reply in thread")), "");
  assert.equal(boxWords(boxNamed(container, "Message #general")), "half a thought");
});

test("a post out holds the box and a send that reads as sent, an Enter meanwhile posts nothing more, and the caret comes back once it lands", async () => {
  const { container, draw } = page();
  const send = heldSend();
  draw([{ channelId: GENERAL, label: "Message #general", onSend: send.onSend }]);
  const box = boxNamed(container, "Message #general");
  typeInComposer(box, "Shipping today.");
  pressInComposer(box, "Enter");
  await settle();
  assert.equal(sendOf(box).disabled, true);
  assert.equal(sendOf(box).dataset.submit, "submitted");
  assert.equal(composerEditor(box).getAttribute("aria-disabled"), "true");
  pressInComposer(box, "Enter");
  await settle();
  assert.deepEqual(send.sent, ["Shipping today."]);
  // A field that takes no words can hold no caret, so the browser takes it off the held box.
  act(() => composerEditor(box).blur());

  await send.answer(undefined);
  assert.equal(boxWords(box), "");
  assert.equal(composerEditor(box).getAttribute("aria-disabled"), null);
  assert.equal(document.activeElement, composerEditor(box));
});

test("a box that opens again after a post leaves the caret where the developer went meanwhile", async () => {
  const { container, draw } = page();
  const send = heldSend();
  draw([{ channelId: GENERAL, label: "Message #general", onSend: send.onSend }]);
  const box = boxNamed(container, "Message #general");
  typeInComposer(box, "Shipping today.");
  pressInComposer(box, "Enter");
  await settle();
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  act(() => elsewhere.focus());

  await send.answer(undefined);
  assert.equal(document.activeElement, elsewhere);
});

test("a post refused says why with Retry, which posts the same words again and empties the box once taken", async () => {
  const { container, draw } = page();
  const send = heldSend();
  draw([{ channelId: GENERAL, label: "Message #general", onSend: send.onSend }]);
  const box = boxNamed(container, "Message #general");
  typeInComposer(box, "Shipping today.");
  pressInComposer(box, "Enter");
  await send.answer("Chat could not be reached.");
  const alert = box.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? "", /Chat could not be reached\./u);
  assert.equal(boxWords(box), "Shipping today.");

  const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === "Retry",
  );
  assert.ok(retry, "the refusal offers Retry");
  act(() => retry.click());
  await send.answer(undefined);
  assert.deepEqual(send.sent, ["Shipping today.", "Shipping today."]);
  assert.equal(boxWords(box), "");
  assert.equal(box.querySelector('[role="alert"]'), null);
});

test("Escape leaves the box, and its field says what it asks for to assistive technology", () => {
  const { container, draw } = page();
  draw([{ channelId: GENERAL, label: "Message #general", onSend: taken }]);
  const box = boxNamed(container, "Message #general");
  assert.equal(composerEditor(box).getAttribute("aria-placeholder"), "Message #general");
  typeInComposer(box, "never mind");
  assert.equal(document.activeElement, composerEditor(box));
  pressInComposer(box, "Escape");
  assert.notEqual(document.activeElement, composerEditor(box));
  assert.equal(boxWords(box), "never mind");
});

/** Words pasted into the box's editor as the clipboard hands them. */
function pasteInComposer(box: HTMLElement, words: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? words : ""),
    },
  });
  act(() => {
    composerEditor(box).dispatchEvent(event);
  });
}

test("a plan's address pasted whole is drawn as its chip and posted as its link under the chat's workspace", async () => {
  const { container, draw } = page("acme");
  const sent: string[] = [];
  draw([
    {
      channelId: GENERAL,
      label: "Message #general",
      onSend: (text) => {
        sent.push(text);
        return taken();
      },
    },
  ]);
  const box = boxNamed(container, "Message #general");
  typeInComposer(box, "see ");
  pasteInComposer(box, `https://tryluke.dev/acme/plan/${PLAN}`);
  await settle();
  assert.equal(composerEditor(box).querySelectorAll("[data-mention-ref]").length, 1);
  pressInComposer(box, "Enter");
  await settle();
  assert.equal(sent.length, 1);
  assert.match(
    sent[0] ?? "",
    new RegExp(`^see \\[@[^\\]]+\\]\\(https://tryluke\\.dev/acme/plan/${PLAN}\\)$`, "u"),
  );
});
