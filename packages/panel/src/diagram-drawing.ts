import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { drawnDark, onDrawnThemeChange } from "@repo/ui/appearance";
import {
  DIAGRAM_APPEARANCE,
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
  type DiagramModule,
} from "@repo/ui/diagram-contract";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { useSideBundles } from "./bundle-loader.js";

const HELD_PICTURES = 64;

const DIAGRAM_ALT = "Diagram";

const ALT_LIMIT = 80;

const FRONT_MATTER = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/u;

const FRONT_TITLE = /^title:[ \t]*(.+?)[ \t]*$/mu;

const BODY_TITLE = /^[ \t]*(?:\w+[ \t]+)?title[ \t]+(.+?)[ \t]*$/mu;

const SILENT_LINE = /^\s*(?:%%.*)?\s*$/u;

const NO_BUNDLE = Atom.make(AsyncResult.initial<DiagramModule, Error>());

const drawn = new Map<DiagramAppearance, Map<string, DiagramDrawing>>();

const drawing = new Map<DiagramAppearance, Map<string, Promise<DiagramDrawing>>>();

export function heldDrawing(
  appearance: DiagramAppearance,
  code: string,
): DiagramDrawing | undefined {
  return drawn.get(appearance)?.get(code);
}

function keep(appearance: DiagramAppearance, code: string, answer: DiagramDrawing): void {
  const held = drawn.get(appearance) ?? new Map<string, DiagramDrawing>();
  held.delete(code);
  held.set(code, answer);
  const oldest = held.keys().next();
  if (held.size > HELD_PICTURES && oldest.done !== true) held.delete(oldest.value);
  drawn.set(appearance, held);
}

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

function appearanceNow(): DiagramAppearance {
  return drawnDark() ? DIAGRAM_APPEARANCE.DARK : DIAGRAM_APPEARANCE.LIGHT;
}

function onAppearance(changed: () => void): () => void {
  return onDrawnThemeChange(changed);
}

export function useAppearance(): DiagramAppearance {
  return useSyncExternalStore(onAppearance, appearanceNow, appearanceNow);
}

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

function altWords(line: string): string {
  const words = line.replace(/^["']|["']$/gu, "").trim();
  return words.length > ALT_LIMIT ? `${words.slice(0, ALT_LIMIT).trimEnd()}…` : words;
}

export function diagramAlt(code: string): string {
  const front = FRONT_MATTER.exec(code);
  const body = front === null ? code : code.slice(front[0].length);
  const title = FRONT_TITLE.exec(front?.[1] ?? "")?.[1] ?? BODY_TITLE.exec(body)?.[1];
  const first = body.split("\n").find((line) => !SILENT_LINE.test(line));
  const words = altWords(title ?? first ?? "");
  return words === "" ? DIAGRAM_ALT : `${DIAGRAM_ALT}: ${words}`;
}
