import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { settingsView } from "@sidecar/settings/testing";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { connectionInput, connectionVisibility } from "#testing/connection-fixtures";
import { SETTINGS_VIEW } from "../settings-views";
import { CONFIRM_STAGE } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";
import { ConnectionRow } from "./connection-row";
import {
  CONNECTION_LAYOUT,
  CONNECTION_SCHEMA,
  CONNECTION_SECTION,
  type ConnectionSpec,
} from "./connection-schema";

function swap(stage: (typeof CONFIRM_STAGE)[keyof typeof CONFIRM_STAGE] | undefined): string {
  const asking = stage
    ? {
        confirm: {
          question: "Delete the Acme API key?",
          stage,
          verb: "Delete",
          running: "Deleting…",
          onKeep: () => undefined,
          onAct: () => undefined,
        },
      }
    : undefined;
  return renderToStaticMarkup(
    createElement(ConfirmSwap, {
      ...asking,
      // biome-ignore lint/correctness/noChildrenProp: a colocated test runs as `.ts` and cannot write JSX, and `createElement`'s third argument does not satisfy a required `children` prop
      children: createElement("button", { type: "button" }, "Connect"),
    }),
  );
}

test("an answer already sent says what it is doing and takes no second press", () => {
  const acting = swap(CONFIRM_STAGE.ACTING);
  // Both answers go disabled: an answer already given is nobody's to withdraw.
  assert.equal(acting.match(/disabled=""/g)?.length, 2);
});

test("a row whose build cannot offer the connection draws nothing at all", () => {
  const spec = CONNECTION_SCHEMA.find((entry) => entry.id === CREDENTIAL_PROVIDER_ID.LINEAR);
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
