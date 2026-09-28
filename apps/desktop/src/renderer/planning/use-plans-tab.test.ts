// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import {
  IDLE_PLANNING_VIEW,
  PLANNING_READ,
  type PlanningView,
} from "@sidecar/hosted/planning-view";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, type ActKind, type ActResultFor } from "#shared/messages/acts";
import { RUN_PROFILE } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { PLANS_PAGE } from "./planning-model";
import { type PlansControl, usePlansTab } from "./use-plans-tab";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4",
  },
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const OPEN: PlanningView = {
  plans: [],
  listStatus: PLANNING_READ.READY,
  activePlanId: PLAN.id,
  document: { status: PLANNING_READ.READY, plan: PLAN },
};

interface Standing {
  shown: boolean;
  planning: PlanningView;
  profile: string;
  fixtureMode: boolean;
}

/** Mounts the hook alone over what the panel would hand it, keeping every act it told, in order. */
function mount(initial: Partial<Standing> = {}) {
  const told: ActKind[] = [];
  let control: PlansControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  let standing: Standing = {
    shown: false,
    planning: IDLE_PLANNING_VIEW,
    profile: RUN_PROFILE.IDLE,
    fixtureMode: false,
    ...initial,
  };
  function Probe() {
    const [held, setHeld] = useState(standing);
    const [composing, setComposing] = useState(false);
    restand = setHeld;
    control = usePlansTab({
      acts: {
        // Nothing answers in this test: an asked act is recorded and refused.
        act: <Kind extends ActKind>(
          kind: Kind,
          ..._args: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          told.push(kind);
          return Promise.reject(new Error("Not answered in this test."));
        },
        tell: (kind: ActKind, ..._args: unknown[]) => {
          told.push(kind);
        },
      },
      planning: held.planning,
      run: { fixtureMode: held.fixtureMode, profile: held.profile },
      signedIn: true,
      voiceAvailable: true,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: held.shown,
      composing,
      onComposingChange: setComposing,
      voice: { view: IDLE_VOICE_VIEW, listening: false, requestMicrophoneAccess: () => undefined },
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    createRoot(container).render(createElement(Probe));
  });
  return {
    told,
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: (patch: Partial<Standing>) => {
      standing = { ...standing, ...patch };
      act(() => restand?.(standing));
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the tab showing follows the plans and the tab going away pauses the follow, leaving the open plan alone", () => {
  const tab = mount({ planning: OPEN });
  assert.deepEqual(tab.told, []);

  tab.stand({ shown: true });
  tab.stand({ shown: true });
  tab.stand({ shown: false });

  assert.deepEqual(tab.told, [ACT_KIND.PLANNING_REFRESH, ACT_KIND.PLANNING_PAUSE]);
  assert.equal(tab.control().page, PLANS_PAGE.DOCUMENT);
});

test("stepping back leaves an open plan, closes the form to the list, and has nothing to do on the list", () => {
  const tab = mount({ shown: true, planning: OPEN });

  act(() => {
    assert.equal(tab.control().back(), true);
  });
  assert.equal(tab.told.at(-1), ACT_KIND.PLANNING_CLOSE);

  tab.stand({ planning: IDLE_PLANNING_VIEW });
  act(() => tab.control().onNewPlan());
  assert.equal(tab.control().page, PLANS_PAGE.NEW);
  act(() => {
    assert.equal(tab.control().back(), true);
  });
  assert.equal(tab.control().page, PLANS_PAGE.LIST);
  act(() => {
    assert.equal(tab.control().back(), false);
  });
  assert.equal(tab.told.filter((kind) => kind === ACT_KIND.PLANNING_CLOSE).length, 1);
});

test("the microphone asks for the open plan's call, and the planning profile's fixture reads and leaves nothing", () => {
  const live = mount({ shown: true, planning: OPEN });
  act(() => live.control().microphone.onPress());
  assert.equal(live.told.at(-1), ACT_KIND.PLANNING_TALK);

  const fixture = mount({ shown: true, fixtureMode: true, profile: RUN_PROFILE.PLANNING });
  assert.equal(fixture.control().page, PLANS_PAGE.DOCUMENT);
  act(() => {
    fixture.control().back();
  });
  assert.deepEqual(fixture.told, []);
});
