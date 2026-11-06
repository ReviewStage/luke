const WAIT_SELECTOR = '[class*="skeleton"], .ui-spinner, [aria-busy="true"]';

export const READY_SCRIPT = `![...document.querySelectorAll(${JSON.stringify(WAIT_SELECTOR)})].some((box) => {
  const r = box.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
})`;
