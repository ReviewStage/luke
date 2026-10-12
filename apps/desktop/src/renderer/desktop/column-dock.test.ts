// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { builtStylesheet, cssRules } from "#testing/css-rules";
import { relayout } from "#testing/resize-observer";
import { useColumnDock } from "./column-dock";

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** An element at a staged place on the screen, since jsdom lays out nothing. */
function placed(element: Element, top: number, bottom: number): Element {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top }),
  });
  return element;
}

function part(className: string, top: number, bottom: number): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  placed(element, top, bottom);
  return element;
}

/** A shell over the page given, the hook reading it as the desktop shell does. */
function Shell({ panelFull, page }: { panelFull: boolean; page: HTMLElement }): React.JSX.Element {
  const shell = useRef<HTMLDivElement>(null);
  useColumnDock(shell, panelFull, `${panelFull}`);
  return createElement("div", {
    className: "desktop-shell",
    ref: (element: HTMLDivElement | null) => {
      shell.current = element;
      if (element !== null && !element.contains(page)) element.append(page);
    },
  });
}

function draw(page: HTMLElement, panelFull = false): HTMLElement {
  act(() => {
    root ??= createRoot(document.body.appendChild(document.createElement("div")));
    root.render(createElement(Shell, { panelFull, page }));
  });
  const shell = document.querySelector<HTMLElement>(".desktop-shell");
  assert.ok(shell);
  return shell;
}

const dock = (shell: HTMLElement) => shell.style.getPropertyValue("--column-dock");

test("over an agent's tab the card's dock is the composer, its to-do list, and the call bar, and it grows when to-dos appear", async () => {
  // A 700-tall window: the call bar's 61 at its foot, the composer's 99 card and inset over it.
  const column = part("desktop-plan-main", 0, 700);
  const agent = column.appendChild(part("desktop-agent", 0, 639));
  agent.append(part("agent-composer", 540, 639));
  column.append(part("desktop-call-bar", 639, 700));
  const shell = draw(column);
  assert.equal(dock(shell), "160px");

  // A to-do list arrives over the composer, 80 tall.
  const todos = part("agent-todos-dock", 460, 540);
  await act(async () => {
    agent.insertBefore(todos, agent.lastElementChild);
  });
  assert.equal(dock(shell), "240px");
  // The composer grows a line: the observer reads the new tops.
  placed(todos, 440, 520);
  act(() => relayout());
  assert.equal(dock(shell), "260px");
});

test("while the side panel fills the window the card's dock is the panel's own, or none", () => {
  const page = document.createElement("div");
  const column = page.appendChild(part("desktop-plan-main", 0, 700));
  column.append(part("desktop-call-bar", 639, 700));
  const panel = page.appendChild(part("side-panel", 0, 700));
  const composer = panel.appendChild(part("agent-composer", 580, 700));
  const shell = draw(page, true);
  assert.equal(dock(shell), "120px");
  composer.remove();
  act(() => relayout());
  assert.equal(dock(shell), "0px");
});

test("a shell with no plan column, Settings or a version history, says no dock, and the card keeps the corner", async () => {
  const shell = draw(part("settings-pages", 0, 700));
  assert.equal(dock(shell), "");
  const rules = cssRules(await builtStylesheet());
  const floating = rules.find((rule) =>
    rule.selectors.includes('.call-card[data-surface="floating"]'),
  );
  assert.equal(floating?.declarations.get("bottom"), "var(--space-16)");
  assert.equal(
    floating?.declarations.get("translate"),
    "0 calc(-1 * max(0px, var(--column-dock, 0px) + var(--space-8) - var(--space-16)))",
  );
  assert.match(floating?.declarations.get("transition") ?? "", /^translate var\(--duration-fast\)/);
});

test("the transcript under the card keeps its last line clear of it, by the card's own height", async () => {
  const column = part("desktop-plan-main", 0, 700);
  const shell = draw(column);
  const card = part("call-card", 400, 476);
  card.dataset.surface = "floating";
  await act(async () => {
    shell.append(card);
  });
  assert.equal(shell.style.getPropertyValue("--floating-card"), "76px");
  const rules = cssRules(await builtStylesheet());
  const transcript = rules.find((rule) =>
    rule.selectors.some(
      (selector) =>
        selector.replace(/\s+/g, " ") ===
        '.desktop-shell:has(> .call-card[data-surface="floating"]) :is(.desktop-agent, .side-panel-content) [role="log"]',
    ),
  );
  assert.equal(
    transcript?.declarations.get("padding-bottom"),
    "calc(var(--space-20) + var(--floating-card, 0px) + var(--space-8))",
  );
});
