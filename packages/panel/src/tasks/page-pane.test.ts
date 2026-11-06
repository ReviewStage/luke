// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentStart,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { LINK_ORIGIN } from "@repo/features/link-home";
import type { pageFindAnswerSchema } from "@repo/features/page-find";
import { pageFrameUrl } from "@repo/features/page-frame";
import { PAGE_PICK_ACT, PAGE_PICK_TYPE, type pagePickAnswerSchema } from "@repo/features/page-pick";
import type { PageLine, PagePlace } from "@repo/features/page-wire";
import {
  type CodeLines,
  TASK_CALL_FAILURE,
  type TasksPageSourceAnswer,
} from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import type { DescriptionCommentsControl } from "@repo/ui/description-comments";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { useDraftsOwner } from "../composer-drafts.js";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { HandTabActionsContext, type TabActionGroups } from "../desktop/strip-tabs.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { chooseMenuItem } from "../testing/phone-head.js";
import { onPhone } from "../testing/phone-tab.js";
import { wholeFileDrawn, wholeFileLines, wholeFileRoot } from "../testing/whole-file.js";
import { PagePane } from "./page-pane.js";

/**
 * A page's tab as the developer meets it: the page drawn in a frame that
 * runs its scripts and nothing else, out of the screen recording, at its
 * newest version until they step back through the earlier ones, or its
 * HTML drawn as a File tab draws a file. Synthetic tasks and pages
 * throughout; main's read of a version's source is a door answering each
 * version's HTML as colored lines.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "0c4e2b1d-9f3a-4e6b-8d7c-1a2b3c4d5e6f";

const FUNNEL: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 3,
  at: 1_800_000_000_000,
};

const roots: Root[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** One version's HTML as main colors it: its tag in a color of its own, its words plain. */
function sourceOf(version: number): CodeLines {
  return [
    [{ text: "<h1>", color: "#7ee787", lightColor: "#116329" }, { text: `Funnel v${version}` }],
    [{ text: "<p>Invites sent</p>" }],
  ];
}

/** Reads one version's source, as the service answers it. */
type ReadPageSource = (version: number) => Promise<TasksPageSourceAnswer>;

const readSource: ReadPageSource = (version) => Promise.resolve({ lines: sourceOf(version) });

/** Answers the pane's source reads through `read`, over the act port its window reads through. */
function answerSources(read: ReadPageSource): void {
  fakeActPort({ [ACT_KIND.TASKS_PAGE_SOURCE]: (payload) => read(payload.version) });
}

/** The account signed in to the window, as the panel's root hands it what the window keeps for it, a review's held comments among it. */
function SignedIn(): null {
  useDraftsOwner({ id: "u-dean", email: "dean@example.com" });
  return null;
}

/** Mounts the pane over the page as the task lists it, its links written under `acme`, answering what it draws and a way to list it again. */
function mount(
  page: PageLine,
  read: ReadPageSource = readSource,
  findActive = true,
  place: PagePlace = { taskId: TASK },
  comments?: Parameters<typeof PagePane>[0]["comments"],
) {
  answerSources(read);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // What the tab hands the strip's one ⋯, as its groups' names.
  let held: TabActionGroups | undefined;
  const handed = () => (held ?? []).map((group) => group.map((each) => each.label));
  const chooseHanded = (label: string) => {
    const item = held?.flat().find((each) => each.label === label);
    assert.ok(item !== undefined && "onSelect" in item, `the ⋯ is handed ${label}`);
    act(() => item.onSelect());
  };
  const render = (listed: PageLine) =>
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(
            LinkWorkspaceProvider,
            { value: "acme" },
            createElement(
              HandTabActionsContext.Provider,
              {
                value: (actions) => {
                  held = actions;
                },
              },
              createElement(SignedIn),
              createElement(PagePane, {
                place,
                page: listed,
                findActive,
                comments,
              }),
            ),
          ),
        ),
      ),
    );
  render(page);
  const frame = () => {
    const found = container.querySelector("iframe");
    assert.ok(found);
    return found;
  };
  const press = async (label: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button);
    await act(async () => button.click());
  };
  // The source's lines as drawn, each its number then its text, once Pierre has drawn them.
  const sourceLines = async () => {
    await wholeFileDrawn(container);
    return wholeFileLines(container);
  };
  return { container, frame, press, render, sourceLines, handed, chooseHanded };
}

