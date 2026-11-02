import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { Schema } from "effect";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";

/**
 * The product is named in one constant, `PRODUCT_NAME`
 * (`packages/features/src/product-name.ts`), so a rename is that constant and
 * not a sweep of every sentence that says it. Outside that module, an app's or
 * a package's string, template, or JSX text that spells the name is refused:
 * the words interpolate `PRODUCT_NAME`, or say what they mean without it ("The
 * service did not answer", "Couldn't reach ChatGPT"). A test, what tests share,
 * and a fixture pin what a surface says, so the rule leaves them be. A file
 * that cannot read the constant is named in `product-name-allowed.json` with
 * its reason.
 */

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** The module the name is spelled in, which the rule reads it from. */
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

/** An app's or a package's own source, never a test, what tests share, or a fixture. */
function isChecked(file: string): boolean {
  return (
    TYPESCRIPT_SOURCE.test(file) &&
    /^(?:apps|packages)\//u.test(file) &&
    !/\.test\.[cm]?[jt]sx?$/u.test(file) &&
    !/(?:^|\/)(?:tests|testing|__tests__|fixtures)\//u.test(file) &&
    file !== NAME_MODULE &&
    ALLOWED[file] === undefined
  );
}

export const noProductNameRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow spelling the product's name in a string outside PRODUCT_NAME.",
    },
    messages: {
      productName:
        "Spell the product's name through `PRODUCT_NAME` (`@luke/features/product-name`), or say this without it. A file that cannot import it goes in `tools/anti-slop/product-name-allowed.json` with its reason.",
    },
  },
  createOnce(context) {
    function check(node: ESTree.Node, text: string): void {
      if (text.includes(PRODUCT_NAME)) context.report({ node, messageId: "productName" });
    }
    return {
      before() {
        return isChecked(repositoryPathOf(context.filename));
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
