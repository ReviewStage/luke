export const LINK_GLUE = {
  TAG: "app-glue",
  CLASS: "link-glued",
} as const;

const CLOSING_PUNCTUATION = /^[,.;:!?)\]}”’»…]+/u;

const OPENING_PUNCTUATION = new Set(["(", "[", "{", "“", "‘", "«"]);

function openingAtEnd(value: string): string | undefined {
  let from = value.length;
  while (from > 0 && OPENING_PUNCTUATION.has(value.charAt(from - 1))) from -= 1;
  return from === value.length ? undefined : value.slice(from);
}

interface GlueNode {
  readonly type: string;
  readonly value?: string;
}

export interface GlueTree<Node extends GlueNode> {
  readonly held: (node: Node) => boolean;
  readonly text: (value: string) => Node;
  readonly box: (inside: Node[]) => Node;
  readonly markWords?: (node: Node) => string | undefined;
}

function wholeMark<Node extends GlueNode>(
  node: Node | undefined,
  tree: GlueTree<Node>,
  punctuation: (words: string) => string | undefined,
): boolean {
  const words = node === undefined || node.type === "text" ? undefined : tree.markWords?.(node);
  return words !== undefined && words !== "" && punctuation(words) === words;
}

function closingAtStart(value: string): string | undefined {
  return CLOSING_PUNCTUATION.exec(value)?.[0];
}

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
