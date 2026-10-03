/**
 * The three dots that rise while a run of Luke's is still going: one drawing
 * of the wait, shared by the Conversation bubble and the Plans tab's status
 * row so the two cannot grow separate visual languages. Decorative on every
 * surface: each carries the reader's status line beside it.
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