const versionUrl = (version: number) => pageFrameUrl({ taskId: TASK, pageId: FUNNEL.id, version });

beforeEach(() => {
  fakeAppPlatform({ pageFrameUrl });
  // View settings opens its syntax theme on the window's appearance, here the dark one.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark"),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

test("a page is drawn at its newest version in a frame that runs its own scripts alone, left out of the recording", () => {
  const { container, frame } = mount(FUNNEL);

  assert.equal(frame().getAttribute("src"), versionUrl(3));
  assert.equal(frame().getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame().getAttribute("allow"), "");
  assert.ok(frame().closest(".ph-no-capture"));
  assert.match(container.textContent ?? "", /Invite funnel.*Version 3 of 3/);
});

test("a page's frame says it is read until it loads, and the wait goes when it has", () => {
  const { container, frame } = mount(FUNNEL);

  assert.equal(container.querySelector('[role="status"]')?.textContent, "Reading the page");
  act(() => {
    frame().dispatchEvent(new Event("load"));
  });
  assert.equal(container.querySelector('[role="status"]'), null);
});

test("stepping to another version says Reading again until that version's frame loads", async () => {
  const { container, frame, press } = mount(FUNNEL);
  act(() => {
    frame().dispatchEvent(new Event("load"));
  });
  assert.equal(container.querySelector('[role="status"]'), null);

  await press("Earlier version");

  assert.equal(frame().getAttribute("src"), versionUrl(2));
  assert.equal(container.querySelector('[role="status"]')?.textContent, "Reading the page");
  act(() => {
    frame().dispatchEvent(new Event("load"));
  });
  assert.equal(container.querySelector('[role="status"]'), null);
});

test("View source draws the version's HTML as a File tab's numbered, colored lines in the frame's place, and View page draws the frame again", async () => {
  const { container, press, frame, sourceLines } = mount(FUNNEL);

  await press("View source");

  assert.equal(container.querySelector("iframe"), null);
  assert.deepEqual(await sourceLines(), ["1 <h1>Funnel v3", "2 <p>Invites sent</p>"]);
  const tag = wholeFileRoot(container)?.querySelector<HTMLElement>('[data-line="1"] span');
  assert.equal(tag?.textContent, "<");
  assert.match(tag?.getAttribute("style") ?? "", /--diffs-token/);
  assert.ok(container.querySelector(".whole-file")?.closest(".ph-no-capture"));

  await press("View page");

  assert.deepEqual(wholeFileLines(container), []);
  assert.equal(frame().getAttribute("src"), versionUrl(3));
});

test("the page's Reload hangs a hint in the words it is named by", () => {
  const { container } = mount(FUNNEL);
  const reload = container.querySelector('button[aria-label="Reload page"]') ?? assert.fail();

  restOn(reload);

  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "Reload page");
});

test("over the source, View settings offers the settings its lines follow, and the tab's one ⋯ is handed Copy source before Reload page", async () => {
  const { container, press, handed } = mount(FUNNEL);
  assert.deepEqual(handed(), [["Open in browser"], ["Reload page"]]);
  assert.equal(container.querySelector('button[aria-label="View options"]'), null);

  await press("View source");
  await press("View options");
  const popover = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();
  assert.deepEqual(
    [...popover.querySelectorAll('[role="switch"], [role="radiogroup"], [aria-haspopup]')].map(
      // A pop-up's name ends with the value it names, which is not the row's.
      (control) => control.getAttribute("aria-label")?.split(": ")[0],
    ),
    [
      "Word wrap",
      "Line numbers",
      "Syntax theme",
      "For dark mode",
      "Font",
      "Font size",
      "Line height",
      "Ligatures",
    ],
  );
  await press("View options");

  assert.equal(
    container.querySelector('button[aria-label="Source actions"]'),
    null,
    "the bar draws no ⋯ of its own beside the strip's",
  );
  assert.deepEqual(handed(), [["Open in browser"], ["Copy source"], ["Reload page"]]);
});

test.each([
  { holder: "a task's page", place: { taskId: TASK }, path: `task/${TASK}` },
  { holder: "a page of an agent on no task", place: { agentId: AGENT }, path: `agent/${AGENT}` },
])(
  "Open in browser on $holder opens its own Vespin link, flagged to stay on the web, never the address it is framed from",
  ({ place, path }) => {
    const opened: string[] = [];
    fakeAppPlatform({ pageFrameUrl, openWeb: (url) => opened.push(url) });
    const { chooseHanded } = mount(FUNNEL, readSource, true, place);

    chooseHanded("Open in browser");

    assert.deepEqual(opened, [`${LINK_ORIGIN}/acme/${path}/page/${FUNNEL.id}?stay=web`]);
  },
);

test("the source stays shown while the versions are stepped, each version's own", async () => {
  const { press, sourceLines, container } = mount(FUNNEL);

  await press("View source");
  await press("Earlier version");

  assert.equal(container.querySelector("iframe"), null);
  assert.deepEqual(await sourceLines(), ["1 <h1>Funnel v2", "2 <p>Invites sent</p>"]);
  assert.match(container.textContent ?? "", /Version 2 of 3/);

  await press("View page");
  await press("Later version");

  assert.equal(container.querySelector(".whole-file"), null);
  assert.ok(container.querySelector(`iframe[src="${versionUrl(3)}"]`));
});

test("a source the service did not answer says so in its place, and Retry reads it again", async () => {
  let answered = false;
  const { press, sourceLines, container } = mount(FUNNEL, (version) =>
    Promise.resolve(
      answered ? { lines: sourceOf(version) } : { failure: TASK_CALL_FAILURE.UNANSWERED },
    ),
  );

  await press("View source");

  await vi.waitFor(() =>
    assert.match(
      container.querySelector("[role='alert']")?.textContent ?? "",
      /source could not be read/,
    ),
  );

  answered = true;
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  );
  assert.ok(retry);
  await act(async () => retry.click());

  assert.deepEqual(await sourceLines(), ["1 <h1>Funnel v3", "2 <p>Invites sent</p>"]);
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector('[role="search"][aria-label="Find"] .ui-search-field-tally')
    ?.textContent;
}

/** What the panel asks of a frame's find, each ask in the order it was posted. */
function framePosts(frame: HTMLIFrameElement): unknown[] {
  const posted: unknown[] = [];
  const window = frame.contentWindow ?? assert.fail("the frame has no window");
  vi.spyOn(window, "postMessage").mockImplementation((message) => {
    posted.push(message);
  });
  return posted;
}

/** A message posted to the panel's window from `from`, as a frame's page posts one. */
function postFrom(
  from: Window | null,
  data: typeof pageFindAnswerSchema.Type | typeof pagePickAnswerSchema.Type,
): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: from }));
  });
}

