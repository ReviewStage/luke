import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isAllowedFile, RAW_ASYNC_PRIMITIVE_ALLOWLIST } from "../shared/effect-edges.ts";

const TIMER_FUNCTION = {
  SET_TIMEOUT: "setTimeout",
  SET_INTERVAL: "setInterval",
} as const;

const TIMER_FUNCTIONS: ReadonlySet<string> = new Set(Object.values(TIMER_FUNCTION));
const TIMER_MODULES: ReadonlySet<string> = new Set(["node:timers", "node:timers/promises"]);
/** `window.setTimeout` is `setTimeout`; the object it hangs on says nothing about the timer. */
const TIMER_HOSTS: ReadonlySet<string> = new Set(["globalThis", "window", "global", "self"]);
const WATCH_MODULES: ReadonlySet<string> = new Set(["node:fs", "node:fs/promises"]);

const CONSTRUCTED = {
  PROMISE: "Promise",
  ABORT_CONTROLLER: "AbortController",
} as const;

type FileBindings = {
  readonly timerNames: Set<string>;
  readonly watchNames: Set<string>;
  readonly fileSystemNamespaces: Set<string>;
};

function moduleSource(node: ESTree.ImportDeclaration): string | null {
  return typeof node.source.value === "string" ? node.source.value : null;
}

function isMemberNamed(callee: ESTree.Expression | ESTree.Super, name: string): boolean {
  if (callee.type !== "MemberExpression") return false;
  const property = callee.property;
  return callee.computed
    ? property.type === "Literal" && property.value === name
    : property.type === "Identifier" && property.name === name;
}

function hostedTimerName(callee: ESTree.Expression | ESTree.Super): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const object = callee.object;
  const property = callee.property;
  if (object.type !== "Identifier" || !TIMER_HOSTS.has(object.name)) return null;
  if (property.type !== "Identifier" || !TIMER_FUNCTIONS.has(property.name)) return null;
  return `${object.name}.${property.name}`;
}

/** `fs.watch` and `fs.promises.watch` are the same call under two namespaces. */
function fileSystemNamespaceName(callee: ESTree.Expression | ESTree.Super): string | null {
  if (callee.type !== "MemberExpression") return null;
  const object = callee.object;
  if (object.type === "Identifier") return object.name;
  if (!isMemberNamed(object, "promises")) return null;
  const inner = object.type === "MemberExpression" ? object.object : null;
  return inner !== null && inner.type === "Identifier" ? inner.name : null;
}

/**
 * The raw primitives Effect replaces: a delay is `Effect.sleep`, a cadence a
 * `Schedule`, a value another fiber completes a `Deferred`, a cancellation a
 * fiber's interruption, and a watched directory a `Stream`. The allowlist this
 * reads is the ADR's, and every entry on it is a file some later PR converts.
 */
export const noRawAsyncPrimitivesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow setTimeout, setInterval, new Promise, new AbortController, and fs.watch outside the ADR's runtime edges and the files still awaiting conversion.",
    },
    messages: {
      timer:
        "Replace `{{name}}` with `Effect.sleep` for a delay or a `Schedule` for a cadence, forked into the Scope that owns it.",
      promise:
        "Replace `new Promise` with the Effect that describes the work — `Deferred` where another fiber completes it, `Effect.async` where a callback does.",
      abortController:
        "Replace `new AbortController` with a fiber's own interruption; a Scope closing is what cancels the work.",
      watch:
        "Replace `fs.watch` with `FileSystem.watch` read as a Stream, so the re-arm and the teardown are the Scope's.",
    },
  },
  createOnce(context) {
    let bindings: FileBindings = {
      timerNames: new Set(),
      watchNames: new Set(),
      fileSystemNamespaces: new Set(),
    };

    return {
      before() {
        if (isAllowedFile(context.filename, RAW_ASYNC_PRIMITIVE_ALLOWLIST)) return false;
        bindings = {
          timerNames: new Set(TIMER_FUNCTIONS),
          watchNames: new Set(),
          fileSystemNamespaces: new Set(),
        };
        return true;
      },
      ImportDeclaration(node) {
        const source = moduleSource(node);
        if (source === null) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            const imported = specifier.imported;
            const name = imported.type === "Identifier" ? imported.name : null;
            if (name === null) continue;
            if (TIMER_MODULES.has(source) && TIMER_FUNCTIONS.has(name)) {
              bindings.timerNames.add(specifier.local.name);
            }
            if (WATCH_MODULES.has(source) && name === "watch") {
              bindings.watchNames.add(specifier.local.name);
            }
            if (WATCH_MODULES.has(source) && name === "promises") {
              bindings.fileSystemNamespaces.add(specifier.local.name);
            }
            continue;
          }
          if (WATCH_MODULES.has(source)) bindings.fileSystemNamespaces.add(specifier.local.name);
        }
      },
      NewExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier") return;
        if (callee.name === CONSTRUCTED.PROMISE) {
          context.report({ node, messageId: "promise" });
          return;
        }
        if (callee.name === CONSTRUCTED.ABORT_CONTROLLER) {
          context.report({ node, messageId: "abortController" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier") {
          if (bindings.timerNames.has(callee.name)) {
            context.report({ node, messageId: "timer", data: { name: callee.name } });
            return;
          }
          if (bindings.watchNames.has(callee.name)) {
            context.report({ node, messageId: "watch" });
          }
          return;
        }
        if (callee.type === "Super" || callee.type === "V8IntrinsicExpression") return;
        const hostedTimer = hostedTimerName(callee);
        if (hostedTimer !== null) {
          context.report({ node, messageId: "timer", data: { name: hostedTimer } });
          return;
        }
        const objectName = fileSystemNamespaceName(callee);
        if (objectName === null || !bindings.fileSystemNamespaces.has(objectName)) return;
        if (isMemberNamed(callee, "watch")) context.report({ node, messageId: "watch" });
      },
    };
  },
});
