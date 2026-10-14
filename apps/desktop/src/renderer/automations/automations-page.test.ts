// @vitest-environment jsdom

import assert from "node:assert/strict";
import { automationCreateParamsSchema } from "@sidecar/hosted/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@sidecar/hosted/automation-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { onRegistry } from "#testing/copy-feedback";
import { plansControl } from "#testing/plans-control";
import { AutomationsPage } from "./automations-page";

/**
 * The Automations page over a scripted host: it lists what the host
 * answers, a switch asks the host to turn that automation off, a new
 * webhook automation names a secret minted in the window in its write and
 * shows that very secret once with the address the service answered, and
 * with none made it offers templates that open the editor filled in.
 * Synthetic plans and words throughout.
 */

const PLAN = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: "workspace-1",
  name: "Usage-based billing",
  createdAt: 0,
  updatedAt: 0,
  repository: "acme/ledger",
};

const SCHEDULED: AutomationSummary = {
  id: "40000000-0000-4000-8000-000000000001",
  planId: PLAN.id,
  planName: PLAN.name,
  name: "Nightly flaky-test sweep",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * 1-5", timezone: "UTC" },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the flakiest test." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: Date.parse("2026-10-15T02:00:00Z"),
  lastRun: null,
  createdAt: 0,
};

/** Every act the page asked, kind and payload, in order. */
let asked: { readonly kind: string; readonly payload: WireBoundaryInput }[] = [];
let root: Root | undefined;

/** The host as a script: the list it holds, and each write answered with the automation it made or changed. */
function script(automations: readonly AutomationSummary[]) {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: { kind: string; payload?: WireBoundaryInput }) => {
        asked.push({ kind: request.kind, payload: request.payload });
        const value = (() => {
          switch (request.kind) {
            case ACT_KIND.AUTOMATIONS_LIST:
              return { automations };
            case ACT_KIND.AUTOMATIONS_CHANGE:
              return { automation: { ...SCHEDULED, enabled: false } };
            case ACT_KIND.AUTOMATIONS_CREATE:
              return {
                automation: {
                  ...SCHEDULED,
                  id: "40000000-0000-4000-8000-000000000002",
                  trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
                  nextRunAt: null,
                  webhookUrl:
                    "https://luke.test/api/automations/40000000-0000-4000-8000-000000000002/webhook",
                },
              };
            case ACT_KIND.AUTOMATIONS_RUNS:
              return { runs: [] };
            default:
              return undefined;
          }
        })();
        return Promise.resolve(
          value === undefined
            ? { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not scripted." }
            : { status: ACT_OUTCOME_STATUS.DONE, value },
        );
      },
    },
  });
}

beforeEach(() => {
  asked = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The page mounted over the scripted host, the list read. */
async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const plans = plansControl({
    plans: [PLAN],
    automationsView: {
      open: true,
      chosen: undefined,
      plan: undefined,
      onOpen: () => undefined,
      onClose: () => undefined,
      onChoose: () => undefined,
    },
  });
  await act(async () => {
    root?.render(onRegistry(AtomRegistry.make(), createElement(AutomationsPage, { plans })));
  });
  return container;
}

/** A button by its words, failing the test where none stands. */
function button(scope: ParentNode, words: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (each) => each.textContent?.trim() === words,
  );
  assert.ok(found, `no button "${words}"`);
  return found;
}

/** Sets a field's value as typing would. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

test("lists the automations the host answers, and a switch asks the host to turn one off", async () => {
  script([SCHEDULED]);
  const page = await mount();

  assert.match(page.textContent ?? "", /Nightly flaky-test sweep/u);
  assert.match(page.textContent ?? "", /Weekdays at 2:00 · UTC/u);
  const toggle = page.querySelector<HTMLButtonElement>('[role="switch"]');
  assert.ok(toggle);
  await act(async () => toggle.click());

  assert.deepEqual(asked.find((each) => each.kind === ACT_KIND.AUTOMATIONS_CHANGE)?.payload, {
    automationId: SCHEDULED.id,
    change: { enabled: false },
  });
  assert.equal(page.querySelector('[role="switch"]')?.getAttribute("aria-checked"), "false");
});

test("a new webhook automation names a secret minted in the window and shows that very secret once, with the address the service answered", async () => {
  script([SCHEDULED]);
  const page = await mount();
  await act(async () => button(page, "New automation").click());
  const dialog = document.querySelector<HTMLElement>(".automation-dialog");
  assert.ok(dialog);

  const name = dialog.querySelector<HTMLInputElement>('[aria-label="Automation name"]');
  const task = dialog.querySelector<HTMLTextAreaElement>('[aria-label="Task"]');
  assert.ok(name && task);
  await act(async () => {
    type(name, "Smoke test");
    button(dialog, "Webhook").click();
  });
  await act(async () => type(task, "Check prod."));
  await act(async () => button(dialog, "Create automation").click());

  const create = asked.find((each) => each.kind === ACT_KIND.AUTOMATIONS_CREATE);
  const read = readEither(automationCreateParamsSchema)(unparsedWire(create?.payload));
  assert.ok(Result.isSuccess(read), "the write is a make's own payload");
  const sent = read.success;
  assert.deepEqual(sent.trigger, { kind: AUTOMATION_TRIGGER.WEBHOOK });
  assert.ok((sent.webhookSecret ?? "").length >= 32, "a secret of real length is minted");
  const shown = [...document.querySelectorAll(".automation-secret")]
    .map((each) => each.textContent)
    .join(" ");
  assert.ok(shown.includes(sent.webhookSecret ?? "-"), "the secret shown is the one sent");
  assert.ok(
    shown.includes(
      "https://luke.test/api/automations/40000000-0000-4000-8000-000000000002/webhook",
    ),
  );
});

test("with none made, a template opens the editor filled in", async () => {
  script([]);
  const page = await mount();

  const template = [...page.querySelectorAll<HTMLButtonElement>(".automation-template")].find(
    (each) => each.querySelector("strong")?.textContent === "Fix failing CI on main",
  );
  assert.ok(template, "the template is offered");
  await act(async () => template.click());

  const name = document.querySelector<HTMLInputElement>(
    '.automation-dialog [aria-label="Automation name"]',
  );
  assert.equal(name?.value, "Fix failing CI on main");
  assert.equal(
    document.querySelector<HTMLInputElement>('.automation-dialog [aria-label="Branches"]')?.value,
    "main",
  );
});
