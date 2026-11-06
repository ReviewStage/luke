import type { Ref, RefCallback } from "react";

function handTo<T>(ref: Ref<T> | undefined, element: T): () => void {
  if (ref === null || ref === undefined) return () => undefined;
  if (typeof ref !== "function") {
    ref.current = element;
    return () => {
      ref.current = null;
    };
  }
  const cleanup = ref(element);
  return typeof cleanup === "function" ? cleanup : () => ref(null);
}

export function joinRefs<T>(...refs: readonly (Ref<T> | undefined)[]): RefCallback<T> {
  return (element) => {
    if (element === null) return undefined;
    const undo = refs.map((ref) => handTo(ref, element));
    return () => {
      for (const each of undo) each();
    };
  };
}
