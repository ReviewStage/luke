import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isAllowedFile, RUN_ALLOWLIST } from "../shared/effect-edges.ts";

/**
 * `Effect.run*` and `Runtime.run*` run a description; `ManagedRuntime.make`
 * builds the thing that runs one. Both belong at an edge, because a runtime
 * built where the work lives is a second runtime, and two runtimes are two
 * copies of every service a `Context.Tag` was supposed to identify.
 */
const RUNNING_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "Effect",
    new Set(["runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"]),
  ],
  [
    "Runtime",
    new Set(["runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"]),
  ],
  ["ManagedRuntime", new Set(["make"])],
]);

function runningMemberName(callee: ESTree.Expression | ESTree.Super): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const object = callee.object;
  const property = callee.property;
  if (object.type !== "Identifier" || property.type !== "Identifier") return null;
  const members = RUNNING_MEMBERS.get(object.name);
  return members?.has(property.name) === true ? `${object.name}.${property.name}` : null;
}

/** Keep the running of an Effect at the process edges the ADR names. */
export const noRunPromiseOutsideEdgesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect.run*, Runtime.run*, and ManagedRuntime.make outside the runtime edges and strangler shims docs/adr/0001-effect.md names.",
    },
    messages: {
      runOutsideEdge:
        "`{{name}}` runs an Effect where the work lives. Return the Effect and let one of the runtime edges in docs/adr/0001-effect.md run it; a shim that has to answer a promise is recorded on that ADR's allowlist and in effect-edges.json.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return !isAllowedFile(context.filename, RUN_ALLOWLIST);
      },
      CallExpression(node) {
        const name = runningMemberName(node.callee);
        if (name !== null) context.report({ node, messageId: "runOutsideEdge", data: { name } });
      },
    };
  },
});
