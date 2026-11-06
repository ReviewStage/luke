import { visibleViewport } from "@repo/ui/visible-viewport";
import { useLayoutEffect } from "react";
import { scrollerOf } from "./scroll-within.js";

const VIEWPORT_TOP = "--ui-viewport-top";
const STAGE_HEIGHT = "--ui-stage-height";
const KEYBOARD_INSET = "--ui-keyboard-inset";

const UNZOOMED_TOLERANCE = 0.01;

const CARET_MARGIN = 24;

function unzoomed(viewport: VisualViewport): boolean {
  return Math.abs(viewport.scale - 1) <= UNZOOMED_TOLERANCE;
}

function caretBox(field: HTMLElement): DOMRect {
  const selection = window.getSelection();
  const range =
    field.isContentEditable && selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0)
      : undefined;
  if (range === undefined || !field.contains(range.startContainer)) {
    return field.getBoundingClientRect();
  }
  const measured: Partial<Pick<Range, "getBoundingClientRect">> | undefined = range;
  const box = measured?.getBoundingClientRect?.();
  return box === undefined || (box.top === 0 && box.bottom === 0)
    ? field.getBoundingClientRect()
    : box;
}

const TYPED_FIELD =
  'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"], [type="radio"], [type="range"])';

function typedField(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches(TYPED_FIELD));
}

function caretAboveKeyboard(bottom: number): void {
  const field = document.activeElement;
  if (!typedField(field)) return;
  const column = scrollerOf(field);
  if (column === undefined) return;
  const below =
    caretBox(field).bottom + CARET_MARGIN - Math.min(bottom, column.getBoundingClientRect().bottom);
  if (below > 0) column.scrollTop += below;
}

export function useVisualViewport(): void {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null || viewport === undefined) return undefined;
    const root = document.documentElement.style;
    let top = 0;
    let covered = 0;
    let going = false;
    const write = () => {
      let layout: number;
      let bottom: number;
      if (unzoomed(viewport)) {
        const seen = visibleViewport();
        top = seen.top;
        layout = window.innerHeight;
        bottom = seen.bottom;
      } else {
        layout = document.documentElement.clientHeight;
        bottom = Math.min(layout, top + Math.round(viewport.height * viewport.scale));
      }
      if (going && bottom - top >= layout) going = false;
      const stageTop = going ? 0 : top;
      const stageBottom = going ? layout : bottom;
      const taken = layout - (stageBottom - stageTop);
      root.setProperty(VIEWPORT_TOP, `${stageTop}px`);
      root.setProperty(STAGE_HEIGHT, `${stageBottom - stageTop}px`);
      root.setProperty(KEYBOARD_INSET, `${Math.max(0, layout - stageBottom)}px`);
      if (taken > covered) caretAboveKeyboard(stageBottom);
      covered = taken;
    };
    const left = (event: FocusEvent) => {
      if (covered <= 0 || typedField(event.relatedTarget)) return;
      going = true;
      write();
    };
    const entered = (event: FocusEvent) => {
      if (!typedField(event.target)) return;
      going = false;
      write();
    };
    write();
    viewport.addEventListener("resize", write);
    viewport.addEventListener("scroll", write);
    document.addEventListener("focusout", left);
    document.addEventListener("focusin", entered);
    return () => {
      viewport.removeEventListener("resize", write);
      viewport.removeEventListener("scroll", write);
      document.removeEventListener("focusout", left);
      document.removeEventListener("focusin", entered);
      root.removeProperty(VIEWPORT_TOP);
      root.removeProperty(STAGE_HEIGHT);
      root.removeProperty(KEYBOARD_INSET);
    };
  }, []);
}
