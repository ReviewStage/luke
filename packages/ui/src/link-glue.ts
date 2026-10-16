/**
 * link-glue.ts -- a chip held together with the punctuation written against it, in one box no line breaks inside: the run both drawings of words hold their chips in.
 *
 * A chip is one box the line cannot break inside, so the browser breaks
 * beside it instead, and a comma or full stop written straight after it
 * starts the next line alone (", after"), or an opening bracket ends the
 * line before it. Both drawings of words, the plan's (`markdown-message.tsx`)
 * and a transcript's (`planning/transcript-blocks.tsx`), hold each chip with
 * the opening punctuation that ends the text before it and the closing
 * punctuation that starts the text after it, in a box of the
 * `LINK_GLUE.CLASS` (`markdown.css`). Note that a word joiner would not do:
 * Chromium still breaks after an inline box beside one. Only a link drawn
 * as a chip is held, because a plain link's words must still wrap.
 */

/** The box a chip and its punctuation stand in: the element a transcript writes it as, and the class it is drawn with. */
export const LINK_GLUE = {
  TAG: "luke-glue",
  CLASS: "link-glued",
} as const;

/** Punctuation that closes against the word before it, at the start of the text after a chip. */
const CLOSING_PUNCTUATION = /^[,.;:!?)\]}”’»…]+/u;

/** Punctuation that opens against the word after it, at the end of the text before a chip. */
const OPENING_PUNCTUATION = new Set(["(", "[", "{", "“", "‘", "«"]);

/**
 * The run of opening punctuation that ends some text, or nothing. Note that
 * it is read back from the end rather than by a pattern anchored there,
 * because such a pattern retries from every opening bracket in the text and
 * runs in polynomial time on words full of them.
 */
function openingAtEnd(value: string): string | undefined {
  let from = value.length;
  while (from > 0 && OPENING_PUNCTUATION.has(value.charAt(from - 1))) from -= 1;
  return from === value.length ? undefined : value.slice(from);
}

/** A node of either tree, as much of one as its words are told by. */
interface GlueNode {
  readonly type: string;
  readonly value?: string;
}

/** How a tree's nodes are told and made, for {@link gluedRun}. */
export interface GlueTree<Node extends GlueNode> {
  /** Whether a node is a link drawn as a chip. */
  readonly held: (node: Node) => boolean;
  /** A text node of these words. */
  readonly text: (value: string) => Node;
  /** The box a chip and its punctuation stand in. */
  readonly box: (inside: Node[]) => Node;
  /** The words of a node held whole beside a chip where they are all its punctuation, a change mark over a comma say; nothing for any other. */
  readonly markWords?: (node: Node) => string | undefined;
}

/** Whether a node beside a chip is a mark whose words are all punctuation of the kind given, so it is held whole. */
function wholeMark<Node extends GlueNode>(
  node: Node | undefined,
  tree: GlueTree<Node>,
  punctuation: (words: string) => string | undefined,
): boolean {
  const words = node === undefined || node.type === "text" ? undefined : tree.markWords?.(node);
  return words !== undefined && words !== "" && punctuation(words) === words;
}

/** The run of closing punctuation that starts some text, or nothing. */
function closingAtStart(value: string): string | undefined {
  return CLOSING_PUNCTUATION.exec(value)?.[0];
}

/**
 * A run of sibling nodes with each chip held in a box together with the
 * punctuation written against it: split off the text either side as text
 * nodes of its own, or a change mark over nothing but that punctuation held
 * whole; every other node as it was.
 */
export function gluedRun<Node extends GlueNode>(
  nodes: readonly Node[],
  tree: GlueTree<Node>,
): Node[] {
  const run: Node[] = [];
  for (let at = 0; at < nodes.length; at += 1) {
    const node = nodes[at];
    if (node === undefined) continue;
    if (!tree.held(node)) {
      run.push(node);
      continue;
    }
    const inside: Node[] = [node];
    const before = run.at(-1);
    const opening = before?.type === "text" ? openingAtEnd(before.value ?? "") : undefined;
    if (before !== undefined && opening !== undefined) {
      run.pop();
      const rest = (before.value ?? "").slice(0, -opening.length);
      if (rest !== "") run.push(tree.text(rest));
      inside.unshift(tree.text(opening));
    } else if (before !== undefined && wholeMark(before, tree, openingAtEnd)) {
      run.pop();
      inside.unshift(before);
    }
    run.push(tree.box(inside));
    const after = nodes[at + 1];
    if (after !== undefined && wholeMark(after, tree, closingAtStart)) {
      inside.push(after);
      at += 1;
      continue;
    }
    const closing = after?.type === "text" ? closingAtStart(after.value ?? "") : undefined;
    if (after === undefined || closing === undefined) continue;
    inside.push(tree.text(closing));
    at += 1;
    const rest = (after.value ?? "").slice(closing.length);
    if (rest !== "") run.push(tree.text(rest));
  }
  return run;
}