test("⌘F over the page asks its frame to find, and the bar tallies what that frame alone answers", () => {
  const { frame } = mount(FUNNEL);
  const posted = framePosts(frame());

  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("invites");
  postFrom(null, { type: "app-page-find", tally: { count: 9, at: 0 } });
  const tallyBefore = findTally();
  postFrom(frame().contentWindow, { type: "app-page-find", tally: { count: 3, at: 0 } });
  act(() => {
    runAppCommand(APP_COMMAND.FIND_NEXT);
  });

  assert.equal(offered, true);
  assert.deepEqual(posted, [
    { type: "app-page-find", act: "search", query: "invites" },
    { type: "app-page-find", act: "step", query: "invites", by: 1 },
  ]);
  assert.equal(tallyBefore, "No results");
  assert.equal(findTally(), "1 of 3");
});

test("⌘F over the page is seeded with the words selected in its frame", () => {
  const { frame } = mount(FUNNEL);

  postFrom(frame().contentWindow, { type: "app-page-find", selection: "funnel" });
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });

  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.equal(field?.value, "funnel");
});

test("a frame that loads again, as a Reload or another version does, is asked again for the query standing", () => {
  const { frame } = mount(FUNNEL);
  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("invites");
  const posted = framePosts(frame());

  act(() => {
    frame().dispatchEvent(new Event("load"));
  });

  assert.deepEqual(posted, [{ type: "app-page-find", act: "search", query: "invites" }]);
});

