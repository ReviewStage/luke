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

/**
 * A run of sibling nodes with each one `held` (a link drawn as a chip) in a
 * `box` together with the punctuation written against it, split off the text
 * either side as text nodes of its own (`text`); every other node as it was.
 */
export function gluedRun<Node extends GlueNode>(
  nodes: readonly Node[],
  held: (node: Node) => boolean,
  text: (value: string) => Node,
  box: (inside: Node[]) => Node,
): Node[] {
  const run: Node[] = [];
  for (let at = 0; at < nodes.length; at += 1) {
    const node = nodes[at];
    if (node === undefined) continue;
    if (!held(node)) {
      run.push(node);
      continue;
    }
    const inside: Node[] = [node];
    const before = run.at(-1);
    const opening = before?.type === "text" ? openingAtEnd(before.value ?? "") : undefined;
    if (before !== undefined && opening !== undefined) {
      run.pop();
      const rest = (before.value ?? "").slice(0, -opening.length);
      if (rest !== "") run.push(text(rest));
      inside.unshift(text(opening));
    }
    const after = nodes[at + 1];
    const closing =
      after?.type === "text" ? CLOSING_PUNCTUATION.exec(after.value ?? "")?.[0] : undefined;
    run.push(box(inside));
    if (after === undefined || closing === undefined) continue;
    inside.push(text(closing));
    at += 1;
    const rest = (after.value ?? "").slice(closing.length);
    if (rest !== "") run.push(text(rest));
  }
  return run;
}
