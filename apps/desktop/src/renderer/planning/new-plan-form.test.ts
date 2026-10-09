// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_CALL_FAILURE, type PlanningRepositoriesAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { NewPlanForm } from "./new-plan-form";
import type { RepositoryChooser } from "./repository-chip";
import type { PlansControl } from "./use-plans-tab";

const RELAY = "acme/relay";
const BILLING = "acme/billing";
const INSTALLATION_URL = "https://github.com/apps/luke/installations/new";

/** The repositories the account reaches, as the host answers them: the App installed, two of them, one private. */
const LISTED: PlanningRepositoriesAnswer = {
  repositories: {
    installed: true,
    repositories: [
      {
        owner: "acme",
        name: "relay",
        fullName: RELAY,
        defaultBranch: "main",
        private: false,
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
    installationUrl: INSTALLATION_URL,
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
    menu: () => container.querySelector(".plan-compose-menu"),
    search: () => find<HTMLInputElement>("input[aria-label='Search repositories']"),
    rows: () => [...container.querySelectorAll<HTMLButtonElement>("[role=option]")],
    /** The row the arrows stand on. */
    highlighted: () => container.querySelector("[role=option][aria-selected='true']")?.textContent,
    note: () => container.querySelector(".plan-compose-menu-note")?.textContent,
    gitHubRow: () => find<HTMLButtonElement>(".plan-compose-menu-foot button"),
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

/** Presses a key on whatever holds focus, the way the keyboard does. */
function press(key: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** Lets the chip's read of the repositories land. */
async function settle(): Promise<void> {
  await act(async () => undefined);
}

beforeEach(installScrollIntoView);

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

  // With none recent, the menu lists the repositories Luke reaches as the service ordered them.
  act(() => page.chip().click());
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY, BILLING],
  );
  act(() => page.rows()[1]?.click());
  assert.equal(page.menu(), null);
  assert.equal(page.chip().textContent, BILLING);
  await act(async () => page.find<HTMLFormElement>("form").requestSubmit());
  assert.deepEqual(page.started.at(-1), ["Teammate invitations", BILLING]);
});

test("the menu is the search, the recent repositories first and the rest after, a lock on a private one, a check on the chosen one, and GitHub pinned last, with no heading", async () => {
  const page = mount({}, { recent: [BILLING] });
  await settle();
  assert.equal(page.chip().textContent, BILLING);

  act(() => page.chip().click());
  const menu = page.menu();
  assert.ok(menu, "the menu opens");
  assert.equal(menu.querySelector(".plan-compose-menu-heading"), null, "no heading");
  assert.equal(menu.firstElementChild, page.search().parentElement, "the search is the first row");
  assert.ok(document.activeElement === page.search(), "the search field holds focus");
  assert.equal(page.search().placeholder, "Search repositories");
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [BILLING, RELAY],
  );
  const [billing, relay] = page.rows();
  assert.ok(billing?.querySelector("svg.lock-icon"), "the private repository wears a lock");
  assert.ok(relay?.querySelector("svg.account-mark"), "the public one wears the GitHub mark");
  assert.equal(billing?.getAttribute("aria-current"), "true");
  assert.ok(billing?.querySelector("svg.credential-check"), "the chosen row is checked");
  assert.equal(relay?.querySelector("svg.credential-check"), null);

  // The GitHub row is the foot, pinned under the list, and opens the installation page.
  const gitHub = page.gitHubRow();
  assert.equal(gitHub.textContent, "GitHub");
  assert.ok(gitHub.querySelector("svg.link-icon"), "the arrow out");
  assert.equal(gitHub.closest(".plan-compose-menu-list"), null, "the foot is not in the list");
  act(() => gitHub.click());
  assert.deepEqual(page.opened, [INSTALLATION_URL]);
  assert.equal(page.menu(), null);
  assert.equal(page.chip().textContent, BILLING);
});

test("typing filters the repositories by name, the arrows move the highlight while the field keeps focus, and Enter picks", async () => {
  const page = mount({}, { recent: [RELAY] });
  await settle();

  act(() => page.chip().click());
  type(page.search(), "BILL");
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [BILLING],
  );
  type(page.search(), "zzz");
  assert.deepEqual(page.rows(), []);
  assert.equal(page.note(), "No repositories match");

  type(page.search(), "acme");
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY, BILLING],
  );
  assert.equal(page.highlighted(), RELAY);
  press("ArrowDown");
  assert.equal(page.highlighted(), BILLING);
  assert.ok(document.activeElement === page.search(), "the field keeps focus");
  press("ArrowDown");
  assert.equal(page.highlighted(), RELAY, "the arrows wrap");
  press("ArrowUp");
  press("Enter");
  assert.equal(page.chip().textContent, BILLING);
  assert.equal(page.menu(), null);
  assert.ok(document.activeElement === page.chip(), "focus is back on the chip");
});

test("the menu says it is reading while the list is out, with the recent repositories already listed", async () => {
  const page = mount({}, { recent: [RELAY], read: () => new Promise(() => undefined) });
  await settle();

  act(() => page.chip().click());
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY],
  );
  assert.equal(page.note(), "Reading your repositories…");
  assert.equal(page.container.querySelector(".plan-compose-menu-foot"), null);
});

test("with the App installed nowhere, the chip offers installing Luke on GitHub instead of a menu", async () => {
  const page = mount(
    {},
    {
      read: () =>
        Promise.resolve({
          repositories: { installed: false, repositories: [], installationUrl: INSTALLATION_URL },
        }),
    },
  );
  await settle();

  assert.equal(page.chip().textContent, "Install Luke on GitHub");
  assert.equal(page.chip().getAttribute("aria-haspopup"), null);
  act(() => page.chip().click());
  assert.equal(page.menu(), null);
  assert.deepEqual(page.opened, [INSTALLATION_URL]);
});

test("with the App installed and no repository reached, the menu says so over the GitHub row", async () => {
  const page = mount(
    {},
    {
      read: () =>
        Promise.resolve({
          repositories: { installed: true, repositories: [], installationUrl: INSTALLATION_URL },
        }),
    },
  );
  await settle();

  act(() => page.chip().click());
  assert.equal(page.note(), "Luke can't see any repository yet.");
  assert.deepEqual(page.rows(), []);
  assert.equal(page.gitHubRow().textContent, "GitHub");
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
  assert.deepEqual(page.rows(), []);
  const again = [...page.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  );
  assert.ok(again, "the menu offers to try again");
  await act(async () => again.click());
  assert.equal(page.container.querySelector("[role=alert]"), null);
  assert.equal(reads, 2);
  assert.deepEqual(
    page.rows().map((row) => row.textContent),
    [RELAY, BILLING],
  );

  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  assert.equal(reads, 3);
});

test("Escape closes the menu, goes no further than it, and hands focus back to the chip", async () => {
  const page = mount({}, { recent: [RELAY, BILLING] });
  await settle();
  const escapes: string[] = [];
  const listen = (event: KeyboardEvent) => {
    if (event.key === "Escape") escapes.push(event.key);
  };
  window.addEventListener("keydown", listen);

  act(() => page.chip().click());
  assert.ok(document.activeElement === page.search(), "the search field holds focus");
  press("Escape");
  window.removeEventListener("keydown", listen);

  assert.equal(page.menu(), null);
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
