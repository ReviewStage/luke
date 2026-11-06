import { ENTER_KEY_HINT, type EnterKeyHint, TEXT_AREA_SUBMIT, type TextAreaSubmit } from "@repo/ui";

const COARSE_POINTER = "(pointer: coarse)";

interface EnterPress {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

function coarsePointer(): boolean {
  return window.matchMedia(COARSE_POINTER).matches;
}

export function enterSends(press: EnterPress): boolean {
  if (press.key !== "Enter" || press.shiftKey) return false;
  return press.metaKey || press.ctrlKey || !coarsePointer();
}

export function modEnterSends(press: Pick<EnterPress, "key" | "metaKey" | "ctrlKey">): boolean {
  return press.key === "Enter" && (press.metaKey || press.ctrlKey);
}

export function enterKeyHint(): EnterKeyHint {
  return coarsePointer() ? ENTER_KEY_HINT.NEW_LINE : ENTER_KEY_HINT.SEND;
}

export function enterSubmitKey(): TextAreaSubmit {
  return coarsePointer() ? TEXT_AREA_SUBMIT.MOD_ENTER : TEXT_AREA_SUBMIT.ENTER;
}
