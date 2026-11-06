// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { TASK_TREE_ENTRY, type Task } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { ACTOR_KIND, ACTOR_STATE } from "@repo/ui/actor-model";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Effect } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handState, registryWith } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { DescriptionBody } from "./description-body.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";

/**
 * `@` in the description's editor over the real editor bundle: the word typed
 * opens the list of the description's sections and the repository's files,
 * grouped by kind and narrowed by the word; Enter writes the highlighted
 * row as its mention, drawn in the editor as its chip. Synthetic description and
 * repository.
 */

const TASK: Task = {
  ...DOCUMENT_TASK,
  repository: "acme/relay",
  document: { body: "## Goal\n\nInvite by email.\n\n## Rollout\n\nStore first.", assumptions: [] },
};

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installEditorLayout();
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.TASKS_TREE]: () =>
      Promise.resolve({
        folder: {
          path: "",
          repository: "acme/relay",
          branch: "main",
          entries: [
            { name: "apps/web/rollout-store.ts", kind: TASK_TREE_ENTRY.FILE },
            { name: "apps/web", kind: TASK_TREE_ENTRY.FOLDER },
            { name: "apps", kind: TASK_TREE_ENTRY.FOLDER },
          ],
          truncated: false,
        },
      }),
  });
});

afterEach(async () => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  // Note that the saves a description left as it went answer before its atoms go.
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.innerHTML = "";
});

/**
 * The plan's page drawn editable with its mentions, its editor opened on
 * Rollout, under the page's mentions where given. Note that it draws on a
 * registry of its own, as the window's root provides one, because the
 * minute a date's chip is said from is an atom: on the one registry every
 * test shares, a test before it would have started that minute on the real
 * clock, and a test that sets the date would read that one instead.
 */
async function opened(page?: TaskMentionsValue, task: Task = TASK) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS));
  registries.push(registry);
  const body = createElement(DescriptionBody, {
    task: task,
    onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
    sectionLinks: {
      workspace: "acme",
      onOpen: () => undefined,
      onOpenFile: () => undefined,
      reveal: undefined,
    },
  });
  act(() =>
    root.render(
      onRegistry(
        registry,
        page === undefined ? body : createElement(TaskMentions, { value: page, children: body }),
      ),
    ),
  );
  const rollout = container.querySelector<HTMLElement>('[role="group"][aria-label="Rollout"]');
  assert.ok(rollout);
  // Opened by Enter on its block, which places the caret by section rather than by a point jsdom cannot lay out.
  act(() => rollout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);
  const element = container.querySelector<TiptapEditorHTMLElement>(".description-document-text");
  const editor = element?.editor;
  assert.ok(element && editor, "the description's editor is open");
  /** The words typed at the end of the text, as the editor's own input inserts them. */
  const typeAtEnd = async (words: string) => {
    act(() => {
      editor.view.focus();
      const end = TextSelection.atEnd(editor.state.doc);
      editor.view.dispatch(editor.state.tr.setSelection(end));
      editor.view.dispatch(editor.state.tr.insertText(words));
    });
    await act(async () => undefined);
  };
  const press = (key: string) =>
    act(() => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  /** The words typed right after the words given, as the editor's own input inserts them. */
  const typeAfter = async (words: string, typed: string) => {
    act(() => {
      let at: number | undefined;
      editor.state.doc.descendants((node, position) => {
        if (at === undefined && node.isText && node.text?.includes(words)) {
          at = position + (node.text.indexOf(words) + words.length);
        }
      });
      assert.ok(at !== undefined, `the text holds ${words}`);
      editor.view.focus();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
      );
      editor.view.dispatch(editor.state.tr.insertText(typed));
    });
    await act(async () => undefined);
  };
  /** Words pasted at the end of the text, as the system's clipboard hands them over. */
  const pasteAtEnd = async (words: string) => {
    act(() => {
      editor.view.focus();
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [],
          types: ["text/plain"],
          getData: (type: string) => (type === "text/plain" ? words : ""),
        },
      });
      editor.view.dom.dispatchEvent(event);
    });
    await act(async () => undefined);
  };
  return { container, typeAtEnd, typeAfter, press, pasteAtEnd };
}

