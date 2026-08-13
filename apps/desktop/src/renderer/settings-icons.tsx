/**
 * Every glyph the panel draws itself, in one place: drawn here rather than
 * pulled from an icon set, so they share one weight and one box and are sized
 * by the headings, labels, and controls they sit in. They are ours, not
 * anyone's brand mark, so they inherit `currentColor` like any other text — a
 * provider's own mark lives in `provider-marks.tsx` and keeps its brand colour.
 */
function Glyph({
  children,
  className = "settings-icon",
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function KeyIcon(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="8" cy="12" r="4.2" />
      <path d="M12.2 12H21" />
      <path d="M17.6 12v3.1" />
      <path d="M20.4 12v2.2" />
    </Glyph>
  );
}

/** Sits beside a provider's name to say it is connected, in the state palette. */
export function CheckIcon(): React.JSX.Element {
  return (
    <Glyph className="credential-check">
      <path d="M4.8 12.6 9.6 17.3 19.2 6.9" />
    </Glyph>
  );
}

export function PencilIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M16.3 3.8a2.3 2.3 0 0 1 3.9 1.6 2.3 2.3 0 0 1-.7 1.6L8.4 18.1l-4.5 1.1 1.1-4.5z" />
      <path d="M14.6 5.5l3.9 3.9" />
    </Glyph>
  );
}

export function TrashIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4.4 6.7h15.2" />
      <path d="M9.4 6.7V4.6a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v2.1" />
      <path d="M6.7 6.7l.9 12.9a1.7 1.7 0 0 0 1.7 1.6h5.4a1.7 1.7 0 0 0 1.7-1.6l.9-12.9" />
      <path d="M10.4 10.6v6.6" />
      <path d="M13.6 10.6v6.6" />
    </Glyph>
  );
}

export function KeyboardIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="2.4" y="6" width="19.2" height="12" rx="2.4" />
      <path d="M6.4 10h.01M10 10h.01M13.6 10h.01M17.2 10h.01" />
      <path d="M7.6 14h8.8" />
    </Glyph>
  );
}

export function MicrophoneIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="9" y="2.6" width="6" height="11" rx="3" />
      <path d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0" />
      <path d="M12 18v3.4" />
    </Glyph>
  );
}

/** Drawn rather than typed: a ↗ character depends on a font having one. */
export function ExternalIcon(): React.JSX.Element {
  return (
    <Glyph className="link-icon">
      <path d="M9.4 4.6H5.2A1.6 1.6 0 0 0 3.6 6.2v12.6a1.6 1.6 0 0 0 1.6 1.6h12.6a1.6 1.6 0 0 0 1.6-1.6v-4.2" />
      <path d="M14 3.6h6.4V10" />
      <path d="M10.4 13.6 20.1 3.9" />
    </Glyph>
  );
}

export function PowerIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M12 3v8.4" />
      <path d="M17.6 6.2a7.6 7.6 0 1 1-11.2 0" />
    </Glyph>
  );
}

/**
 * Two sliders rather than a funnel: the control it opens holds an order as well
 * as a filter, and a funnel would promise only the second.
 */
export function OptionsIcon(): React.JSX.Element {
  return (
    <Glyph className="options-glyph">
      <path d="M3.6 8.4h5.2" />
      <path d="M13.2 8.4h7.2" />
      <circle cx="11" cy="8.4" r="2.2" />
      <path d="M3.6 15.6h2.6" />
      <path d="M10.6 15.6h9.8" />
      <circle cx="8.4" cy="15.6" r="2.2" />
    </Glyph>
  );
}

/** Work happening on this Mac: the machine it is happening on. */
export function LaptopIcon(): React.JSX.Element {
  return (
    <Glyph className="filter-icon">
      <rect x="4.2" y="5.4" width="15.6" height="10.4" rx="1.7" />
      <path d="M2.4 18.8h19.2" />
    </Glyph>
  );
}

/**
 * Work happening somewhere else. The badge on a session's mark says the same
 * thing in the same shape — two small puffs and one large over a flat base —
 * drawn here as an outline rather than a fill, because at this size it sits
 * beside the laptop and the pair has to read as one weight.
 */
export function CloudIcon(): React.JSX.Element {
  return (
    <Glyph className="filter-icon">
      <path d="M7.3 18.4h9.5a4.3 4.3 0 0 0 .8-8.52 6.1 6.1 0 0 0-11.66-1.3A4.35 4.35 0 0 0 7.3 18.4Z" />
    </Glyph>
  );
}
