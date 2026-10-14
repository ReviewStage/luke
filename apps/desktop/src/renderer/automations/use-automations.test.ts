// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@sidecar/hosted/automation-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result, Schema } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
import { useAutomations } from "./use-automations";

/**
 * The Automations list over a host whose list reads the test answers by
 * hand, in whatever order it likes: the list drawn is always the newest
 * read's, so a write that lands before the first read answers still shows
 * every automation, and a plan's read that answers after the list was
 * widened never narrows it again. Synthetic automations throughout.
 */

const PLAN_A = "10000000-0000-4000-8000-000000000001";
const PLAN_B = "10000000-0000-4000-8000-000000000002";

/** An automation by name, on a plan. */
function automation(name: string, planId: string, n: number): AutomationSummary {
  return {
    id: `40000000-0000-4000-8000-00000000000${n}`,
    planId,
    planName: "Usage-based billing",
    name,
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Check prod." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 0,
  };
}

const ALPHA = automation("Alpha", PLAN_A, 1);
const BETA = automation("Beta", PLAN_B, 2);
const GAMMA = automation("Gamma", PLAN_A, 3);

/** What a list read asks: one plan's automations, or every plan's. */
const listAsked = readEither(Schema.Struct({ planId: Schema.optionalKey(Schema.String) }));

/** A list read the host has not answered yet: the plan it asked for, and how to answer it. */
interface HeldRead {
  readonly planId: string | undefined;
  readonly answer: (automations: readonly AutomationSummary[]) => void;
}

let held: HeldRead[] = [];
let root: Root | undefined;
let registry = AtomRegistry.make();
let store: ReturnType<typeof useAutomations> | undefined;

/** The host: each list read held for the test to answer, and a make answered at once with `made`. */
function script(made: AutomationSummary): void {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: { kind: string; payload?: WireBoundaryInput }) => {
        const done = <Value>(value: Value) => ({ status: ACT_OUTCOME_STATUS.DONE, value });
        if (request.kind === ACT_KIND.AUTOMATIONS_CREATE) {
          return Promise.resolve(done({ automation: made }));
        }
        assert.equal(request.kind, ACT_KIND.AUTOMATIONS_LIST);
        const read = listAsked(unparsedWire(request.payload));
        assert.ok(Result.isSuccess(read), "a list read asks for a plan or for none");
        const { planId } = read.success;
        return new Promise((resolve) => {
          held.push({ planId, answer: (automations) => resolve(done({ automations })) });
        });
      },
    },
  });
}

/** The names the list draws, or what it says instead. */
function Listed({ plan }: { plan: string | undefined }): React.JSX.Element {
  store = useAutomations(plan);
  const { read } = store;
  if (read === undefined) return createElement("p", null, "unread");
  if ("failure" in read) return createElement("p", null, "failed");
  return createElement("p", null, read.automations.map((each) => each.name).join(", "));
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  store = undefined;
  held = [];
  registry = AtomRegistry.make();
  document.body.innerHTML = "";
});

/** The list drawn for `plan`, mounted or redrawn in place. */
async function draw(container: HTMLElement, plan: string | undefined): Promise<void> {
  root ??= createRoot(container);
  await act(async () => {
    root?.render(onRegistry(registry, createElement(Listed, { plan })));
  });
}

/** Answers the held read asked for `planId` with `automations`, the oldest first. */
async function answer(
  planId: string | undefined,
  automations: readonly AutomationSummary[],
): Promise<void> {
  const at = held.findIndex((each) => each.planId === planId);
  assert.ok(at >= 0, `no read held for ${planId ?? "every plan"}`);
  const [read] = held.splice(at, 1);
  await act(async () => read?.answer(automations));
}

test("a make that lands before the first read answers still shows every automation, once the list is read again", async () => {
  script(GAMMA);
  const container = document.createElement("div");
  document.body.append(container);
  await draw(container, undefined);

  await act(async () => {
    await store?.create({
      planId: PLAN_A,
      name: GAMMA.name,
      trigger: GAMMA.trigger,
      action: GAMMA.action,
      webhookSecret: "x".repeat(32),
    });
  });
  await answer(undefined, [ALPHA, BETA]);
  await answer(undefined, [GAMMA, ALPHA, BETA]);

  assert.equal(container.textContent, "Gamma, Alpha, Beta");
});

test("a plan's read that answers after the list was widened never narrows it again", async () => {
  script(GAMMA);
  const container = document.createElement("div");
  document.body.append(container);
  await draw(container, PLAN_A);
  await draw(container, undefined);

  await answer(undefined, [ALPHA, BETA]);
  await answer(PLAN_A, [ALPHA]);

  assert.equal(container.textContent, "Alpha, Beta");
});

test("a list narrowed to another plan starts unread rather than showing the last plan's", async () => {
  script(GAMMA);
  const container = document.createElement("div");
  document.body.append(container);
  await draw(container, PLAN_A);
  await answer(PLAN_A, [ALPHA]);
  assert.equal(container.textContent, "Alpha");

  await draw(container, PLAN_B);

  assert.equal(container.textContent, "unread");
});
