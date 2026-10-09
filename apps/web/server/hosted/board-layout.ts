import { BOARD_ELEMENT_TYPE, DRAWING_ZONE, LUKE_MARK } from "@sidecar/hosted/board-vocabulary";
import type { BoardElement, DrawingElement } from "@sidecar/hosted/board-wire";
import { Schema } from "effect";

/**
 * board-layout.ts -- what is wrong with how a drawing of Luke's is laid out, in words the planning model can fix it from.
 *
 * The model cannot see the board, so it cannot do what Excalidraw's own
 * agent guides ask of a model that draws: look at the result and fix what
 * overlaps, what does not fit, and what an arrow runs through. This reads the
 * same mistakes off the coordinates instead. Text is never measured here, only
 * estimated from Excalidraw's hand-drawn font, so a finding is advice the
 * drawing is still drawn under, never a refusal.
 *
 * It finds two shapes or texts that overlap or stand closer than
 * `LAYOUT.MIN_GAP`; a label too long for its shape, which the Mac's
 * converter would make taller than the drawing says, into whatever is below;
 * a shape across a zone's edge or over its title; an arrow that runs through
 * a shape it does not join, or is too short for its label; and anything of
 * Luke's laid over what the developer drew, which the model reads in the
 * board's scene.
 */

const LAYOUT = {
  /** The least space between two shapes, as Excalidraw's agent guides ask. */
  MIN_GAP: 40,
  /** The most findings one answer carries, so a tangled drawing cannot flood the turn. */
  MAX_FINDINGS: 8,
  /** Excalifont's average glyph width and its line height, each as a share of the font size. */
  GLYPH_WIDTH: 0.55,
  LINE_HEIGHT: 1.25,
  /** The converter's defaults, as the Mac's whiteboard spells them. */
  WIDTH: 200,
  HEIGHT: 80,
  FONT_SIZE: 20,
  LABEL_PADDING: 5,
  ZONE_INSET: 16,
  ZONE_TITLE_SIZE: 16,
  /** The room an arrow's label needs beyond its own width on either side. */
  ARROW_LABEL_MARGIN: 20,
} as const;

/** The share of a shape's width and height its label can fill. */
const LABEL_AREA = {
  [BOARD_ELEMENT_TYPE.RECTANGLE]: 1,
  [BOARD_ELEMENT_TYPE.ELLIPSE]: Math.SQRT1_2,
  [BOARD_ELEMENT_TYPE.DIAMOND]: 0.5,
} as const;

/** The mark a scene element of Luke's carries in its `customData`. */
const isLukesMark = Schema.is(Schema.Struct({ drawnBy: Schema.Literal(LUKE_MARK.drawnBy) }));

/** The scene element types a drawing can be laid over; arrows and lines pass between things and are left out. */
const SOLID_SCENE_TYPES: ReadonlySet<string> = new Set([
  BOARD_ELEMENT_TYPE.RECTANGLE,
  BOARD_ELEMENT_TYPE.ELLIPSE,
  BOARD_ELEMENT_TYPE.DIAMOND,
  BOARD_ELEMENT_TYPE.TEXT,
  BOARD_ELEMENT_TYPE.FREEDRAW,
  BOARD_ELEMENT_TYPE.FRAME,
]);

/** What a placed box of Luke's is: a shape, a free text, a zone, or a zone's title. */
const PLACED_KIND = {
  SHAPE: "shape",
  TEXT: "text",
  ZONE: "zone",
  TITLE: "title",
} as const;

type PlacedKind = (typeof PLACED_KIND)[keyof typeof PLACED_KIND];

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Box extends Size {
  readonly x: number;
  readonly y: number;
}

