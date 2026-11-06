import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { calleeName, isWatchedTest, nodesWithin } from "../shared/test-guard.ts";

const FILE_READERS: ReadonlySet<string> = new Set(["readFile", "readFileSync"]);

const TREE_LISTERS: ReadonlySet<string> = new Set(["glob", "globSync", "readdir", "readdirSync"]);

const SOURCE_PATH = /\.(?:css|[cm]?tsx?)$/u;

const SOURCE_TREE = /(?:^|\/)src(?:\/|$)/u;

const CHECKOUT_PATH =
  /^@repo\/|(?:^|\/)\.{1,2}(?:\/|$)|(?:^|\/)(?:apps|packages|tools)\/[^/]+\/src(?:\/|$)/u;

const OWN_PLACE: ReadonlySet<string> = new Set(["__dirname", "__filename"]);

function reachesCheckout(nodes: readonly ESTree.Node[], strings: readonly string[]): boolean {
  if (strings.some((text) => CHECKOUT_PATH.test(text))) return true;
  return nodes.some(
    (node) =>
      (node.type === "MetaProperty" && node.meta.name === "import") ||
      (node.type === "Identifier" && OWN_PLACE.has(node.name)),
  );
}

export const noSourceReadInTestRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a test reading a .css or TypeScript file of this checkout, or listing a src tree.",
    },
    messages: {
      sourceRead:
        'This test reads source text ({{what}}). Hold a rule about source text in a lint rule under tools/anti-slop/, and assert behavior through the public export (root AGENTS.md\'s "Testing").',
    },
  },
  createOnce(context) {
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
