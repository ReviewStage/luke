// field-value.ts -- SPIKE: a plan field's stored shape as an editor's document and back, the same for every ProseMirror-based prototype.

import type { Node as PmNode } from "prosemirror-model";
import {
  type FieldSources,
  fieldMarkdown,
  fieldOpened,
  inlineMarkdown,
  inlineOpened,
  type PmJson,
} from "./field-markdown";

/**
 * SPIKE, not production code. Each field is read and written in its own
 * stored shape: a text field's Markdown, a list's items, a rule's statement
 * and examples. Nothing here reads the formatted body; that is the
 * proposal's rule (`docs/proposals/plan-history-and-editing.md`) and the
 * reason a per-field editor needs no body→fields parser.
 */

/** The kinds of field an editor edits. */
export const PM_FIELD_KIND = {
  TEXT: "text",
  ITEMS: "items",
  RULE: "rule",
} as const;

export type PmFieldKind = (typeof PM_FIELD_KIND)[keyof typeof PM_FIELD_KIND];

/** One example of a rule, each clause as typed, empty while unknown. */
export interface ExampleValue {
  readonly given: string;
  readonly when: string;
  readonly then: string;
}

/** A rule's parts as the editor reads them back. */
export interface RuleValue {
  readonly statement: string;
  readonly examples: readonly ExampleValue[];
}

/** What a field holds, by its kind. */
export type FieldValue =
  | { readonly kind: typeof PM_FIELD_KIND.TEXT; readonly markdown: string | null }
  | { readonly kind: typeof PM_FIELD_KIND.ITEMS; readonly items: readonly string[] }
  | { readonly kind: typeof PM_FIELD_KIND.RULE; readonly rule: RuleValue };

function part(type: string, words: string): PmJson {
  const content = inlineOpened(words);
  return content.length === 0 ? { type } : { type, content };
}

/**
 * A field's stored value as an editor document's JSON, with the source of
 * each node `sourceNodes` walks: a text field's top-level blocks, a list's
 * items, a rule's statement and clauses.
 */
export function fieldJson(value: FieldValue): { json: PmJson; sources: readonly string[] } {
  switch (value.kind) {
    case PM_FIELD_KIND.TEXT: {
      const opened = fieldOpened(value.markdown);
      return { json: opened.doc, sources: opened.sources };
    }
    case PM_FIELD_KIND.ITEMS: {
      const items = value.items.length === 0 ? [""] : value.items;
      const content = items.map((item) => ({
        type: "listItem",
        content: [part("paragraph", item)],
      }));
      return { json: { type: "doc", content: [{ type: "bulletList", content }] }, sources: items };
    }
    case PM_FIELD_KIND.RULE: {
      const { statement, examples } = value.rule;
      const json = {
        type: "doc",
        content: [
          part("statement", statement),
          {
            type: "examples",
            content: examples.map((example) => ({
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
      const clauses = examples.flatMap((example) => [example.given, example.when, example.then]);
      return { json, sources: [statement, ...clauses] };
    }
  }
}

/** The nodes that carry a source, in `fieldJson`'s order. */
function sourceNodes(kind: PmFieldKind, doc: PmNode): PmNode[] {
  const nodes: PmNode[] = [];
  if (kind === PM_FIELD_KIND.TEXT) {
    doc.forEach((child) => {
      nodes.push(child);
    });
  } else if (kind === PM_FIELD_KIND.ITEMS) {
    doc.firstChild?.forEach((item) => {
      nodes.push(item);
    });
  } else {
    nodes.push(doc.child(0));
    doc.child(1).forEach((example) => {
      example.forEach((clause) => {
        nodes.push(clause);
      });
    });
  }
  return nodes;
}

/** A freshly built document's source-bearing nodes, each with the words it opened from. */
export function sourcesOf(
  kind: PmFieldKind,
  doc: PmNode,
  sources: readonly string[],
): FieldSources {
  const map = new Map<PmNode, string>();
  sourceNodes(kind, doc).forEach((node, index) => {
    const source = sources[index];
    if (source !== undefined) map.set(node, source);
  });
  return map;
}

/** Inline words as stored: the words it opened from while the node is untouched, printed fresh once it is not. */
function wordsOf(node: PmNode, sources: FieldSources): string {
  return sources.get(node) ?? inlineMarkdown(node);
}

/** The editor's document read back as the field's stored shape; no body is ever parsed. */
export function fieldValueOf(kind: PmFieldKind, doc: PmNode, sources: FieldSources): FieldValue {
  if (kind === PM_FIELD_KIND.TEXT) return { kind, markdown: fieldMarkdown(doc, sources) };
  if (kind === PM_FIELD_KIND.ITEMS) {
    const items: string[] = [];
    doc.firstChild?.forEach((item) => {
      const source = sources.get(item);
      const words =
        source ?? (item.firstChild === null ? "" : inlineMarkdown(item.firstChild).trim());
      if (words !== "") items.push(words);
    });
    return { kind, items };
  }
  const examples: ExampleValue[] = [];
  doc.child(1).forEach((example) => {
    examples.push({
      given: wordsOf(example.child(0), sources),
      when: wordsOf(example.child(1), sources),
      // biome-ignore lint/suspicious/noThenProperty: `then` is the example's key in the fixed template.
      then: wordsOf(example.child(2), sources), // oxlint-disable-line unicorn/no-thenable -- the same key.
    });
  });
  return { kind, rule: { statement: wordsOf(doc.child(0), sources), examples } };
}
