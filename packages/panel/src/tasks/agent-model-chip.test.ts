// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_PAYER,
  CODING_AGENT_RUNTIME,
  type CodingAgentPayer,
  type CodingAgentRuntime,
  type CodingAgentUsage,
} from "@luke/features/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@luke/features/models-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { AgentModelChip } from "./agent-model-chip.js";

/**
 * agent-model-chip.test.ts -- the chip's model menu stands still while it is
 * open: turning Fast on widens the chip leftward from its fixed trailing
 * edge, and the menu hung from that edge neither jumps on the frame the
 * chip widens nor once the resize is measured. On an agent that runs on
 * Claude Code it offers Claude models alone, with Fast and no Context row,
 * on Codex GPT models alone with neither, the list `list_models` answers
 * for the same catalog (`coder-agent-tools.test.ts`), while an eve agent's
 * offers all of it. A model whose plan runs no fast mode draws no Fast.
 * A Codex agent's menu ends on the ChatGPT plan that pays and a link to
 * manage its usage; no other agent's says what pays. An automation's chip
 * says a choice nothing of the reader's pays for cannot run; a running
 * agent's never does.
 */

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];

/** The chip's trailing edge on the composer's foot, which the controls after it hold still. */
const CHIP_RIGHT = 900;

/** The chip's width as its words draw it: wider once it says Fast. */
const CHIP_WIDTH = { STANDARD: 120, FAST: 160 } as const;

const MENU_HEIGHT = 300;

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  // The GPT model's row wears its harness's mark, an asset of the panel's.
  fakeAppPlatform({ assetBase: () => "https://luke.test/" });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function box(left: number, top: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

/**
 * Lays the composer's foot out as the window would, since jsdom lays out
 * nothing: the chip's box stands at a fixed trailing edge, as wide as its
 * words, and its menu's layer is as tall as a menu; the room is the window.
 */
function stageLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("agent-model-chip")) {
      const fast = this.querySelector(".model-label")?.textContent?.includes("Fast") ?? false;
      const width = fast ? CHIP_WIDTH.FAST : CHIP_WIDTH.STANDARD;
      return box(CHIP_RIGHT - width, 700, width, 24);
    }
    if (this.classList.contains("luke-anchored-popover")) return box(0, 0, 340, MENU_HEIGHT);
    return box(0, 0, 0, 0);
  });
}

/** The chip over a choice it changes at once, as `use-agent-model.ts` draws a pick before the service answers. */
function Owned(): React.JSX.Element {
  const [choice, setChoice] = useState<ModelChoice>({
    model: "anthropic/claude-opus-5.5",
    effort: "high",
  });
  return createElement(AgentModelChip, {
    model: { choice, note: undefined, choose: setChoice },
    models: MODELS,
    modelsFailed: false,
    readModels: () => undefined,
    usage: undefined,
  });
}

/** Where the open menu's left edge is drawn in the window: its layer's inset from whichever chip edge it is held by. */
function menuLeft(view: HTMLElement): number {
  const anchor = view.querySelector(".agent-model-chip");
  const layer = view.querySelector<HTMLElement>(".luke-anchored-popover");
  assert.ok(anchor !== null && layer !== null, "the menu is open over the chip");
  const chip = anchor.getBoundingClientRect();
  const width = Number.parseFloat(layer.style.width);
  if (layer.style.left !== "") return chip.left + Number.parseFloat(layer.style.left);
  assert.notEqual(layer.style.right, "", "the layer is placed by one of the chip's edges");
  return chip.right - Number.parseFloat(layer.style.right) - width;
}

