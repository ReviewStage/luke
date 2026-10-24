// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  GITHUB_AUTHOR_ASSOCIATION,
  type GitHubIssuePick,
  ISSUE_STATE,
} from "@luke/features/github-repositories-wire";
import {
  TASK_ISSUE_LINK_REFUSAL,
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueLinkView,
} from "@luke/features/task-issue-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import type { WireBoundaryInput } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { TaskIssueLinks } from "./task-issue-links.js";

/**
 * A task's linked issues as its owner meets them under its status and
 * priority: one chip each, saying its key, its title, its live state, and
 * its keyword, whose menu opens it, switches the keyword, and unlinks it,
 * each read and changed through the act port; Link issue opening New task's
 * picker over the task's repository, the issues the task links dimmed; what
 * the service refuses said under the chips; and nothing drawn where the
 * workspace offers no issue to link and the task links none. On a phone the
 * chips wrap rather than run past the page. Synthetic task, workspace, and
 * issues.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const WORKSPACE_ID = "workspace-acme";

const SAFARI: TaskIssueLinkView = {
  id: "0b6c1f0e-2a7d-4c3e-9f1a-0d8e7b6a5c41",
  provider: TASK_ISSUE_PROVIDER.GITHUB,
  externalId: "I_kwDOweb312",
  key: "acme/web#312",
  url: "https://github.com/acme/web/issues/312",
  title: "Login fails on Safari 18",
  repository: "acme/web",
  number: 312,
  relation: TASK_ISSUE_RELATION.CLOSES,
  standing: { provider: TASK_ISSUE_PROVIDER.GITHUB, state: ISSUE_STATE.NOT_PLANNED },
};

const ENG: TaskIssueLinkView = {
  id: "0b6c1f0e-2a7d-4c3e-9f1a-0d8e7b6a5c42",
  provider: TASK_ISSUE_PROVIDER.LINEAR,
  externalId: "5b6c1f0e-2a7d-4c3e-9f1a-0d8e7b6a5c4d",
  key: "ENG-455",
  url: "https://linear.app/acme/issue/ENG-455",
  title: "Session cookie dropped",
  relation: TASK_ISSUE_RELATION.PART_OF,
  standing: { provider: TASK_ISSUE_PROVIDER.LINEAR, state: "In Progress" },
};

/** acme/web's open issues as the picker lists them: the one the task links, and one it does not. */
function pick(number: number, title: string, nodeId: string): GitHubIssuePick {
  return {
    nodeId,
    repository: "acme/web",
    number,
    title,
    url: `https://github.com/acme/web/issues/${number}`,
    state: ISSUE_STATE.OPEN,
    author: "priya",
    authorAssociation: GITHUB_AUTHOR_ASSOCIATION.MEMBER,
    updatedAt: Date.now(),
  };
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The box for the task, its links answered by `links`, each act it sent
 * written down and answered by `answers` where given; `github` the
 * workspace's GitHub reader, absent where it has none connected.
 */
async function mount(options: {
  links: readonly TaskIssueLinkView[];
  github?: boolean;
  answers?: Partial<Record<string, WireBoundaryInput>>;
  /** Each read's answer in turn, the last standing for every read after; the task's links where none is given. */
  reads?: readonly WireBoundaryInput[];
  /** How a relation is answered, where the test holds it. */
  relate?: (payload: WireBoundaryInput) => Promise<WireBoundaryInput>;
}) {
  const sent: [string, WireBoundaryInput][] = [];
  const opened: string[] = [];
  let links = [...options.links];
  const answer = (kind: string, payload: WireBoundaryInput, fallback: WireBoundaryInput) => {
    sent.push([kind, payload]);
    return Promise.resolve(options.answers?.[kind] ?? fallback);
  };
  const reads = [...(options.reads ?? [])];
  fakeActPort({
    [ACT_KIND.TASK_ISSUES_READ]: (payload) =>
      // SAFETY: the fake answers what the test hands it, which the port's own schema would check.
      answer(
        ACT_KIND.TASK_ISSUES_READ,
        payload,
        (reads.length > 1 ? reads.shift() : reads[0]) ?? { issues: links },
      ) as never,
    [ACT_KIND.TASK_ISSUES_LINK]: (payload) => {
      const made: TaskIssueLinkView = {
        ...SAFARI,
        id: "0b6c1f0e-2a7d-4c3e-9f1a-0d8e7b6a5c43",
        externalId: "I_kwDOweb301",
        key: "acme/web#301",
        number: 301,
        title: "Chart tooltips unreadable",
      };
      links = [...links, made];
      // SAFETY: as the read's answer above.
      return answer(ACT_KIND.TASK_ISSUES_LINK, payload, { issue: made }) as never;
    },
    [ACT_KIND.TASK_ISSUES_RELATE]: (payload) => {
      if (options.relate === undefined) {
        // SAFETY: as the read's answer above.
        return answer(ACT_KIND.TASK_ISSUES_RELATE, payload, { issue: SAFARI }) as never;
      }
      sent.push([ACT_KIND.TASK_ISSUES_RELATE, payload]);
      // SAFETY: as the read's answer above.
      return options.relate(payload) as never;
    },
    [ACT_KIND.TASK_ISSUES_UNLINK]: (payload) =>
      // SAFETY: as the read's answer above.
      answer(ACT_KIND.TASK_ISSUES_UNLINK, payload, { unlinked: true }) as never,
  });
  fakeAppPlatform({ openGitHub: (url) => opened.push(url), openWeb: (url) => opened.push(url) });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskIssueLinks, {
          taskId: TASK_ID,
          workspaceId: WORKSPACE_ID,
          repository: "acme/web",
          linearIn: () => undefined,
          githubIn: () =>
            options.github === false
              ? undefined
              : () =>
                  Promise.resolve({
                    issues: [
                      pick(312, "Login fails on Safari 18", "I_kwDOweb312"),
                      pick(301, "Chart tooltips unreadable", "I_kwDOweb301"),
                    ],
                  }),
        }),
      ),
    ),
  );
  await settle();
  return { container, sent, opened };
}

