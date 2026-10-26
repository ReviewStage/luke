/**
 * unread-mark.tsx -- the blue dot a row or a post wears in a gutter before its words while what it stands for is unread, as a mail app marks an unread thread.
 *
 * The gutter stands whether the dot does or not, so the words of a run of
 * rows line up read or unread. The dot is decoration: the row says unread
 * in words of its own (its title's weight, or a hidden word), since a dot
 * alone says nothing to a reader who cannot see it. The gutter sets its
 * line in a title's type, so its baseline is the title's, and the dot
 * stands centred on the title's capitals rather than on its line's box.
 * The dot is the accent's ink rather than its fill, because the web's cyan
 * fill reads at 1.7:1 on its light page, under a mark's 3:1.
 */

/** The gutter, a dot wide, and the dot in it while `unread`. */
export function UnreadMark({ unread }: { unread: boolean }): React.JSX.Element {
  return (
    <span
      className="luke-unread-gutter block w-status-dot flex-none text-center text-label"
      aria-hidden="true"
    >
      {unread ? (
        <span className="luke-unread-dot inline-block size-status-dot rounded-disc bg-accent-ink align-[calc(0.5cap-var(--spacing-status-dot)/2)]" />
      ) : null}
    </span>
  );
}
