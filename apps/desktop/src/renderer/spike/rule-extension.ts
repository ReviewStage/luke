// rule-extension.ts -- SPIKE: a rule's fixed shape as TipTap nodes: its statement, then examples of exactly Given, When, and Then.

import { type Editor, Extension, type JSONContent, Node } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/**
 * SPIKE, not production code. The one shape no library knows: a rule is its
 * statement over examples of exactly Given, When, and Then, the labels drawn
 * and never typed, so the structure cannot be broken by editing. Enter walks
 * the parts as a form does and adds the next example after Then; Backspace in
 * an empty example strikes it. Each part's words are inline Markdown, read
 * and written by TipTap's own Markdown manager.
 */

/** A rule's parts as `plan-field-editor-model.ts` holds them. */
export interface RuleParts {
  readonly statement: string;
  readonly examples: readonly { given: string; when: string; then: string }[];
}

/** TipTap's Markdown for one part's inline words, with StarterKit's marks. */
const markdown = new MarkdownManager({ extensions: [StarterKit] });

const EMPTY_EXAMPLE: JSONContent = {
  type: "example",
  content: [{ type: "given" }, { type: "when" }, { type: "then" }],
};

/** A clause, its label drawn beside its words as the read view draws it. */
function clause(name: string, label: string) {
  return Node.create({
    name,
    content: "inline*",
    parseHTML: () => [{ tag: `div[data-clause=${name}]` }],
    renderHTML: () => [
      "div",
      { "data-clause": name, class: "spike-clause" },
      ["strong", { contenteditable: "false" }, label],
      ["span", 0],
    ],
  });
}

/** One part's inline Markdown as the node of that part. */
function part(type: string, words: string): JSONContent {
  const content = markdown.parse(words).content?.[0]?.content;
  return content === undefined || content.length === 0 ? { type } : { type, content };
}

/** One part's node as its inline Markdown. */
function words(node: JSONContent | undefined): string {
  if (node?.content === undefined) return "";
  return markdown
    .serialize({ type: "doc", content: [{ type: "paragraph", content: node.content }] })
    .trim();
}

/** A rule's parts as the editor's document. */
export function ruleDocument(rule: RuleParts): JSONContent {
  return {
    type: "doc",
    content: [
      part("statement", rule.statement),
      {
        type: "examples",
        content: rule.examples.map((example) => ({
          type: "example",
          content: [
            part("given", example.given),
            part("when", example.when),
            part("then", example.then),
          ],
        })),
      },
    ],
  };
}

/** The editor's document read back as a rule's parts. */
export function ruleParts(editor: Editor): RuleParts {
  const doc: JSONContent = editor.getJSON();
  const [statement, examples] = doc.content ?? [];
  return {
    statement: words(statement),
    examples: (examples?.content ?? []).map((example) => ({
      given: words(example.content?.[0]),
      when: words(example.content?.[1]),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template.
      then: words(example.content?.[2]), // oxlint-disable-line unicorn/no-thenable -- the same key.
    })),
  };
}

/** Enter: the statement to the first Given (adding an example where there is none), a clause to the next, Then to a new example. */
function nextPart(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const name = $from.parent.type.name;
  if (name === "statement") {
    const inside = $from.after(1) + 1;
    const chain = editor.chain();
    if (editor.state.doc.child(1).childCount === 0) chain.insertContentAt(inside, EMPTY_EXAMPLE);
    return chain.setTextSelection(inside + 2).run();
  }
  if (name === "given" || name === "when")
    return editor.commands.setTextSelection($from.after() + 1);
  if (name !== "then") return false;
  const after = $from.after(2);
  return editor
    .chain()
    .insertContentAt(after, EMPTY_EXAMPLE)
    .setTextSelection(after + 2)
    .run();
}

/** Backspace at the start of an example whose clauses are all empty strikes it. */
function strikeEmptyExample(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.depth < 3) return false;
  const example = $from.node(2);
  if (example.type.name !== "example" || example.textContent !== "") return false;
  return editor.commands.deleteRange({ from: $from.before(2), to: $from.after(2) });
}

/** The rule's nodes and keys, over StarterKit's inline marks. */
export const RULE_EXTENSIONS = [
  Node.create({ name: "doc", topNode: true, content: "statement examples" }),
  Node.create({
    name: "statement",
    content: "inline*",
    parseHTML: () => [{ tag: "p" }],
    renderHTML: () => ["p", 0],
  }),
  Node.create({
    name: "examples",
    content: "example*",
    parseHTML: () => [{ tag: "ul" }],
    renderHTML: () => ["ul", 0],
  }),
  Node.create({
    name: "example",
    content: "given when then",
    parseHTML: () => [{ tag: "li" }],
    renderHTML: () => ["li", 0],
  }),
  clause("given", "Given"),
  clause("when", "When"),
  clause("then", "Then"),
  Extension.create({
    name: "ruleKeys",
    addKeyboardShortcuts: () => ({
      Enter: ({ editor }) => nextPart(editor),
      Backspace: ({ editor }) => strikeEmptyExample(editor),
    }),
  }),
];
