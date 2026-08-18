export const REPOSITORY_URL = "https://github.com/ReviewStage/luke";
export const DMG_URL = `${REPOSITORY_URL}/releases/latest/download/Luke.dmg`;

/**
 * GitHub's mark, drawn in `currentColor` so the stylesheet holds the color in
 * one place. Inlined for the same reason as the favicon: the page ships no
 * binary assets and fetches nothing at runtime.
 */
const GITHUB_MARK_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z";

/**
 * Both marks size at their call site rather than through a stylesheet rule, so
 * the one place a mark's box is decided is the place it is drawn.
 */
type MarkProps = { readonly className?: string };

/**
 * Always decorative: every use either sits beside a visible label or hangs off
 * a link that carries its own `aria-label`, so announcing the mark as well
 * would only repeat what a reader already hears.
 */
export function GitHubMark({ className = "block size-4" }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

/**
 * Luke's face, traced from `design/brand/luke-mark-{dark,light}.svg`. Those two
 * files differ only in a hard-coded stroke color, so drawing in `currentColor`
 * collapses them into one inline mark and keeps the page free of fetched
 * assets. Decorative: the wordmark beside it already says "Luke".
 *
 * Wider than tall, so a caller sizes both axes and lets the default
 * `xMidYMid meet` letterbox the face inside that box rather than stretch it.
 */
export function LukeMark({ className = "block h-[18px] w-5" }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="53.85 62.67 134.29 122.37" fill="none" aria-hidden="true">
      <g transform="rotate(-8 120 124)">
        <path
          d="M 104 84 V 150 Q 104 164 118 164 Q 140 164 168 142"
          fill="none"
          stroke="currentColor"
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="78" cy="92" r="12" fill="currentColor" />
        <circle cx="162" cy="92" r="12" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Shared between every page so navigation and branding never drift apart. */
export function SiteHeader(): React.JSX.Element {
  return (
    <header className="shell">
      <nav className="flex h-16 items-center justify-between">
        <a
          className="inline-flex items-center gap-2 font-brand text-base font-bold tracking-[-0.01em] no-underline"
          href="/"
        >
          <LukeMark />
          Luke
        </a>
        {/* Icon-only, so the padding buys a comfortable hit target and a focus
            ring with room around the mark. The matching negative margin keeps
            the mark optically aligned with the wordmark's edge rather than
            inset from it. */}
        <a
          className="-mr-1.5 inline-flex items-center rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:text-foreground motion-reduce:transition-none"
          href={REPOSITORY_URL}
          aria-label="Luke on GitHub"
        >
          <GitHubMark className="block size-[18px]" />
        </a>
      </nav>
    </header>
  );
}

/** Shared between every page so the legal and license links never drift apart. */
export function SiteFooter(): React.JSX.Element {
  return (
    <footer className="shell hairline pt-12 pb-16 font-mono text-xs text-muted-foreground">
      {/* The separator belongs to the gap between items rather than to any
          item, so adding or reordering a link never leaves a stray dot. */}
      <div className="flex flex-wrap gap-2 [&>*+*]:before:mr-2 [&>*+*]:before:content-['·']">
        <span>Apache-2.0</span>
        <span>macOS 14+</span>
        <a
          className="no-underline transition-colors duration-150 hover:text-foreground motion-reduce:transition-none"
          href="/privacy"
        >
          Privacy
        </a>
      </div>
    </footer>
  );
}
