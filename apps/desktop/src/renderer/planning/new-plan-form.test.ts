// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";
import { plansControl } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { NewPlanForm } from "./new-plan-form";
import type { RepositoryChooser } from "./repository-chip";

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
  installScrollIntoView();
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

/** What a page stands over besides the start's answer: a repository picked for it, and the chooser's workspace and recent repositories. */
interface Staging {
  readonly preset?: { readonly repository: string };
  readonly chooser?: Partial<RepositoryChooser>;
}

/** The page over a start answered by `answer`, each start's name and repository written down. */
async function mount(answer: string | undefined = undefined, staging: Staging = {}) {
  const starts: [string, string | null][] = [];
  const control = plansControl();
  const newPlan = {
    ...control.newPlan,
    preset: staging.preset ?? control.newPlan.preset,
    start: (name: string, repository: string | null) => {
      starts.push([name, repository]);
      return Promise.resolve(answer);
    },
  };
  let connects = 0;
  let repositories: RepositoryChooser = {
    ...control.repositories,
    recent: ["acme/web"],
    connectGitHub: () => {
      connects += 1;
    },
    ...staging.chooser,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (presses: number) =>
    act(() =>
      root.render(createElement(NewPlanForm, { newPlan: { ...newPlan, presses }, repositories })),
    );
  render(0);
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
    /** A press of New plan while the page stands, which reads the template again. */
    pressNewPlan: async (presses: number) => {
      render(presses);
      await settle();
    },
    create,
    container,
    /** How many times the chip's menu asked to connect GitHub. */
    connects: () => connects,
    /** Stands the page again over another chooser, as a workspace switch or the first workspaces read hands it. */
    rechoose: async (next: Partial<RepositoryChooser>) => {
      repositories = { ...repositories, ...next };
      render(0);
      await settle();
    },
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

test("a later read that fails takes the sections away rather than keep ones the plan may no longer start as", async () => {
  const page = await mount();
  assert.deepEqual(page.sections(), ["Why", "Risks"]);
  template = undefined;
  await page.pressNewPlan(1);
  assert.deepEqual(page.sections(), []);
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

test("a workspace switch lets the pick go for the new workspace's recent repository", async () => {
  const page = await mount(undefined, {
    preset: { repository: "alice/private" },
    chooser: { scope: "workspace-personal", recent: ["alice/notes"] },
  });
  page.type("Dark mode");

  await page.rechoose({ scope: "workspace-acme", recent: ["acme/relay"] });
  await page.pressReturn();

  assert.deepEqual(page.starts, [["Dark mode", "acme/relay"]]);
});

test("the workspace first resolving keeps a repository picked before the workspaces were read", async () => {
  const page = await mount(undefined, {
    preset: { repository: "alice/private" },
    chooser: { scope: undefined, recent: ["alice/notes"] },
  });
  page.type("Dark mode");

  await page.rechoose({ scope: "workspace-personal" });
  await page.pressReturn();

  assert.deepEqual(page.starts, [["Dark mode", "alice/private"]]);
});

test("a list refused for GitHub not connected points to Settings, and the menu's Connect GitHub opens the connect page", async () => {
  const page = await mount(undefined, {
    chooser: {
      read: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED }),
    },
  });
  const chip =
    page.container.querySelector<HTMLButtonElement>(".plan-compose-chip") ??
    assert.fail("the page draws the repository chip");

  act(() => chip.click());
  await settle();
  const buttons = () => [...page.container.querySelectorAll("button")];
  const alert = page.container.querySelector("[role=alert]")?.textContent;
  const retry = buttons().find((button) => button.textContent === "Retry");
  const connect = buttons().find((button) => button.textContent === "Connect GitHub");
  assert.ok(connect, "the menu offers to connect GitHub");
  act(() => connect.click());

  assert.equal(alert, "Connect GitHub in Settings to use a repository with Luke.");
  assert.equal(retry, undefined);
  assert.equal(page.connects(), 1);
  assert.equal(page.container.querySelector(".plan-compose-menu"), null);
});