/** The list's groups as it draws them: each heading and its rows' names. */
function listed(container: HTMLElement): [string, string[]][] {
  return [...container.querySelectorAll('.mention-menu [role="group"]')].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll(".ui-combobox-option-label")].map((name) => name.textContent ?? ""),
  ]);
}

test("an @ typed in the description offers the description's sections and, as the word is typed, the repository's files, grouped by kind", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @");
  const empty = listed(task.container);
  await task.typeAtEnd("roll");

  assert.deepEqual(empty, [
    ["Description", ["Goal", "Rollout", "Teammate invitations"]],
    ["Mention from", ["Description", "Files and folders", "Dates"]],
  ]);
  assert.deepEqual(listed(task.container), [
    ["Description", ["Rollout"]],
    ["Files and folders", ["rollout-store.ts"]],
  ]);
});

test("Enter writes the highlighted row as its mention, drawn in the editor as its chip, and closes the list", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @roll");
  task.press("Enter");
  await act(async () => undefined);

  const chips = [
    ...task.container.querySelectorAll(".description-document-text [data-mention-ref]"),
  ];
  assert.deepEqual(
    chips.map((chip) => chip.querySelector(".ui-inline-ref-label")?.textContent),
    ["Rollout"],
  );
  assert.equal(task.container.querySelector(".mention-menu"), null);
});

test("words after an @ that read as a time on a day, up to six of them, offer it first, and Enter draws it as a chip saying it from today", async () => {
  vi.useFakeTimers({ now: Date.parse("2026-10-19T12:00:00Z"), toFake: ["Date"] });
  try {
    const task = await opened();

    await task.typeAtEnd(" Ship @next fri at 3pm to 5pm");
    const offered = listed(task.container)[0];
    task.press("Enter");
    await act(async () => undefined);

    const chips = [
      ...task.container.querySelectorAll(".description-document-text [data-mention-ref]"),
    ];
    assert.deepEqual(offered, ["Dates", ["Oct 30 3:00 PM → 5:00 PM"]]);
    assert.deepEqual(
      chips.map((chip) => chip.querySelector(".ui-inline-ref-label")?.textContent),
      ["Oct 30 3:00 PM → 5:00 PM"],
    );
  } finally {
    vi.useRealTimers();
  }
});

test("Escape closes the list and leaves the editor open", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @roll");
  task.press("Escape");

  assert.equal(task.container.querySelector(".mention-menu"), null);
  assert.notEqual(task.container.querySelector(".description-document-text"), null);
});

test("words typed past a space that match nothing close the list, and words that match keep it", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @zzq");
  await vi.waitFor(() =>
    assert.match(
      task.container.querySelector(".mention-menu")?.textContent ?? "",
      /No results match/u,
    ),
  );
  const oneWord = task.container.querySelector(".mention-menu")?.textContent ?? "";
  await task.typeAtEnd(" later");
  const proseClosed = task.container.querySelector(".mention-menu") === null;
  await task.typeAtEnd(" Ask @Teammate inv");

  assert.match(oneWord, /No results match/u);
  assert.ok(proseClosed, "the list closes once the words past a space match nothing");
  assert.deepEqual(listed(task.container), [["Description", ["Teammate invitations"]]]);
});

test("the list says it is reading, never that nothing matches, while the repository's files are unread", async () => {
  fakeActPort({ [ACT_KIND.TASKS_TREE]: () => new Promise(() => undefined) });
  const task = await opened();

  await task.typeAtEnd(" See @zzq");
  const reading = task.container.querySelector(".mention-menu");

  assert.match(reading?.querySelector(".ui-combobox-note")?.textContent ?? "", /Reading/u);
  assert.equal(reading?.querySelector(".ui-combobox-empty"), null);
});

