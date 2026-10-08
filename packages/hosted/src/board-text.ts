import { isLukes, StandingBoard } from "./board-drawing.js";
import { BOARD_ELEMENT_TYPE } from "./board-vocabulary.js";
import type { Board, BoardElement } from "./board-wire.js";

/**
 * board-text.ts -- a board as the planning model reads it: one line per kind of element, each element by id with its words and where it stands.
 *
 * The model cannot see the canvas, so this is the whole of what it knows of
 * the board: what the developer drew is here on its next turn, beside what
 * it drew itself, each element of its own marked `(yours)`. A shape is its
 * id, its type, its label, and its box; text
 * is its words and where it starts; an arrow is the two ends it joins, each
 * a shape's id or a free point; a line is its ends; and freehand strokes,
 * which carry nothing the model could name, are only counted. A label is
 * folded into what it labels rather than listed on its own. Coordinates are
 * rounded to whole pixels. The text is cut at `BOARD_TEXT_MAX_CHARS`, saying
 * how many elements were left out, so a crowded board cannot take over the
 * planning turn's context. A drawing of the model's that the developer's Mac
 * has not put on the board yet is said to be on its way, with the ids it puts
 * on and takes off, since the scene does not show them yet and the model's
 * next drawing may name them.
 */

export const BOARD_TEXT_MAX_CHARS = 8_000;

const SHAPES: ReadonlySet<string> = new Set([
  BOARD_ELEMENT_TYPE.RECTANGLE,
  BOARD_ELEMENT_TYPE.ELLIPSE,
  BOARD_ELEMENT_TYPE.DIAMOND,
  BOARD_ELEMENT_TYPE.FRAME,
]);

const HEADING = "[board]";
const PENDING_LINE = "Your latest drawing is not on the board yet; the developer's Mac draws it.";
const YOURS = " (yours)";

function round(value: number): number {
  return Math.round(value);
}

/** Words as one quoted line, so a label with a newline stays on its element's line. */
function quoted(words: string): string {
  return JSON.stringify(words.replace(/\s+/g, " ").trim());
}

/** An arrow's or line's end: the id of the shape it is bound to, or the point it stops at. */
function endText(
  element: BoardElement,
  binding: { readonly elementId: string } | null | undefined,
  point: readonly number[] | undefined,
  live: ReadonlyMap<string, BoardElement>,
): string {
  if (binding && live.has(binding.elementId)) return binding.elementId;
  return `(${round(element.x + (point?.[0] ?? 0))},${round(element.y + (point?.[1] ?? 0))})`;
}

function runText(element: BoardElement, live: ReadonlyMap<string, BoardElement>): string {
  const points = element.points ?? [];
  const start = endText(element, element.startBinding, points[0], live);
  const end = endText(element, element.endBinding, points[points.length - 1], live);
  return `${start} -> ${end}`;
}

/** One element's entry on its kind's line, or nothing for a label, which its container carries. */
function entryOf(
  element: BoardElement,
  labels: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, BoardElement>,
): string | undefined {
  const entry = bareEntryOf(element, labels, live);
  return entry !== undefined && isLukes(element) ? `${entry}${YOURS}` : entry;
}

/** An element's entry before it is marked as the model's own. */
function bareEntryOf(
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
      return `${element.id} ${runText(element, live)}${labelText}`;
    case BOARD_ELEMENT_TYPE.LINE:
      return `${element.id} ${runText(element, live)}`;
    default:
      return undefined;
  }
}

/** What the drawings on their way do to the board, for the model to name in its next drawing. */
function pendingLines(board: Board): readonly string[] {
  if (board.drawings.length === 0) return [];
  const standing = StandingBoard.of(board);
  return [
    PENDING_LINE,
    ...(standing.arriving.length > 0 ? [`on its way: ${standing.arriving.join(", ")}`] : []),
    ...(standing.leaving.length > 0 ? [`coming off: ${standing.leaving.join(", ")}`] : []),
  ];
}

const LINE_ORDER = [
  { title: "shapes", has: (element: BoardElement) => SHAPES.has(element.type) },
  { title: "text", has: (element: BoardElement) => element.type === BOARD_ELEMENT_TYPE.TEXT },
  { title: "arrows", has: (element: BoardElement) => element.type === BOARD_ELEMENT_TYPE.ARROW },
  { title: "lines", has: (element: BoardElement) => element.type === BOARD_ELEMENT_TYPE.LINE },
] as const;

/** The board as the planning model reads it. */
export function boardText(board: Board): string {
  const { elements } = board;
  const lines = [HEADING, ...pendingLines(board)];
  if (elements.length === 0) return [...lines, "The board is empty."].join("\n");
  const live = new Map(elements.map((element) => [element.id, element]));
  const labels = new Map(
    elements.flatMap((element) =>
      element.type === BOARD_ELEMENT_TYPE.TEXT && element.containerId
        ? [[element.containerId, element.text ?? ""] as const]
        : [],
    ),
  );
  let used = lines.join("\n").length;
  let omitted = 0;
  for (const { title, has } of LINE_ORDER) {
    const kept: string[] = [];
    for (const entry of elements
      .filter(has)
      .flatMap((element) => entryOf(element, labels, live) ?? [])) {
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
