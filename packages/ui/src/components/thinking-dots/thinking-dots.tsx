/**
 * thinking-dots.tsx -- the three dots that rise while a run of Luke's is still going.
 *
 * One drawing of the wait, shared by the Conversation bubble and the Tasks
 * tab's status row so the two cannot grow separate visual languages.
 * Decorative on every surface: each carries the reader's status line beside
 * it. The dots hold still on `--luke-loop-motion`, as every endless loop does.
 *
 * The dots are drawn in the Tailwind theme's utilities, faint at rest in the
 * muted ink; their rise is `thinking-dots.css`'s.
 */

/** One dot, at rest. */
const DOT = "size-thinking-dot rounded-full bg-muted-foreground opacity-35";
export function ThinkingDots(): React.JSX.Element {
  return (
    <span
      className="luke-thinking-dots inline-flex h-luke-12 items-center gap-luke-4"
      aria-hidden="true"
    >
      <i className={DOT} />
      <i className={DOT} />
      <i className={DOT} />
    </span>
  );
}
