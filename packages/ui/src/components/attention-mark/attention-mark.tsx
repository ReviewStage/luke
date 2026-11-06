export function AttentionMark(): React.JSX.Element {
  return (
    <span
      className="attention-mark inline-grid size-attention-mark flex-none place-items-center rounded-disc bg-attention-fill text-on-attention [&_svg]:size-ui-12"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
        <path d="M8 4.25v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="8" cy="11.6" r="1.15" fill="currentColor" />
      </svg>
    </span>
  );
}
