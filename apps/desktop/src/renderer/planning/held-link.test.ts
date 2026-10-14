// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MENTION_KIND, type PlanMention } from "@luke/features/mention-link";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useLinkOpener } from "./held-link";

/**
 * A Luke link handed while sign-in stands opens once the account is signed
 * in, the latest one only, and one handed after opens at once. Synthetic
 * plans.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

const plan = (planId: string): PlanMention => ({ kind: MENTION_KIND.PLAN, planId });

/** The opener drawn behind a gate that `stand` moves, every plan it opened kept. */
function opener() {
  const opened: string[] = [];
  let handTo: ((mention: PlanMention) => void) | undefined;
  function Probe({ gated }: { gated: boolean }): null {
    handTo = useLinkOpener(gated, (mention) => opened.push(mention.planId));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const stand = (gated: boolean) => act(() => root.render(createElement(Probe, { gated })));
  const hand = (mention: PlanMention) => act(() => handTo?.(mention));
  return { opened, stand, hand };
}

test("a link handed behind the sign-in gate opens once it gives way, the latest one only", () => {
  const { opened, stand, hand } = opener();

  stand(true);
  hand(plan("first"));
  hand(plan("latest"));
  const whileGated = [...opened];
  stand(false);

  assert.deepEqual(whileGated, []);
  assert.deepEqual(opened, ["latest"]);
});

test("a link handed while signed in opens at once, and none held is opened twice", () => {
  const { opened, stand, hand } = opener();

  stand(false);
  hand(plan("now"));
  stand(true);
  stand(false);

  assert.deepEqual(opened, ["now"]);
});
