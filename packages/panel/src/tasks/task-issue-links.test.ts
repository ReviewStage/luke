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
import { afterEach, beforeEach, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { TaskIssueLinks } from "./task-issue-links.js";

/**
 * A task's Linked issues box as its owner meets it under the task's name:
 * each link's live state, its keyword switch, and its unlink, read and
 * changed through the act port; Link issue opening New task's picker over
 * the task's repository, the issues the task links dimmed; what the service
 * refuses said under the rows; and nothing drawn where the workspace offers
 * no issue to link and the task links none. On a phone a row stands its
 * controls on a line of their own under its title, which gives way, and a
 * wide room keeps its one line. Synthetic task, workspace, and issues.
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
  archived?: boolean;
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
          archived: options.archived ?? false,
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

/** Each row as the box draws it: its key, title, and state, and the keyword chosen. */
function rows(container: HTMLElement) {
  return [...container.querySelectorAll(".task-issue-link")].map((row) => ({
    key: row.querySelector(".task-issue-link-key")?.textContent,
    title: row.querySelector(".task-issue-link-title")?.textContent,
    state: row.querySelector(".task-issue-link-state")?.textContent ?? null,
    keyword: row.querySelector('[aria-checked="true"]')?.textContent,
  }));
}

function press(element: Element | null | undefined): void {
  assert.ok(element instanceof HTMLElement, "nothing to press");
  act(() => element.click());
}

test("each link is drawn with its key, title, live state, and keyword, and its title opens the issue", async () => {
  const { container, opened } = await mount({ links: [SAFARI, ENG] });

  assert.deepEqual(rows(container), [
    {
      key: "acme/web#312",
      title: "Login fails on Safari 18",
      state: "Not planned",
      keyword: "Closes",
    },
    { key: "ENG-455", title: "Session cookie dropped", state: "In Progress", keyword: "Part of" },
  ]);
  press(container.querySelector(".task-issue-link-title button"));
  assert.deepEqual(opened, ["https://github.com/acme/web/issues/312"]);
});

test("a keyword switched and an issue unlinked reach the host for that link, and the row follows", async () => {
  const { container, sent } = await mount({ links: [SAFARI, ENG] });

  const partOf = [...container.querySelectorAll(".task-issue-link")][0]?.querySelectorAll(
    '[role="radio"]',
  )[1];
  press(partOf);
  await settle();
  press(container.querySelectorAll(".task-issue-link-unlink button")[1]);
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
    [["acme/web#312", "Part of"]],
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
    ["acme/web#312", "acme/web#301"],
  );
});

