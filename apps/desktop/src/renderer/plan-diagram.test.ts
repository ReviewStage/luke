// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_TASK } from "#testing/document-task";
import {
  DIAGRAM_APPEARANCE,
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
} from "./diagram/contract";
import { MarkdownMessage } from "./markdown-message";
import { PlanBody } from "./tasks/plan-body";
import { HISTORY_READ } from "./tasks/use-plan-history";
import { VersionView } from "./tasks/version-view";

/**
 * plan-diagram.test.ts -- a ```` ```mermaid ```` fence on a plan's page and
 * in its versions draws as the picture the diagram bundle answered, its code
 * a press away; a fence the bundle refuses says so over its code; a fence
 * whose code a version changed is drawn as its code with the changes marked;
 * and every other fence, and every fence where the words are not a plan's,
 * stays code. Mermaid cannot lay out under jsdom, so the bundle stands in at
 * its one boundary, `window.lukeDiagram`, answering a picture named by the
 * code and the appearance it was asked in. Synthetic plan.
 */

/** The code the stand-in refuses, as Mermaid refuses code it cannot parse. */
const UNPARSED = "flowchart LR\n  A -->";

/** What the stand-in answers: a picture named by what it was asked to draw, or a refusal for `UNPARSED`. */
function stoodInDrawing(code: string, appearance: DiagramAppearance): DiagramDrawing {
  if (code === UNPARSED) return { kind: DIAGRAM_DRAWING.REFUSED };
  return { kind: DIAGRAM_DRAWING.DRAWN, url: pictureOf(code, appearance) };
}

/** The address the stand-in answers for a code in an appearance. */
function pictureOf(code: string, appearance: DiagramAppearance): string {
  return `data:image/svg+xml,${encodeURIComponent(`${appearance}:${code}`)}`;
}

// The bundle already loaded, as it is once a diagram has been shown in this window.
window.lukeDiagram = {
  draw: (code, appearance) => Promise.resolve(stoodInDrawing(code, appearance)),
};

/** Whether the window is in its dark appearance, and who hears it flip. */
const appearance = { dark: false, listeners: new Set<() => void>() };

const roots: Root[] = [];

beforeEach(() => {
  appearance.dark = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return appearance.dark;
      },
      addEventListener: (_type: string, listener: () => void) => appearance.listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        appearance.listeners.delete(listener),
    }),
  });
  fakeAppBridge({
    act: (): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
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

/** `node` drawn in a window of its own, once every draw it asked for has landed. */
async function drawn(node: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), node)));
  await settle();
  return container;
}

/** A plan whose text holds `fence` under a heading. */
function planWith(fence: string): Task {
  return { ...DOCUMENT_TASK, document: { body: `## Flow\n\n${fence}\n`, assumptions: [] } };
}

/** A Mermaid fence around `code`. */
const mermaidFence = (code: string) => `\`\`\`mermaid\n${code}\n\`\`\``;

/** The diagrams a page draws, as their pictures' addresses. */
function pictures(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll(".plan-diagram img")].map((img) => img.getAttribute("src"));
}

/** The diagram's Show code, or Show diagram, toggle. */
function toggle(container: HTMLElement): HTMLButtonElement {
  return (
    container.querySelector<HTMLButtonElement>(".plan-diagram-head button") ??
    assert.fail("the diagram has its toggle")
  );
}

/** A version of the plan drawn against the one before it, as the version history draws it. */
function Version({ previous, now }: { previous: string; now: string }): ReactNode {
  const restore = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  return createElement(VersionView, {
    viewing: {
      line: {
        seq: 2,
        lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 2, duringCall: false },
        startedAt: 1,
        changes: 1,
      },
      current: false,
      read: {
        kind: HISTORY_READ.READY,
        previous: { body: previous, assumptions: [] },
        document: { body: now, assumptions: [] },
      },
    },
    restore,
  });
}

