// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DocumentIcon } from "@sidecar/panel";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { FileTypeIcon } from "./file-type-icon";

test("until the file tree's bundle has loaded, a file wears a blank page, never the plan's own document glyph", () => {
  const drawn = renderToStaticMarkup(createElement(FileTypeIcon, { name: "src/invite.ts" }));
  assert.notEqual(drawn, renderToStaticMarkup(createElement(DocumentIcon)));
  assert.match(drawn, /^<svg[^>]*lucide-file\b/u, "lucide's blank page");
});
