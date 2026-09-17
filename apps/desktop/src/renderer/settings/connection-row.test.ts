import assert from "node:assert/strict";
import { GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { settingsView } from "@sidecar/settings/testing";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { connectionInput, connectionVisibility } from "#testing/connection-fixtures";
import { SETTINGS_VIEW } from "../settings-views";
import { ConnectionRow } from "./connection-row";
import {
  CONNECTION_LAYOUT,
  CONNECTION_SCHEMA,
  CONNECTION_SECTION,
  type ConnectionSpec,
} from "./connection-schema";

test("a row whose build cannot offer the connection draws nothing at all", () => {
  const spec = CONNECTION_SCHEMA.find((entry) => entry.id === GOOGLE_CALENDAR_ID);
  assert.ok(spec);
  const markup = renderToStaticMarkup(
    createElement(ConnectionRow, {
      spec,
      input: connectionInput({
        visibility: connectionVisibility({ settings: settingsView() }),
      }),
    }),
  );
  assert.equal(markup, "", "a row whose one action cannot run is not a row");
});

test("what a row draws under its line is told when an answer of its own is running", () => {
  // A checkbox pressed while its account's disconnect is in flight would write
  // to a grant already leaving, so the body has to be able to still itself.
  const told: boolean[] = [];
  const spec: ConnectionSpec = {
    id: "example",
    layout: CONNECTION_LAYOUT.BLOCK,
    page: SETTINGS_VIEW.CONNECTIONS,
    section: CONNECTION_SECTION.INTEGRATIONS,
    order: 1,
    offered: () => true,
    name: () => "Example",
    status: () => ({ connected: true }),
    actions: () => [],
    body: (_input, settling) => {
      told.push(settling);
      return null;
    },
    haystack: [],
  };
  renderToStaticMarkup(createElement(ConnectionRow, { spec, input: connectionInput() }));
  assert.deepEqual(told, [false], "nothing asked, nothing running");
});
