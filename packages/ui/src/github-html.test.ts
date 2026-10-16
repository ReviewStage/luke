import assert from "node:assert/strict";
import { test } from "vitest";
import { githubShapes, wholeRendering } from "./github-html.js";

/**
 * github-html.test.ts -- GitHub's rendering reaches the window's HTML steps
 * whole, and what GitHub dresses its way is reshaped into what the window
 * draws its own: a highlighted block into a fenced one in its language, and
 * a diagram into a fenced mermaid block of its source. The trees are as the parse leaves them.
 */

/** A node of the parsed tree, as the step reads it. */
type HtmlNode = Parameters<ReturnType<typeof githubShapes>>[0];

/** An element of the parsed tree. */
function element(
  tagName: string,
  properties: NonNullable<HtmlNode["properties"]>,
  children: HtmlNode[] = [],
): HtmlNode {
  return { type: "element", tagName, properties, children };
}

function text(value: string): HtmlNode {
  return { type: "text", value };
}

/** The tree the step leaves of the children given. */
function shaped(...children: HtmlNode[]) {
  const tree: HtmlNode = { type: "root", children };
  githubShapes()(tree);
  return tree.children;
}

test("the words reach the HTML steps whole, as one HTML node, a blank line in a block included", () => {
  const tree = { children: [{ type: "paragraph" }, { type: "code" }] };
  const words = "<pre>one\n\nthree</pre>";
  wholeRendering()(tree, { value: words });
  assert.deepEqual(tree.children, [{ type: "html", value: words }]);
});

test("a highlighted block becomes a fenced block in its language, holding its words alone", () => {
  const block = element("div", { className: ["highlight", "highlight-source-ts", "notranslate"] }, [
    element("pre", {}, [
      element("span", { className: ["pl-k"] }, [text("const")]),
      text(" a = 1;\n\nconst b = 2;"),
    ]),
  ]);
  assert.deepEqual(shaped(block), [
    element("pre", {}, [
      element("code", { className: ["language-ts"] }, [text("const a = 1;\n\nconst b = 2;")]),
    ]),
  ]);
});

test("a diagram becomes a fenced mermaid block of its source", () => {
  const diagram = element("section", { dataType: "mermaid" }, [
    element("div", {}, [element("pre", { lang: "mermaid" }, [text("graph TD\nA-->B")])]),
  ]);
  assert.deepEqual(shaped(diagram), [
    element("section", { dataType: "mermaid" }, [
      element("div", {}, [
        element("pre", {}, [
          element("code", { className: ["language-mermaid"] }, [text("graph TD\nA-->B")]),
        ]),
      ]),
    ]),
  ]);
});