test("turning Fast on in the chip's menu leaves the menu where it stood", () => {
  stageLayout();
  const view = document.createElement("div");
  document.body.append(view);
  const root = createRoot(view);
  roots.push(root);
  act(() => root.render(createElement(Owned)));

  const chip = view.querySelector<HTMLButtonElement>(".agent-model-chip button");
  assert.ok(chip);
  act(() => chip.click());
  const opened = menuLeft(view);
  assert.equal(opened, CHIP_RIGHT - 340, "the menu opens from the chip's trailing edge");

  const fast = view.querySelector<HTMLButtonElement>('[role="switch"]');
  assert.ok(fast, "the menu offers Fast");
  act(() => fast.click());
  assert.equal(fast.getAttribute("aria-checked"), "true", "Fast is on");
  assert.match(chip.textContent ?? "", /Fast/, "the chip says Fast, and is wider for it");
  assert.equal(menuLeft(view), opened, "the frame the chip widens on draws the menu in place");

  act(() => relayout());
  assert.equal(menuLeft(view), opened, "the measured resize keeps the menu in place");

  act(() => fast.click());
  act(() => relayout());
  assert.equal(menuLeft(view), opened, "turning Fast off again keeps it in place");
});

/** The catalog `coder-agent-tools.test.ts`'s runtime tests read: Opus with its fast version and two windows, Sonnet, and a GPT model. */
const RUNTIME_MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
    contextWindows: { standardTokens: 200_000, longTokens: 1_000_000 },
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 Fast",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

/** The open menu of a chip on an agent on the runtime given: the models it lists, and its pinned rows. */
function openMenuOn(
  runtime: CodingAgentRuntime | undefined,
  choice: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" },
  models: readonly CatalogModel[] = RUNTIME_MODELS,
  usage: CodingAgentUsage | undefined = undefined,
  payer: CodingAgentPayer | undefined = undefined,
): {
  models: string[];
  foot: string;
  menu: Element;
} {
  const view = document.createElement("div");
  document.body.append(view);
  const root = createRoot(view);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AgentModelChip, {
        model: {
          choice,
          note: undefined,
          choose: () => undefined,
          runtime,
        },
        models,
        modelsFailed: false,
        readModels: () => undefined,
        usage,
        payer,
      }),
    ),
  );
  const chip = view.querySelector<HTMLButtonElement>(".agent-model-chip button");
  assert.ok(chip);
  act(() => chip.click());
  const menu = view.querySelector('[role="dialog"]');
  assert.ok(menu, "the menu is open");
  const foot = menu.querySelector(".luke-searchable-menu-foot")?.textContent ?? "";
  const listed = [...menu.querySelectorAll('[role="listbox"] [role="option"]')].map(
    (row) => row.textContent ?? "",
  );
  return { models: listed, foot, menu };
}

test("on a Claude Code agent the menu offers Claude models alone with Fast and no Context row, on a Codex agent GPT models alone with neither, while an eve agent's offers every model with both", () => {
  const claudeCode = openMenuOn(CODING_AGENT_RUNTIME.CLAUDE_CODE);
  const codex = openMenuOn(CODING_AGENT_RUNTIME.CODEX);
  const eve = openMenuOn(undefined);

  assert.equal(claudeCode.models.length, 2, claudeCode.models.join(" | "));
  assert.match(claudeCode.models[0] ?? "", /Opus 5\.5/u);
  assert.match(claudeCode.models[1] ?? "", /Sonnet 5\.5/u);
  assert.match(claudeCode.foot, /Effort/u);
  assert.match(claudeCode.foot, /Fast/u);
  assert.doesNotMatch(claudeCode.foot, /Context/u);

  assert.equal(codex.models.length, 1, codex.models.join(" | "));
  assert.match(codex.models[0] ?? "", /GPT-6\.1 Sol/u);
  assert.doesNotMatch(codex.foot, /Fast|Context/u);

  assert.equal(eve.models.length, 3, eve.models.join(" | "));
  assert.match(eve.models[2] ?? "", /GPT-6\.1 Sol/u);
  assert.match(eve.foot, /Effort/u);
  assert.match(eve.foot, /Context/u);
  assert.match(eve.foot, /Fast/u);
});

