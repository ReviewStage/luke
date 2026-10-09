// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import type { UIMessage } from "ai";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AgentTranscriptView } from "./agent-tab";
import { PlanTranscript } from "./plan-transcript";
import { TRANSCRIPT_REGION } from "./transcript-model";

/**
 * The one layout rule a transcript's components keep, held against the
 * stylesheet the renderer ships. The side panel has a fixed height, the
 * log fills it, and a flex item of a container with a definite height has
 * a definite height of its own once flexed; so a percentage height on
 * anything inside a message resolves against the message's column rather
 * than falling back to its content. That is what Dean saw: the markdown
 * root was `size-full`, every text part asked for the whole column, the
 * column overflowed, and flex-shrink squeezed the tool rows, whose
 * `overflow-hidden` zeroes their minimum height, to slivers with gaps of
 * hundreds of pixels between the words. jsdom lays nothing out, so the
 * rule is read where it lives: the utilities every element inside the log
 * resolves to, in the stylesheet Tailwind compiles from the same entry the
 * build does. The log stacks its messages as blocks, and nothing under it
 * sets a percentage height.
 */

const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../styles");
const TAILWIND_ENTRY = path.join(STYLES, "tailwind.css");

interface CssRule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

/** The declarations written directly in a block, between its nested rules. */
function declarationsIn(loose: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of loose.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return declarations;
}

/** A nested rule's selectors resolved against the rule it sits in, as the browser resolves nesting. */
function nestedSelectors(prelude: string, parents: readonly string[]): readonly string[] {
  const own = prelude.split(",").map((each) => each.trim());
  if (parents.length === 0) return own;
  return own.flatMap((selector) =>
    parents.map((parent) =>
      selector.includes("&") ? selector.replaceAll("&", parent) : `${parent} ${selector}`,
    ),
  );
}

/**
 * Every style rule in the sheet, however deep inside `@layer`, `@media`,
 * or a parent rule it sits: Tailwind writes a variant as a rule nested in
 * its utility, so a nested selector is resolved against its parent before
 * it is read.
 */
function cssRules(css: string): readonly CssRule[] {
  const rules: CssRule[] = [];
  const walk = (block: string, parents: readonly string[]): void => {
    let at = 0;
    let loose = "";
    for (;;) {
      const open = block.indexOf("{", at);
      if (open === -1) {
        loose += block.slice(at);
        break;
      }
      const preludeStart =
        Math.max(block.lastIndexOf(";", open), block.lastIndexOf("}", open), at - 1) + 1;
      loose += block.slice(at, preludeStart);
      const prelude = block.slice(preludeStart, open).trim();
      let depth = 1;
      let close = open + 1;
      while (depth > 0 && close < block.length) {
        if (block[close] === "{") depth += 1;
        else if (block[close] === "}") depth -= 1;
        close += 1;
      }
      const body = block.slice(open + 1, close - 1);
      walk(body, prelude.startsWith("@") ? parents : nestedSelectors(prelude, parents));
      at = close;
    }
    const declarations = declarationsIn(loose);
    if (parents.length > 0 && declarations.size > 0)
      rules.push({ selectors: parents, declarations });
  };
  walk(css, []);
  return rules;
}

/** A class as Tailwind spells it in a selector: every character beyond a word escaped. */
function escaped(className: string): string {
  return `.${className.replace(/[^a-zA-Z0-9_-]/gu, (character) => `\\${character}`)}`;
}

/** Whether the selector styles the element carrying the class itself, rather than something inside or beside it. */
function stylesSelf(selector: string, className: string): boolean {
  const own = escaped(className);
  if (!selector.startsWith(own)) return false;
  const rest = selector.slice(own.length);
  return rest === "" || rest.startsWith(":");
}

