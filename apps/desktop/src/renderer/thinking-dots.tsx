/**
 * The three dots that rise in the wake of Luke's repeating success hop while a
 * run of his is still going: one drawing of the wait, shared by the
 * Conversation bubble and the notch strip so the two cannot grow separate
 * visual languages. Decorative on every surface — the bubble carries the
 * reader's status line beside it, and the strip is already aria-hidden.
 */
export function ThinkingDots(): React.JSX.Element {
  return (
    <span className="thinking-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