test("a GPT model whose ChatGPT plan pays draws no Fast row in the menu, not even a resting one, while Opus beside it keeps Fast", () => {
  const withheld = RUNTIME_MODELS.map((model) =>
    model.provider === MODEL_PROVIDER.OPENAI ? { ...model, fastWithheldByPlan: true } : model,
  );
  const gpt = openMenuOn(undefined, { model: "openai/gpt-6.1-sol", effort: "low" }, withheld);
  const opus = openMenuOn(
    undefined,
    { model: "anthropic/claude-opus-5.5", effort: "high" },
    withheld,
  );

  assert.match(gpt.foot, /Effort/u);
  assert.doesNotMatch(gpt.foot, /Fast/u);
  assert.match(opus.foot, /Fast/u);
});

test("a Codex agent's menu ends on \"Using ChatGPT plan · Manage usage\", the link opening ChatGPT's usage settings, while a Claude Code or eve agent's names no plan", () => {
  const opened: string[] = [];
  fakeAppPlatform({ assetBase: () => "https://luke.test/", openWeb: (href) => opened.push(href) });
  const codex = openMenuOn(CODING_AGENT_RUNTIME.CODEX, {
    model: "openai/gpt-6.1-sol",
    effort: "low",
  });
  assert.match(codex.foot, /Using ChatGPT plan · Manage usage$/u);
  const link = [...codex.menu.querySelectorAll("a")].find((a) => a.textContent === "Manage usage");
  assert.ok(link, "Manage usage is a link");
  act(() => link.click());
  assert.deepEqual(opened, ["https://chatgpt.com/settings/usage"]);

  for (const runtime of [CODING_AGENT_RUNTIME.CLAUDE_CODE, undefined]) {
    assert.doesNotMatch(openMenuOn(runtime).foot, /plan|Manage usage/u);
  }
});

test("a Codex agent its OpenAI API key pays for names no plan, before its first turn settles too, and its menu ends on what it cost", () => {
  const onKey = openMenuOn(
    CODING_AGENT_RUNTIME.CODEX,
    { model: "openai/gpt-6.1-sol", effort: "low" },
    RUNTIME_MODELS,
    { inputTokens: 1000, outputTokens: 200, costUsd: 0.42, payer: CODING_AGENT_PAYER.API_KEY },
  );
  assert.doesNotMatch(onKey.foot, /plan|Manage usage/u);
  assert.match(onKey.foot, /\$0\.42/u);
  // Before its first turn settles, the payer the page names says the same.
  const first = openMenuOn(
    CODING_AGENT_RUNTIME.CODEX,
    { model: "openai/gpt-6.1-sol", effort: "low" },
    RUNTIME_MODELS,
    undefined,
    CODING_AGENT_PAYER.API_KEY,
  );
  assert.doesNotMatch(first.foot, /plan|Manage usage/u);
});

test("an automation's chip, whose choice a new agent starts on, says a model nothing of the reader's pays for cannot run, while a running agent's chip says nothing of it", () => {
  const unconnected = MODELS.map((model) => ({ ...model, credentialMissing: true }));
  const footOf = (startsNew: boolean): string => {
    const view = document.createElement("div");
    document.body.append(view);
    const root = createRoot(view);
    roots.push(root);
    act(() =>
      root.render(
        createElement(AgentModelChip, {
          model: {
            choice: { model: "anthropic/claude-opus-5.5", effort: "high" },
            note: undefined,
            choose: () => undefined,
          },
          models: unconnected,
          modelsFailed: false,
          readModels: () => undefined,
          usage: undefined,
          startsNew,
        }),
      ),
    );
    const chip = view.querySelector<HTMLButtonElement>(".agent-model-chip button");
    assert.ok(chip);
    act(() => chip.click());
    const foot = view.querySelector(".luke-searchable-menu-foot")?.textContent ?? "";
    act(() => chip.click());
    return foot;
  };

  assert.match(footOf(true), /Connect Claude.*Opus 5\.5 cannot run until you connect Claude/u);
  assert.doesNotMatch(footOf(false), /cannot run|Connect/u);
});