/** Each chip as the row draws it: its key, title, and what it says of its state and keyword. */
function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".task-issue-link")].map((row) => ({
    key: row.querySelector(".task-issue-link-key")?.textContent,
    title: row.querySelector(".luke-chip-name")?.textContent,
    says: row.querySelector("button")?.getAttribute("aria-label")?.split(": ")[1],
    keyword: KEYWORDS.find((keyword) => row.dataset.relation === RELATION_OF[keyword]),
  }));
}

const KEYWORDS = ["Closes", "Part of"] as const;

const RELATION_OF = {
  Closes: TASK_ISSUE_RELATION.CLOSES,
  "Part of": TASK_ISSUE_RELATION.PART_OF,
} as const;

function press(element: Element | null | undefined): void {
  assert.ok(element instanceof HTMLElement, "nothing to press");
  act(() => element.click());
}

/** Opens the chip of the link at `at` and presses the item of its menu whose label is `label`. */
function choose(container: HTMLElement, at: number, label: string): void {
  press(container.querySelectorAll(".task-issue-link button")[at]);
  const items = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  press(items.find((item) => item.querySelector(".luke-menu-item-label")?.textContent === label));
}

test("each link is drawn with its key, title, live state, and keyword, and its menu opens the issue", async () => {
  const { container, opened } = await mount({ links: [SAFARI, ENG] });

  assert.deepEqual(rows(container), [
    {
      key: "#312",
      title: "Login fails on Safari 18",
      says: "Not planned · Closes",
      keyword: "Closes",
    },
    {
      key: "ENG-455",
      title: "Session cookie dropped",
      says: "In Progress · Part of",
      keyword: "Part of",
    },
  ]);
  choose(container, 0, "Open on GitHub");
  assert.deepEqual(opened, ["https://github.com/acme/web/issues/312"]);
});

