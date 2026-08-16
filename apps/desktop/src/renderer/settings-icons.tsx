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

/** An arrow turning back on itself: returns a setting to its default. */
export function ResetIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M2.5 5.1v5.2h5.2" />
      <path d="M4.6 14.6a7.8 7.8 0 1 0 1.9-8.1L2.5 10.3" />
    </Glyph>
  );
}

/** Stands down without choosing: the cancel a control becomes mid-act. */
export function CloseIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M6.8 6.8 17.2 17.2" />
      <path d="M17.2 6.8 6.8 17.2" />
    </Glyph>
  );
}

/** The up-and-down pair macOS badges a pop-up button with. */
export function PopUpIcon(): React.JSX.Element {
  return (
    <Glyph className="voice-select-glyph">
      <path d="M7.2 9.6 12 4.8l4.8 4.8" />
      <path d="M7.2 14.4 12 19.2l4.8-4.8" />
    </Glyph>
  );
}

/** A plug: the services Luke connects to beyond the agents themselves. */
export function PlugIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M9 2.6v5.2" />
      <path d="M15 2.6v5.2" />
      <path d="M6 7.8h12v4.4a4.4 4.4 0 0 1-4.4 4.4h-3.2A4.4 4.4 0 0 1 6 12.2Z" />
      <path d="M12 16.6v4.8" />
    </Glyph>
  );
}

/** Points into a page: the row it sits on opens one. */
/** A month, drawn the way macOS draws one: a grid with its hanging rings. */
export function CalendarIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.4" y="5" width="17.2" height="16" rx="2.6" />
      <path d="M3.4 10h17.2" />
      <path d="M8 2.6v4.4" />
      <path d="M16 2.6v4.4" />
    </Glyph>
  );
}

export function ChevronIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

/** Points back out of one: the control that returns to the front page. */
export function BackIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m14.6 5.8-6.2 6.2 6.2 6.2" />
    </Glyph>
  );
}

/** A project's folder: where a conversational ask creates new workspaces. */
export function FolderIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M3.4 6.2a1.8 1.8 0 0 1 1.8-1.8h4l2 2.4h7.6a1.8 1.8 0 0 1 1.8 1.8v9.2a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8Z" />
    </Glyph>
  );
}

/** Sound leaving the machine: everything about how Luke is heard. */
export function SpeakerIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 9.4h2.9L11.6 5v14L6.9 14.6H4Z" />
      <path d="M14.8 9.3a4.1 4.1 0 0 1 0 5.4" />
      <path d="M17.6 6.9a7.6 7.6 0 0 1 0 10.2" />
    </Glyph>
  );
}

/** The display Luke stands on: everything about where and how he is drawn. */
export function DisplayIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.2" y="4.4" width="17.6" height="12.2" rx="2" />
      <path d="M9.4 20.2h5.2" />
      <path d="M12 16.6v3.6" />
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

/** What the app has been allowed to reach, which is what this group is about. */
export function ShieldIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M12 2.6 4.8 5.6v5.5c0 4.4 3 8.4 7.2 9.9 4.2-1.5 7.2-5.5 7.2-9.9V5.6Z" />
      <path d="m8.9 11.9 2.2 2.2 4-4.2" />
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

/** Two sliders, drawn once for both controls that mean "choices". */
function SliderMarks(): React.JSX.Element {
  return (
    <>
      <path d="M3.6 8.4h5.2" />
      <path d="M13.2 8.4h7.2" />
      <circle cx="11" cy="8.4" r="2.2" />
      <path d="M3.6 15.6h2.6" />
      <path d="M10.6 15.6h9.8" />
      <circle cx="8.4" cy="15.6" r="2.2" />
    </>
  );
}

/**
 * Two sliders rather than a funnel: the control it opens holds an order as well
 * as a filter, and a funnel would promise only the second.
 */
export function OptionsIcon(): React.JSX.Element {
  return (
    <Glyph className="options-glyph">
      <SliderMarks />
    </Glyph>
  );
}

/** The same two sliders at a heading's size: settings the user has chosen. */
export function PreferencesIcon(): React.JSX.Element {
  return (
    <Glyph>
      <SliderMarks />
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

/**
 * The stop glyph every chat surface uses: a filled, slightly rounded square.
 * Filled rather than stroked, because at control size a stroked square reads
 * as a checkbox.
 */
export function StopIcon(): React.JSX.Element {
  return (
    <svg
      className="control-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.6" />
    </svg>
  );
}

/** Words meant to carry: what the feedback section is for. */
export function MegaphoneIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M3.4 10.2v3.6a1.6 1.6 0 0 0 1.6 1.6h1.8l1.2 4.2a1.3 1.3 0 0 0 1.3 1h.9a1 1 0 0 0 1-1.3l-1.1-3.9h1.7l7.4 3.4a1 1 0 0 0 1.4-.9V6.1a1 1 0 0 0-1.4-.9l-7.4 3.4H5a1.6 1.6 0 0 0-1.6 1.6Z" />
    </Glyph>
  );
}

/** A picture, on the control that attaches one. */
export function ImageIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="m3.8 17.4 4.8-4.6 3.4 3.2 3.6-3.6 4.8 4.6" />
    </Glyph>
  );
}

/**
 * Takes one attachment back off the note. Its own element rather than a
 * `Glyph`: at the eight pixels it is drawn at, the shared 1.9 stroke thins to
 * nothing and the X reads as a dot, so this one carries the weight it needs.
 */
export function RemoveIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5.6 5.6 18.4 18.4" />
      <path d="M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

/** Sends what was typed, drawn the way every chat surface draws it: an arrow up. */
export function SendIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M12 18.6V5.8" />
      <path d="m6.4 11.2 5.6-5.6 5.6 5.6" />
    </Glyph>
  );
}
