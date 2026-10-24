import type { Ref, RefCallback } from "react";

/**
 * join-refs.ts -- one ref callback that hands an element to several refs, as a roving box both its component and the component's owner hold.
 *
 * Note that the callback answers what undoes each ref rather than being
 * called again with null, because React calls a ref that answers a cleanup
 * with that cleanup alone, and a roving box's own ref answers one.
 */

/** Hands `element` to one ref, answering what takes it back. */
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

/** A ref callback handing its element to each of `refs`, and taking it back from each as it goes. */
export function joinRefs<T>(...refs: readonly (Ref<T> | undefined)[]): RefCallback<T> {
  return (element) => {
    if (element === null) return undefined;
    const undo = refs.map((ref) => handTo(ref, element));
    return () => {
      for (const each of undo) each();
    };
  };
}
