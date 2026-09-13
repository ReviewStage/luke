import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isAllowedFile, RUN_ALLOWLIST } from "../shared/effect-edges.ts";

/**
 * `Effect.run*` and `Runtime.run*` run a description; `ManagedRuntime.make`
 * builds the thing that runs one, and `NodeRuntime.runMain` runs one as a
 * whole process. All of them belong at an edge, because a runtime built where
 * the work lives is a second runtime, and two runtimes are two copies of every
 * service a `Context.Service` was supposed to identify.
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
 * Names whose call answers a runner rather than a result: the brain's own
 * dispatch between a `ManagedRuntime` and a plain `Runtime`
 * (`packages/brain/src/effect/carry.ts`), where `runtimeExit(execution)(effect)`
 * runs the effect as surely as `Runtime.runPromiseExit` does, the same file's
 * `detachOn(execution)(effect)`, which forks it as surely as `Runtime.runFork`
 * does, and the web edge's `webRuntime()` (`apps/web/server/runtime.ts`),
 * whose `webRuntime().runPromise(effect)` is the same run one member deeper
 * than `RUNNING_MEMBERS` reaches. Naming them here is what keeps their
 * callers on the allowlist rather than invisible to it.
 */
const RUNNER_FACTORIES: ReadonlySet<string> = new Set(["runtimeExit", "detachOn", "webRuntime"]);

/**
 * Runners an edge exports for a collaborator to hold. `runWeb`
 * (`apps/web/server/runtime.ts`) runs an effect on the one runtime `apps/web`
 * builds, so `runWeb(effect)` in a module that is not itself an edge is the
 * same escape `Effect.runPromise` would be.
 */
const HANDED_RUNNERS: ReadonlySet<string> = new Set(["runWeb"]);

/** Every member name any of the namespaces above runs an Effect through. */
const EVERY_RUNNING_MEMBER: ReadonlySet<string> = new Set(
  [...RUNNING_MEMBERS.values()].flatMap((members) => [...members]),
);

function runningMemberName(
  callee: ESTree.Expression | ESTree.Super,
  runnerFactoryNames: ReadonlySet<string>,
): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const object = callee.object;
  const property = callee.property;
  if (property.type !== "Identifier") return null;
  if (object.type === "Identifier") {
    const members = RUNNING_MEMBERS.get(object.name);
    return members?.has(property.name) === true ? `${object.name}.${property.name}` : null;
  }
  if (object.type !== "CallExpression") return null;
  const factory = object.callee;
  if (factory.type !== "Identifier" || !runnerFactoryNames.has(factory.name)) return null;
  return EVERY_RUNNING_MEMBER.has(property.name) ? `${factory.name}().${property.name}` : null;
}

/** Keep the running of an Effect at the process edges root AGENTS.md names. */
export const noRunPromiseOutsideEdgesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect.run*, Runtime.run*, ManagedRuntime.make, NodeRuntime.runMain, the brain's runtimeExit and detachOn dispatch, and the web edge's runWeb and webRuntime runners outside the runtime edges and permanent adaptors root AGENTS.md's \"Effect idioms\" section names.",
    },
    messages: {
      runOutsideEdge:
        '`{{name}}` runs an Effect where the work lives. Return the Effect and let one of the runtime edges in root AGENTS.md\'s "Effect idioms" section run it; a permanent adaptor that has to answer a promise is named there and in effect-edges.json.',
    },
  },
  createOnce(context) {
    let runnerFactoryNames = new Set<string>();
    let handedRunnerNames = new Set<string>();

    return {
      before() {
        if (isAllowedFile(context.filename, RUN_ALLOWLIST)) return false;
        runnerFactoryNames = new Set();
        handedRunnerNames = new Set();
        return true;
      },
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported = specifier.imported;
          if (imported.type !== "Identifier") continue;
          if (RUNNER_FACTORIES.has(imported.name)) runnerFactoryNames.add(specifier.local.name);
          if (HANDED_RUNNERS.has(imported.name)) handedRunnerNames.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        const name = runningMemberName(node.callee, runnerFactoryNames);
        if (name !== null) {
          context.report({ node, messageId: "runOutsideEdge", data: { name } });
          return;
        }
        const callee = node.callee;
        if (callee.type === "Identifier" && handedRunnerNames.has(callee.name)) {
          context.report({ node, messageId: "runOutsideEdge", data: { name: callee.name } });
          return;
        }
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