test("a chip hangs its issue's card while the pointer rests on it: its title, repository key, state, and keyword", async () => {
  const { container } = await mount({ links: [SAFARI] });

  restOn(container.querySelector(".task-issue-link button") ?? assert.fail("the chip"));
  const card = document.querySelector("[data-issue-card]");

  assert.match(card?.textContent ?? "", /Login fails on Safari 18/);
  assert.match(card?.textContent ?? "", /acme\/web#312 · Not planned/);
  assert.match(card?.textContent ?? "", /Closes: Merging closes the issue/);
  assert.ok(card?.querySelector("[data-issue-mark]"), "the issue's live mark leads the card");
});

test("a keyword switched and an issue unlinked from a chip's menu reach the host for that link, and the chips follow", async () => {
  const { container, sent } = await mount({ links: [SAFARI, ENG] });

  choose(container, 0, "Part of");
  await settle();
  choose(container, 1, "Unlink");
  await settle();

  assert.deepEqual(sent.slice(1), [
    [
      ACT_KIND.TASK_ISSUES_RELATE,
      { taskId: TASK_ID, linkId: SAFARI.id, relation: TASK_ISSUE_RELATION.PART_OF },
    ],
    [ACT_KIND.TASK_ISSUES_UNLINK, { taskId: TASK_ID, linkId: ENG.id }],
  ]);
  assert.deepEqual(
    rows(container).map(({ key, keyword }) => [key, keyword]),
    [["#312", "Part of"]],
  );
});

test("Link issue opens the picker over the task's repository, the linked issue dimmed, and an issue picked is linked and read back", async () => {
  const { container, sent } = await mount({ links: [SAFARI] });

  press(
    [...container.querySelectorAll("button")].find((each) => each.textContent === "Link issue"),
  );
  await settle();
  const options = [...document.querySelectorAll('[role="option"]')];
  const dimmed = options.map((option) => option.getAttribute("aria-disabled") === "true");
  press(options.find((option) => option.textContent?.includes("Chart tooltips")));
  await settle();

  assert.deepEqual(dimmed, [true, false]);
  assert.deepEqual(sent.slice(1, 3), [
    [
      ACT_KIND.TASK_ISSUES_LINK,
      {
        taskId: TASK_ID,
        issue: { provider: TASK_ISSUE_PROVIDER.GITHUB, repository: "acme/web", number: 301 },
      },
    ],
    [ACT_KIND.TASK_ISSUES_READ, { taskId: TASK_ID }],
  ]);
  assert.deepEqual(
    rows(container).map(({ key }) => key),
    ["#312", "#301"],
  );
});

test("a link refused and a keyword the service did not take are said", async () => {
  const full = await mount({
    links: [SAFARI],
    answers: {
      [ACT_KIND.TASK_ISSUES_LINK]: { refused: TASK_ISSUE_LINK_REFUSAL.FULL },
      [ACT_KIND.TASK_ISSUES_RELATE]: { failure: TASK_CALL_FAILURE.UNANSWERED },
    },
  });
  press(
    [...full.container.querySelectorAll("button")].find(
      (each) => each.textContent === "Link issue",
    ),
  );
  await settle();
  press(
    [...document.querySelectorAll('[role="option"]')].find((option) =>
      option.textContent?.includes("Chart tooltips"),
    ),
  );
  await settle();
  const fullNote = full.container.querySelector('[role="alert"]')?.textContent;
  choose(full.container, 0, "Part of");
  await settle();

  assert.equal(fullNote, "A task links at most 10 issues.");
  assert.equal(
    full.container.querySelector('[role="alert"]')?.textContent,
    "Luke didn't answer. Try again.",
  );
  assert.deepEqual(
    rows(full.container).map(({ keyword }) => keyword),
    ["Closes"],
  );
});

test("a task that links nothing in a workspace offering no issue to link draws no row, and one offering some offers Link issue alone", async () => {
  const unoffered = await mount({ links: [], github: false });
  assert.equal(unoffered.container.querySelector(".task-issue-links"), null);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const offered = await mount({ links: [] });
  assert.deepEqual(rows(offered.container), []);
  assert.deepEqual(
    [...offered.container.querySelectorAll("button")].map((each) => each.textContent),
    ["Link issue"],
  );
});

test("a first read that did not land says so in the row's place, and Try again reads the links", async () => {
  const { container } = await mount({
    links: [SAFARI],
    reads: [{ failure: TASK_CALL_FAILURE.UNANSWERED }, { issues: [SAFARI] }],
  });
  const said = container.querySelector('[role="alert"] .luke-failure-note-words')?.textContent;

  press([...container.querySelectorAll("button")].find((each) => each.textContent === "Retry"));
  await settle();

  assert.equal(said, "Luke didn't answer. Try again.");
  assert.deepEqual(
    rows(container).map(({ key }) => key),
    ["#312"],
  );
  assert.equal(container.querySelector('[role="alert"]'), null);
});

test("a keyword change a newer one overtook puts nothing back when it is refused, so the chip says what was saved last", async () => {
  const held: ((answer: WireBoundaryInput) => void)[] = [];
  const { container } = await mount({
    links: [SAFARI],
    relate: () =>
      new Promise<WireBoundaryInput>((resolve) => {
        held.push(resolve);
      }),
  });
  choose(container, 0, "Part of");
  choose(container, 0, "Closes");
  choose(container, 0, "Part of");
  await settle();
  held[2]?.({ issue: { ...SAFARI, relation: TASK_ISSUE_RELATION.PART_OF } });
  await settle();
  held[0]?.({ failure: TASK_CALL_FAILURE.UNANSWERED });
  held[1]?.({ failure: TASK_CALL_FAILURE.UNANSWERED });
  await settle();

  assert.deepEqual(
    rows(container).map(({ keyword }) => keyword),
    ["Part of"],
  );
  assert.equal(container.querySelector('[role="alert"]'), null);
});

test("on a phone the chips wrap rather than run past the page, each cutting its title short", async () => {
  const laid = layContainersAt({}, { touch: true });
  try {
    const { container } = await mount({ links: [SAFARI, ENG] });
    const shell = document.body.appendChild(document.createElement("div"));
    shell.className = "desktop-shell";
    shell.dataset.room = "narrow";
    shell.append(container);
    const list = container.querySelector(".task-issue-links-rows") ?? assert.fail("the row");
    const chip = container.querySelector(".task-issue-link") ?? assert.fail("a chip");

    assert.equal(getComputedStyle(list).flexWrap, "wrap");
    assert.equal(getComputedStyle(chip).minWidth, "0px", "a chip may shrink below its words");
    assert.match(getComputedStyle(chip).maxWidth, /100%/u, "a chip stands inside the page");
  } finally {
    laid.remove();
  }
});

/** Link issue's menu at its own width, an issue's title with its key and state after it. */
const LINK_MENU_WIDTH = 420;

/**
 * Where Link issue's menu stands once the chip stands `left` pixels in from
 * the left edge of a window `width` wide, 90px wide itself: the edge it
 * hangs from, and its left and right edges as the stylesheet draws them from
 * that edge, its inset, and its width capped to the widest it may stand.
 * jsdom lays nothing out, so the chip's place and the menu's width are
 * answered as the window would lay them.
 */
async function linkMenuAt(left: number, width = 390) {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("searchable-menu") ? LINK_MENU_WIDTH : 0;
  });
  const { container } = await mount({ links: [SAFARI] });
  const chip =
    [...container.querySelectorAll<HTMLElement>("button")].find(
      (each) => each.textContent === "Link issue",
    ) ?? assert.fail("Link issue stands");
  vi.spyOn(chip, "getBoundingClientRect").mockReturnValue(new DOMRect(left, 100, 90, 28));
  press(chip);
  await settle();
  const box = chip.closest<HTMLElement>(".issue-picker-chip") ?? assert.fail("the picker's box");
  const widest = Number.parseFloat(box.style.getPropertyValue("--settings-picker-width-max"));
  const inset = Number.parseFloat(box.style.getPropertyValue("--settings-picker-inset"));
  const drawn = Math.min(LINK_MENU_WIDTH, widest);
  const start = box.dataset.align === "end" ? left + 90 - inset - drawn : left + inset;
  return { align: box.dataset.align, start, end: start + drawn, drawn };
}

