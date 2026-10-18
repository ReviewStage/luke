import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  CHANGELOG_VIEW,
  type ChangelogView,
  changelogRoutes,
  changelogViewForPath,
  parseReleases,
} from "../src/changelog-releases";

/** A release section, newest first as CHANGELOG.md lists them, numbered from the oldest at 1.0.0. */
function releaseSection(minor: number, body: string): string {
  return `## 1.${minor}.0 — 2026-09-${String(minor + 1).padStart(2, "0")}\n\n${body}\n`;
}

/** A changelog of `count` plain releases, 1.<count-1>.0 down to 1.0.0. */
function changelogOf(count: number): string {
  const sections = Array.from({ length: count }, (_, index) => count - 1 - index).map((minor) =>
    releaseSection(minor, `### Fixes\n\n- Fixed thing ${minor}\n`),
  );
  return `# Changelog\n\nIntro.\n\n${sections.join("\n")}`;
}

function versionsOf(view: ChangelogView | undefined): readonly string[] {
  assert.ok(view !== undefined && view.kind === CHANGELOG_VIEW.PAGE);
  return view.releases.map((release) => release.version);
}

test("twenty-three releases fill three pages of ten, newest first", () => {
  const releases = parseReleases(changelogOf(23));
  assert.deepEqual(versionsOf(changelogViewForPath(releases, "/changelog")), [
    "1.22.0",
    "1.21.0",
    "1.20.0",
    "1.19.0",
    "1.18.0",
    "1.17.0",
    "1.16.0",
    "1.15.0",
    "1.14.0",
    "1.13.0",
  ]);
  assert.equal(versionsOf(changelogViewForPath(releases, "/changelog/page/2"))[0], "1.12.0");
  assert.deepEqual(versionsOf(changelogViewForPath(releases, "/changelog/page/3")), [
    "1.2.0",
    "1.1.0",
    "1.0.0",
  ]);
  assert.equal(changelogViewForPath(releases, "/changelog/page/4"), undefined);
});

test("the first page lives at the changelog itself, not at page 1", () => {
  const releases = parseReleases(changelogOf(12));
  assert.equal(changelogViewForPath(releases, "/changelog/page/1"), undefined);
  assert.equal(versionsOf(changelogViewForPath(releases, "/changelog/"))[0], "1.11.0");
  assert.equal(versionsOf(changelogViewForPath(releases, "/changelog.html"))[0], "1.11.0");
  assert.equal(versionsOf(changelogViewForPath(releases, "/changelog/page/2.html"))[0], "1.1.0");
});

test("every release has its own address, which names its neighbours", () => {
  const releases = parseReleases(changelogOf(3));
  const middle = changelogViewForPath(releases, "/changelog/1.1.0");
  assert.ok(middle !== undefined && middle.kind === CHANGELOG_VIEW.RELEASE);
  assert.equal(middle.release.version, "1.1.0");
  assert.equal(middle.newer?.version, "1.2.0");
  assert.equal(middle.older?.version, "1.0.0");
  const newest = changelogViewForPath(releases, "/changelog/1.2.0");
  assert.ok(newest !== undefined && newest.kind === CHANGELOG_VIEW.RELEASE);
  assert.equal(newest.newer, undefined);
  assert.equal(changelogViewForPath(releases, "/changelog/9.9.9"), undefined);
});

test("the routes are every page and every release, each in a file of its own", () => {
  const routes = changelogRoutes(parseReleases(changelogOf(11)));
  assert.deepEqual(
    routes.map((route) => [route.path, route.file]),
    [
      ["/changelog", "changelog.html"],
      ["/changelog/page/2", "changelog/page/2.html"],
      ...Array.from({ length: 11 }, (_, index) => 10 - index).map((minor) => [
        `/changelog/1.${minor}.0`,
        `changelog/1.${minor}.0.html`,
      ]),
    ],
  );
});

test("a release's head names its first feature, opens on its first paragraph, and shares its first screenshot", () => {
  const markdown = `# Changelog\n\n${releaseSection(
    4,
    [
      "### The Call tab",
      "",
      "Each plan's calls read as one thread in the [Call](https://example.com) tab, with `code` kept as words.",
      "",
      "![The Call tab, full screen.](apps/web/public/changelog/1.4.0/the-call-tab.png)",
      "",
      "### Improvements",
      "",
      "- Something smaller",
    ].join("\n"),
  )}`;
  const route = changelogRoutes(parseReleases(markdown)).find(
    (candidate) => candidate.path === "/changelog/1.4.0",
  );
  assert.ok(route !== undefined);
  assert.equal(route.head.title, "Luke 1.4.0: The Call tab — Changelog");
  assert.equal(
    route.head.description,
    "Each plan's calls read as one thread in the Call tab, with code kept as words.",
  );
  assert.equal(route.head.url, "https://tryluke.dev/changelog/1.4.0");
  assert.deepEqual(route.head.image, {
    src: "/changelog/1.4.0/the-call-tab.png",
    alt: "The Call tab, full screen.",
  });
});

test("a release with only standing sections is titled by its version and opens on its first bullet", () => {
  const route = changelogRoutes(parseReleases(changelogOf(1))).find(
    (candidate) => candidate.path === "/changelog/1.0.0",
  );
  assert.ok(route !== undefined);
  assert.equal(route.head.title, "Luke 1.0.0 — Changelog");
  assert.equal(route.head.description, "Fixed thing 0");
  assert.equal(route.head.image, undefined);
});

test("a long first paragraph is cut at a word for the share card", () => {
  const words = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
  const [release] = parseReleases(`# Changelog\n\n${releaseSection(0, `### Big\n\n${words}`)}`);
  assert.ok(release !== undefined);
  const route = changelogRoutes([release])[1];
  assert.ok(route !== undefined);
  assert.ok(route.head.description.length <= 201);
  assert.ok(route.head.description.endsWith("…"));
  assert.ok(words.startsWith(route.head.description.slice(0, -1)));
});

test("a heading that is not a version and a date is refused", () => {
  assert.throws(
    () => parseReleases("# Changelog\n\n## Next release\n\nSoon.\n"),
    /release heading/,
  );
});

test("every route of the real changelog reads back, from its address, the view it was written with", () => {
  const markdown = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "CHANGELOG.md"),
    "utf8",
  );
  const releases = parseReleases(markdown);
  for (const route of changelogRoutes(releases)) {
    assert.deepEqual(changelogViewForPath(releases, route.path), route.view, route.path);
  }
});
