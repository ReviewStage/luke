export function afterPaint(work: () => void): () => void {
  let canceled = false;
  const go = () => {
    if (!canceled) work();
  };
  if (document.visibilityState === "hidden") {
    queueMicrotask(go);
    return () => {
      canceled = true;
    };
  }
  let frame = globalThis.requestAnimationFrame(() => {
    frame = globalThis.requestAnimationFrame(go);
  });
  return () => {
    canceled = true;
    globalThis.cancelAnimationFrame(frame);
  };
}
