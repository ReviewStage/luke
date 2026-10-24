// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Dialog } from "../dialog/dialog.js";
import { ANNOUNCE, Announcer, announce, type Retire, useAnnounce } from "./announcer.js";

/**
 * announcer.test.ts -- `announce` says polite words in the status region and
 * an alert in the alert region; the same words twice are read twice; a burst
 * ends on its last words; an alert takes the polite words waiting with it;
 * nothing is said before an announcer stands; words taken back leave their
 * region, never taking newer words with them, and words a component says
 * leave as they change or it goes; a window holds one pair of regions
 * however many announcers mount; and a modal dialog leaves them heard.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Mounts an `Announcer` in a container of its own. */
function mount(): Root {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Announcer)));
  return root;
}

function region(role: "status" | "alert"): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role="${role}"]`);
}

test("polite words land in the status region and an alert in the alert region", () => {
  mount();
  act(() => announce(ANNOUNCE.POLITE, "Link copied"));
  assert.equal(region("status")?.textContent, "Link copied");
  assert.equal(region("alert")?.textContent, "");

  act(() => announce(ANNOUNCE.ALERT, "Couldn't save"));
  assert.equal(region("alert")?.textContent, "Couldn't save");
});

test("the same words announced twice are added to the region twice, so a reader hears them twice", () => {
  mount();
  const status = region("status");
  assert.ok(status !== null);
  const observer = new MutationObserver(() => undefined);
  observer.observe(status, { childList: true, subtree: true, characterData: true });

  act(() => announce(ANNOUNCE.POLITE, "Copied"));
  act(() => announce(ANNOUNCE.POLITE, "Copied"));

  const added = observer
    .takeRecords()
    .flatMap((record) => [...record.addedNodes])
    .filter((node) => node.textContent === "Copied");
  observer.disconnect();
  assert.equal(added.length, 2);
  assert.equal(status.textContent, "Copied");
});

test("a burst of polite words ends on the last of them", () => {
  mount();
  act(() => {
    announce(ANNOUNCE.POLITE, "Task archived");
    announce(ANNOUNCE.POLITE, "Task moved");
    announce(ANNOUNCE.POLITE, "Task renamed");
  });
  assert.equal(region("status")?.textContent, "Task renamed");
});

test("an alert interrupts the polite words still standing", () => {
  mount();
  act(() => announce(ANNOUNCE.POLITE, "Saving"));
  act(() => announce(ANNOUNCE.ALERT, "Couldn't save"));
  assert.equal(region("status")?.textContent, "");
  assert.equal(region("alert")?.textContent, "Couldn't save");
});

test("words taken back leave their region, and words said since stay", () => {
  mount();
  let retire: Retire = () => undefined;
  act(() => {
    retire = announce(ANNOUNCE.ALERT, "Could not copy");
  });
  assert.equal(region("alert")?.textContent, "Could not copy");
  act(() => retire());
  assert.equal(region("alert")?.textContent, "");

  act(() => {
    retire = announce(ANNOUNCE.POLITE, "Copied");
  });
  act(() => announce(ANNOUNCE.POLITE, "Task archived"));
  act(() => retire());
  assert.equal(region("status")?.textContent, "Task archived");
});

/** Says `words` politely as they change, as a component's state does. */
function Saying({ words }: { words: string }): null {
  useAnnounce(ANNOUNCE.POLITE, words);
  return null;
}

test("words a component says leave the region once they are empty, or once it goes", () => {
  const root = mount();
  const draw = (saying: React.ReactNode) =>
    act(() => root.render(createElement(Fragment, null, createElement(Announcer), saying)));
  draw(createElement(Saying, { words: "" }));
  draw(createElement(Saying, { words: "3 of 12" }));
  assert.equal(region("status")?.textContent, "3 of 12");
  draw(createElement(Saying, { words: "" }));
  assert.equal(region("status")?.textContent, "");

  draw(createElement(Saying, { words: "2 selected" }));
  assert.equal(region("status")?.textContent, "2 selected");
  draw(null);
  assert.equal(region("status")?.textContent, "");
});

test("nothing is said before an announcer stands, and its regions arrive empty", () => {
  act(() => announce(ANNOUNCE.ALERT, "Couldn't save"));
  mount();
  assert.equal(region("alert")?.textContent, "");
});

test("a window holds one pair of regions however many announcers mount, and the next takes over when the first leaves", () => {
  const first = mount();
  mount();
  assert.equal(document.querySelectorAll('[role="status"]').length, 1);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 1);

  act(() => first.unmount());
  roots.splice(roots.indexOf(first), 1);
  assert.equal(document.querySelectorAll('[role="status"]').length, 1);
  act(() => announce(ANNOUNCE.POLITE, "Still heard"));
  assert.equal(region("status")?.textContent, "Still heard");
});

test("the regions stay heard while a modal dialog hides the rest of the window", () => {
  mount();
  const dialog = mount();
  act(() =>
    dialog.render(
      createElement(Dialog, { title: "Rename", onDismiss: () => undefined, children: "Name" }),
    ),
  );
  assert.ok(document.querySelector('[role="dialog"]'), "the dialog opens");
  for (const role of ["status", "alert"] as const) {
    const live = region(role);
    assert.ok(live !== null);
    assert.ok(live.closest('[aria-hidden="true"]') === null, `the ${role} region is not hidden`);
  }
});
