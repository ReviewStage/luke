// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { plansControl } from "#testing/plans-control";
import { NewPlanForm } from "./new-plan-form";

/**
 * The new-plan page as the developer meets it: a name drawn as the plan's
 * title, the repository it will be about, Create plan, and the sections of
 * the account's own template faint beneath, read through the bridge the
 * host answers. The template the bridge holds is set per test; undefined is
 * a read the host cannot answer.
 */

const TEMPLATE = "## Why\n\nWhat prompted this.\n\n## Risks\n\nWhat could go wrong.\n";

let template: string | undefined;
const roots: Root[] = [];

beforeEach(() => {
  template = TEMPLATE;
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        if (request.kind === ACT_KIND.PLAN_TEMPLATE_READ && template !== undefined) {
          return Promise.resolve({
            status: ACT_OUTCOME_STATUS.DONE,
            value: { template, custom: true },
          });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The page over a start answered by `answer`, each start's name and repository written down. */
async function mount(answer: string | undefined = undefined) {
  const starts: [string, string | null][] = [];
  const control = plansControl();
  const newPlan = {
    ...control.newPlan,
    start: (name: string, repository: string | null) => {
      starts.push([name, repository]);
      return Promise.resolve(answer);
    },
  };
  const repositories = { ...control.repositories, recent: ["acme/web"] };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(NewPlanForm, { newPlan, repositories })));
  await settle();
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan name"]');
  assert.ok(field, "the name is drawn");
  const create = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("Create plan"),
  );
  assert.ok(create, "Create plan is drawn");
  return {
    starts,
    field,
    create,
    type: (words: string) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      act(() => {
        setValue?.call(field, words);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    pressReturn: async () => {
      act(() => {
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
      await settle();
    },
    sections: () =>
      [...container.querySelectorAll(".new-plan-template .markdown-heading")].map(
        (heading) => heading.textContent,
      ),
    note: () => container.querySelector('[role="alert"]')?.textContent ?? undefined,
  };
}

test("the page reads Untitled plan and draws the account's own template's sections under it", async () => {
  const page = await mount();
  assert.equal(page.field.placeholder, "Untitled plan");
  assert.deepEqual(page.sections(), ["Why", "Risks"]);
});

test("a template the host cannot read leaves the page without sections, and the plan can still be created", async () => {
  template = undefined;
  const page = await mount();
  assert.deepEqual(page.sections(), []);
  page.type("Dark mode");
  await page.pressReturn();
  assert.deepEqual(page.starts, [["Dark mode", "acme/web"]]);
});

test("Return creates the plan under the name as typed, trimmed, about the repository last used", async () => {
  const page = await mount();
  assert.equal(page.create.disabled, true, "nothing to create before a name");
  await page.pressReturn();
  assert.deepEqual(page.starts, []);
  page.type("  Dark mode toggle  ");
  assert.equal(page.create.disabled, false);
  await page.pressReturn();
  assert.deepEqual(page.starts, [["Dark mode toggle", "acme/web"]]);
});

test("Create plan pressed creates the plan, and a refusal keeps the name and says why under it", async () => {
  const page = await mount("Luke can't reach acme/web.");
  page.type("Dark mode toggle");
  act(() => page.create.click());
  await settle();
  assert.deepEqual(page.starts, [["Dark mode toggle", "acme/web"]]);
  assert.equal(page.note(), "Luke can't reach acme/web.");
  assert.equal(page.field.value, "Dark mode toggle");
  assert.equal(page.create.disabled, false, "the press can be made again");
});
