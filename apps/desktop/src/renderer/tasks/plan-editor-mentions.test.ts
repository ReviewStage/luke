// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { TASK_TREE_ENTRY, type Task } from "@luke/features/task-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { ACTOR_KIND, ACTOR_STATE } from "@luke/ui/actor-model";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { editorBundleLanded, installEditorLayout } from "#testing/composer";
import { DOCUMENT_TASK } from "#testing/document-task";
import { PlanBody } from "./plan-body";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions";

/**
 * `@` in the plan's editor over the real editor bundle: the word typed
 * opens the list of the plan's sections and the repository's files,
 * grouped by kind and narrowed by the word; Enter writes the highlighted
 * row as its mention, drawn in the editor as its chip. Synthetic plan and
 * repository.
 */

const PLAN: Task = {
  ...DOCUMENT_TASK,
  repository: "acme/relay",
  document: { body: "## Goal\n\nInvite by email.\n\n## Rollout\n\nStore first.", assumptions: [] },
};

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installEditorLayout();
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.TASKS_TREE
          ? {
              status: ACT_OUTCOME_STATUS.DONE,
              value: {
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
              },
            }
          : { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT },
      ),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The plan's page drawn editable with its mentions, its editor opened on Rollout, under the page's mentions where given. */
async function opened(page?: TaskMentionsValue, plan: Task = PLAN) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const body = createElement(PlanBody, {
    task: plan,
    live: false,
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
      page === undefined ? body : createElement(TaskMentions, { value: page, children: body }),
    ),
  );
  const rollout = container.querySelector<HTMLElement>('[role="group"][aria-label="Rollout"]');
  assert.ok(rollout);
  // Opened by Enter on its block, which places the caret by section rather than by a point jsdom cannot lay out.
  act(() => rollout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);
  const element = container.querySelector<TiptapEditorHTMLElement>(".plan-document-text");
  const editor = element?.editor;
  assert.ok(element && editor, "the plan's editor is open");
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
    [...group.querySelectorAll(".luke-combobox-option-label")].map(
      (name) => name.textContent ?? "",
    ),
  ]);
}

test("an @ typed in the plan offers the plan's sections and, as the word is typed, the repository's files, grouped by kind", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @");
  const empty = listed(task.container);
  await task.typeAtEnd("roll");

  assert.deepEqual(empty, [
    ["Plan", ["Goal", "Rollout", "Teammate invitations"]],
    ["Mention from", ["Files and folders", "Plan"]],
  ]);
  assert.deepEqual(listed(task.container), [
    ["Files and folders", ["rollout-store.ts"]],
    ["Plan", ["Rollout"]],
  ]);
});

test("Enter writes the highlighted row as its mention, drawn in the editor as its chip, and closes the list", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @roll");
  task.press("ArrowDown");
  task.press("Enter");
  await act(async () => undefined);

  const chips = [...task.container.querySelectorAll(".plan-document-text [data-mention-ref]")];
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Rollout"],
  );
  assert.equal(task.container.querySelector(".mention-menu"), null);
});

test("Escape closes the list and leaves the editor open", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @roll");
  task.press("Escape");

  assert.equal(task.container.querySelector(".mention-menu"), null);
  assert.notEqual(task.container.querySelector(".plan-document-text"), null);
});

test("words typed past a space that match nothing close the list, and words that match keep it", async () => {
  const task = await opened();

  await task.typeAtEnd(" See @zzq");
  const oneWord = task.container.querySelector(".mention-menu")?.textContent ?? "";
  await task.typeAtEnd(" later");
  const proseClosed = task.container.querySelector(".mention-menu") === null;
  await task.typeAtEnd(" Ask @Teammate inv");

  assert.match(oneWord, /Nothing matches/u);
  assert.ok(proseClosed, "the list closes once the words past a space match nothing");
  assert.deepEqual(listed(task.container), [["Plan", ["Teammate invitations"]]]);
});

test("a heading just renamed is offered by its new words, before the editor hands its draft over", async () => {
  const task = await opened();

  await task.typeAfter("Rollout", " plan");
  await task.typeAtEnd(" See @roll");

  assert.deepEqual(
    listed(task.container).find(([group]) => group === "Plan"),
    ["Plan", ["Rollout plan"]],
  );
});

test("on the plan's page an @ typed in the plan offers its pages and its agents too", async () => {
  const page: TaskMentionsValue = {
    taskId: PLAN.id,
    taskName: PLAN.name,
    workspace: "acme",
    repository: PLAN.repository,
    text: () => PLAN.document.body,
    pages: [{ id: "page-1", title: "Invites by week" }],
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
      taskId: PLAN.id,
      place: { workspace: "acme", repository: PLAN.repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: () => undefined,
      onOpenFile: undefined,
    },
  };
  const plan = await opened(page);

  await plan.typeAtEnd(" @");

  assert.deepEqual(
    listed(plan.container).map(([group]) => group),
    ["Plan", "Pages", "Agents", "Mention from"],
  );
});

