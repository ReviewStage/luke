// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "#shared/messages/acts";
import { IntegrationsSection } from "./integrations-page";

/**
 * Settings › Integrations through the bridge the host answers, Linear standing
 * for every provider: where the connection stands as drawn, Connect sending
 * the browser and reading again when the window comes back, and Disconnect
 * asking first. The service's
 * standing is the test's own variable, which a Connect leaves pending and the
 * browser's return settles.
 */

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

/** Where the account's connection stands at the service, as the test's bridge holds it. */
let standing: IntegrationStatus = INTEGRATION_STATUS.DISCONNECTED;
/** Every act the row sent, in order. */
let sent: Act[] = [];
/** Whether the browser could be opened for a sign-in. */
let opens = true;
/** Whether the host answers a status read with no answer, the way an unreachable service reads. */
let readFails = false;
/** Where a Connect waits before the host answers it, when the test holds it. */
let connectHeld: Promise<void> | undefined;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the row's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.INTEGRATIONS_STATUS:
      if (readFails) return Promise.resolve(done({ failure: INTEGRATION_CALL_FAILURE.UNANSWERED }));
      return Promise.resolve(done({ integrations: { linear: standing } }));
    case ACT_KIND.INTEGRATIONS_CONNECT:
      assert.deepEqual(request.payload, LINEAR);
      if (!opens) return Promise.resolve(done({ failure: INTEGRATION_CALL_FAILURE.NOT_OPENED }));
      return (connectHeld ?? Promise.resolve()).then(() => done({ opened: true }));
    case ACT_KIND.INTEGRATIONS_DISCONNECT:
      assert.deepEqual(request.payload, LINEAR);
      standing = INTEGRATION_STATUS.DISCONNECTED;
      return Promise.resolve(done({ status: standing }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  standing = INTEGRATION_STATUS.DISCONNECTED;
  sent = [];
  opens = true;
  connectHeld = undefined;
  readFails = false;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

async function mount(signedIn = true): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(IntegrationsSection, { signedIn })));
  await settle();
  return container;
}

const line = (row: HTMLElement) => row.querySelector("small")?.textContent;

function button(row: HTMLElement, label: string): HTMLButtonElement {
  return (
    [...row.querySelectorAll<HTMLButtonElement>("button")].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`no ${label} button`)
  );
}

test("a disconnected account is offered Connect, which sends the browser and reads the sign-in's outcome when the window comes back", async () => {
  const row = await mount();
  assert.equal(line(row), "Read and update issues, projects, and documents.");

  act(() => button(row, "Connect").click());
  await settle();
  assert.equal(line(row), "Finish signing in to Linear in your browser.");

  // The browser's sign-in completed while the window was away.
  standing = INTEGRATION_STATUS.CONNECTED;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  assert.equal(line(row), "Read and update issues, projects, and documents.");
  assert.ok(button(row, "Disconnect"));
  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.INTEGRATIONS_STATUS, ACT_KIND.INTEGRATIONS_CONNECT, ACT_KIND.INTEGRATIONS_STATUS],
  );
});

test("a sign-in found expired while Connect was answering stays expired once the browser is sent", async () => {
  standing = INTEGRATION_STATUS.PENDING;
  const row = await mount();
  let release: (() => void) | undefined;
  connectHeld = new Promise<void>((resolve) => {
    release = resolve;
  });

  act(() => button(row, "Connect again").click());
  await settle();
  // The window is focused before the host answers, and the read finds the sign-in expired.
  standing = INTEGRATION_STATUS.EXPIRED;
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await settle();
  release?.();
  await settle();
  assert.match(line(row) ?? "", /expired/);
});

test("Disconnect asks first, and only the answer to the question disconnects", async () => {
  standing = INTEGRATION_STATUS.CONNECTED;
  const row = await mount();

  act(() => button(row, "Disconnect").click());
  await settle();
  assert.ok(!sent.some((request) => request.kind === ACT_KIND.INTEGRATIONS_DISCONNECT));
  const question =
    row.querySelector<HTMLFieldSetElement>('fieldset[data-drawn="true"]') ??
    assert.fail("no question asked");
  const name = document.getElementById(question.getAttribute("aria-labelledby") ?? "");
  assert.match(name?.textContent ?? "", /^Disconnect Linear\?/);

  act(() => button(question, "Disconnect").click());
  await settle();
  assert.equal(standing, INTEGRATION_STATUS.DISCONNECTED);
  assert.ok(button(row, "Connect"));
});

test("a browser that could not be opened says so under the row, and the account stays as it was", async () => {
  opens = false;
  const row = await mount();

  act(() => button(row, "Connect").click());
  await settle();
  assert.equal(
    row.querySelector('[role="alert"]')?.textContent,
    "Luke could not open your browser to sign in.",
  );
  assert.ok(button(row, "Connect"));
});

test("a read that failed still draws every row a search can land on, and reading again offers its action", async () => {
  readFails = true;
  const page = await mount();
  assert.ok(page.querySelector('[data-search-anchor="linear"]'), "Linear's row stands");
  assert.equal(
    page.querySelector('[role="alert"]')?.textContent,
    "Your integrations could not be read.",
  );
  assert.ok(![...page.querySelectorAll("button")].some((each) => each.textContent === "Connect"));

  readFails = false;
  act(() => button(page, "Retry").click());
  await settle();
  assert.equal(page.querySelector('[role="alert"]'), null);
  assert.ok(button(page, "Connect"));
});

test("signed out, the page asks for a sign-in and asks the host nothing", async () => {
  const page = await mount(false);
  assert.equal(
    page.querySelector(".settings-note")?.textContent,
    "Sign in to connect integrations.",
  );
  assert.deepEqual(sent, []);
});

test("an expired sign-in and a service with no Linear each say so, and only the first offers to connect", async () => {
  standing = INTEGRATION_STATUS.EXPIRED;
  const expired = await mount();
  assert.match(line(expired) ?? "", /expired/);
  assert.ok(button(expired, "Connect again"));

  standing = INTEGRATION_STATUS.UNAVAILABLE;
  const unavailable = await mount();
  assert.match(unavailable.textContent ?? "", /Not available/);
  assert.equal(unavailable.querySelectorAll("button").length, 0);
});
