/**
 * Drawn here rather than pulled from an icon set: three glyphs at one weight,
 * sized to the section headings they label. They are ours, not anyone's brand
 * mark, so they inherit `currentColor` like any other text.
 */
function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      className="settings-icon"
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

export function MicrophoneIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="9" y="2.6" width="6" height="11" rx="3" />
      <path d="M5.4 11.4a6.6 6.6 0 0 0 13.2 0" />
      <path d="M12 18v3.4" />
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
