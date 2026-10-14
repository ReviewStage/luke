// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { useWindowHistory, type WindowHistory } from "./navigation-history";
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