test("a heading just renamed is offered by its new words, before the editor hands its draft over", async () => {
  const task = await opened();

  await task.typeAfter("Rollout", " plan");
  await task.typeAtEnd(" See @roll");

  assert.deepEqual(
    listed(task.container).find(([group]) => group === "Description"),
    ["Description", ["Rollout plan"]],
  );
});

test("on the plan's page an @ typed in the description offers its pages and its agents too", async () => {
  const page: TaskMentionsValue = {
    holder: { taskId: TASK.id },
    taskName: TASK.name,
    workspace: "acme",
    repository: TASK.repository,
    text: () => TASK.document.body,
    pages: [{ id: "page-1", title: "Invites by week", version: 1, at: 1_000 }],
    agents: [
      {
        id: "agent-2",
        name: "Wire the desktop",
        actor: {
          kind: ACTOR_KIND.AGENT,
          name: "Wire the desktop",
          provider: undefined,
          state: ACTOR_STATE.REST,
        },
      },
    ],
    doors: {
      holder: { taskId: TASK.id },
      place: { workspace: "acme", repository: TASK.repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: () => undefined,
      onOpenFile: undefined,
    },
  };
  const description = await opened(page);

  await description.typeAtEnd(" @");

  assert.deepEqual(
    listed(description.container).map(([group]) => group),
    ["Agents", "Description", "Pages", "Mention from"],
  );
});

test("on the plan's page an @ typed in the description offers the workspace's other agents after its own, each labeled by its task", async () => {
  const agent = (id: string, name: string) => ({
    id,
    name,
    actor: { kind: ACTOR_KIND.AGENT, name, provider: undefined, state: ACTOR_STATE.REST },
  });
  const page: TaskMentionsValue = {
    holder: { taskId: TASK.id },
    taskName: TASK.name,
    workspace: "acme",
    repository: TASK.repository,
    text: () => TASK.document.body,
    agents: [agent("agent-2", "Wire the desktop")],
    readAgents: () =>
      Promise.resolve([
        { ...agent("agent-3", "Bill by seat"), task: { id: "task-billing", name: "Billing" } },
        agent("agent-4", "Sweep flaky tests"),
      ]),
    doors: {
      holder: { taskId: TASK.id },
      place: { workspace: "acme", repository: TASK.repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: () => undefined,
      onOpenFile: undefined,
    },
  };
  const description = await opened(page);

  await description.typeAtEnd(" @");

  assert.deepEqual(
    listed(description.container).find(([group]) => group === "Agents"),
    ["Agents", ["Wire the desktop", "Bill by seat", "Sweep flaky tests"]],
  );
});

test("a section's address pasted whole into the description is laid in as its chip, called by its heading", async () => {
  const description = await opened();
  const goal = encodeMention(
    { kind: MENTION_KIND.SECTION, taskId: TASK.id, anchor: "goal" },
    { workspace: "acme", repository: TASK.repository },
  );

  await description.typeAtEnd(" See ");
  await description.pasteAtEnd(goal);

  const chips = [
    ...description.container.querySelectorAll(".description-document-text [data-mention-ref]"),
  ];
  assert.deepEqual(
    chips.map((chip) => chip.querySelector(".ui-inline-ref-label")?.textContent),
    ["Goal"],
  );
});

test("a section's address naming its task by its number, pasted whole into the description, is laid in as the chip its id lays in, found among the window's tasks", async () => {
  handState(experimentsOn(EXPERIMENT.DESCRIPTIONS), {
    tasks: {
      ...IDLE_TASKS_VIEW,
      workspaces: [
        {
          id: "workspace-acme",
          name: "Acme",
          slug: "acme",
          role: WORKSPACE_ROLE.MEMBER,
          github: null,
        },
      ],
      tasks: [{ ...TASK, workspaceId: "workspace-acme", number: 42 }],
    },
  });
  const description = await opened();

  await description.typeAtEnd(" See ");
  await description.pasteAtEnd("https://vespin.dev/acme/task/42#goal");

  const chips = [
    ...description.container.querySelectorAll<HTMLElement>(
      ".description-document-text [data-mention-ref]",
    ),
  ];
  assert.deepEqual(
    chips.map((chip) => [
      chip.dataset.kind,
      chip.querySelector(".ui-inline-ref-label")?.textContent,
    ]),
    [[MENTION_KIND.SECTION, "Goal"]],
  );
});

/** What the crumb over a narrowed list names: its kind or the folder walked into; none over a wide list. */
function crumb(container: HTMLElement): string | undefined {
  return container.querySelector(".mention-menu-crumb-title")?.textContent ?? undefined;
}

test("a plan with no repository offers no files and folders to narrow to", async () => {
  const description = await opened(undefined, { ...TASK, repository: null });

  await description.typeAtEnd(" See @");

  assert.deepEqual(
    listed(description.container).find(([group]) => group === "Mention from"),
    ["Mention from", ["Description", "Dates"]],
  );
});

test("a bare @ in the description narrows by its kind's row to the repository's paths, where → walks into a folder, ⌫ climbs out, and Enter writes the folder", async () => {
  const description = await opened();

  await description.typeAtEnd(" See @");
  description.press("ArrowDown");
  description.press("ArrowDown");
  description.press("ArrowDown");
  description.press("ArrowDown");
  description.press("ArrowRight");
  await act(async () => undefined);
  const narrowed = [crumb(description.container), listed(description.container)];
  description.press("ArrowRight");
  description.press("ArrowDown");
  description.press("ArrowRight");
  const inWeb = [crumb(description.container), listed(description.container)];
  description.press("Backspace");
  const climbed = [crumb(description.container), listed(description.container)];
  description.press("ArrowDown");
  description.press("Enter");
  await act(async () => undefined);

  assert.deepEqual(narrowed, ["Files and folders", [["Files and folders", ["apps/"]]]]);
  assert.deepEqual(inWeb, ["apps/web", [["apps/web", ["web/", "rollout-store.ts"]]]]);
  assert.deepEqual(climbed, ["apps", [["apps", ["apps/", "web/"]]]]);
  assert.deepEqual(
    [
      ...description.container.querySelectorAll(".description-document-text [data-mention-ref]"),
    ].map((chip) => chip.querySelector(".ui-inline-ref-label")?.textContent),
    ["web/"],
  );
});

test("@plan: typed in the description narrows the list to the description, searched by the words after the colon", async () => {
  const description = await opened();

  await description.typeAtEnd(" See @plan:");
  const all = listed(description.container);
  await description.typeAtEnd("roll");

  assert.equal(crumb(description.container), "Description");
  assert.deepEqual(all, [["Description", ["Goal", "Rollout", "Teammate invitations"]]]);
  assert.deepEqual(listed(description.container), [["Description", ["Rollout"]]]);
});

test("on the description's page an @ typed in the description offers the pull requests its agents published, a pick written as its link's chip", async () => {
  const page: TaskMentionsValue = {
    holder: { taskId: TASK.id },
    taskName: TASK.name,
    workspace: "acme",
    repository: TASK.repository,
    text: () => TASK.document.body,
    pullRequests: [
      {
        number: 3059,
        title: "feat(billing): bill by seat",
        url: "https://github.com/acme/relay/pull/3059",
        state: PULL_REQUEST_STATE.OPEN,
        checks: CHECK_SUMMARY.PENDING,
        agent: "Bill by seat",
      },
    ],
    doors: {
      holder: { taskId: TASK.id },
      place: { workspace: "acme", repository: TASK.repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: () => undefined,
      onOpenFile: undefined,
    },
  };
  const description = await opened(page);

  await description.typeAtEnd(" See @seat");
  const offered = listed(description.container);
  description.press("Enter");
  await act(async () => undefined);

  assert.deepEqual(offered, [["Pull requests", ["#3059 feat(billing): bill by seat"]]]);
  assert.deepEqual(
    [
      ...description.container.querySelectorAll(".description-document-text [data-mention-ref]"),
    ].map((chip) => chip.querySelector(".ui-inline-ref-label")?.textContent),
    ["#3059"],
  );
});
