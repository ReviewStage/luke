import assert from "node:assert/strict";
import { BOARD_ELEMENT_TYPE, DRAWING_ZONE, LUKE_MARK } from "@sidecar/hosted/board-vocabulary";
import type { BoardElement, DrawingElement } from "@sidecar/hosted/board-wire";
import { test } from "vitest";
import { layoutFindings } from "../server/hosted/board-layout";

/**
 * What `draw_on_board` tells the planning model about a drawing's layout,
 * read off its coordinates since the model cannot see the board. Each case
 * is a mistake Excalidraw's agent guides name, laid out the way a model
 * makes it, and a finding is held to the ids a model would fix.
 */

function box(id: string, x: number, y: number, label = "Box"): DrawingElement {
  return { type: BOARD_ELEMENT_TYPE.RECTANGLE, id, x, y, label };
}

function arrow(id: string, from: string, to: string, label?: string): DrawingElement {
  return label === undefined
    ? { type: BOARD_ELEMENT_TYPE.ARROW, id, from, to }
    : { type: BOARD_ELEMENT_TYPE.ARROW, id, from, to, label };
}

/** A shape as the Mac's canvas stores one, the developer's unless marked as Luke's. */
function scened(id: string, x: number, y: number, mark?: typeof LUKE_MARK): BoardElement {
  const stored = { id, type: BOARD_ELEMENT_TYPE.RECTANGLE, x, y, width: 200, height: 80 };
  return mark === undefined ? stored : { ...stored, customData: mark };
}

/** The findings that name every one of the ids. */
function naming(findings: readonly string[], ...ids: readonly string[]): string[] {
  return findings.filter((finding) => ids.every((id) => finding.includes(`"${id}"`)));
}

test("a diagram on the guides' grid, grouped in a titled zone, has nothing wrong with it", () => {
  const drawing: DrawingElement[] = [
    { type: BOARD_ELEMENT_TYPE.TEXT, id: "title", x: 0, y: -110, text: "Inviting a teammate" },
    { type: DRAWING_ZONE, id: "service", x: 280, y: -60, width: 280, height: 380, title: "API" },
    box("member", 0, 0, "Member"),
    box("invites", 320, 0, "POST /invites"),
    box("joined", 320, 190, "Joins workspace"),
    {
      type: BOARD_ELEMENT_TYPE.DIAMOND,
      id: "valid",
      x: 620,
      y: 160,
      width: 240,
      height: 140,
      label: "Link still valid?",
    },
    arrow("sends", "member", "invites", "email"),
    arrow("checks", "invites", "valid"),
    arrow("accepts", "valid", "joined", "yes"),
  ];
  assert.deepEqual(layoutFindings(drawing, [scened("dev-note", 0, 400)]), []);
});

test("boxes that overlap, or stand closer than the guides' gap, are named", () => {
  const findings = layoutFindings([box("api", 0, 0), box("db", 150, 0), box("cache", 0, 100)], []);
  assert.equal(naming(findings, "api", "db").length, 1);
  assert.match(naming(findings, "api", "cache")[0] ?? "", /20px apart/);
  assert.equal(naming(findings, "db", "cache").length, 1);
});

test("a label too long for its shape names a size it fits, and a wider shape fits it", () => {
  const label = "Cancel every background subagent of the session";
  const narrow = layoutFindings([box("cancel", 0, 0, label)], []);
  const [finding] = naming(narrow, "cancel");
  const size = /about (\d+)x(\d+)/.exec(finding ?? "");
  assert.ok(size, "the finding names a size");
  const fitted: DrawingElement = {
    type: BOARD_ELEMENT_TYPE.RECTANGLE,
    id: "cancel",
    x: 0,
    y: 0,
    width: Number(size[1]),
    height: Number(size[2]),
    label,
  };
  assert.deepEqual(layoutFindings([fitted], []), []);
});

test("a shape across a zone's edge or over its title is named, and one inside or outside is not", () => {
  const zone: DrawingElement = {
    type: DRAWING_ZONE,
    id: "web",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    title: "Web deployment",
  };
  const findings = layoutFindings(
    [zone, box("inside", 40, 120), box("straddles", 300, 120), box("outside", 640, 0)],
    [],
  );
  assert.equal(naming(findings, "straddles", "web").length, 1);
  assert.deepEqual(naming(findings, "inside"), []);
  assert.deepEqual(naming(findings, "outside"), []);
  const covered = layoutFindings([zone, box("under-title", 20, 20)], []);
  assert.equal(naming(covered, "under-title", "web").length, 1);
});

test("an arrow through a shape it does not join, or too short for its label, is named", () => {
  const through = layoutFindings(
    [box("a", 0, 0), box("b", 280, 0), box("c", 560, 0), arrow("skip", "a", "c")],
    [],
  );
  assert.equal(naming(through, "skip", "b").length, 1);
  const short = layoutFindings(
    [box("a", 0, 0), box("b", 260, 0), arrow("call", "a", "b", "authorizes the session")],
    [],
  );
  assert.equal(naming(short, "call").length, 1);
});

test("a drawing over what the developer drew is named, and over Luke's own last drawing is not", () => {
  const scene = [scened("their-sketch", 0, 0), scened("lukes-old", 400, 0, LUKE_MARK)];
  const findings = layoutFindings([box("api", 50, 20), box("db", 400, 0)], scene);
  assert.equal(naming(findings, "api", "their-sketch").length, 1);
  assert.deepEqual(naming(findings, "lukes-old"), []);
});

test("a tangled drawing's findings are cut short and say how many more there were", () => {
  const pile = Array.from({ length: 6 }, (_, index) => box(`stack-${index}`, index * 10, 0));
  const findings = layoutFindings(pile, []);
  assert.equal(findings.length, 8);
  assert.match(findings.at(-1) ?? "", /^\d+ more layout problems/);
});
