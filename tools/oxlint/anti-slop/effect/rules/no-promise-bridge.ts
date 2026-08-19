import { defineRule } from "@oxlint/plugins";

/**
 * The only files permitted to wrap a raw Promise API. A bridge anywhere else
 * means a caller was left on Promises: convert that caller instead, or the two
 * worlds grow side by side rather than one replacing the other.
 */
const BRIDGE_FILES = [
  "apps/desktop/src/services/http.ts",
  "apps/desktop/src/services/cli.ts",
  "apps/desktop/src/services/files.ts",
  "apps/desktop/src/main.ts",
  "apps/desktop/src/desktop-app.ts",
  "apps/desktop/src/action-handler.ts",
  "apps/desktop/src/observation-loop.ts",
  "apps/desktop/src/settings-handler.ts",
  "apps/desktop/src/ipc/window-surface.ts",
] as const;

const BRIDGE_MEMBERS = new Set(["tryPromise", "promise", "async", "asyncEffect"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function normalized(filename: string): string {
  return filename.replaceAll("\\", "/");
}

function isBridgeFile(filename: string): boolean {
  const path = normalized(filename);
  return BRIDGE_FILES.some((allowed) => path.endsWith(allowed));
}

export const noPromiseBridgeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Promise-to-Effect bridges outside the I/O service implementations and edge files.",
    },
    messages: {
      promiseBridge:
        'Do not bridge a Promise into an Effect here. "Effect.{{name}}" belongs in an I/O service implementation. If a callee still returns a Promise, convert the callee rather than wrapping it.',
    },
  },
  create(context) {
    const filename = context.filename;
    if (isBridgeFile(filename) || TEST_FILE.test(normalized(filename))) return {};

    return {
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.property.type !== "Identifier") return;
        if (node.object.name !== "Effect") return;
        if (!BRIDGE_MEMBERS.has(node.property.name)) return;
        context.report({
          node,
          messageId: "promiseBridge",
          data: { name: node.property.name },
        });
      },
    };
  },
});
