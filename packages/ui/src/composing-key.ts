import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function isComposingKey(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || event.keyCode === 229;
}
