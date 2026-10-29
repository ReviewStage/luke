// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { SubjectLine } from "../subject-line/subject-line.js";
import { MessageHead } from "./message-head.js";

/**
 * message-head.test.ts -- the line over a received message names who sent
 * it, then what they did, in that reading order.
 */

test("a received message's head names its sender, then what they did", () => {
  const page = new DOMParser().parseFromString(
    renderToStaticMarkup(
      createElement(MessageHead, {
        sender: "Ada",
        children: createElement(SubjectLine, { lead: "Thread answer" }, "Ship the invites?"),
      }),
    ),
    "text/html",
  );
  assert.equal(page.body.textContent, "AdaThread answer Ship the invites?");
});
