// @vitest-environment jsdom
import assert from "node:assert/strict";
import { FaceMark } from "@luke/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ForbiddenCard } from "../src/admin/chrome/gate-cards";

/** The admin gate's cards open with Luke's face, the one `@luke/ui` draws for the site's banner too. */

test("the forbidden card opens with the face mark from @luke/ui", () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(ForbiddenCard, { email: "someone@example.com", onSignOut: () => undefined }),
  );
  assert.ok(root.innerHTML.includes(renderToStaticMarkup(createElement(FaceMark))));
});
