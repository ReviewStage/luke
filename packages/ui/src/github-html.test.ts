import assert from "node:assert/strict";
import { test } from "vitest";
import { githubShapes, wholeRendering } from "./github-html.js";

/**
 * github-html.test.ts -- GitHub's rendering reaches the window's HTML steps
 * whole, and what GitHub dresses its way is reshaped into what the window
 * draws its own: a highlighted block into a fenced one in its language, and
 * a diagram into a fenced mermaid block of its source, a themed picture
 * into its `<img>` alone, and a picture GitHub links to itself into the
 * picture alone. The trees are as the parse leaves them.
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

test("a themed picture keeps its image alone, so no source names an address the window would read itself", () => {
  const badge = element("img", { src: "https://camo.githubusercontent.com/light", alt: "Review" });
  const picture = element("picture", {}, [
    element("source", {
      media: "(prefers-color-scheme: dark)",
      srcSet: ["https://camo.githubusercontent.com/dark"],
    }),
    element("source", {
      media: "(prefers-color-scheme: light)",
      srcSet: ["https://camo.githubusercontent.com/light"],
    }),
    badge,
  ]);
  assert.deepEqual(shaped(element("a", { href: "https://example.com/review" }, [picture])), [
    element("a", { href: "https://example.com/review" }, [element("picture", {}, [badge])]),
  ]);
});

test("a picture GitHub links to itself, or to another of its own image addresses, stands alone; a picture linked anywhere else keeps its link", () => {
  const upload = "https://github.com/user-attachments/assets/4f2c1a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  const signed = "https://private-user-images.githubusercontent.com/1/2-3.png?jwt=abc";
  const tracker = "https://tracker.example.com/pixel.png";
  const picture = (src: string) => element("img", { src, alt: "before and after" });
  const linked = (href: string, src: string) =>
    element("a", { href, target: "_blank" }, [text(" "), picture(src), text("\n")]);
  assert.deepEqual(shaped(linked(upload, upload)), [picture(upload)], "linked to itself");
  assert.deepEqual(shaped(linked(upload, signed)), [picture(signed)], "linked to its upload");
  assert.deepEqual(
    shaped(linked(tracker, tracker)),
    [picture(tracker)],
    "any picture linked to itself",
  );
  assert.deepEqual(
    shaped(linked("https://review.example.com", upload)),
    [linked("https://review.example.com", upload)],
    "a link elsewhere is kept",
  );
  const captioned = element("a", { href: upload }, [picture(upload), text("the screenshot")]);
  assert.deepEqual(shaped(captioned), [captioned], "a link with words beside its picture is kept");
});

test("a suggested change becomes a fenced block of its rows in order, a removed line marked - and an added one +, its words as they stand", () => {
  const row = (side: "deletion" | "addition", words: HtmlNode[]) =>
    element("tr", {}, [
      element("td", { className: ["blob-num", `blob-num-${side}`] }),
      element("td", { className: ["blob-code-inner", `blob-code-${side}`] }, words),
    ]);
  const blob = element("div", { className: ["my-2", "js-suggested-changes-blob", "diff-view"] }, [
    element("div", { className: ["f6"] }, [text("Suggested change")]),
    element("table", {}, [
      element("tbody", {}, [
        row("deletion", [
          element("span", { className: ["pl-k"] }, [text("const")]),
          text(" a = 1;"),
        ]),
        row("addition", []),
        row("addition", [text("  const a = 2;")]),
      ]),
    ]),
  ]);
  assert.deepEqual(shaped(blob), [
    element("pre", {}, [
      element("code", { className: ["language-suggested-change"] }, [
        text("-const a = 1;\n+\n+  const a = 2;"),
      ]),
    ]),
  ]);
});
