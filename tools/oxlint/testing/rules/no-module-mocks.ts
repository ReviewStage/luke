import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isTestFile } from "../shared/test-edges.ts";

const VITEST_MODULE = "vitest";
const VI_EXPORT = "vi";

const MOCK_MEMBER = {
  MOCK: "mock",
  DO_MOCK: "doMock",
  SPY_ON: "spyOn",
  FN: "fn",
  MOCKED: "mocked",
} as const;

const MOCK_MEMBERS: ReadonlySet<string> = new Set(Object.values(MOCK_MEMBER));

function mockMemberName(
  callee: ESTree.Expression | ESTree.Super,
  viNames: ReadonlySet<string>,
): string | null {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  const object = callee.object;
  const property = callee.property;
  if (object.type !== "Identifier" || !viNames.has(object.name)) return null;
  if (property.type !== "Identifier" || !MOCK_MEMBERS.has(property.name)) return null;
  return `${object.name}.${property.name}`;
}

/**
 * A double is a test `Layer` on the subject's `Context.Tag`, and what is faked
 * is a process boundary: provider HTTP, Apple, the model, the OS, the clock.
 * `vi.mock` replaces a module the subject imports, `vi.spyOn` and `vi.fn`
 * exist to assert a call count, and `vi.mocked` is the type of one of them —
 * each a test that asserts on its own fake. `vi.stubEnv` stays legal: the
 * environment is a process boundary.
 */
export const noModuleMocksRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow vi.mock, vi.doMock, vi.spyOn, vi.fn, and vi.mocked in a test file; a double is a test Layer on the subject's Context.Tag.",
    },
    messages: {
      moduleMock:
        "`{{name}}` fakes a module or counts calls. Provide a test `Layer` on the subject's `Context.Tag` at the process boundary and assert what a caller observes.",
    },
  },
  createOnce(context) {
    let viNames = new Set<string>([VI_EXPORT]);

    return {
      before() {
        if (!isTestFile(context.filename)) return false;
        viNames = new Set([VI_EXPORT]);
        return true;
      },
      ImportDeclaration(node) {
        if (node.source.value !== VITEST_MODULE) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported = specifier.imported;
          if (imported.type === "Identifier" && imported.name === VI_EXPORT) {
            viNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        const name = mockMemberName(node.callee, viNames);
        if (name !== null) context.report({ node, messageId: "moduleMock", data: { name } });
      },
    };
  },
});
