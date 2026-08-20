import { defineRule } from "@oxlint/plugins";

/**
 * The only files permitted to leave the Effect world. Everything else composes
 * Effects and lets its requirements propagate; a runtime call anywhere else is
 * a conversion that stopped halfway.
 */
const EDGE_FILES = [
  "apps/desktop/src/main.ts",
  "apps/desktop/src/desktop-app.ts",
  "apps/desktop/src/action-handler.ts",
  "apps/desktop/src/observation-loop.ts",
  "apps/desktop/src/settings-handler.ts",
  "apps/desktop/src/ipc/window-surface.ts",
] as const;

const RUNTIME_MEMBERS = new Set([
  "runPromise",
  "runPromiseExit",
  "runSync",
  "runSyncExit",
  "runFork",
  "runCallback",
]);

const RUNTIME_OBJECTS = new Set(["Effect", "ManagedRuntime", "Runtime"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const TEST_SUPPORT_FILE = /\/tests\/support\//u;

function normalized(filename: string): string {
  return filename.replaceAll("\\", "/");
}

function isEdgeFile(filename: string): boolean {
  const path = normalized(filename);
  return EDGE_FILES.some((edge) => path.endsWith(edge));
}

function isAllowedRuntimeFile(filename: string): boolean {
  const path = normalized(filename);
  return isEdgeFile(path) || TEST_FILE.test(path) || TEST_SUPPORT_FILE.test(path);
}

export const noEffectRuntimeOutsideEdgesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Effect runtime execution outside the declared composition-root edge files.",
    },
    messages: {
      runtimeOutsideEdge:
        'Do not run an Effect here. "{{name}}" may only appear in a composition-root edge file. Return the Effect to your caller and let the runtime at the edge execute it.',
      managedRuntimeOutsideEdge:
        "Do not build a ManagedRuntime here. Exactly one runtime is built at the composition root; provide its Layer there instead.",
    },
  },
  create(context) {
    const filename = context.filename;
    if (isAllowedRuntimeFile(filename)) return {};

    return {
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.property.type !== "Identifier") return;
        const object = node.object.name;
        const property = node.property.name;
        if (!RUNTIME_OBJECTS.has(object)) return;

        if (object === "ManagedRuntime" && property === "make") {
          context.report({ node, messageId: "managedRuntimeOutsideEdge" });
          return;
        }
        if (RUNTIME_MEMBERS.has(property)) {
          context.report({
            node,
            messageId: "runtimeOutsideEdge",
            data: { name: `${object}.${property}` },
          });
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (!RUNTIME_MEMBERS.has(node.callee.name)) return;
        context.report({
          node: node.callee,
          messageId: "runtimeOutsideEdge",
          data: { name: node.callee.name },
        });
      },
    };
  },
});