test("a Mermaid fence on a plan's page draws as the picture the diagram bundle answered, out of the screen recording", async () => {
  const code = "sequenceDiagram\n  Admin->>Service: Invite";

  const page = await drawn(
    createElement(PlanBody, { task: planWith(mermaidFence(code)), live: false }),
  );

  assert.deepEqual(pictures(page), [pictureOf(code, DIAGRAM_APPEARANCE.LIGHT)]);
  assert.equal(page.querySelector(".plan-diagram pre"), null);
  assert.ok(page.querySelector(".plan-diagram")?.classList.contains("ph-no-capture"));
});

test("Show code puts the fence's code in the picture's place, and Show diagram brings the picture back", async () => {
  const code = "flowchart LR\n  Invite --> Join";
  const page = await drawn(
    createElement(PlanBody, { task: planWith(mermaidFence(code)), live: false }),
  );

  act(() => toggle(page).click());

  assert.deepEqual(pictures(page), []);
  assert.equal(page.querySelector(".plan-diagram pre")?.textContent, `${code}\n`);
  assert.equal(toggle(page).textContent, "Show diagram");

  act(() => toggle(page).click());

  assert.deepEqual(pictures(page), [pictureOf(code, DIAGRAM_APPEARANCE.LIGHT)]);
  assert.equal(toggle(page).textContent, "Show code");
});

test("a fence the diagram bundle refuses says it could not be drawn, over its code", async () => {
  const page = await drawn(
    createElement(PlanBody, { task: planWith(mermaidFence(UNPARSED)), live: false }),
  );

  assert.deepEqual(pictures(page), []);
  assert.equal(
    page.querySelector(".plan-diagram-failed")?.textContent,
    "This diagram could not be drawn.",
  );
  assert.equal(page.querySelector(".plan-diagram pre")?.textContent, `${UNPARSED}\n`);
});

test("the diagram is drawn again in the window's new appearance when it flips", async () => {
  const code = "flowchart TD\n  Accept --> Member";
  const page = await drawn(
    createElement(PlanBody, { task: planWith(mermaidFence(code)), live: false }),
  );

  appearance.dark = true;
  act(() => {
    for (const listener of appearance.listeners) listener();
  });
  await settle();

  assert.deepEqual(pictures(page), [pictureOf(code, DIAGRAM_APPEARANCE.DARK)]);
});

test("a fence in another language, and a Mermaid fence where the words are not a plan's, stay code", async () => {
  const code = "flowchart LR\n  Caption --> Code";
  const shell = "```sh\npnpm install\n```";

  const page = await drawn(createElement(PlanBody, { task: planWith(shell), live: false }));
  const caption = await drawn(createElement(MarkdownMessage, { words: mermaidFence(code) }));

  assert.equal(page.querySelector(".plan-diagram"), null);
  assert.equal(page.querySelector("pre")?.textContent, "pnpm install\n");
  assert.equal(caption.querySelector(".plan-diagram"), null);
  assert.equal(caption.querySelector("pre")?.textContent, `${code}\n`);
});

test("a version draws a fence it left alone as its diagram, and one whose code it changed as its code with the changes marked", async () => {
  const kept = "sequenceDiagram\n  Mail-->>Invitee: Link";
  const before = "flowchart LR\n  Invite --> Join";
  const after = "flowchart LR\n  Invite --> Accept";

  const version = await drawn(
    createElement(Version, {
      previous: `## Flow\n\n${mermaidFence(kept)}\n\n## Steps\n\n${mermaidFence(before)}\n`,
      now: `## Flow\n\n${mermaidFence(kept)}\n\n## Steps\n\n${mermaidFence(after)}\n`,
    }),
  );

  assert.deepEqual(pictures(version), [pictureOf(kept, DIAGRAM_APPEARANCE.LIGHT)]);
  const changed = [...version.querySelectorAll("pre")].find((pre) =>
    pre.textContent?.includes("Invite"),
  );
  assert.ok(changed, "the changed fence stands as its code");
  assert.equal(changed.closest(".plan-diagram"), null);
  assert.deepEqual(
    [...changed.querySelectorAll("del, ins")].map((mark) => [mark.tagName, mark.textContent]),
    [
      ["DEL", "Join"],
      ["INS", "Accept"],
    ],
  );
});
