import assert from "node:assert/strict";
import test from "node:test";
import { APPLE_CALENDAR_ID, GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  HOSTED_AGENT_ID,
  ISSUE_TRACKER_ID,
  PROVIDER_ID,
  SESSION_APPLICATION_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "@sidecar/session";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type MarkId, ProviderMark } from "./provider-marks.js";

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
    assert.notEqual(markup, UNKNOWN_MARK, `${providerId} falls through to the unknown mark`);
  }
});

test("local Conductor creation wears the cloud provider's own mark", () => {
  assert.equal(mark(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID), mark(PROVIDER_ID.CONDUCTOR));
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
  }
});
