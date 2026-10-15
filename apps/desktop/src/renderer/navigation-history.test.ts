// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { SETTINGS_VIEW } from "@luke/settings/settings-views";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { useWindowHistory, type WindowHistory } from "./navigation-history";
import { PANEL_TAB } from "./panel-tabs";
import type { LeaveAsk, PlansControl } from "./planning/use-plans-tab";

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
      tab: PANEL_TAB.TASKS,
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
    plansControl({ page: TASKS_PAGE.DOCUMENT, activePlanId: PLAN_ID, boundFor: PLAN_ID }),
  );
  assert.equal(window.history().canGoBack, false);
});

test("leaving a plan for the home page is a step Back returns from", () => {
  const window = mount(
    plansControl({ page: TASKS_PAGE.DOCUMENT, activePlanId: PLAN_ID, boundFor: PLAN_ID }),
  );
  window.stand(plansControl());
  assert.equal(window.history().canGoBack, true);
});

test("a step back cancelled at the leave ask leaves the trail where the window stands, so the next step is the same step", () => {
  const asked: (() => void)[] = [];
  const ask: LeaveAsk = (leave) => asked.push(leave);
  let standing: LeaveAsk | undefined;
  const asking = (base: PlansControl): PlansControl => ({
    ...base,
    leaveGuard: {
      stand: () => () => undefined,
      pass: (leave) => leave(),
      guard:
        (leave) =>
        (...args) => {
          if (standing === undefined) leave(...args);
          else standing(() => leave(...args));
        },
    },
  });
  const homes: string[] = [];
  const atPlan = asking(
    plansControl({
      page: TASKS_PAGE.DOCUMENT,
      activePlanId: PLAN_ID,
      boundFor: PLAN_ID,
      onLeavePlan: () => homes.push("home"),
    }),
  );
  const window = mount(asking(plansControl()));
  window.stand(atPlan);
  assert.equal(window.history().canGoBack, true);

  standing = ask;
  act(() => window.history().onBack());
  assert.deepEqual(homes, [], "the step waits on the ask");
  assert.equal(window.history().canGoBack, true, "and the trail has not moved");
  assert.equal(window.history().canGoForward, false);

  act(() => asked[0]?.());
  assert.deepEqual(homes, ["home"], "Leave takes the step it asked about");
});

test("a person's page is a step of its own, which Back from a plan opened after it returns to, and another person's is another step", () => {
  const reopened: string[] = [];
  // Every control the window stands on opens a person's page the same way, recorded.
  const standing = (userId: string | undefined, rest: Partial<PlansControl> = {}) =>
    plansControl({
      ...rest,
      personView: {
        userId,
        name: undefined,
        workspaceId: undefined,
        onOpen: (id) => reopened.push(id),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("user-charles"));
  window.stand(standing("user-maya"));
  window.stand(
    standing(undefined, { page: TASKS_PAGE.DOCUMENT, activePlanId: PLAN_ID, boundFor: PLAN_ID }),
  );

  act(() => window.history().onBack());
  window.stand(standing("user-maya"));
  act(() => window.history().onBack());

  assert.deepEqual(reopened, ["user-maya", "user-charles"]);
});

test("a person's page is theirs in the workspace it stood in, so once another is listed Back passes over it", () => {
  const reopened: string[] = [];
  const standing = (workspaceId: string, userId: string | undefined) =>
    plansControl({
      workspace: { id: workspaceId, name: workspaceId, role: WORKSPACE_ROLE.MEMBER, github: null },
      personView: {
        userId,
        name: undefined,
        workspaceId: undefined,
        onOpen: (id) => reopened.push(id),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("workspace-acme", undefined));
  window.stand(standing("workspace-acme", "user-charles"));
  window.stand(standing("workspace-platform", undefined));

  act(() => window.history().onBack());

  assert.deepEqual(reopened, []);
});

test("a person's page opened again with a newer name keeps that name in its step, which Back opens it with", () => {
  const reopened: (string | undefined)[] = [];
  const standing = (userId: string | undefined, name?: string, rest: Partial<PlansControl> = {}) =>
    plansControl({
      ...rest,
      personView: {
        userId,
        name,
        workspaceId: undefined,
        onOpen: (_id, opened) => reopened.push(opened),
        onClose: () => undefined,
      },
    });
  const window = mount(standing("user-lee", "Lee Park"));
  window.stand(standing("user-lee", "Lee Chen"));
  window.stand(
    standing(undefined, undefined, {
      page: TASKS_PAGE.DOCUMENT,
      activePlanId: PLAN_ID,
      boundFor: PLAN_ID,
    }),
  );

  act(() => window.history().onBack());

  assert.deepEqual(reopened, ["Lee Chen"]);
});
