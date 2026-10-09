// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_CALL_FAILURE, type PlanningRepositoriesAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NewPlanForm } from "./new-plan-form";
import type { RepositoryChooser } from "./repository-chip";
import type { PlansControl } from "./use-plans-tab";

const RELAY = "acme/relay";
const BILLING = "acme/billing";

/** The repositories the account reaches, as the host answers them: the App installed, two of them. */
const LISTED: PlanningRepositoriesAnswer = {
  repositories: {
    installed: true,
    repositories: [
      {
        owner: "acme",
        name: "relay",
        fullName: RELAY,
        defaultBranch: "main",
        private: true,
        updatedAt: 2,
      },
      {
        owner: "acme",
        name: "billing",
        fullName: BILLING,
        defaultBranch: "main",
        private: true,
        updatedAt: 1,
      },
    ],
    installationUrl: "https://github.com/apps/luke/installations/new",
  },
};

type NewPlan = PlansControl["newPlan"];

/** A new-plan page over a fake host that keeps every start it was asked for. */
function mount(patch: Partial<NewPlan> = {}, chooser: Partial<RepositoryChooser> = {}) {
  const started: [string, string | null][] = [];
  const opened: string[] = [];
  let newPlan: NewPlan = {
    presses: 0,
    start: (name, repository) => {
      started.push([name, repository]);
      return Promise.resolve(undefined);
    },
    ...patch,
  };
  const repositories: RepositoryChooser = {
    recent: [],
    read: () => Promise.resolve(LISTED),
    openGitHub: (url) => opened.push(url),
    ...chooser,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () => root.render(createElement(NewPlanForm, { newPlan, repositories }));
  act(render);
  const find = <Element extends HTMLElement>(selector: string): Element => {
    const found = container.querySelector<Element>(selector);
    assert.ok(found, `the page draws ${selector}`);
    return found;
  };
  return {
    container,
    started,
    opened,
    find,
    nameField: () => find<HTMLInputElement>("input[aria-label='Plan name']"),
    startButton: () => find<HTMLButtonElement>("button[aria-label='Start plan']"),
    chip: () => find<HTMLButtonElement>(".plan-compose-chip"),
    rows: () => [...container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")],
    restand: (next: Partial<NewPlan>) => {
      newPlan = { ...newPlan, ...next };
      act(render);
    },
  };
}

/** Types into a field the way a key press does, through the setter React watches. */
function type(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Lets the chip's read of the repositories land. */
async function settle(): Promise<void> {
  await act(async () => undefined);
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the page asks what to plan, focuses the name field, and the chip waits on a repository while no plan has one", async () => {
  const page = mount();
  await settle();

  assert.equal(page.find("h1").textContent, "What are we planning?");
  assert.ok(document.activeElement === page.nameField(), "the name field holds focus");
  assert.equal(page.chip().textContent, "Choose repository");
  assert.equal(page.startButton().disabled, true);
});

test("start waits for a name alone, and submitting starts the plan on the chosen repository, or none", async () => {
  const page = mount();
  await settle();

  type(page.nameField(), "  Teammate invitations ");
  assert.equal(page.startButton().disabled, false);
  type(page.nameField(), " ");
  assert.equal(page.startButton().disabled, true);
  type(page.nameField(), "Teammate invitations");
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());
  assert.deepEqual(page.started, [["Teammate invitations", null]]);

  // With none recent, the menu lists the repositories Luke reaches.
  act(() => page.chip().click());
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY, BILLING, "Search all repositories…", "Choose which repositories Luke can see"],
  );
  act(() => page.rows()[1]?.click());
  assert.equal(page.container.querySelector("[role=menu]"), null);
  assert.equal(page.chip().textContent, BILLING);
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());
  assert.deepEqual(page.started.at(-1), ["Teammate invitations", BILLING]);
});

test("the repository starts on the last one used, and the chip's menu offers the recent ones, a search, and GitHub's page", async () => {
  const page = mount({}, { recent: [RELAY, BILLING] });
  await settle();
  assert.equal(page.chip().textContent, RELAY);

  act(() => page.chip().click());
  assert.equal(page.find(".plan-compose-menu-heading").textContent, "Recent");
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY, BILLING, "Search all repositories…", "Choose which repositories Luke can see"],
  );
  assert.ok(page.rows()[0]?.querySelector("svg + span + svg"), "the chosen row is checked");

  act(() => page.rows().at(-1)?.click());
  assert.deepEqual(page.opened, ["https://github.com/apps/luke/installations/new"]);
  assert.equal(page.container.querySelector("[role=menu]"), null);
  assert.equal(page.chip().textContent, RELAY);
});

