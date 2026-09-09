import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { connectionInput, connectionVisibility } from "#testing/connection-fixtures";
import { settingsView } from "#testing/settings-fixtures";
import { CONFIRM_STAGE } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";
import { ConnectionRow } from "./connection-row";
import { CONNECTION_SCHEMA, type ConnectionInput } from "./connection-schema";

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

test("both layers are mounted, and they trade which one answers", () => {
  const resting = swap(CONFIRM_STAGE.RESTING);
  // Neither layer is mounted by the press: one arriving from nothing would
  // have no size to spring from, and the cell would re-shape as they traded.
  assert.match(resting, /credential-controls" data-drawn="true"/);
  assert.match(resting, /credential-confirm"/);
  assert.match(resting, /data-drawn="false"/);
  assert.match(resting, /Delete the Acme API key\?/);

  const asking = swap(CONFIRM_STAGE.ASKING);
  assert.match(asking, /credential-controls" data-drawn="false" aria-hidden="true" inert=""/);
  assert.match(asking, /credential-confirm"[^>]*data-drawn="true"/);
});

test("the safe answer arrives first and the one that cannot be taken back a beat behind", () => {
  const asking = swap(CONFIRM_STAGE.ASKING);
  assert.match(asking, /--answer-index:0[^>]*>Cancel/);
  assert.match(asking, /--answer-index:1/);
});

test("an answer already sent says what it is doing and takes no second press", () => {
  const acting = swap(CONFIRM_STAGE.ACTING);
  assert.match(acting, /Deleting…/);
  // Both answers go disabled: an answer already given is nobody's to withdraw.
  assert.equal(acting.match(/disabled=""/g)?.length, 2);
  // The confirm is still what the line is showing, so the answer stays on
  // screen saying what it is doing.
  assert.match(acting, /credential-confirm"[^>]*data-drawn="true"/);
});

test("a line with nothing to ask about draws its controls alone", () => {
  const plain = swap(undefined);
  assert.match(plain, /credential-controls" data-drawn="true"/);
  // An unaskable question still mounted would size the cell to a confirm that
  // could never be given.
  assert.doesNotMatch(plain, /credential-confirm/);
  assert.match(plain, />Connect</);
});

function row(id: string, overrides: Partial<ConnectionInput> = {}): string {
  const spec = CONNECTION_SCHEMA.find((entry) => entry.id === id);
  assert.ok(spec, id);
  return renderToStaticMarkup(
    createElement(ConnectionRow, { spec, input: connectionInput(overrides) }),
  );
}

test("a connected row wears the check, and offers the way back out behind a question", () => {
  const linear = row(CREDENTIAL_PROVIDER_ID.LINEAR);
  assert.match(linear, /data-search-anchor="linear"/);
  assert.match(linear, /credential-name">Linear</);
  assert.match(linear, /credential-remove/);
  assert.match(linear, /Disconnect Linear\?/);
  // Asking is the trash's own promise, said in the ellipsis.
  assert.match(linear, /title="Disconnect…"/);
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

test("a connection made somewhere else draws its words and no controls", () => {
  const codex = row("codex-cloud");
  assert.match(codex, /credential-name">Codex</);
  assert.match(codex, /credential-status/);
  assert.doesNotMatch(codex, /credential-actions/);
  assert.doesNotMatch(codex, /credential-confirm/);
});

test("what the latest pass reported is drawn as state rather than as an answer", () => {
  const google = row("google-calendar", {
    settings: settingsView({
      calendarSignInAvailable: true,
      calendarAccounts: [{ id: "person@example.com", selectedCalendarIds: [] }],
    }),
    calendar: {
      ...connectionInput().calendar,
      choices: [
        {
          accountId: "person@example.com",
          calendars: [],
          failure: "Google would not answer for this account.",
        },
      ],
    },
  });
  assert.match(google, /calendar-account-name">person@example\.com</);
  assert.match(google, /Google would not answer for this account\./);
  assert.doesNotMatch(google, /role="alert"/);
});