/** A box of Luke's drawing, with how a finding names it. */
interface Placed {
  readonly id: string;
  readonly name: string;
  readonly box: Box;
  readonly kind: PlacedKind;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const FINDING = {
  overlap: (a: string, b: string) => `${a} and ${b} overlap; move one clear of the other.`,
  tooClose: (a: string, b: string, gap: number) =>
    `${a} and ${b} are ${gap}px apart; leave ${LAYOUT.MIN_GAP}px or more.`,
  labelTooLong: (name: string, need: Size) =>
    `The label of ${name} does not fit inside it, and the shape would grow into its ` +
    `neighbors; make it about ${need.width}x${need.height}, or shorten the label.`,
  zoneEdge: (name: string, zone: string) =>
    `${name} crosses the edge of ${zone}; put it wholly inside the zone or wholly outside.`,
  arrowThrough: (arrow: string, name: string) =>
    `Arrow "${arrow}" runs through ${name}; move the shapes so it runs clear.`,
  arrowLabel: (arrow: string) =>
    `Arrow "${arrow}" is too short for its label; shorten the label or move its ends apart.`,
  overDeveloper: (name: string, theirs: string) =>
    `${name} lies over the developer's "${theirs}"; move your drawing clear of what they drew.`,
  more: (count: number) => `${count} more layout problems like these.`,
} as const;

function roundUp(value: number): number {
  return Math.ceil(value / 10) * 10;
}

/** Words' estimated size in Excalifont at a size, one row per line they hold. */
function textSize(words: string, fontSize: number): Size {
  const rows = words.split("\n");
  const longest = Math.max(...rows.map((row) => row.length));
  return {
    width: longest * fontSize * LAYOUT.GLYPH_WIDTH,
    height: rows.length * fontSize * LAYOUT.LINE_HEIGHT,
  };
}

/** The space between two boxes along the axis that parts them most, negative where they overlap. */
function gapBetween(a: Box, b: Box): number {
  const across = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const down = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(across, down);
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Where the ray from a box's center toward a point leaves the box, as the Mac starts an arrow. */
function edgeToward(box: Box, toward: Point): Point {
  const from = center(box);
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy),
    1,
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/** Whether a segment passes through a box's inside (Liang-Barsky clipping). */
function crosses(start: Point, end: Point, box: Box): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let enter = 0;
  let leave = 1;
  const edges = [
    [-dx, start.x - box.x],
    [dx, box.x + box.width - start.x],
    [-dy, start.y - box.y],
    [dy, box.y + box.height - start.y],
  ] as const;
  for (const [step, room] of edges) {
    if (step === 0) {
      if (room <= 0) return false;
      continue;
    }
    const at = room / step;
    if (step < 0) enter = Math.max(enter, at);
    else leave = Math.min(leave, at);
  }
  return enter < leave;
}

/** Every shape, text, zone, and zone title of a drawing as the Mac would place it. */
function placedOf(drawing: readonly DrawingElement[]): Placed[] {
  return drawing.flatMap((element): Placed[] => {
    const named = { id: element.id, name: `"${element.id}"` };
    switch (element.type) {
      case BOARD_ELEMENT_TYPE.ARROW:
        return [];
      case BOARD_ELEMENT_TYPE.TEXT: {
        const size = textSize(element.text, element.fontSize ?? LAYOUT.FONT_SIZE);
        const box = { x: element.x, y: element.y, ...size };
        return [{ ...named, box, kind: PLACED_KIND.TEXT }];
      }
      case DRAWING_ZONE: {
        const box = { x: element.x, y: element.y, width: element.width, height: element.height };
        const zone = { ...named, name: `zone "${element.id}"`, box, kind: PLACED_KIND.ZONE };
        if (element.title === undefined) return [zone];
        const size = textSize(element.title, LAYOUT.ZONE_TITLE_SIZE);
        const title = {
          id: element.id,
          name: `the title of zone "${element.id}"`,
          box: { x: element.x + LAYOUT.ZONE_INSET, y: element.y + LAYOUT.ZONE_INSET, ...size },
          kind: PLACED_KIND.TITLE,
        };
        return [zone, title];
      }
      default: {
        const width = element.width ?? LAYOUT.WIDTH;
        const height = element.height ?? LAYOUT.HEIGHT;
        const box = { x: element.x, y: element.y, width, height };
        return [{ ...named, box, kind: PLACED_KIND.SHAPE }];
      }
    }
  });
}

/** The size a shape needs for its label to stay inside it, or nothing where it fits. */
function labelNeed(element: DrawingElement): Size | undefined {
  if (
    element.type === BOARD_ELEMENT_TYPE.TEXT ||
    element.type === BOARD_ELEMENT_TYPE.ARROW ||
    element.type === DRAWING_ZONE ||
    element.label === undefined
  )
    return undefined;
  const share = LABEL_AREA[element.type];
  const width = element.width ?? LAYOUT.WIDTH;
  const height = element.height ?? LAYOUT.HEIGHT;
  const padding = 2 * LAYOUT.LABEL_PADDING;
  const rowWidth = width * share - padding;
  const lineHeight = LAYOUT.FONT_SIZE * LAYOUT.LINE_HEIGHT;
  // Note that a row wider than the shape wraps, so each row of the label takes as many lines as it spans.
  const rows = element.label.split("\n").map((row) => textSize(row, LAYOUT.FONT_SIZE).width);
  const lines = rows.reduce((sum, row) => sum + Math.max(1, Math.ceil(row / rowWidth)), 0);
  if (lines * lineHeight + padding <= height * share) return undefined;
  return {
    width: roundUp(Math.max(width, (Math.max(...rows) + padding) / share)),
    height: roundUp(Math.max(height, (rows.length * lineHeight + padding) / share)),
  };
}

/** Whether a scene element is one the Mac made from a drawing of Luke's. */
function isLukes(element: BoardElement): boolean {
  return isLukesMark(element.customData);
}

/** What the developer drew that a drawing could be laid over: their solid elements, a shape's label aside. */
function developersOf(scene: readonly BoardElement[]): BoardElement[] {
  return scene.filter(
    (element) =>
      !isLukes(element) &&
      SOLID_SCENE_TYPES.has(element.type) &&
      !(element.type === BOARD_ELEMENT_TYPE.TEXT && element.containerId),
  );
}

function spacingFindings(placed: readonly Placed[]): string[] {
  const findings: string[] = [];
  const solid = placed.filter((each) => each.kind !== PLACED_KIND.ZONE);
  for (const [index, a] of solid.entries()) {
    for (const b of solid.slice(index + 1)) {
      if (a.id === b.id) continue;
      const gap = gapBetween(a.box, b.box);
      if (gap < 0) findings.push(FINDING.overlap(a.name, b.name));
      else if (gap < LAYOUT.MIN_GAP && a.kind === PLACED_KIND.SHAPE && b.kind === PLACED_KIND.SHAPE)
        findings.push(FINDING.tooClose(a.name, b.name, Math.round(gap)));
    }
  }
  for (const zone of placed.filter((each) => each.kind === PLACED_KIND.ZONE)) {
    for (const each of solid) {
      if (each.id === zone.id) continue;
      if (gapBetween(zone.box, each.box) < 0 && !contains(zone.box, each.box))
        findings.push(FINDING.zoneEdge(each.name, zone.name));
    }
  }
  return findings;
}

function arrowFindings(drawing: readonly DrawingElement[], placed: readonly Placed[]): string[] {
  const ends = placed.filter((each) => each.kind !== PLACED_KIND.TITLE);
  const boxes = new Map(ends.map((each) => [each.id, each.box]));
  const shapes = placed.filter((each) => each.kind === PLACED_KIND.SHAPE);
  return drawing.flatMap((element): string[] => {
    if (element.type !== BOARD_ELEMENT_TYPE.ARROW) return [];
    const from = boxes.get(element.from);
    const to = boxes.get(element.to);
    if (from === undefined || to === undefined || element.from === element.to) return [];
    const start = edgeToward(from, center(to));
    const end = edgeToward(to, center(from));
    const through = shapes
      .filter((each) => each.id !== element.from && each.id !== element.to)
      .filter((each) => crosses(start, end, each.box))
      .map((each) => FINDING.arrowThrough(element.id, each.name));
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const label =
      element.label === undefined
        ? 0
        : textSize(element.label, LAYOUT.FONT_SIZE).width + 2 * LAYOUT.ARROW_LABEL_MARGIN;
    return length < label ? [...through, FINDING.arrowLabel(element.id)] : through;
  });
}

function developerFindings(placed: readonly Placed[], scene: readonly BoardElement[]): string[] {
  const theirs = developersOf(scene);
  return placed.flatMap((each) => {
    const under = theirs.find((element) => gapBetween(each.box, element) < 0);
    return under === undefined ? [] : [FINDING.overDeveloper(each.name, under.id)];
  });
}

/**
 * What is wrong with how a drawing is laid out, beside the scene it will be
 * put on; empty where nothing is. A long list is cut at `LAYOUT.MAX_FINDINGS`
 * and says how many more there were.
 */
export function layoutFindings(
  drawing: readonly DrawingElement[],
  scene: readonly BoardElement[],
): string[] {
  const placed = placedOf(drawing);
  const labels = drawing.flatMap((element) => {
    const need = labelNeed(element);
    return need === undefined ? [] : [FINDING.labelTooLong(`"${element.id}"`, need)];
  });
  const findings = [
    ...developerFindings(placed, scene),
    ...spacingFindings(placed),
    ...labels,
    ...arrowFindings(drawing, placed),
  ];
  if (findings.length <= LAYOUT.MAX_FINDINGS) return findings;
  const kept = findings.slice(0, LAYOUT.MAX_FINDINGS - 1);
  return [...kept, FINDING.more(findings.length - kept.length)];
}