test("a link refused, a keyword the service refused, and an archived task are said, and an archived task's box reads only", async () => {
  const full = await mount({
    links: [SAFARI],
    answers: {
      [ACT_KIND.TASK_ISSUES_LINK]: { refused: TASK_ISSUE_LINK_REFUSAL.FULL },
      [ACT_KIND.TASK_ISSUES_RELATE]: { failure: TASK_CALL_FAILURE.TASK_ARCHIVED },
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
  press(full.container.querySelectorAll('[role="radio"]')[1]);
  await settle();

  assert.equal(fullNote, "A task links at most 10 issues.");
  assert.equal(
    full.container.querySelector('[role="alert"]')?.textContent,
    "This task is archived, so its issues can't change.",
  );
  assert.deepEqual(
    rows(full.container).map(({ keyword }) => keyword),
    ["Closes"],
  );

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const archived = await mount({ links: [SAFARI], archived: true });
  assert.equal(
    [...archived.container.querySelectorAll("button")].some(
      (each) => each.textContent === "Link issue",
    ),
    false,
  );
  assert.equal(archived.container.querySelectorAll(".task-issue-link-unlink").length, 0);
});

test("a task that links nothing in a workspace offering no issue to link draws no box, and one offering some says it links none", async () => {
  const unoffered = await mount({ links: [], github: false });
  assert.equal(unoffered.container.querySelector(".task-issue-links"), null);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  const offered = await mount({ links: [] });
  assert.equal(
    offered.container.querySelector(".task-issue-links-none")?.textContent,
    "No linked issues",
  );
});

test("a first read that did not land says so in the box, and Try again reads the links", async () => {
  const { container } = await mount({
    links: [SAFARI],
    reads: [{ failure: TASK_CALL_FAILURE.UNANSWERED }, { issues: [SAFARI] }],
  });
  const said = container.querySelector('[role="alert"]')?.textContent;

  press([...container.querySelectorAll("button")].find((each) => each.textContent === "Try again"));
  await settle();

  assert.equal(said, "Luke didn't answer. Try again.");
  assert.deepEqual(
    rows(container).map(({ key }) => key),
    ["acme/web#312"],
  );
  assert.equal(container.querySelector('[role="alert"]'), null);
});

test("a keyword change a newer one overtook puts nothing back when it is refused, so the row says what was saved last", async () => {
  const held: ((answer: WireBoundaryInput) => void)[] = [];
  const { container } = await mount({
    links: [SAFARI],
    relate: () =>
      new Promise<WireBoundaryInput>((resolve) => {
        held.push(resolve);
      }),
  });
  const radios = () => container.querySelectorAll('[role="radio"]');

  press(radios()[1]);
  press(radios()[0]);
  press(radios()[1]);
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

/**
 * The box drawn under a shell in `room`, the window's sheets laid for a
 * touch screen (`testing/container-width.ts`): jsdom lays nothing out, so
 * the rows are read through the sheets, which line of each row's grid each
 * part stands on, and whether the title's track may shrink to nothing.
 */
async function laidIn(room: "narrow" | "wide") {
  const laid = layContainersAt({}, { touch: true });
  const { container } = await mount({ links: [SAFARI, ENG] });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  shell.append(container);
  const row = container.querySelector<HTMLElement>(".task-issue-link") ?? assert.fail("a row");
  const style = (part: string) =>
    getComputedStyle(row.querySelector(`.task-issue-link-${part}`) ?? assert.fail(part));
  const lines = [
    ...getComputedStyle(row)
      .getPropertyValue("grid-template-areas")
      .matchAll(/"([^"]*)"/g),
  ].map(([, line = ""]) => line.trim().split(/\s+/));
  const lineOf = (part: string) => {
    const at = lines.findIndex((line) => line.includes(style(part).getPropertyValue("grid-area")));
    return at === -1 ? undefined : at;
  };
  return { laid, row, style, lines, lineOf };
}

test("on a phone a linked issue's controls stand on a line of their own, under a title that gives way, so none is pushed past the box at 360px", async () => {
  const { laid, row, style, lineOf } = await laidIn("narrow");
  try {
    assert.equal(getComputedStyle(row).display, "grid");
    const title = lineOf("title");
    const controls = lineOf("controls");
    assert.notEqual(title, undefined, "the title stands in the row");
    assert.notEqual(controls, undefined, "the controls stand in the row");
    assert.notEqual(controls, title, "the controls are not on the title's line");
    assert.equal(style("controls").display, "flex", "the controls stand in one row of their own");
    assert.equal(style("state").minWidth, "0px", "the state gives way before a control does");
    for (const control of ["relation", "unlink"]) {
      assert.equal(style(control).flexShrink, "0", `${control} keeps its whole width`);
    }
    assert.match(
      getComputedStyle(row).getPropertyValue("grid-template-columns"),
      /minmax\(0,\s*1fr\)/,
      "the title's track may shrink to nothing",
    );
  } finally {
    laid.remove();
  }
});

test("in a wide room a linked issue keeps its one line, its controls among its parts", async () => {
  const { laid, row, style, lines } = await laidIn("wide");
  try {
    assert.equal(getComputedStyle(row).display, "flex");
    assert.equal(style("controls").display, "contents");
    assert.deepEqual(lines, []);
  } finally {
    laid.remove();
  }
});
