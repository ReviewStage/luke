// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useLinkOpener } from "./held-link.js";

/**
 * A Luke link handed while sign-in stands opens once the account is signed
 * in, the latest one only, and one handed after opens at once. Synthetic
 * plans.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

const task = (taskId: string): PlanMention => ({ kind: MENTION_KIND.TASK, taskId });

/** The opener drawn behind a gate that `stand` moves, every plan it opened kept; `arriving` is handed in the commit the gate moves in, before its effects run. */
function opener() {
  const opened: string[] = [];
  let handTo: ((mention: PlanMention) => void) | undefined;
  function Probe({ gated, arriving }: { gated: boolean; arriving?: PlanMention }): null {
    const open = useLinkOpener<PlanMention>(gated, (mention) => opened.push(mention.taskId));
    handTo = open;
    useLayoutEffect(() => {
      if (arriving !== undefined) open(arriving);
    }, [arriving, open]);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const stand = (gated: boolean, arriving?: PlanMention) =>
    act(() =>
      root.render(createElement(Probe, arriving === undefined ? { gated } : { gated, arriving })),
    );
  const hand = (mention: PlanMention) => act(() => handTo?.(mention));
  return { opened, stand, hand };
}

test("a link handed behind the sign-in gate opens once it gives way, the latest one only", () => {
  const { opened, stand, hand } = opener();

  stand(true);
  hand(task("first"));
  hand(task("latest"));
  const whileGated = [...opened];
  stand(false);

  assert.deepEqual(whileGated, []);
  assert.deepEqual(opened, ["latest"]);
});

test("a link handed while signed in opens at once, and none held is opened twice", () => {
  const { opened, stand, hand } = opener();

  stand(false);
  hand(task("now"));
  stand(true);
  stand(false);

  assert.deepEqual(opened, ["now"]);
});

test("a link handed as the gate gives way, before the held one opens, stays the one open", () => {
  const { opened, stand, hand } = opener();

  stand(true);
  hand(task("older"));
  stand(false, task("newer"));

  assert.deepEqual(opened, ["newer"]);
});
