import {
  BOARD_AUTHOR,
  BOARD_ELEMENT_TYPE,
  type Board,
  type BoardElement,
  LINE_END,
  type LineEnd,
  lineEnd,
} from "./board-wire.js";

/**
 * board-text.ts -- a board as the planning model reads it: one line per kind of element, each element by id with its words and where it stands.
 *
 * The model cannot see the canvas, so this is the whole of what it knows of
 * the board: it reads what the developer drew here on its next turn, and
 * names the same ids back to `draw_on_board`. A shape is its id, its type,
 * its label, and its box; text is its words and where it starts; an arrow
 * is the two ends it joins, each a shape's id or a free point; a line is its
 * ends; and freehand strokes, which carry nothing the model could name, are
 * only counted. A label is folded into what it labels rather than listed on
 * its own. Coordinates are rounded to whole pixels. The text is cut at
 * `BOARD_TEXT_MAX_CHARS`, saying how many elements were left out, so a
 * crowded board cannot take over the planning turn's context.
 */

export const BOARD_TEXT_MAX_CHARS = 8_000;

const SHAPES: ReadonlySet<string> = new Set([
  BOARD_ELEMENT_TYPE.RECTANGLE,
  BOARD_ELEMENT_TYPE.ELLIPSE,
  BOARD_ELEMENT_TYPE.DIAMOND,
  BOARD_ELEMENT_TYPE.FRAME,
]);

const AUTHOR_WORDS = {
  [BOARD_AUTHOR.LUKE]: "you",
  [BOARD_AUTHOR.DEVELOPER]: "the developer",
} as const;

function round(value: number): number {
  return Math.round(value);
}

/** Words as one quoted line, so a label with a newline stays on its element's line. */
function quoted(words: string): string {
  return JSON.stringify(words.replace(/\s+/g, " ").trim());
}

/** An arrow's end: the id of the shape it is bound to, or the free point it stops at. */
function endText(
  arrow: BoardElement,
  which: LineEnd,
  live: ReadonlyMap<string, BoardElement>,
): string {
  const binding = which === LINE_END.START ? arrow.startBinding : arrow.endBinding;
  if (binding && live.has(binding.elementId)) return binding.elementId;
  const point = lineEnd(arrow, which);
  return `(${round(point.x)},${round(point.y)})`;
}

/** One element's entry on its kind's line, or nothing for a label, which its container carries. */
function entryOf(
  element: BoardElement,
  labels: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, BoardElement>,
): string | undefined {
  const label = labels.get(element.id);
  const labelText = label === undefined ? "" : ` ${quoted(label)}`;
  if (SHAPES.has(element.type)) {
    return (
      `${element.id} ${element.type}${labelText} at ${round(element.x)},${round(element.y)} ` +
      `${round(element.width)}x${round(element.height)}`
    );
  }
  switch (element.type) {
    case BOARD_ELEMENT_TYPE.TEXT:
      if (element.containerId && live.has(element.containerId)) return undefined;
      return `${element.id} ${quoted(element.text ?? "")} at ${round(element.x)},${round(element.y)}`;
    case BOARD_ELEMENT_TYPE.ARROW:
      return `${element.id} ${endText(element, LINE_END.START, live)} -> ${endText(element, LINE_END.END, live)}${labelText}`;
    case BOARD_ELEMENT_TYPE.LINE:
      return `${element.id} ${endText(element, LINE_END.START, live)} -> ${endText(element, LINE_END.END, live)}`;
    default:
      return undefined;
  }
}

const LINE_ORDER = [
  { title: "shapes", has: (element: BoardElement) => SHAPES.has(element.type) },
  { title: "text", has: (element: BoardElement) => element.type === BOARD_ELEMENT_TYPE.TEXT },
  { title: "arrows", has: (element: BoardElement) => element.type === BOARD_ELEMENT_TYPE.ARROW },
  { title: "lines", has: (element: BoardElement) => element.type === BOARD_ELEMENT_TYPE.LINE },
] as const;

/** The board as the planning model reads it, headed by its revision and who wrote it. */
export function boardText(board: Board): string {
  const elements = board.elements.filter((element) => !element.isDeleted);
  const author = board.updatedBy ? `, last changed by ${AUTHOR_WORDS[board.updatedBy]}` : "";
  const heading = `[board] revision ${board.revision}${author}`;
  if (elements.length === 0) return `${heading}\nThe board is empty.`;
  const live = new Map(elements.map((element) => [element.id, element]));
  const labels = new Map(
    elements.flatMap((element) =>
      element.type === BOARD_ELEMENT_TYPE.TEXT && element.containerId
        ? [[element.containerId, element.text ?? ""] as const]
        : [],
    ),
  );
  const lines = [heading];
  let used = heading.length;
  let omitted = 0;
  for (const { title, has } of LINE_ORDER) {
    const entries = elements.filter(has).flatMap((element) => entryOf(element, labels, live) ?? []);
    const kept: string[] = [];
    for (const entry of entries) {
      if (used + entry.length + 3 > BOARD_TEXT_MAX_CHARS) omitted += 1;
      else {
        kept.push(entry);
        used += entry.length + 3;
      }
    }
    if (kept.length > 0) lines.push(`${title}: ${kept.join(" | ")}`);
  }
  const strokes = elements.filter((element) => element.type === BOARD_ELEMENT_TYPE.FREEDRAW).length;
  if (strokes > 0) lines.push(`other: ${strokes} freehand ${strokes === 1 ? "stroke" : "strokes"}`);
  if (omitted > 0) lines.push(`… ${omitted} more not shown`);
  return lines.join("\n");
}
