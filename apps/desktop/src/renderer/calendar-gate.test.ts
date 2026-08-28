import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CalendarGate,
  type CalendarGateConnection,
  type CalendarGateControl,
} from "./calendar-gate";

function render(control: Partial<CalendarGateControl>): string {
  return renderToStaticMarkup(
    createElement(CalendarGate, {
      control: {
        connections: [],
        onSkip: () => undefined,
        onDone: () => undefined,
        ...control,
      },
      onQuit: () => undefined,
    }),
  );
}

const stillSource = { connecting: false, onConnect: () => undefined };

function connection(overrides: Partial<CalendarGateConnection>): CalendarGateConnection {
  return {
    id: "person@example.com",
    name: "person@example.com",
    account: { id: "person@example.com", selectedCalendarIds: ["work"] },
    calendars: [
      { id: "work", label: "Work" },
      { id: "family", label: "Family" },
    ],
    onToggle: () => undefined,
    ...overrides,
  };
}

test("unconnected, the gate offers exactly the sources the build can", () => {
  // React escapes the apostrophe in "Mac's", so the label is matched around it.
  const both = render({ apple: stillSource, google: stillSource });
  assert.match(both, /Use this Mac/);
  assert.match(both, /Connect Google Calendar/);
  assert.doesNotMatch(both, />Done</);

  const appleOnly = render({ apple: stillSource });
  assert.match(appleOnly, /Use this Mac/);
  assert.doesNotMatch(appleOnly, /Connect Google Calendar/);

  const googleOnly = render({ google: stillSource });
  assert.doesNotMatch(googleOnly, /Use this Mac/);
  assert.match(googleOnly, /Connect Google Calendar/);
});

test("the gate says what connecting buys and what it will never read", () => {
  const markup = render({ apple: stillSource });
  assert.match(markup, /Quiet during meetings/);
  assert.match(markup, /never titles or attendees/);
});

test("connected, the gate reviews the calendars and offers Done", () => {
  const markup = render({ apple: stillSource, google: stillSource, connections: [connection({})] });
  assert.match(markup, /person@example\.com/);
  assert.match(markup, /Work/);
  assert.match(markup, /Family/);
  // The chosen calendar is checked; the unchosen one is offered unchecked.
  assert.match(markup, /checked/);
  assert.match(markup, /calendar-gate-done[^>]*>Done/);
  // Another connection stays offered, and the Google button says it is adding.
  assert.match(markup, /Use this Mac/);
  assert.match(markup, /Add another Google account/);
});

test("a connection whose calendars have not been read yet says so", () => {
  const markup = render({ google: stillSource, connections: [connection({ calendars: [] })] });
  assert.match(markup, /Reading its calendars/);
});

test("a connect under way holds the buttons and the checkboxes, never the quit", () => {
  const markup = render({
    apple: { ...stillSource, connecting: true },
    google: stillSource,
    connections: [connection({})],
  });
  // Two sources, Done, and both checkboxes; the quit stays live.
  const disabled = markup.match(/disabled=""/g) ?? [];
  assert.equal(disabled.length, 5);
  assert.doesNotMatch(markup, /sign-in-quit[^>]*disabled/);
});

test("the skip stands only while the question does; connected, Done is the answer", () => {
  const asking = render({ google: stillSource });
  assert.match(asking, /calendar-gate-skip[^>]*>Set up later/);
  assert.match(asking, /sign-in-quit[^>]*>Quit Luke/);

  const reviewing = render({ google: stillSource, connections: [connection({})] });
  assert.doesNotMatch(reviewing, /Set up later/);
  assert.match(reviewing, /sign-in-quit[^>]*>Quit Luke/);
});