/** The declarations the sheet gives an element's own box, from every class it carries. */
function ownDeclarations(
  rules: readonly CssRule[],
  element: Element,
): readonly (readonly [property: string, value: string, className: string])[] {
  return [...element.classList].flatMap((className) =>
    rules
      .filter((rule) => rule.selectors.some((selector) => stylesSelf(selector, className)))
      .flatMap((rule) =>
        [...rule.declarations].map(([property, value]) => [property, value, className] as const),
      ),
  );
}

/** The properties that size a box along the column, where a percentage is the hazard. */
const BLOCK_SIZE_PROPERTIES: ReadonlySet<string> = new Set([
  "height",
  "min-height",
  "block-size",
  "min-block-size",
  "flex-basis",
]);

const FLEX_OR_GRID = /\b(?:inline-)?(?:flex|grid)\b/u;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The transcript mounted live with every fold opened, so a body's elements are held to the rule as well as a row's. */
function mountedOpen(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  for (const summary of container.querySelectorAll("summary")) act(() => summary.click());
  return container;
}

const PLAN: CodingAgentMessage = {
  id: "m-plan",
  role: "user",
  parts: [{ type: "text", text: "# Teammate invitations\n\nInvite a teammate by email." }],
};

const TURN: CodingAgentMessage = {
  id: "m-turn",
  role: "assistant",
  parts: [
    { type: "text", text: "I'll start by reading the guide.\n\n- one\n- two" },
    { type: "reasoning", text: "Read AGENTS.md first." },
    {
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { command: "cat AGENTS.md" },
      output: {
        status: "completed",
        exitCode: 0,
        stdout: "# Agent guide\n",
        stderr: "",
        truncated: false,
      },
    },
    {
      type: "tool-apply_patch",
      toolCallId: "call_2",
      state: "output-error",
      input: { root: "/w", patchText: "*** Begin Patch\n*** Update File: a.ts\n+x\n*** End Patch" },
      errorText: "rejected",
    },
    { type: "text", text: "Now the code the plan names." },
  ],
};

const CALL: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Let's plan invitations." }] },
  {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text: "Who should invite?\n\n- Owners" }],
  },
];

test("nothing inside the log sets a percentage height, and the log stacks its messages as blocks", async () => {
  const compiler = await compile(await readFile(TAILWIND_ENTRY, "utf8"), {
    base: STYLES,
    from: TAILWIND_ENTRY,
    // The build watches what the entry imports; a test reads it once.
    onDependency: () => undefined,
  });
  const scanner = new Scanner({ sources: compiler.sources });
  const rules = cssRules(compiler.build(scanner.scan()));
  assert.ok(
    rules.some((rule) => rule.selectors.includes(".overflow-y-auto")),
    "the sheet compiled",
  );

  const surfaces = [
    createElement(AgentTranscriptView, {
      messages: [PLAN, TURN],
      reading: false,
      failed: false,
      working: true,
      onRetry: () => undefined,
      openGitHub: () => undefined,
      copyText: () => Promise.resolve(),
    }),
    createElement(PlanTranscript, {
      region: {
        kind: TRANSCRIPT_REGION.READY,
        earlierOmitted: false,
        calls: [{ key: "c1", startedAt: 1, live: true, messages: CALL }],
      },
      onRetry: () => undefined,
      copyText: () => Promise.resolve(),
    }),
  ];
  for (const surface of surfaces) {
    const container = mountedOpen(surface);
    const log = container.querySelector('[role="log"]');
    assert.ok(log);
    for (const [property, value, className] of ownDeclarations(rules, log)) {
      if (property === "display") {
        assert.doesNotMatch(value, FLEX_OR_GRID, `the log is a block, not ${className}`);
      }
    }
    const inside = log.querySelectorAll("*");
    assert.ok(inside.length > 8, "the transcript drew its rows and their bodies");
    for (const element of inside) {
      for (const [property, value, className] of ownDeclarations(rules, element)) {
        if (BLOCK_SIZE_PROPERTIES.has(property)) {
          assert.doesNotMatch(
            value,
            /%/u,
            `${element.tagName.toLowerCase()} carries ${className}, whose ${property} is ${value}`,
          );
        }
      }
    }
  }
});
