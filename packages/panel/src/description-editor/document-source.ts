import { type AnyExtension, type Editor, type JSONContent, Node } from "@tiptap/core";
import { BulletList, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { diffArrays } from "diff";
import { withMentions } from "./mention-node.js";

const FOOTNOTE = /\[\^[^\]\s]+\]/u;

const ESCAPED_ALERT = /^(>[^\S\n]*)\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\\]/iu;

const BLOCK_GAP = "\n\n";

const LIST_BLOCKS = new Set([BulletList.name, TaskList.name]);

export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "pre[data-raw-block]" }],
  renderHTML: ({ node }) => [
    "pre",
    { "data-raw-block": "", class: "description-raw-block", contenteditable: "false" },
    node.attrs.source,
  ],
  renderMarkdown: (node: JSONContent) => String(node.attrs?.source ?? "").trimEnd(),
});

type LexedToken = ReturnType<MarkdownManager["instance"]["lexer"]>[number];

function tokenSources(token: LexedToken): string[] {
  if (token.type !== "list" || token.ordered === true || !("items" in token)) return [token.raw];
  const runs: string[] = [];
  let task: boolean | undefined;
  for (const item of token.items) {
    if (runs.length > 0 && item.task === task) runs[runs.length - 1] += item.raw;
    else runs.push(item.raw);
    task = item.task;
  }
  const joined = runs.join("");
  if (runs.length < 2 || !token.raw.startsWith(joined)) return [token.raw];
  runs[runs.length - 1] += token.raw.slice(joined.length);
  return runs;
}

function keptRaw(token: LexedToken): boolean {
  if (token.type === "html" || token.type === "def") return true;
  if (token.type !== "paragraph") return false;
  const inline = "tokens" in token ? (token.tokens ?? []) : [];
  return FOOTNOTE.test(token.raw) || inline.some((child) => child.type === "html");
}

export interface OpenedDocument {
  readonly content: JSONContent;
  readonly sources: readonly string[];
  readonly lead: string;
  readonly ending: string;
}

export interface HeldSources {
  readonly sources: ReadonlyMap<PmNode, string>;
  readonly lead: string;
  readonly ending: string;
}

const LINE_ENDING = { LF: "\n", CRLF: "\r\n" } as const;

type LineEnding = (typeof LINE_ENDING)[keyof typeof LINE_ENDING];

export function lineEndingOf(markdown: string): LineEnding {
  return markdown.includes(LINE_ENDING.CRLF) ? LINE_ENDING.CRLF : LINE_ENDING.LF;
}

export function withLf(markdown: string): string {
  return markdown.replaceAll(LINE_ENDING.CRLF, LINE_ENDING.LF);
}

export function withLineEnding(markdown: string, ending: LineEnding): string {
  return ending === LINE_ENDING.LF ? markdown : markdown.replaceAll(LINE_ENDING.LF, ending);
}

export function documentManager(extensions: AnyExtension[]): MarkdownManager {
  return new MarkdownManager({ extensions });
}

export function documentOpened(manager: MarkdownManager, markdown: string): OpenedDocument {
  const blocks: JSONContent[] = [];
  const sources: string[] = [];
  let lead = "";
  for (const token of manager.instance.lexer(markdown)) {
    if (token.type === "space") {
      if (sources.length === 0) lead += token.raw;
      else sources[sources.length - 1] += token.raw;
      continue;
    }
    for (const source of tokenSources(token)) {
      const parsed = keptRaw(token) ? [] : (manager.parse(source.trimEnd()).content ?? []);
      const [block] = parsed;
      blocks.push(
        parsed.length === 1 && block !== undefined
          ? withMentions(block)
          : { type: RawBlock.name, attrs: { source } },
      );
      sources.push(source);
    }
  }
  const content = blocks.length === 0 ? [{ type: "paragraph" }] : blocks;
  return {
    content: { type: "doc", content },
    sources,
    lead,
    ending: trailing(sources.at(-1) ?? ""),
  };
}

export function sourcesOf(doc: PmNode, opened: OpenedDocument): HeldSources {
  const map = new Map<PmNode, string>();
  doc.forEach((node, _offset, index) => {
    const source = opened.sources[index];
    if (source !== undefined) map.set(node, source);
  });
  return { sources: map, lead: opened.lead, ending: opened.ending };
}

function trailing(source: string): string {
  return /\s*$/u.exec(source)?.[0] ?? "";
}

function reprinted(manager: MarkdownManager, node: PmNode): string {
  const markdown = manager.serialize({ type: "doc", content: [node.toJSON()] }).trimEnd();
  return node.type.name === "blockquote" ? markdown.replace(ESCAPED_ALERT, "$1[!$2]") : markdown;
}