test("Link issue near the window's right edge hangs its menu from its trailing edge, inside the window", async () => {
  const menu = await linkMenuAt(290);
  assert.equal(menu.align, "end");
  assert.ok(
    menu.start >= 0 && menu.end <= 390,
    `the menu stands from ${menu.start} to ${menu.end}`,
  );
  assert.ok(menu.drawn >= 280, `the menu stands ${menu.drawn}px wide`);
});

test("Link issue near the row's start hangs its menu from its leading edge, inside the window", async () => {
  const menu = await linkMenuAt(16);
  assert.equal(menu.align, "start");
  assert.ok(
    menu.start >= 0 && menu.end <= 390,
    `the menu stands from ${menu.start} to ${menu.end}`,
  );
});

test("Link issue with too little room on either side pushes its menu back over the chip, whole and inside the window", async () => {
  const menu = await linkMenuAt(320, 600);
  assert.equal(menu.align, "end");
  assert.equal(menu.drawn, LINK_MENU_WIDTH);
  assert.ok(
    menu.start >= 0 && menu.end <= 600,
    `the menu stands from ${menu.start} to ${menu.end}`,
  );
});

test("Link issue with room for the whole menu after it hangs it from its leading edge, though there is more before it", async () => {
  const menu = await linkMenuAt(560, 1000);
  assert.equal(menu.align, "start");
  assert.equal(menu.start, 560);
  assert.equal(menu.drawn, LINK_MENU_WIDTH);
});
