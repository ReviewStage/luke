// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  DRAFT_PLACE,
  type InboxPlace,
  useDraftWriter,
  useInboxDrafts,
} from "../composer-drafts.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { type InboxCloser, useInboxClose, useInboxCloser } from "./inbox-close.js";

/**
 * inbox-close.test.ts -- an item's Close asks first, and its question is
 * withdrawn once the agent posts the item again, so the reader never closes
 * a request they were not asked about; a close taken lets go of the answer
 * drafted against the revision it closed, and of nothing else of the item's.
 * Synthetic item.
 */

const ITEM: InboxItem = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
  key: "threshold",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Alert at 80%?",
  blocks: [],
  response: { type: INBOX_RESPONSE.APPROVAL },
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_000,
  updatedAt: 1_000,
};

let root: Root | undefined;

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  fakeAppBridge({});
});

/** The close as a row offers it: a button pressing its action, and its question beside it. */
function CloseProbe({ item, closed }: { item: InboxItem; closed: InboxItem[] }): React.JSX.Element {
  const close = useInboxClose(item, (each) => closed.push(each), true);
  return createElement(
    "div",
    null,
    close.action === undefined
      ? null
      : createElement("button", { type: "button", onClick: close.action.onSelect }, "Ask"),
    close.dialog,
  );
}

/** The question's button reading `words`. */
function questionButton(words: string): HTMLButtonElement {
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("Close asks first");
  return (
    [...question.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === words,
    ) ?? assert.fail(`the question offers ${words}`)
  );
}

test("Close asks first and closes the revision it asked about; the agent posting the item again withdraws the question, closing nothing", () => {
  const closed: InboxItem[] = [];
  const registry = AtomRegistry.make();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const draw = (item: InboxItem) =>
    act(() => root?.render(onRegistry(registry, createElement(CloseProbe, { item, closed }))));
  const ask = () => act(() => document.querySelector<HTMLButtonElement>("button")?.click());

  draw(ITEM);
  ask();
  draw({ ...ITEM, revision: 2, updatedAt: 2_000 });
  assert.equal(document.querySelector('[role="alertdialog"]'), null, "the question goes");
  assert.deepEqual(closed, []);

  ask();
  act(() => questionButton("Resolve").click());
  assert.deepEqual(
    closed.map(({ revision }) => revision),
    [2],
    "a question asked again closes the revision it asked about",
  );
});

test("a settled item offers no Close", () => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(CloseProbe, {
          item: { ...ITEM, status: INBOX_STATUS.ANSWERED },
          closed: [],
        }),
      ),
    ),
  );
  assert.equal(document.querySelector("button"), null);
});

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** Where the item's answer at a revision, or a message on its thread, is drafted. */
function placeOf(revision: number, thread: boolean): InboxPlace {
  return {
    kind: DRAFT_PLACE.INBOX,
    planId: PLAN,
    agentId: ITEM.agentId,
    itemId: ITEM.id,
    revision,
    ...(thread ? { thread: true as const } : undefined),
  };
}

test("a close taken lets go of the answer drafted against the revision it closed, and keeps a message begun on the thread meanwhile and an answer to a later revision", async () => {
  let land: (() => void) | undefined;
  let closer: InboxCloser | undefined;
  let write: ((place: InboxPlace, text: string) => void) | undefined;
  let kept: readonly string[] = [];
  const closeAct = () =>
    new Promise<{ item: InboxItem; taken: boolean }>((resolve) => {
      land = () =>
        resolve({ item: { ...ITEM, status: INBOX_STATUS.CLOSED, updatedAt: 2_000 }, taken: true });
    });
  function Probe(): null {
    // SAFETY: the probe answers the one act the closer sends, the close.
    closer = useInboxCloser({ act: closeAct as never });
    const writer = useDraftWriter();
    write = (place, text) =>
      writer.update(place, () => ({ text, attachments: [], choices: [], values: [] }));
    kept = useInboxDrafts(PLAN).map(
      ({ place }) => `${place.revision}${place.thread === true ? " thread" : ""}`,
    );
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(Probe))));
  act(() => {
    write?.(placeOf(1, false), "Use 90%");
    write?.(placeOf(2, false), "Use 85%");
  });
  assert.deepEqual([...kept].sort(), ["1", "2"]);

  act(() => closer?.(ITEM));
  act(() => write?.(placeOf(1, true), "One more detail"));
  await act(async () => land?.());

  assert.deepEqual([...kept].sort(), ["1 thread", "2"], "the closed revision's answer alone goes");
});
