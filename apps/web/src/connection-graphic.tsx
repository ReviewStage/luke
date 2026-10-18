import { LukeMark } from "./SiteChrome";

/**
 * connection-graphic.tsx -- the pairing a card draws when Luke connects to another service: its mark, an arrow, and Luke's own face.
 *
 * The sign-in card, the GitHub App's landing, and an integration's landing
 * all draw it, so the three agree on the sizes and the gap between them.
 */

function ArrowMark(): React.JSX.Element {
  return (
    <svg
      className="size-6 shrink-0 text-(--luke-color-text-muted)"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The service's mark, drawn at `PROVIDER_MARK_SIZE.TILE` by the caller, then the arrow and Luke's face; the space around it is the card's. */
export function ConnectionGraphic({ mark }: { mark: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="flex items-center justify-center gap-4 text-(--luke-color-text)"
      aria-hidden="true"
    >
      {mark}
      <ArrowMark />
      <LukeMark className="h-auto w-12 shrink-0" />
    </div>
  );
}