test("Search all repositories… filters every repository Luke reaches by its name", async () => {
  const page = mount({}, { recent: [RELAY] });
  await settle();

  act(() => page.chip().click());
  act(() => page.rows()[1]?.click());
  const search = page.find<HTMLInputElement>("input[aria-label='Search repositories']");
  assert.ok(document.activeElement === search, "the search field holds focus");
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY, BILLING],
  );
  type(search, "BILL");
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [BILLING],
  );
  type(search, "zzz");
  assert.deepEqual(page.rows(), []);
  assert.equal(page.find(".plan-compose-menu-note").textContent, "No repositories match.");

  type(search, "billing");
  act(() => page.rows()[0]?.click());
  assert.equal(page.chip().textContent, BILLING);
  assert.equal(page.container.querySelector("[role=menu]"), null);
});

test("with the App installed nowhere, the chip offers installing Luke on GitHub instead of a menu", async () => {
  const page = mount(
    {},
    {
      read: () =>
        Promise.resolve({
          repositories: {
            installed: false,
            repositories: [],
            installationUrl: "https://github.com/apps/luke/installations/new",
          },
        }),
    },
  );
  await settle();

  assert.equal(page.chip().textContent, "Install Luke on GitHub");
  assert.equal(page.chip().getAttribute("aria-haspopup"), null);
  act(() => page.chip().click());
  assert.equal(page.container.querySelector("[role=menu]"), null);
  assert.deepEqual(page.opened, ["https://github.com/apps/luke/installations/new"]);
});

test("with the App installed and no repository reached, the menu says so beside the page to choose some", async () => {
  const page = mount(
    {},
    {
      read: () =>
        Promise.resolve({
          repositories: {
            installed: true,
            repositories: [],
            installationUrl: "https://github.com/apps/luke/installations/new",
          },
        }),
    },
  );
  await settle();

  act(() => page.chip().click());
  assert.equal(
    page.find(".plan-compose-menu-note").textContent,
    "Luke can't see any repository yet.",
  );
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    ["Search all repositories…", "Choose which repositories Luke can see"],
  );
});

test("a list the host could not read says why in the menu and offers to try again; the list is read again when the window takes focus", async () => {
  let reads = 0;
  const page = mount(
    {},
    {
      read: () => {
        reads += 1;
        return Promise.resolve(
          reads === 1 ? { failure: PLAN_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED } : LISTED,
        );
      },
    },
  );
  await settle();

  act(() => page.chip().click());
  assert.match(page.find("[role=alert]").textContent ?? "", /Sign in with GitHub/u);
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    ["Try again"],
  );
  await act(async () => page.rows()[0]?.click());
  assert.equal(page.container.querySelector("[role=alert]"), null);
  assert.equal(reads, 2);

  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  assert.equal(reads, 3);
});

test("Escape closes the menu, goes no further than it, and hands focus back to the chip; arrows walk its rows", async () => {
  const page = mount({}, { recent: [RELAY, BILLING] });
  await settle();
  const escapes: string[] = [];
  const listen = (event: KeyboardEvent) => {
    if (event.key === "Escape") escapes.push(event.key);
  };
  window.addEventListener("keydown", listen);

  act(() => page.chip().click());
  assert.ok(document.activeElement === page.rows()[0], "the first row holds focus");
  const press = (key: string) =>
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  press("ArrowDown");
  assert.ok(document.activeElement === page.rows()[1]);
  press("ArrowUp");
  press("ArrowUp");
  assert.ok(document.activeElement === page.rows().at(-1), "the arrows wrap");
  press("Escape");
  window.removeEventListener("keydown", listen);

  assert.equal(page.container.querySelector("[role=menu]"), null);
  assert.deepEqual(escapes, [], "Escape went no further than the menu");
  assert.ok(document.activeElement === page.chip(), "focus is back on the chip");
});

test("a refused start keeps the page, with the reason under the composer", async () => {
  const page = mount({
    start: () => Promise.resolve("Luke's service could not be reached. Try again."),
  });
  await settle();

  type(page.nameField(), "Invites");
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());

  assert.equal(
    page.find("[role=alert]").textContent,
    "Luke's service could not be reached. Try again.",
  );
  assert.equal(page.startButton().disabled, false);
});

test("each press of New plan brings focus back to the name field", async () => {
  const page = mount();
  await settle();
  page.chip().focus();
  assert.ok(document.activeElement !== page.nameField(), "focus starts elsewhere");

  page.restand({ presses: 1 });

  assert.ok(document.activeElement === page.nameField(), "the name field holds focus");
});
