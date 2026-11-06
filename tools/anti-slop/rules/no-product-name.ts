import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { Schema } from "effect";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const NAME_MODULE = "packages/features/src/product-name.ts";

const PRODUCT_NAME = (() => {
  const source = readFileSync(path.join(REPOSITORY_ROOT, NAME_MODULE), "utf8");
  const name = /export const PRODUCT_NAME = "([^"]+)";/u.exec(source)?.[1];
  if (name === undefined)
    throw new Error(`${NAME_MODULE} no longer spells PRODUCT_NAME as a literal`);
  return name;
})();

const ALLOWED: Readonly<Record<string, string>> = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
)(readFileSync(path.resolve(REPOSITORY_ROOT, "tools/anti-slop/product-name-allowed.json"), "utf8"));

function isSource(file: string): boolean {
  return TYPESCRIPT_SOURCE.test(file) && /^(?:apps|packages)\//u.test(file) && file !== NAME_MODULE;
}

function areStringsChecked(file: string): boolean {
  return (
    isSource(file) &&
    !/\.test\.[cm]?[jt]sx?$/u.test(file) &&
    !/(?:^|\/)(?:tests|testing|__tests__|fixtures)\//u.test(file) &&
    ALLOWED[file] === undefined
  );
}

function proseOf(comment: string): string {
  return comment.replace(/`[^`]*`/gu, "");
}

export const noProductNameRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow spelling the product's name in a string or a comment outside PRODUCT_NAME.",
    },
    messages: {
      productName:
        "Spell the product's name through `PRODUCT_NAME` (`@repo/features/product-name`), or say this without it. A file that cannot import it goes in `tools/anti-slop/product-name-allowed.json` with its reason.",
      productNameInComment:
        'Say this comment without the product\'s name: "we", "our", "the app", or "the service". Code it quotes in backticks may spell it.',
    },
  },
  createOnce(context) {
    let stringsChecked = false;
    function check(node: ESTree.Node, text: string): void {
      if (stringsChecked && text.includes(PRODUCT_NAME))
        context.report({ node, messageId: "productName" });
    }
    return {
      before() {
        const file = repositoryPathOf(context.filename);
        stringsChecked = areStringsChecked(file);
        return isSource(file);
      },
      Program() {
        for (const comment of context.sourceCode.getAllComments())
          if (proseOf(comment.value).includes(PRODUCT_NAME))
            context.report({ node: comment, messageId: "productNameInComment" });
      },
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      JSXText(node) {
        check(node, node.value);
      },
    };
  },
});