test("⌘F and ⌘G pressed in the page, which the window's keys never hear, open the find over it and step, whichever column held the keys", () => {
  const { frame } = mount(FUNNEL, readSource, false);
  const posted = framePosts(frame());

  postFrom(frame().contentWindow, { type: "app-page-find", selection: "funnel" });
  postFrom(frame().contentWindow, { type: "app-page-find", key: "find" });
  postFrom(frame().contentWindow, { type: "app-page-find", key: "next" });

  const field = document.querySelector<HTMLInputElement>('.find-bar input[aria-label="Find"]');
  assert.equal(field?.value, "funnel");
  assert.deepEqual(posted, [
    { type: "app-page-find", act: "search", query: "funnel" },
    { type: "app-page-find", act: "step", query: "funnel", by: 1 },
  ]);
});

test("a click into the page, which stirs only the window's blur, is told as a focus in the tab, which hands its column the keys", () => {
  const { container, frame } = mount(FUNNEL);
  // Note that jsdom tells a focus moved into a frame itself, which Chromium's click does not.
  act(() => frame().focus());
  const heard: EventTarget[] = [];
  container.addEventListener("focusin", (event) => {
    if (event.target !== null) heard.push(event.target);
  });

  act(() => {
    window.dispatchEvent(new FocusEvent("blur"));
  });

  assert.deepEqual(heard, [frame()]);
});

test("⌘F over the source finds in its lines, the window's own, rather than through the frame", async () => {
  const { press, container } = mount(FUNNEL);

  await press("View source");
  let offered = false;
  act(() => {
    offered = runAppCommand(APP_COMMAND.FIND);
  });

  assert.equal(offered, true);
  assert.equal(container.querySelector("iframe"), null);
  assert.ok(container.querySelector("[role='search'][aria-label='Find']"));
});

test("a source read before a Reload that answers after it does not replace the fresh read", async () => {
  const answers: ((html: string) => void)[] = [];
  const { press, sourceLines } = mount(FUNNEL, () => {
    const answer = new Promise<string>((resolve) => answers.push(resolve));
    return answer.then((html) => ({ lines: [[{ text: html }]] }));
  });

  await press("View source");
  await press("Reload page");
  await act(async () => answers[1]?.("<h1>Fresh</h1>"));
  await act(async () => answers[0]?.("<h1>Stale</h1>"));

  assert.deepEqual(await sourceLines(), ["1 <h1>Fresh</h1>"]);
});

test("on a phone the page draws no bar, and the task's header's ⋯ offers every control of it, the version said under its steps", async () => {
  answerSources(readSource);
  const { element, handed } = onPhone(
    createElement(PagePane, {
      place: { taskId: TASK },
      page: FUNNEL,
      findActive: true,
    }),
  );
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));

  assert.equal(container.querySelector(".file-view-bar"), null);
  assert.equal(container.querySelectorAll("button").length, 0, "nothing over the page presses");
  assert.deepEqual(handed.labels(), [
    "Earlier version",
    "Later version",
    "View source",
    "Reload page",
  ]);
  assert.deepEqual(handed.item("Later version"), { disabled: true, detail: "Version 3 of 3" });

  handed.press("Earlier version");
  assert.equal(container.querySelector("iframe")?.getAttribute("src"), versionUrl(2));

  handed.press("View source");
  await act(async () => undefined);
  assert.deepEqual(handed.labels(), [
    "Earlier version",
    "Later version",
    "View page",
    "Reload page",
    "View options",
    "Copy source",
  ]);
  handed.press("View options");
  const sheet = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();
  assert.match(sheet.textContent ?? "", /View options.*Word wrap/);
});

