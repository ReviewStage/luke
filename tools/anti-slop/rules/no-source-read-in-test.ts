import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { calleeName, isWatchedTest, nodesWithin } from "../shared/test-guard.ts";

/** The calls that read a file's text, `fs`'s and `fs/promises`' alike. */
const FILE_READERS: ReadonlySet<string> = new Set(["readFile", "readFileSync"]);

/** The calls that list a tree of files. */
const TREE_LISTERS: ReadonlySet<string> = new Set(["glob", "globSync", "readdir", "readdirSync"]);

/** A path to a stylesheet or a TypeScript source. */
const SOURCE_PATH = /\.(?:css|[cm]?tsx?)$/u;

/** A path that names a workspace's `src` tree. */
const SOURCE_TREE = /(?:^|\/)src(?:\/|$)/u;

/**
 * A path spelled from this checkout: relative to the test, a workspace
 * package's, or through one of the repository's own folders. A path into a
 * temporary directory or a checkout the test made is data, not source.
 */
const CHECKOUT_PATH = /^@luke\/|(?:^|\/)(?:\.{1,2}|src|apps|packages|tools)(?:\/|$)/u;

/** The names a module reaches its own place on disk by. */
const OWN_PLACE: ReadonlySet<string> = new Set(["__dirname", "__filename"]);

/** Whether a path's subtree reaches into this checkout, by `import.meta`, `__dirname`, or a path that names it. */
function reachesCheckout(nodes: readonly ESTree.Node[], strings: readonly string[]): boolean {
  if (strings.some((text) => CHECKOUT_PATH.test(text))) return true;
  return nodes.some(
    (node) =>
      (node.type === "MetaProperty" && node.meta.name === "import") ||
      (node.type === "Identifier" && OWN_PLACE.has(node.name)),
  );
}

/**
 * Root AGENTS.md's "Testing": a rule about source text, such as a banned
 * class or import, is a lint rule, never a test that reads source files. A
 * test reads a stylesheet or a module's text only to pin a pattern in it,
 * which is a lint rule's job, or appearance, which `@luke/ui` and its rules
 * hold. A test asserts what a caller sees through the public export.
 */
export const noSourceReadInTestRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a test reading a .css or TypeScript file of this checkout, or listing a src tree.",
    },
    messages: {
      sourceRead:
        "This test reads source text ({{what}}). Hold a rule about source text in a lint rule under tools/anti-slop/, and assert behavior through the public export (root AGENTS.md's \"Testing\").",
    },
  },
  createOnce(context) {
    // Note that a path is often held in a constant above the read, so each constant's value is kept to read through.
    let constants = new Map<string, ESTree.Node>();

    return {
      before() {
        constants = new Map();
        return isWatchedTest(context.filename);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init) constants.set(node.id.name, node.init);
      },
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === undefined || (!FILE_READERS.has(name) && !TREE_LISTERS.has(name))) return;
        const { nodes, strings } = nodesWithin(node.arguments[0], (named) => constants.get(named));
        if (!reachesCheckout(nodes, strings)) return;
        const pattern = FILE_READERS.has(name) ? SOURCE_PATH : SOURCE_TREE;
        const what = strings.find((text) => pattern.test(text));
        if (what !== undefined)
          context.report({ node, messageId: "sourceRead", data: { what: `${name} of ${what}` } });
      },
    };
  },
});
