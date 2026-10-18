import { type AnyExtension, type Editor, type JSONContent, Node } from "@tiptap/core";
import { BulletList, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import type { Node as PmNode } from "@tiptap/pm/model";
import { diffArrays } from "diff";
import { withMentions } from "./mention-node";

/**
 * document-source.ts -- a plan's whole Markdown document as the editor's top-level blocks, each keeping its exact source, and back.
 *
 * TipTap re-prints Markdown in its own style (`*` bullets as `-`, a soft wrap
 * as a hard break, `_em_` as `*em*`). Over a whole plan, one typed word
 * re-printed everywhere would be a change on every line: a false conflict
 * with Luke in every section, every section said to be edited by the
 * developer, and a noisy history. So the document is split by the same
 * `marked` lexer TipTap reads with, whose top-level tokens' sources join back
 * into the document exactly; each top-level token is parsed on its own into
 * one block, and that block keeps its source, the space after it included. As
 * the words are handed over, a block that is still the very node it opened as
 * (ProseMirror keeps an untouched node's identity across edits) is written
 * as its source, and only a block the developer changed or added is
 * re-printed. A block the editor cannot draw faithfully (block HTML, a link
 * definition, a paragraph holding inline HTML or a footnote) opens as a
 * locked raw block and is written back byte for byte.
 *
 * A save answers with the document as merged with what Luke wrote since its
 * base. Luke's part of it, the blocks that differ between what was sent and
 * what came back, is laid into the open editor in place of only the blocks
 * it changed, where the developer has not changed them since the send, so
 * the caret's block stays and the selection maps through; it is no step of
 * the developer's undo.
 */

/** A paragraph's footnote reference or definition, which TipTap's Markdown would escape. */
const FOOTNOTE = /\[\^[^\]\s]+\]/u;

/** What separates a re-printed block from the next. */
const BLOCK_GAP = "\n\n";

/** The blocks a bullet list opens as, a run of plain items or of task items (`tokenSources`). */
const LIST_BLOCKS = new Set([BulletList.name, TaskList.name]);

/** The locked block a source the editor cannot draw faithfully opens as. */
export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: "" } }),
  parseHTML: () => [{ tag: "pre[data-raw-block]" }],
  renderHTML: ({ node }) => [
    "pre",
    { "data-raw-block": "", class: "plan-raw-block", contenteditable: "false" },
    node.attrs.source,
  ],
  renderMarkdown: (node: JSONContent) => String(node.attrs?.source ?? "").trimEnd(),
});

/** One top-level token of the lexer TipTap's Markdown reads with. */
type LexedToken = ReturnType<MarkdownManager["instance"]["lexer"]>[number];

/**
 * A token's source as the blocks it opens as. A bullet list mixing task
 * items with plain ones, which Markdown reads as one list and TipTap as a
 * list of each kind, is cut into its runs of one kind, each its own block
 * keeping its own source, so it opens editable rather than raw; the runs'
 * sources join back into the list's exactly.
 */
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

/** Whether a token's source would not survive TipTap's Markdown, so it stays raw. */
function keptRaw(token: LexedToken): boolean {
  if (token.type === "html" || token.type === "def") return true;
  if (token.type !== "paragraph") return false;
  const inline = "tokens" in token ? (token.tokens ?? []) : [];
  return FOOTNOTE.test(token.raw) || inline.some((child) => child.type === "html");
}

/** A document as opened: the editor's content, each top-level block's source, and what stands before the first and after the last. */
export interface OpenedDocument {
  readonly content: JSONContent;
  readonly sources: readonly string[];
  readonly lead: string;
  readonly ending: string;
}

/** What the editor holds of a document's sources: each block still as it opened, by identity, and the document's two ends. */
export interface HeldSources {
  readonly sources: ReadonlyMap<PmNode, string>;
  readonly lead: string;
  readonly ending: string;
}

/** The Markdown manager over the editor's own extensions, so a block is read and written as the editor does. */
export function documentManager(extensions: AnyExtension[]): MarkdownManager {
  return new MarkdownManager({ extensions });
}

/** A whole document opened as top-level blocks, each with its exact source. */
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
      // Note that a source read as anything but one block stays raw, so every block has exactly one source.
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

/** Each top-level node of the freshly built document, by identity, with the source it opened from. */
export function sourcesOf(doc: PmNode, opened: OpenedDocument): HeldSources {
  const map = new Map<PmNode, string>();
  doc.forEach((node, _offset, index) => {
    const source = opened.sources[index];
    if (source !== undefined) map.set(node, source);
  });
  return { sources: map, lead: opened.lead, ending: opened.ending };
}

/** The trailing whitespace of a source. */
function trailing(source: string): string {
  return /\s*$/u.exec(source)?.[0] ?? "";
}

/** One block as it would be written now: its source while it is the node it opened as, re-printed otherwise. */
function blockMarkdown(manager: MarkdownManager, node: PmNode, held: HeldSources): string {
  return (
    held.sources.get(node) ??
    manager.serialize({ type: "doc", content: [node.toJSON()] }).trimEnd() + BLOCK_GAP
  );
}

/**
 * The document as the editor holds it now: each block that is still the node
 * it opened as written as its source, each other block re-printed, the
 * document's own ending kept.
 */
export function documentMarkdown(manager: MarkdownManager, doc: PmNode, held: HeldSources): string {
  let out = held.lead;
  doc.forEach((node, _offset, index) => {
    const block = blockMarkdown(manager, node, held);
    // Note that a new block that writes nothing, an empty paragraph or a picture still being kept, writes no blank line either.
    if (held.sources.get(node) === undefined && block.trim() === "") return;
    if (index === doc.childCount - 1) {
      out += block.trimEnd() + held.ending;
      return;
    }
    // Note that a run of a list goes on into the next run with no blank line
    // laid between them, so a tight list stays tight; a kept run keeps its own,
    // and one kept from the text's end gains the line break it lacks.
    if (LIST_BLOCKS.has(node.type.name) && LIST_BLOCKS.has(doc.child(index + 1).type.name)) {
      out += held.sources.has(node) && block.endsWith("\n") ? block : `${block.trimEnd()}\n`;
      return;
    }
    // Note that the text's last block kept its source without the blank line after it, which a block laid in after it needs.
    out += /\n[^\S\n]*\n$/u.test(block) ? block : block.trimEnd() + BLOCK_GAP;
  });
  return out;
}

/** A merged answer as taken: what the editor holds of the sources now, and the base the next save is a change from. */
export interface TakenDocument {
  readonly held: HeldSources;
  readonly base: string;
}

/** One stretch of the editor's top-level blocks to put Luke's blocks in place of. */
interface Taken {
  readonly from: number;
  readonly to: number;
  readonly blocks: readonly JSONContent[];
  readonly sources: readonly string[];
}

/**
 * Luke's part of a merged answer laid into the open editor: the blocks that
 * differ between what was `sent` and what was `merged`, each put in place of
 * the blocks it changed where they still stand as they were sent, so a block
 * the developer changed since stays theirs until the next save merges it.
 * Answers what the editor holds of the sources afterwards, and the base the
 * next save is a change from: the merged text, but for a change it left to
 * the next save, which keeps what was sent there, so the service still sees
 * the developer's words and Luke's meet there.
 */
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
  // Where each block that was sent stands in the editor now, if the developer has not changed it since.
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
    // Note that a change over blocks the developer has changed since is left to the next save to merge.
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

/** The stretches put in place, last first so earlier positions stand, outside the developer's undo. */
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