test("Comment asks the frame for an element, an element holding threads is pinned, the element picked opens a comment quoting its words, and a press in the page lets go of it", async () => {
  const path = "body > p:nth-of-type(1)";
  const thread: DescriptionCommentThread = {
    id: "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e61",
    scope: DESCRIPTION_COMMENT_SCOPE.ELEMENT,
    quote: "Invites sent",
    page: { id: FUNNEL.id, version: 3, element: path },
    section: "",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      {
        id: "8c1d3e5f-7a9b-4c2d-8e4f-6a8b0c2d4e62",
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: { userId: "u-theo", name: "Theo" } },
        words: "Per week?",
        at: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
  };
  const control: DescriptionCommentsControl = {
    planId: TASK,
    threads: [thread],
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async () => ({ note: "not in this test" }),
    act: async () => true,
  };
  const { container, frame, press } = mount(
    FUNNEL,
    readSource,
    true,
    { taskId: TASK },
    {
      control,
      doors: { agents: undefined, me: "u-dean" },
    },
  );
  const posted = framePosts(frame());
  const box = { left: 10, top: 20, right: 200, bottom: 40 };

  act(() => {
    frame().dispatchEvent(new Event("load"));
  });
  postFrom(frame().contentWindow, { type: PAGE_PICK_TYPE, marks: [{ path, box }] });
  await press("Comment on the page");
  // The press in the frame is the developer's, which the window holds as the pick lands.
  vi.stubGlobal("navigator", { ...navigator, userActivation: { isActive: true } });
  postFrom(frame().contentWindow, {
    type: PAGE_PICK_TYPE,
    picked: { path: "body > h2:nth-of-type(1)", quote: "Totals", section: "", box },
  });

  assert.deepEqual(posted, [
    { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.MARK, marks: [{ path }] },
    { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.START },
    { type: PAGE_PICK_TYPE, act: PAGE_PICK_ACT.STOP },
  ]);
  assert.ok(
    container.querySelector('button.ui-comment-pin[aria-label="1 comment"]'),
    "the element is pinned",
  );
  const field = container.querySelector(".page-comment-float");
  assert.ok(field, "the comment is started by the element");
  assert.match(field.textContent ?? "", /Totals/);

  // A press in the page, selecting nothing, is a press away, which lets go of a comment holding no words of its own.
  postFrom(frame().contentWindow, { type: PAGE_PICK_TYPE, pressed: true });
  const standing = container.querySelector(
    ".ui-rect-float:not([data-leaving]) .page-comment-float",
  );
  assert.ok(standing === null, "the comment being started goes");
});

/** The page's pane over `control`, an element of it picked and `words` held on it in the reader's review, as the reader would. */
function holdOnElement(control: DescriptionCommentsControl, words: string) {
  const mounted = mount(
    FUNNEL,
    readSource,
    true,
    { taskId: TASK },
    {
      control,
      doors: { agents: undefined, me: "u-dean" },
    },
  );
  const { container, frame } = mounted;
  const box = { left: 10, top: 20, right: 200, bottom: 40 };
  act(() => {
    frame().dispatchEvent(new Event("load"));
  });
  act(() => buttonLabeled(container, "Comment on the page").click());
  // Note that the summary's editor reads the platform off the navigator, so the stand-in keeps it.
  vi.stubGlobal("navigator", {
    ...navigator,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    userActivation: { isActive: true },
  });
  postFrom(frame().contentWindow, {
    type: PAGE_PICK_TYPE,
    picked: { path: "body > h2:nth-of-type(1)", quote: "Totals", section: "", box },
  });
  const field = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Add a comment"]',
  );
  assert.ok(field, "the comment is started by the element");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      words,
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => buttonNamed(container, "Start a review").click());
  return mounted;
}