function blockMarkdown(manager: MarkdownManager, node: PmNode, held: HeldSources): string {
  return held.sources.get(node) ?? reprinted(manager, node) + BLOCK_GAP;
}

export function documentMarkdown(manager: MarkdownManager, doc: PmNode, held: HeldSources): string {
  let out = held.lead;
  doc.forEach((node, _offset, index) => {
    const block = blockMarkdown(manager, node, held);
    if (held.sources.get(node) === undefined && block.trim() === "") return;
    if (index === doc.childCount - 1) {
      out += block.trimEnd() + held.ending;
      return;
    }
    if (LIST_BLOCKS.has(node.type.name) && LIST_BLOCKS.has(doc.child(index + 1).type.name)) {
      out += held.sources.has(node) && block.endsWith("\n") ? block : `${block.trimEnd()}\n`;
      return;
    }
    out += /\n[^\S\n]*\n$/u.test(block) ? block : block.trimEnd() + BLOCK_GAP;
  });
  return out;
}

export interface TakenDocument {
  readonly held: HeldSources;
  readonly base: string;
}

interface Taken {
  readonly from: number;
  readonly to: number;
  readonly blocks: readonly JSONContent[];
  readonly sources: readonly string[];
}

export function documentTook(
  editor: Editor,
  manager: MarkdownManager,
  held: HeldSources,
  sent: string,
  merged: string,
): TakenDocument {
  const sentOpened = documentOpened(manager, sent);
  const was = [...sentOpened.sources];
  const now = documentOpened(manager, merged);
  const current: string[] = [];
  editor.state.doc.forEach((node) => {
    current.push(blockMarkdown(manager, node, held));
  });
  const standing = new Map<number, number>();
  let sentAt = 0;
  let currentAt = 0;
  for (const part of diffArrays(was, current)) {
    for (let index = 0; index < part.count; index += 1) {
      if (!part.added && !part.removed) standing.set(sentAt, currentAt);
      if (!part.added) sentAt += 1;
      if (!part.removed) currentAt += 1;
    }
  }
  const taken: Taken[] = [];
  const base: string[] = [sentOpened.lead];
  sentAt = 0;
  let mergedAt = 0;
  for (const part of diffArrays(was, [...now.sources])) {
    if (!part.added && !part.removed) {
      base.push(...was.slice(sentAt, sentAt + part.count));
      sentAt += part.count;
      mergedAt += part.count;
      continue;
    }
    const changed = part.removed ? part.count : 0;
    const added = part.added ? part.count : 0;
    const anchors = Array.from({ length: changed }, (_, index) => standing.get(sentAt + index));
    const before = sentAt === 0 ? -1 : standing.get(sentAt - 1);
    const from = changed > 0 ? anchors[0] : before === undefined ? undefined : before + 1;
    if (from !== undefined && anchors.every((at, index) => at === from + index)) {
      const blocks = (now.content.content ?? []).slice(mergedAt, mergedAt + added);
      taken.push({
        from,
        to: from + changed,
        blocks,
        sources: now.sources.slice(mergedAt, mergedAt + added),
      });
      base.push(...now.sources.slice(mergedAt, mergedAt + added));
    } else {
      base.push(...was.slice(sentAt, sentAt + changed));
    }
    sentAt += changed;
    mergedAt += added;
  }
  return { held: laidIn(editor, held, taken, now), base: base.join("") };
}

function laidIn(
  editor: Editor,
  held: HeldSources,
  taken: readonly Taken[],
  now: OpenedDocument,
): HeldSources {
  const { state } = editor;
  const offsets: number[] = [];
  state.doc.forEach((_node, offset) => {
    offsets.push(offset);
  });
  offsets.push(state.doc.content.size);
  const tr = state.tr.setMeta("addToHistory", false);
  const placed = new Map<PmNode, string>();
  for (const stretch of [...taken].reverse()) {
    const nodes = stretch.blocks.map((block) => state.schema.nodeFromJSON(block));
    nodes.forEach((node, index) => {
      placed.set(node, stretch.sources[index] ?? "");
    });
    tr.replaceWith(
      offsets[stretch.from] ?? 0,
      offsets[stretch.to] ?? state.doc.content.size,
      nodes,
    );
  }
  editor.view.dispatch(tr);
  const sources = new Map<PmNode, string>();
  editor.state.doc.forEach((node) => {
    const source = held.sources.get(node) ?? placed.get(node);
    if (source !== undefined) sources.set(node, source);
  });
  return { sources, lead: now.lead, ending: now.ending };
}
