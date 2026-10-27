/**
 * thinking-dots.tsx -- the three dots that rise while a run of Luke's is still going.
 *
 * One drawing of the wait, shared by the Conversation bubble and the Tasks
 * tab's status row so the two cannot grow separate visual languages.
 * Decorative on every surface: each carries the reader's status line beside
 * it. The dots hold still on `--luke-loop-motion`, as every endless loop does.
 */
export function ThinkingDots(): React.JSX.Element {
  return (
    <span className="luke-thinking-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
