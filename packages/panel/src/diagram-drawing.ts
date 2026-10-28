import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { drawnDark, onDrawnThemeChange } from "@luke/ui/appearance";
import {
  DIAGRAM_APPEARANCE,
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
  type DiagramModule,
} from "@luke/ui/diagram-contract";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { useSideBundles } from "./bundle-loader.js";

/**
 * diagram-drawing.ts -- a Mermaid code drawn as its picture in the window's appearance: the diagram bundle loaded the first time one is drawn, each picture kept by its appearance and code, and what the picture is named for.
 *
 * A plan's fence (`plan-diagram.tsx`) and a Mermaid file opened in the file
 * viewer (`tasks/attachment-viewer.tsx`) draw through this one cache, so a
 * diagram shown in both is drawn once.
 */

/** How many pictures the window keeps in each appearance, the oldest let go first; enough for every diagram in a plan, and the drafts the editor's preview drew. */
const HELD_PICTURES = 64;

/** What a diagram's picture is called where its code names nothing: the kind of thing it is. */
const DIAGRAM_ALT = "Diagram";

/** How much of a title or first line an alt text keeps, so a long one does not read out whole. */
const ALT_LIMIT = 80;

/** The front matter a Mermaid code may open with: its settings between two `---` fences, which name nothing of the diagram but a `title`. */
const FRONT_MATTER = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/u;

/** The title a front matter names (`title: Order flow`), a top-level key. */
const FRONT_TITLE = /^title:[ \t]*(.+?)[ \t]*$/mu;

/** A title a diagram's own lines name, as a line of its own or after the diagram's kind (`title Votes`, `pie title Votes`). */
const BODY_TITLE = /^[ \t]*(?:\w+[ \t]+)?title[ \t]+(.+?)[ \t]*$/mu;

/** A line of Mermaid code that names nothing of the diagram: blank or a comment. */
const SILENT_LINE = /^\s*(?:%%.*)?\s*$/u;

/** What a drawer of no code reads in the bundle's place, so a surface that may draw a diagram imports Mermaid only once it does. */
const NO_BUNDLE = Atom.make(AsyncResult.initial<DiagramModule, Error>());

/** Each drawing the window holds, by appearance and then by code, oldest first. */
const drawn = new Map<DiagramAppearance, Map<string, DiagramDrawing>>();

/** Each draw still running, by appearance and then by code, which a second figure of the same code joins. */
const drawing = new Map<DiagramAppearance, Map<string, Promise<DiagramDrawing>>>();

/** The drawing held for a code in an appearance; nothing before it has been drawn. */
export function heldDrawing(
  appearance: DiagramAppearance,
  code: string,
): DiagramDrawing | undefined {
  return drawn.get(appearance)?.get(code);
}

/** A drawing kept, as the newest, the oldest past the bound let go. */
function keep(appearance: DiagramAppearance, code: string, answer: DiagramDrawing): void {
  const held = drawn.get(appearance) ?? new Map<string, DiagramDrawing>();
  held.delete(code);
  held.set(code, answer);
  const oldest = held.keys().next();
  if (held.size > HELD_PICTURES && oldest.done !== true) held.delete(oldest.value);
  drawn.set(appearance, held);
}

/** A code drawn in an appearance, joining the draw already running for it; a draw that fails is a refusal. */
function drawnBy(
  module: DiagramModule,
  appearance: DiagramAppearance,
  code: string,
): Promise<DiagramDrawing> {
  const running = drawing.get(appearance)?.get(code);
  if (running !== undefined) return running;
  const pending = drawing.get(appearance) ?? new Map<string, Promise<DiagramDrawing>>();
  drawing.set(appearance, pending);
  const answer = module
    .draw(code, appearance)
    .catch((): DiagramDrawing => ({ kind: DIAGRAM_DRAWING.REFUSED }))
    .then((settled) => {
      keep(appearance, code, settled);
      pending.delete(code);
      return settled;
    });
  pending.set(code, answer);
  return answer;
}

/** The window's appearance now. */
function appearanceNow(): DiagramAppearance {
  return drawnDark() ? DIAGRAM_APPEARANCE.DARK : DIAGRAM_APPEARANCE.LIGHT;
}

/** Calls back each time the window's appearance flips; answers what stops it. */
function onAppearance(changed: () => void): () => void {
  return onDrawnThemeChange(changed);
}

/** The window's appearance, kept as it flips. */
export function useAppearance(): DiagramAppearance {
  return useSyncExternalStore(onAppearance, appearanceNow, appearanceNow);
}

/**
 * A code's drawing in the window's appearance: the one held, or nothing
 * while the bundle loads and the draw runs, which then lands. A bundle that
 * could not load refuses every code, so each fence stands as its code, with
 * the `retry` that imports the bundle again; a fence the bundle itself
 * refused has none, since drawing it again would refuse it again. No code,
 * as where a viewer shows a file that is no diagram, draws nothing and
 * imports no bundle.
 */
export function useDrawing(
  code: string | undefined,
  appearance: DiagramAppearance,
): { readonly drawing: DiagramDrawing | undefined; readonly retry: (() => void) | undefined } {
  const { diagram } = useSideBundles();
  const bundleRead = code === undefined ? NO_BUNDLE : diagram;
  const bundle = useAtomValue(bundleRead);
  const retryBundle = useAtomRefresh(bundleRead);
  const held = code === undefined ? undefined : heldDrawing(appearance, code);
  const [, landed] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (code === undefined || held !== undefined || !AsyncResult.isSuccess(bundle))
      return undefined;
    let standing = true;
    void drawnBy(bundle.value, appearance, code).then(() => {
      if (standing) landed();
    });
    return () => {
      standing = false;
    };
  }, [held, bundle, appearance, code]);
  if (code === undefined) return { drawing: undefined, retry: undefined };
  if (held !== undefined) return { drawing: held, retry: undefined };
  return AsyncResult.isFailure(bundle)
    ? { drawing: { kind: DIAGRAM_DRAWING.REFUSED }, retry: retryBundle }
    : { drawing: undefined, retry: undefined };
}

/** The words kept of a title or first line, cut at the limit with an ellipsis. */
function altWords(line: string): string {
  const words = line.replace(/^["']|["']$/gu, "").trim();
  return words.length > ALT_LIMIT ? `${words.slice(0, ALT_LIMIT).trimEnd()}…` : words;
}

/** What a diagram's picture says it is, and what its press is named for after "Enlarge": its title, or its first line, after "Diagram". */
export function diagramAlt(code: string): string {
  const front = FRONT_MATTER.exec(code);
  const body = front === null ? code : code.slice(front[0].length);
  const title = FRONT_TITLE.exec(front?.[1] ?? "")?.[1] ?? BODY_TITLE.exec(body)?.[1];
  const first = body.split("\n").find((line) => !SILENT_LINE.test(line));
  const words = altWords(title ?? first ?? "");
  return words === "" ? DIAGRAM_ALT : `${DIAGRAM_ALT}: ${words}`;
}
