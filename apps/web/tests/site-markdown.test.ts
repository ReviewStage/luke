import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { drawnBySite } from "../scripts/site-markdown";

/**
 * site-markdown.test.ts -- the site's Markdown documents drawn as the build
 * draws them, through `scripts/site-markdown.ts`'s own server: a changelog's releases, each with
 * its HTML, headline, summary, and first screenshot, and a policy cut at its
 * headings. A release's screenshot is served from the site's root and links
 * out to its file, a link to a file beside the changelog reads as that file
 * on GitHub, and the documents' own HTML (a chord's keys) is kept. The
 * drawings are held in `site-markdown.golden.json`, which
 * `LUKE_UPDATE_FIXTURES=1` writes. Synthetic words.
 */

/** Records the drawings instead of asserting them. `check.sh` never sets it. */
const UPDATE_FIXTURES = process.env.LUKE_UPDATE_FIXTURES === "1";

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "site-markdown.golden.json");

const CHANGELOG = [
  "# Changelog",
  "",
  "## 1.1.0 — 2026-10-13",
  "",
  "### The Call tab",
  "",
  "Calls read as **one thread**, with `code` and a [link](https://example.com).",
  "",
  "![The Call tab.](apps/web/public/changelog/1.1.0/the-call-tab.png)",
  "",
  "Hold <kbd>⌥</kbd><kbd>S</kbd> to speak, and read the [Privacy](PRIVACY.md) file.",
  "",
  "### Fixes",
  "",
  "- Fixed a thing in [#42](https://github.com/acme/acme/pull/42)",
  "  - and a nested one",
  "",
  "## 1.0.0 — 2026-10-01",
  "",
  "### Misc",
  "",
  "- Updated the *words*",
  "",
].join("\n");

const PRIVACY = [
  "# Privacy",
  "",
  "Acme keeps what you say for **thirty days**.",
  "",
  "## What we collect",
  "",
  "1. Your words",
  "2. Your plans, with `code`",
  "",
  "## Who sees it",
  "",
  "Nobody but you. See [the policy](/privacy).",
  "",
].join("\n");

test("the site's documents draw exactly as recorded", async () => {
  const drawings = await drawnBySite((site) => ({
    releases: site.parseReleases(CHANGELOG),
    policy: site.policyOf(PRIVACY),
  }));
  const recorded = `${JSON.stringify(drawings, undefined, 2)}\n`;
  if (UPDATE_FIXTURES) {
    await fs.writeFile(GOLDEN, recorded);
    return;
  }
  assert.equal(recorded, await fs.readFile(GOLDEN, "utf8"));
});
