// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { type NavigationHistory, useWindowHistory, type WindowHistory } from "./navigation-history";
import { PANEL_TAB } from "./panel-tabs";
import { PLANS_PAGE } from "./planning/planning-model";
import type { PlansControl } from "./planning/use-plans-tab";
import { SETTINGS_VIEW } from "./settings-views";

const PLAN_ID = "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

afterEach(() => {
  document.body.innerHTML = "";
});

/** The window's history over the Plans tab as `plans` stands, restood by the returned setter. */
function mount(initial: PlansControl) {
  let history: WindowHistory | undefined;
  let restand: ((plans: PlansControl) => void) | undefined;
  function Probe() {
    const [plans, setPlans] = useState(initial);
    restand = setPlans;
    history = useWindowHistory({
      known: true,
      tab: PANEL_TAB.PLANS,
      onTabChange: () => undefined,
      settingsView: SETTINGS_VIEW.ACCOUNT,
      onSettingsViewChange: () => undefined,
      plans,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  act(() => createRoot(container).render(createElement(Probe)));
  return {
    history: () => {
      assert.ok(history);
      return history;
    },
    stand: (plans: PlansControl) => act(() => restand?.(plans)),
  };
}

test("a launch that reopens the plan last open leaves nothing behind it to go back to", () => {
  const window = mount(plansControl({ restoring: true }));
  window.stand(
    plansControl({ page: PLANS_PAGE.DOCUMENT, activePlanId: PLAN_ID, boundFor: PLAN_ID }),
  );
  assert.equal(window.history().canGoBack, false);
});

test("leaving a plan for the home page is a step Back returns from", () => {
  const window = mount(
    plansControl({ page: PLANS_PAGE.DOCUMENT, activePlanId: PLAN_ID, boundFor: PLAN_ID }),
  );
  window.stand(plansControl());
  assert.equal(window.history().canGoBack, true);
});

/*
 * The window's history over the Automations page: each automation read is
 * a step of its own, and one deleted in the window is passed over, so Back
 * from the list it left goes to where the window stood before it rather
 * than to a page that can no longer show it. Synthetic ids throughout.
 */

const PLAN = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "workspace-1",
  name: "Usage-based billing",
  createdAt: 0,
  updatedAt: 0,
  repository: "acme/ledger",
};
const AUTOMATION = "40000000-0000-4000-8000-000000000001";

/** Where the Automations page stands, as the window holds it. */
interface Page {
  readonly open: boolean;
  readonly chosen: string | undefined;
}

/** The presses that move the window, as the page and its rows make them. */
interface Presses {
  readonly open: () => void;
  readonly choose: (chosen: string | undefined) => void;
  readonly deleted: (id: string) => void;
}

let root: Root | undefined;
let windowHistory: NavigationHistory | undefined;
let page: Page = { open: false, chosen: undefined };
let presses: Presses;

/** The window bound for one plan, with an Automations page over it and the history over both. */
function Window(): null {
  const [held, setHeld] = useState<Page>({ open: false, chosen: undefined });
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  page = held;
  presses = {
    open: () => setHeld({ open: true, chosen: undefined }),
    choose: (chosen) => setHeld((before) => ({ ...before, chosen })),
    deleted: (id) => {
      setDeleted((before) => new Set([...before, id]));
      setHeld((before) => ({ ...before, chosen: undefined }));
    },
  };
  windowHistory = useWindowHistory({
    known: true,
    tab: PANEL_TAB.PLANS,
    onTabChange: () => undefined,
    settingsView: SETTINGS_VIEW.ACCOUNT,
    onSettingsViewChange: () => undefined,
    plans: plansControl({
      plans: [PLAN],
      activePlanId: PLAN.id,
      automationsView: {
        open: held.open,
        chosen: held.chosen,
        plan: undefined,
        onOpen: () => presses.open(),
        onClose: () => setHeld({ open: false, chosen: undefined }),
        onChoose: (chosen) => presses.choose(chosen),
        deleted,
        onDeleted: (id) => presses.deleted(id),
      },
    }),
  });
  return null;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  windowHistory = undefined;
  document.body.innerHTML = "";
});

test("Back from the list an automation was deleted from passes over that automation to where the window stood before", async () => {
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(createElement(Window)));
  await act(async () => presses.open());
  await act(async () => presses.choose(AUTOMATION));
  await act(async () => presses.deleted(AUTOMATION));

  await act(async () => windowHistory?.onBack());

  assert.deepEqual(page, { open: false, chosen: undefined }, "Back left the page for the plan");
});

test("Back from the list goes to an automation read before it while it stands", async () => {
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(createElement(Window)));
  await act(async () => presses.open());
  await act(async () => presses.choose(AUTOMATION));
  await act(async () => presses.choose(undefined));

  await act(async () => windowHistory?.onBack());

  assert.deepEqual(page, { open: true, chosen: AUTOMATION });
});
