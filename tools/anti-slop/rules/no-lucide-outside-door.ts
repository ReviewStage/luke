import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";
import { isDoorFile, isLucideModule, LUCIDE_BASELINE } from "../shared/lucide-guard.ts";

/**
 * Every icon is imported through `@luke/ui/icons`, so one glyph stands for
 * each meaning and no screen picks a drawing of its own. A direct
 * `lucide-react` import is refused outside the door, from a baseline of the
 * files that still hold one (`lucide-baseline.json`), which only shrinks as
 * each screen moves onto the door.
 */
export const noLucideOutsideDoorRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing lucide-react outside @luke/ui's icon door, from a baseline that only shrinks.",
    },
    messages: {
      newImport:
        "Import icons from `@luke/ui/icons`, the one door: a Lucide glyph by its Lucide name, a concept as `GLYPH.X`. This file's `lucide-react` imports are more than the baseline holds.",
      staleBaseline:
        "This file imports `lucide-react` {{found}} time(s), fewer than `tools/anti-slop/lucide-baseline.json` holds ({{expected}}). Lower its count to {{found}}, or delete the row at 0.",
    },
  },
  createOnce(context) {
    let imports: ESTree.Node[] = [];
    let expected = 0;

    function note(node: ESTree.Node, source: unknown): void {
      if (isLucideModule(source)) imports.push(node);
    }

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        if (!TYPESCRIPT_SOURCE.test(file) || isDoorFile(file)) return false;
        imports = [];
        expected = LUCIDE_BASELINE.get(file) ?? 0;
        return true;
      },
      ImportDeclaration(node) {
        note(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        note(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) note(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") note(node, node.source.value);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier" || callee.name !== "require") return;
        const argument = node.arguments[0];
        if (argument?.type === "Literal") note(node, argument.value);
      },
      "Program:exit"(program) {
        // Note that the imports past the baseline's count are the ones reported, since the ones before it were already there.
        for (const node of imports.slice(expected))
          context.report({ node, messageId: "newImport" });
        if (imports.length >= expected) return;
        context.report({
          node: program,
          messageId: "staleBaseline",
          data: { found: String(imports.length), expected: String(expected) },
        });
      },
    };
  },
});
