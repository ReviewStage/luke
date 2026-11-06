export interface ViewportBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export function visibleViewport(): ViewportBox {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) {
    return { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  }
  return {
    top: viewport.offsetTop,
    bottom: viewport.offsetTop + viewport.height,
    left: viewport.offsetLeft,
    right: viewport.offsetLeft + viewport.width,
  };
}
