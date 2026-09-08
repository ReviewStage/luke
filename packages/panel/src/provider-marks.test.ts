import assert from "node:assert/strict";
import test from "node:test";
import { APPLE_CALENDAR_ID, GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { ISSUE_TRACKER_ID } from "@sidecar/issues";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  HOSTED_AGENT_ID,
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AudioBadge, CloudBadge, type MarkId, ProviderMark } from "./provider-marks.js";

/**
 * Every id the registry is required to draw a mark for. `MarkId` is the union
 * these constants make, so a member added to any of them without a mark fails
 * the registry's own `satisfies` — this list is what proves the drawn markup
 * follows.
 */
const MARK_IDS: readonly MarkId[] = [
  APPLE_CALENDAR_ID,
  GOOGLE_CALENDAR_ID,
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  CREDENTIAL_PROVIDER_ID.OPENAI,
  ...Object.values(PROVIDER_ID),
  ...Object.values(HOSTED_AGENT_ID),
  ...Object.values(SESSION_APPLICATION_ID),
  ...Object.values(ISSUE_TRACKER_ID),
];

function mark(providerId: string, className?: string): string {
  return renderToStaticMarkup(createElement(ProviderMark, { providerId, className }));
}

const UNKNOWN_MARK = mark("a-provider-luke-has-no-mark-for");

test("every id the registry covers draws its own mark", () => {
  for (const providerId of MARK_IDS) {
    const markup = mark(providerId);
    assert.match(markup, /^<svg /, `${providerId} draws no mark`);
    assert.match(markup, /data-mark="/, `${providerId} draws a mark that names no provider`);
    assert.notEqual(markup, UNKNOWN_MARK, `${providerId} falls through to the unknown mark`);
  }
});

test("a provider with no mark still gets a slot rather than nothing", () => {
  assert.match(UNKNOWN_MARK, /^<svg /);
  assert.match(UNKNOWN_MARK, /class="provider-mark"/);
  // The slot is drawn here rather than borrowed from a brand, so it names none.
  assert.doesNotMatch(UNKNOWN_MARK, /data-mark=/);
});

test("a mark keeps its own class and takes the caller's beside it", () => {
  assert.match(mark(PROVIDER_ID.CODEX), /class="provider-mark"/);
  assert.match(mark(PROVIDER_ID.CODEX, "wing-mark"), /class="provider-mark wing-mark"/);
});

test("local Conductor creation wears the cloud provider's own mark", () => {
  assert.equal(mark(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID), mark(PROVIDER_ID.CONDUCTOR));
});

test("marks fetch nothing: every glyph is path data in the document", () => {
  for (const providerId of [...MARK_IDS, "a-provider-luke-has-no-mark-for"]) {
    const markup = mark(providerId);
    assert.doesNotMatch(markup, /<image\b|xlink:href|url\(["']?https?:/i, providerId);
  }
});

test("a mark that paints with a gradient gets its own paint server per row", () => {
  // Two rows of the same provider render in one document; a shared gradient id
  // would leave the second row painting from the first row's definition.
  const gradientMarks = [PROVIDER_ID.CODEX, PROVIDER_ID.OMP, SUPERSET_WORKSPACE_PROVIDER_ID];
  for (const providerId of gradientMarks) {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(ProviderMark, { providerId, key: "first" }),
        createElement(ProviderMark, { providerId, key: "second" }),
      ),
    );
    const definitions = [...markup.matchAll(/<linearGradient id="([^"]+)"/g)].map(
      ([, id]) => id ?? "",
    );
    assert.equal(definitions.length, 2, providerId);
    assert.equal(new Set(definitions).size, 2, `${providerId} reuses one gradient id`);
    for (const id of definitions) {
      assert.ok(markup.includes(`fill="url(#${id})"`), `${providerId} paints from no ${id}`);
    }
  }
});

test("the badges that ride a mark say what they mean to a reader", () => {
  const cloud = renderToStaticMarkup(createElement(CloudBadge));
  assert.match(cloud, /aria-label="Runs in the cloud"/);
  assert.match(cloud, /class="cloud-badge"/);

  const audio = renderToStaticMarkup(createElement(AudioBadge));
  assert.match(audio, /aria-label="Realtime voice chat"/);
  assert.match(audio, /class="audio-badge"/);
});
