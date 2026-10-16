import { useEffect } from "react";

/**
 * use-row-keys.ts -- ↑ and ↓ through a page's rows, a launcher's way, from the window itself as well as from a row, as Home and Factory move.
 *
 * Return opens the row reached, since each row is a button. A key pressed
 * anywhere else, the sidebar or a field, is left to it.
 */

/** The rows the arrow keys move through: every row drawn as the sidebar draws one. */
const ROWS = ".sidebar-plan";

/**
 * ↑ and ↓ from the window itself, or from one of the page's rows, move the
 * focus through the rows; the first press from the window reaches the first
 * row, or the last. A key with a modifier, or one pressed anywhere else, a
 * button of the page's own among them, is left alone.
 */
export function useRowKeys(page: HTMLElement | null, shown: boolean): void {
  useEffect(() => {
    if (page === null || !shown) return;
    const step = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const from = document.activeElement;
      const rows = [...page.querySelectorAll<HTMLElement>(ROWS)];
      const at = rows.findIndex((row) => row === from);
      const fromWindow = from === null || from === document.body;
      if (rows.length === 0 || (!fromWindow && at < 0)) return;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      const next = at < 0 ? (down ? 0 : rows.length - 1) : at + (down ? 1 : -1);
      rows[Math.min(rows.length - 1, Math.max(0, next))]?.focus();
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [page, shown]);
}