test("on the plan's page an @ typed in the plan offers the workspace's other agents after its own, each labelled by its task", async () => {
  const agent = (id: string, name: string) => ({
    id,
    name,
    actor: { kind: ACTOR_KIND.AGENT, name, provider: undefined, state: ACTOR_STATE.REST },
  });
  const page: TaskMentionsValue = {
    taskId: PLAN.id,
    taskName: PLAN.name,
    workspace: "acme",
    repository: PLAN.repository,
    text: () => PLAN.document.body,
    agents: [agent("agent-2", "Wire the desktop")],
    readAgents: () =>
      Promise.resolve([
        { ...agent("agent-3", "Bill by seat"), task: { id: "task-billing", name: "Billing" } },
        agent("agent-4", "Sweep flaky tests"),
      ]),
    doors: {
      taskId: PLAN.id,
      place: { workspace: "acme", repository: PLAN.repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: () => undefined,
      onOpenFile: undefined,
    },
  };
  const plan = await opened(page);

  await plan.typeAtEnd(" @");

  assert.deepEqual(
    listed(plan.container).find(([group]) => group === "Agents"),
    ["Agents", ["Wire the desktop", "Bill by seat", "Sweep flaky tests"]],
  );
});

test("a section's address pasted whole into the plan is laid in as its chip, called by its heading", async () => {
  const plan = await opened();
  const goal = encodeMention(
    { kind: MENTION_KIND.SECTION, taskId: PLAN.id, anchor: "goal" },
    { workspace: "acme", repository: PLAN.repository },
  );

  await plan.typeAtEnd(" See ");
  await plan.pasteAtEnd(goal);

  const chips = [...plan.container.querySelectorAll(".plan-document-text [data-mention-ref]")];
  assert.deepEqual(
    chips.map((chip) => chip.textContent),
    ["Goal"],
  );
});

/** What the crumb over a narrowed list names: its kind or the folder walked into; none over a wide list. */
function crumb(container: HTMLElement): string | undefined {
  return container.querySelector(".mention-menu-crumb-title")?.textContent ?? undefined;
}

test("a plan with no repository offers no files and folders to narrow to", async () => {
  const plan = await opened(undefined, { ...PLAN, repository: null });

  await plan.typeAtEnd(" See @");

  assert.deepEqual(
    listed(plan.container).find(([group]) => group === "Mention from"),
    ["Mention from", ["Plan"]],
  );
});

test("a bare @ in the plan narrows by its kind's row to the repository's paths, where → walks into a folder, ⌫ climbs out, and Enter writes the folder", async () => {
  const plan = await opened();

  await plan.typeAtEnd(" See @");
  plan.press("ArrowDown");
  plan.press("ArrowDown");
  plan.press("ArrowDown");
  plan.press("ArrowRight");
  await act(async () => undefined);
  const narrowed = [crumb(plan.container), listed(plan.container)];
  plan.press("ArrowRight");
  plan.press("ArrowDown");
  plan.press("ArrowRight");
  const inWeb = [crumb(plan.container), listed(plan.container)];
  plan.press("Backspace");
  const climbed = [crumb(plan.container), listed(plan.container)];
  plan.press("ArrowDown");
  plan.press("Enter");
  await act(async () => undefined);

  assert.deepEqual(narrowed, ["Files and folders", [["Files and folders", ["apps/"]]]]);
  assert.deepEqual(inWeb, ["apps/web", [["apps/web", ["web/", "rollout-store.ts"]]]]);
  assert.deepEqual(climbed, ["apps", [["apps", ["apps/", "web/"]]]]);
  assert.deepEqual(
    [...plan.container.querySelectorAll(".plan-document-text [data-mention-ref]")].map(
      (chip) => chip.textContent,
    ),
    ["web/"],
  );
});

test("@plan: typed in the plan narrows the list to the plan, searched by the words after the colon", async () => {
  const plan = await opened();

  await plan.typeAtEnd(" See @plan:");
  const all = listed(plan.container);
  await plan.typeAtEnd("roll");

  assert.equal(crumb(plan.container), "Plan");
  assert.deepEqual(all, [["Plan", ["Goal", "Rollout", "Teammate invitations"]]]);
  assert.deepEqual(listed(plan.container), [["Plan", ["Rollout"]]]);
});

test("on the plan's page an @ typed in the plan offers the pull requests its agents published, a pick written as its link's chip", async () => {
  const page: TaskMentionsValue = {
    taskId: PLAN.id,
    taskName: PLAN.name,
    workspace: "acme",
    repository: PLAN.repository,
    text: () => PLAN.document.body,
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
      taskId: PLAN.id,
      place: { workspace: "acme", repository: PLAN.repository },
      anchors: new Set(["goal", "rollout"]),
      onOpenTask: () => undefined,
      onOpenFile: undefined,
    },
  };
  const plan = await opened(page);

  await plan.typeAtEnd(" See @seat");
  const offered = listed(plan.container);
  plan.press("Enter");
  await act(async () => undefined);

  assert.deepEqual(offered, [["Pull requests", ["#3059 feat(billing): bill by seat"]]]);
  assert.deepEqual(
    [...plan.container.querySelectorAll(".plan-document-text [data-mention-ref]")].map(
      (chip) => chip.textContent,
    ),
    ["#3059 feat(billing): bill by seat"],
  );
});
