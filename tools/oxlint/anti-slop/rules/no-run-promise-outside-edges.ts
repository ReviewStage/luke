import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isAllowedFile, RUN_ALLOWLIST } from "../shared/effect-edges.ts";

/**
 * `Effect.run*` and `Runtime.run*` run a description; `ManagedRuntime.make`
 * builds the thing that runs one, and `NodeRuntime.runMain` runs one as a
 * whole process. All of them belong at an edge, because a runtime built where
 * the work lives is a second runtime, and two runtimes are two copies of every
 * service a `Context.Tag` was supposed to identify.
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
  ["NodeRuntime", new Set(["runMain"])],
]);

/**
 * The brain's own dispatch between a `ManagedRuntime` and a plain `Runtime`
 * (`packages/brain/src/effect/carry.ts`). `runtimeExit(execution)(effect)`
 * runs the effect as surely as `Runtime.runPromiseExit` does; naming it here
 * is what keeps its two permanent callers on the allowlist rather than
 * invisible to it.
 */
const RUNNER_FACTORY = "runtimeExit";

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
        "Disallow Effect.run*, Runtime.run*, ManagedRuntime.make, NodeRuntime.runMain, and the brain's runtimeExit dispatch outside the runtime edges and strangler shims docs/adr/0001-effect.md names.",
    },
    messages: {
      runOutsideEdge:
        "`{{name}}` runs an Effect where the work lives. Return the Effect and let one of the runtime edges in docs/adr/0001-effect.md run it; a shim that has to answer a promise is recorded on that ADR's allowlist and in effect-edges.json.",
    },
  },
  createOnce(context) {
    let runnerFactoryNames = new Set<string>();

    return {
      before() {
        if (isAllowedFile(context.filename, RUN_ALLOWLIST)) return false;
        runnerFactoryNames = new Set();
        return true;
      },
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported = specifier.imported;
          if (imported.type === "Identifier" && imported.name === RUNNER_FACTORY) {
            runnerFactoryNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const name = runningMemberName(node.callee);
        if (name !== null) {
          context.report({ node, messageId: "runOutsideEdge", data: { name } });
          return;
        }
        const callee = node.callee;
        if (callee.type !== "CallExpression") return;
        const factory = callee.callee;
        if (factory.type !== "Identifier" || !runnerFactoryNames.has(factory.name)) return;
        context.report({
          node,
          messageId: "runOutsideEdge",
          data: { name: `${factory.name}(...)` },
        });
      },
    };
  },
});
