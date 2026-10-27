// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIST_ROW_LEAD, LIST_ROW_META, List, ListRow } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * list-row-lead-line.test.ts -- a row whose metadata ends its title's line
 * and whose lead stands on a line of its own, as an Inbox row grouped by
 * anything but task, runs that line across the words' and the end's
 * tracks, as its description does, rather than falling into the leading
 * mark's narrow track. The row's words lend their parts to the press's
 * grid there, so a part the sheets give no track is placed in whatever
 * track is free. jsdom lays nothing out, so the sheets are laid
 * (`testing/container-width.ts`) and the track each part is given is read.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

test("a lead on a line of its own, under a title its metadata ends, runs the description's tracks, not the leading mark's", () => {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({});
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        List,
        null,
        createElement(ListRow, {
          leading: "•",
          title: "Retry the webhook?",
          lead: { icon: "◐", label: "Billing usage alerts" },
          leadAt: LIST_ROW_LEAD.LINE,
          description: "Choice · 2 options",
          meta: "2h",
          metaAt: LIST_ROW_META.TITLE,
          onPress: () => undefined,
        }),
      ),
    ),
  );
  const part = (selector: string) => container.querySelector(selector) ?? assert.fail(selector);
  const description = getComputedStyle(part(".luke-list-row-description")).gridColumn;

  assert.notEqual(description, "", "the description is given its tracks");
  assert.equal(getComputedStyle(part(".luke-list-row-lead")).gridColumn, description);
});
