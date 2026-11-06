export function UnreadMark({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <span
      className="ui-unread-gutter block w-status-dot flex-none text-center text-label"
      aria-hidden="true"
    >
      {unread ? (
        <span className="ui-unread-dot inline-block size-status-dot rounded-disc bg-accent-ink align-[calc(var(--ui-mark-cap,1cap)/2-var(--spacing-status-dot)/2)]" />
      ) : null}
    </span>
  );
}
