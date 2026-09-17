import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isTestFileOutside, LIVE_CLOCK_TESTS, REAL_TIME_HOLDOUTS } from "../shared/test-edges.ts";

const TIMER_FUNCTION = {
  SET_TIMEOUT: "setTimeout",
  SET_INTERVAL: "setInterval",
} as const;

const TIMER_FUNCTIONS: ReadonlySet<string> = new Set(Object.values(TIMER_FUNCTION));
const TIMER_MODULES: ReadonlySet<string> = new Set(["node:timers", "node:timers/promises"]);
/** `globalThis.setTimeout` is `setTimeout`; the object it hangs on says nothing about the timer. */
const TIMER_HOSTS: ReadonlySet<string> = new Set(["globalThis", "window", "global", "self"]);

const EFFECT_NAMESPACE = "Effect";
const SLEEP_MEMBER = "sleep";
const LIVE_MEMBER = "live";
/** The vitest names `it.live` hangs off. */
const TEST_ROOTS: ReadonlySet<string> = new Set(["it", "test"]);

type FileBindings = {
  readonly timerNames: Set<string>;
  readonly timerNamespaces: Set<string>;
};

function memberName(
  callee: ESTree.Expression | ESTree.Super,
): { readonly object: string; readonly property: string } | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const object = callee.object;
  const property = callee.property;
  if (object.type !== "Identifier" || property.type !== "Identifier") return null;
  return { object: object.name, property: property.name };
}

function timerName(
  callee: ESTree.Expression | ESTree.Super,
  bindings: FileBindings,
): string | null {
  if (callee.type === "Identifier") {
    return bindings.timerNames.has(callee.name) ? callee.name : null;
  }
  const member = memberName(callee);
  if (member === null || !TIMER_FUNCTIONS.has(member.property)) return null;
  const hosted = TIMER_HOSTS.has(member.object) || bindings.timerNamespaces.has(member.object);
  return hosted ? `${member.object}.${member.property}` : null;
}

/**
 * A test on real time is slow when it passes and flaky when it does not: a
 * `TestClock` the test advances is the clock an `it.effect` suite runs on, so
 * a `setTimeout` (the global, `node:timers`, or a `new Promise` around one),
 * an `Effect.sleep`, and an `it.live` are each a test that waits for the
 * machine. `it.live` is legal only in a `liveClockTests` file, whose subject
 * is a real socket or a process timeout no `TestClock` drives; those files
 * and the `realTimeHoldouts` in test-edges.json are skipped whole.
 */
export const noRealTimeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow setTimeout, setInterval, Effect.sleep, and it.live in a test file; a test advances a TestClock.",
    },
    messages: {
      timer:
        "`{{name}}` waits on the machine's clock. Run the test on `it.effect` and advance the `TestClock` instead.",
      sleep:
        "`Effect.sleep` in a test waits on the machine's clock. Advance the `TestClock` by the same duration instead.",
      live: "`it.live` runs on the real clock. Write the test on `it.effect`, or, if its subject is a real socket or process timeout, name the file in `liveClockTests` and in AGENTS.md's Testing section.",
    },
  },
  createOnce(context) {
    let bindings: FileBindings = { timerNames: new Set(), timerNamespaces: new Set() };

    return {
      before() {
        if (!isTestFileOutside(context.filename, REAL_TIME_HOLDOUTS)) return false;
        if (!isTestFileOutside(context.filename, LIVE_CLOCK_TESTS)) return false;
        bindings = { timerNames: new Set(TIMER_FUNCTIONS), timerNamespaces: new Set() };
        return true;
      },
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !TIMER_MODULES.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") {
            bindings.timerNamespaces.add(specifier.local.name);
            continue;
          }
          const imported = specifier.imported;
          if (imported.type === "Identifier" && TIMER_FUNCTIONS.has(imported.name)) {
            bindings.timerNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const timer = timerName(node.callee, bindings);
        if (timer !== null) {
          context.report({ node, messageId: "timer", data: { name: timer } });
          return;
        }
        const member = memberName(node.callee);
        if (member === null) return;
        if (member.object === EFFECT_NAMESPACE && member.property === SLEEP_MEMBER) {
          context.report({ node, messageId: "sleep" });
          return;
        }
        if (TEST_ROOTS.has(member.object) && member.property === LIVE_MEMBER) {
          context.report({ node: node.callee, messageId: "live" });
        }
      },
    };
  },
});
