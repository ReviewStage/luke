// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CONSENT_ANSWER, ConsentCard } from "./consent-card.js";

/**
 * consent-card.test.ts -- one answer going out stands busy and holds the other, so a member cannot both allow and deny.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("an answer going out holds the other", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ConsentCard, {
        client: "Acme Notes",
        account: "ada@example.com",
        abilities: ["See your email address"],
        destination: "notes.acme.example",
        answering: CONSENT_ANSWER.DENY,
        onAnswer: () => undefined,
      }),
    ),
  );
  const [deny, allow] = container.querySelectorAll("button");
  expect(deny?.getAttribute("aria-busy")).toBe("true");
  expect(allow?.disabled).toBe(true);
});