/** The button inside `within` named `label`. */
function buttonLabeled(within: ParentNode, label: string): HTMLButtonElement {
  return (
    within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    assert.fail(`a button labeled ${label}`)
  );
}

test("a comment held in a review stands in the Review panel under its element's words, never in the comments column; Send review starts it held, then the summary naming it along, and a summary refused leaves the comment posted fixed, so Retry sends the summary alone and closes the panel", async () => {
  const starts: DescriptionCommentStart[] = [];
  // Note that the service refuses the summary the first time it is sent.
  let refusals = 1;
  const control: DescriptionCommentsControl = {
    planId: TASK,
    threads: [],
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async (start) => {
      starts.push(start);
      if (start.words === "Ship it once these are in." && refusals > 0) {
        refusals -= 1;
        return { note: "The service is unavailable." };
      }
      return {
        thread: {
          id: start.id ?? start.clientKey,
          scope: DESCRIPTION_COMMENT_SCOPE.ELEMENT,
          quote: "Totals",
          section: "",
          status: DESCRIPTION_COMMENT_STATUS.OPEN,
          entries: [],
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
      };
    },
    act: async () => true,
  };
  const { container, press } = holdOnElement(control, "Per week?");

  await press("Show comments");
  const column = container.querySelector(".page-comments-column");
  assert.ok(column, "the comments column stands");
  assert.doesNotMatch(
    column.textContent ?? "",
    /Per week\?/,
    "the column lists posted threads alone",
  );

  await press("Review, 1 pending comment");
  const panel = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(panel, "Review opens its panel");
  const held = panel.querySelector("ol");
  assert.ok(held, "the panel lists the held comment");
  assert.match(held.textContent ?? "", /Totals/, "under its element's words");
  assert.match(held.textContent ?? "", /Per week\?/);
  // The summary's editor stands once its bundle has loaded, a turn after the panel opens.
  const summary = await vi.waitFor(
    () =>
      panel.querySelector<TiptapEditorHTMLElement>(
        `${EDITOR_ROOT_SELECTOR}[aria-label="Review comment"]`,
      )?.editor ?? assert.fail("the panel takes a summary"),
  );
  act(() => {
    summary.commands.setContent("Ship it once these are in.", { contentType: "markdown" });
  });
  // An edit standing open holds the review back until it is saved or canceled.
  await act(async () =>
    (
      held.querySelector<HTMLButtonElement>('button[aria-label="Comment actions"]') ??
      assert.fail("the held comment offers its ⋯")
    ).click(),
  );
  chooseMenuItem("Edit");
  assert.equal(buttonNamed(panel, "Send review").disabled, true, "Send waits on the edit");
  await act(async () => buttonNamed(held, "Cancel").click());
  assert.equal(buttonNamed(panel, "Send review").disabled, false, "Send stands once it is let go");
  await act(async () => buttonNamed(panel, "Send review").click());
  // Note that each start waits on the one before, so the summary goes once the held comment has landed.
  await vi.waitFor(() => assert.equal(starts.length, 2));
  await vi.waitFor(() => assert.match(panel.textContent ?? "", /could not be sent/u));
  // Note that the refused summary now stands held after it, editable as any comment not yet sent.
  const posted = held.querySelector("li");
  assert.match(posted?.textContent ?? "", /Per week\?/u);
  assert.equal(
    posted?.querySelector('button[aria-label="Comment actions"]') === null,
    true,
    "the comment posted already is neither edited nor deleted",
  );

  await act(async () => buttonNamed(panel, "Retry").click());
  await vi.waitFor(() => assert.equal(starts.length, 3));

  assert.deepEqual(
    starts.map((start) => ({
      element: "element" in start ? start.element?.path : undefined,
      words: start.words,
      held: "held" in start ? start.held : undefined,
      along: "along" in start ? start.along : undefined,
    })),
    [
      { element: "body > h2:nth-of-type(1)", words: "Per week?", held: true, along: undefined },
      {
        element: undefined,
        words: "Ship it once these are in.",
        held: undefined,
        along: [starts[0]?.clientKey],
      },
      {
        element: undefined,
        words: "Ship it once these are in.",
        held: undefined,
        along: [starts[0]?.clientKey],
      },
    ],
  );
  assert.equal(starts[2]?.clientKey, starts[1]?.clientKey, "the summary goes again under its key");
  await vi.waitFor(() =>
    assert.equal(document.querySelector('[role="dialog"]'), null, "the panel closes"),
  );
});

/** The button inside `within` whose words are `words`. */
function buttonNamed(within: ParentNode, words: string): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === words,
  );
  return found ?? assert.fail(`a button named ${words}`);
}

