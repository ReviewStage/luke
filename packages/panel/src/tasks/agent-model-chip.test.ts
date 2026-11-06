// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_PAYER,
  AGENT_RUNTIME,
  type AgentPayer,
  type AgentRuntime,
  type AgentUsage,
} from "@repo/features/agent-wire";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@repo/features/models-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeAppPlatform } from "../testing/app-platform.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { AgentModelChip } from "./agent-model-chip.js";

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

const CHIP_RIGHT = 900;

const CHIP_WIDTH = { STANDARD: 120, FAST: 160 } as const;

const MENU_HEIGHT = 300;

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppPlatform({ assetBase: () => "https://app.test/" });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function box(left: number, top: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

function stageLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("agent-model-chip")) {
      const fast = this.querySelector(".model-label")?.textContent?.includes("Fast") ?? false;
      const width = fast ? CHIP_WIDTH.FAST : CHIP_WIDTH.STANDARD;
      return box(CHIP_RIGHT - width, 700, width, 24);
    }
    if (this.classList.contains("ui-anchored-popover")) return box(0, 0, 340, MENU_HEIGHT);
    return box(0, 0, 0, 0);
  });
}

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

function menuLeft(view: HTMLElement): number {
  const anchor = view.querySelector(".agent-model-chip");
  const layer = view.querySelector<HTMLElement>(".ui-anchored-popover");
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
  {
    id: "openai/gpt-6.1-sol-fast",
    name: "GPT-6.1 Sol Fast",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
  {
    id: "openai/gpt-6.1-sol-ultrafast",
    name: "GPT-6.1 Sol (Ultrafast)",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

function openMenuOn(
  runtime: AgentRuntime | undefined,
  choice: ModelChoice = { model: "anthropic/claude-opus-5.5", effort: "high" },
  models: readonly CatalogModel[] = RUNTIME_MODELS,
  usage: AgentUsage | undefined = undefined,
  payer: AgentPayer | undefined = undefined,
): {
  models: string[];
  foot: string;
  line: string;
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
  const foot = menu.querySelector(".ui-searchable-menu-foot")?.textContent ?? "";
  const line = menu.querySelector(".ui-searchable-menu-last-line")?.textContent ?? "";
  const listed = [...menu.querySelectorAll('[role="listbox"] [role="option"]')].map(
    (row) => row.textContent ?? "",
  );
  return { models: listed, foot, line, menu };
}

test("on a Claude Code agent the menu offers Claude models alone with Fast and no Context row, on a Codex agent GPT models alone with neither but a Speed choice of Standard, Fast, and Ultrafast in Fast's place where its API key pays, while an eve agent's offers every model with both", () => {
  const claudeCode = openMenuOn(AGENT_RUNTIME.CLAUDE_CODE);
  const codex = openMenuOn(AGENT_RUNTIME.CODEX);
  const codexOnApiKey = openMenuOn(
    AGENT_RUNTIME.CODEX,
    { model: "openai/gpt-6.1-sol", effort: "high" },
    RUNTIME_MODELS,
    undefined,
    AGENT_PAYER.API_KEY,
  );
  const eve = openMenuOn(undefined);

  assert.equal(claudeCode.models.length, 2, claudeCode.models.join(" | "));
  assert.match(claudeCode.models[0] ?? "", /Opus 5\.5/u);
  assert.match(claudeCode.models[1] ?? "", /Sonnet 5\.5/u);
  assert.match(claudeCode.foot, /Effort/u);
  assert.match(claudeCode.foot, /Fast/u);
  assert.doesNotMatch(claudeCode.foot, /Context/u);

  assert.equal(codex.models.length, 1, codex.models.join(" | "));
  assert.match(codex.models[0] ?? "", /GPT-6\.1 Sol/u);
  assert.doesNotMatch(codex.foot, /Fast|Speed|Context/u);

  assert.equal(codexOnApiKey.models.length, 1, codexOnApiKey.models.join(" | "));
  assert.match(codexOnApiKey.foot, /Speed\s*Standard/u);
  assert.doesNotMatch(codexOnApiKey.foot, /Fast|Context/u);

  assert.equal(eve.models.length, 3, eve.models.join(" | "));
  assert.match(eve.models[2] ?? "", /GPT-6\.1 Sol/u);
  assert.match(eve.foot, /Effort/u);
  assert.match(eve.foot, /Context/u);
  assert.match(eve.foot, /Fast/u);
});

test("a Codex agent's menu ends on \"Using ChatGPT plan\" and Manage usage, before its first turn settles too, the link opening ChatGPT's usage settings, while a Claude Code agent's says its Claude plan and an eve agent's names no payer", () => {
  const opened: string[] = [];
  fakeAppPlatform({ assetBase: () => "https://app.test/", openWeb: (href) => opened.push(href) });
  const codex = openMenuOn(AGENT_RUNTIME.CODEX, {
    model: "openai/gpt-6.1-sol",
    effort: "low",
  });
  assert.equal(codex.line, "Using ChatGPT planManage usage");
  const link = [...codex.menu.querySelectorAll("a")].find((a) => a.textContent === "Manage usage");
  assert.ok(link, "Manage usage is a link");
  act(() => link.click());
  assert.deepEqual(opened, ["https://chatgpt.com/settings/usage"]);

  assert.equal(openMenuOn(AGENT_RUNTIME.CLAUDE_CODE).line, "Using Claude plan");
  assert.equal(openMenuOn(undefined).line, "");
});

test("a Codex agent its OpenAI API key pays for names the key rather than a plan, before its first turn settles too, and what it has cost once one has", () => {
  const onKey = openMenuOn(
    AGENT_RUNTIME.CODEX,
    { model: "openai/gpt-6.1-sol", effort: "low" },
    RUNTIME_MODELS,
    { inputTokens: 1000, outputTokens: 200, costUsd: 0.42, payer: AGENT_PAYER.API_KEY },
  );
  assert.equal(onKey.line, "OpenAI API key · $0.42 so far");
  const first = openMenuOn(
    AGENT_RUNTIME.CODEX,
    { model: "openai/gpt-6.1-sol", effort: "low" },
    RUNTIME_MODELS,
    undefined,
    AGENT_PAYER.API_KEY,
  );
  assert.equal(first.line, "OpenAI API key");
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
    const foot = [
      ...view.querySelectorAll(".ui-searchable-menu-foot, .ui-searchable-menu-last-line"),
    ].map((block) => block.textContent ?? "");
    act(() => chip.click());
    return foot.join("");
  };

  assert.match(
    footOf(true),
    /Connect Claude.*Opus 5\.5 cannot run until you connect a Claude plan/u,
  );
  assert.doesNotMatch(footOf(false), /cannot run|Connect/u);
});
