import { type Editor, Extension, type JSONContent, Node } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import type { RuleParts } from "./contract";

/**
 * rule-extension.ts -- a rule's fixed shape as TipTap nodes: its statement, then examples of exactly Given, When, and Then.
 *
 * The one shape no library knows. A rule is its statement over examples of
 * exactly Given, When, and Then, the labels drawn and never typed, so editing
 * cannot break the structure the plan stores (`examples: [{given, when,
 * then}]`). Enter walks the parts as a form does and adds the next example
 * after Then; Backspace at the start of an empty example strikes it. Each
 * part's words are inline Markdown, read and written by TipTap's own Markdown
 * manager.
 */

/** A rule's nodes, by name: the document, its statement, its examples, one example, and each clause. */
const RULE_NODE = {
  DOC: "doc",
  STATEMENT: "statement",
  EXAMPLES: "examples",
  EXAMPLE: "example",
  GIVEN: "given",
  WHEN: "when",
  // biome-ignore lint/suspicious/noThenProperty: `then` is the example's clause in the fixed template, and this object is never awaited.
  THEN: "then", // oxlint-disable-line unicorn/no-thenable -- the same name, for the same reason.
} as const;

type RuleNode = (typeof RULE_NODE)[keyof typeof RULE_NODE];

/** TipTap's Markdown for one part's inline words, with StarterKit's marks. */
const markdown = new MarkdownManager({ extensions: [StarterKit] });

const EMPTY_EXAMPLE: JSONContent = {
  type: RULE_NODE.EXAMPLE,
  content: [{ type: RULE_NODE.GIVEN }, { type: RULE_NODE.WHEN }, { type: RULE_NODE.THEN }],
};

/** A clause, its label drawn beside its words as the read view draws it. */
function clause(name: RuleNode, label: string) {
  return Node.create({
    name,
    content: "inline*",
    parseHTML: () => [{ tag: `div[data-clause=${name}]` }],
    renderHTML: () => [
      "div",
      { "data-clause": name, class: "plan-rule-clause" },
      ["strong", { contenteditable: "false" }, label],
      // The space the read view draws between a label and its words.
      " ",
      ["span", 0],
    ],
  });
}

/** One part's inline Markdown as the node of that part. */
function part(type: RuleNode, words: string): JSONContent {
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
    type: RULE_NODE.DOC,
    content: [
      part(RULE_NODE.STATEMENT, rule.statement),
      {
        type: RULE_NODE.EXAMPLES,
        content: rule.examples.map((example) => ({
          type: RULE_NODE.EXAMPLE,
          content: [
            part(RULE_NODE.GIVEN, example.given),
            part(RULE_NODE.WHEN, example.when),
            part(RULE_NODE.THEN, example.then),
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
  if (name === RULE_NODE.STATEMENT) {
    const inside = $from.after(1) + 1;
    const chain = editor.chain();
    if (editor.state.doc.child(1).childCount === 0) chain.insertContentAt(inside, EMPTY_EXAMPLE);
    return chain.setTextSelection(inside + 2).run();
  }
  if (name === RULE_NODE.GIVEN || name === RULE_NODE.WHEN)
    return editor.commands.setTextSelection($from.after() + 1);
  if (name !== RULE_NODE.THEN) return false;
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
  if (example.type.name !== RULE_NODE.EXAMPLE || example.textContent !== "") return false;
  return editor.commands.deleteRange({ from: $from.before(2), to: $from.after(2) });
}

/** The rule's nodes and keys, over StarterKit's inline marks. */
export const RULE_EXTENSIONS = [
  Node.create({ name: RULE_NODE.DOC, topNode: true, content: "statement examples" }),
  Node.create({
    name: RULE_NODE.STATEMENT,
    content: "inline*",
    parseHTML: () => [{ tag: "p" }],
    renderHTML: () => ["p", 0],
  }),
  Node.create({
    name: RULE_NODE.EXAMPLES,
    content: "example*",
    parseHTML: () => [{ tag: "ul" }],
    renderHTML: () => ["ul", 0],
  }),
  Node.create({
    name: RULE_NODE.EXAMPLE,
    content: "given when then",
    parseHTML: () => [{ tag: "li" }],
    renderHTML: () => ["li", 0],
  }),
  clause(RULE_NODE.GIVEN, "Given"),
  clause(RULE_NODE.WHEN, "When"),
  clause(RULE_NODE.THEN, "Then"),
  Extension.create({
    name: "ruleKeys",
    addKeyboardShortcuts: () => ({
      Enter: ({ editor }) => nextPart(editor),
      Backspace: ({ editor }) => strikeEmptyExample(editor),
    }),
  }),
];