test("Discard after a send that stopped part way deletes the threads it posted already, so the review leaves nothing behind, and keeps one the service would not delete for the next Discard, never to be sent", async () => {
  const starts: DescriptionCommentStart[] = [];
  const acted: [string, unknown][] = [];
  const control: DescriptionCommentsControl = {
    planId: TASK,
    threads: [],
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async (start) => {
      starts.push(start);
      // Note that the service takes the held comment and refuses the summary that sends the review.
      if (start.words === "That's all.") return { note: "The service is unavailable." };
      return {
        thread: {
          id: start.clientKey,
          scope: DESCRIPTION_COMMENT_SCOPE.ELEMENT,
          quote: "Totals",
          section: "",
          status: DESCRIPTION_COMMENT_STATUS.OPEN,
          entries: [],
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        },
      };
    },
    act: async (threadId, action) => {
      acted.push([threadId, action]);
      // Note that the service refuses the first deletion and takes the next.
      return acted.length > 1;
    },
  };
  const { press } = holdOnElement(control, "Per week?");
  await press("Review, 1 pending comment");
  const panel = document.querySelector<HTMLElement>('[role="dialog"]') ?? assert.fail();
  const summary = await vi.waitFor(
    () =>
      panel.querySelector<TiptapEditorHTMLElement>(
        `${EDITOR_ROOT_SELECTOR}[aria-label="Review comment"]`,
      )?.editor ?? assert.fail("the panel takes a summary"),
  );
  act(() => {
    summary.commands.setContent("That's all.", { contentType: "markdown" });
  });
  await act(async () => buttonNamed(panel, "Send review").click());
  await vi.waitFor(() => assert.match(panel.textContent ?? "", /could not be sent/u));

  await act(async () => buttonNamed(panel, "Discard").click());
  const question =
    document.querySelector<HTMLElement>('[role="alertdialog"]') ??
    assert.fail("Discard asks first");
  await act(async () => buttonNamed(question, "Discard review").click());

  await act(async () => undefined);
  assert.deepEqual(acted, [
    [starts[0]?.clientKey, { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD }],
  ]);
  assert.equal(
    document.querySelector('button[aria-label^="Review, "]'),
    null,
    "the thread the service would not delete is counted no more, so no Send hands it on",
  );
  assert.equal(buttonNamed(panel, "Send review").disabled, true, "nothing is left to send");

  await act(async () => buttonNamed(panel, "Discard").click());
  await act(async () =>
    buttonNamed(
      document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail(),
      "Discard review",
    ).click(),
  );
  await act(async () => undefined);
  assert.equal(acted.length, 2, "the next Discard tries it again");
  assert.equal(
    document.querySelector('button[aria-label^="Review, "]'),
    null,
    "and lets it go once it is deleted",
  );
});
