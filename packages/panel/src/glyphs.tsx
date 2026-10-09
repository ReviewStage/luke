/**
 * Every glyph the panel draws itself, in one place: drawn here rather than
 * pulled from an icon set, so they share one weight and one box and are sized
 * by the headings, labels, and controls they sit in. They are ours, not
 * anyone's brand mark, so they inherit `currentColor` like any other text — a
 * provider's own mark lives in `provider-marks.tsx` and keeps its brand colour.
 * The one exception is Luke's own mark, which is ours in both senses: it is a
 * brand mark, and it inherits `currentColor` like the rest.
 */

import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

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

export function CopyIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="8.6" y="8.6" width="11" height="11" rx="2.4" />
      <path d="M5.6 15.4H5A2.4 2.4 0 0 1 2.6 13V5A2.4 2.4 0 0 1 5 2.6h8A2.4 2.4 0 0 1 15.4 5v.6" />
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

/** Stands down without choosing: the cancel a control becomes mid-action. */
export function CloseIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M6.8 6.8 17.2 17.2" />
      <path d="M17.2 6.8 6.8 17.2" />
    </Glyph>
  );
}

/** Three dots in a row: more actions on the thing it sits beside, in a menu. */
export function EllipsisIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
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

/** Points into a page: the row it sits on opens one. */
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

/** Heads the Updates section: the arrival a newer release waits as. */
export function DownloadIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M12 4.2v9.6" />
      <path d="m7.6 10 4.4 4.4L16.4 10" />
      <path d="M4.8 19.2h14.4" />
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

/** A person: the account the app is signed in as. */
export function UserIcon(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5.4 19.8a6.6 6.6 0 0 1 13.2 0" />
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

/** A magnifier: the list read for the rows that say the typed words. */
export function SearchIcon(): React.JSX.Element {
  return (
    <Glyph className="search-glyph">
      <circle cx="10.6" cy="10.6" r="6.1" />
      <path d="M15.2 15.2L20.2 20.2" />
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

/** The microphone itself — what macOS's own access ask is about. */
export function MicrophoneIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="9.2" y="2.6" width="5.6" height="10.6" rx="2.8" />
      <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.8V21" />
    </Glyph>
  );
}

/** The microphone struck through, on a call that is muted. */
export function MicrophoneOffIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="9.2" y="2.6" width="5.6" height="10.6" rx="2.8" />
      <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.8V21" />
      <path d="M4 3.4 20 19.4" />
    </Glyph>
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

/** A plus: a workspace or an agent that did not exist before the action. */
export function PlusIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 5.4v13.2" />
      <path d="M5.4 12h13.2" />
    </Glyph>
  );
}

/** A folder on this Mac: the one a plan reads. */
export function FolderIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M3.8 7.2a1.7 1.7 0 0 1 1.7-1.7h3.9l2 2.2h7.1a1.7 1.7 0 0 1 1.7 1.7v8.1a1.7 1.7 0 0 1-1.7 1.7H5.5a1.7 1.7 0 0 1-1.7-1.7Z" />
    </Glyph>
  );
}

/** The same folder opened: shows where it is on this Mac, in Finder. */
export function FolderOpenIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M6 14.6 7.4 11.9a1.7 1.7 0 0 1 1.5-.9h10.6a1.4 1.4 0 0 1 1.3 1.8l-1.5 5.1a1.7 1.7 0 0 1-1.6 1.2H5.5a1.7 1.7 0 0 1-1.7-1.7V7.2a1.7 1.7 0 0 1 1.7-1.7h3.9l2 2.2h5.4a1.7 1.7 0 0 1 1.7 1.7V11" />
    </Glyph>
  );
}

/** Sends what was composed, drawn the way every composer draws it: an arrow up. */
export function ArrowUpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 18.6V5.4" />
      <path d="m6.4 11 5.6-5.6 5.6 5.6" />
    </Glyph>
  );
}

/** A window with a pane down its right side: the side panel beside the document, shown or hidden. */
export function SidePanelIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.6" />
      <path d="M14.6 4.6v14.8" />
    </Glyph>
  );
}

/** Two arrows out to opposite corners: a pane grown to fill the window. */
export function ExpandIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M14 4.8h5.2V10" />
      <path d="M19.2 4.8 13.4 10.6" />
      <path d="M10 19.2H4.8V14" />
      <path d="m4.8 19.2 5.8-5.8" />
    </Glyph>
  );
}

/** Two arrows in from opposite corners: a full-window pane brought back to its place. */
export function CollapseIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M19.2 10H14V4.8" />
      <path d="M14 10l5.2-5.2" />
      <path d="M4.8 14H10v5.2" />
      <path d="M10 14l-5.2 5.2" />
    </Glyph>
  );
}

/** The window's sidebar, shown or folded away: the side panel's frame with its left column ruled off. */
export function SidebarIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.6" />
      <path d="M9.4 4.6v14.8" />
    </Glyph>
  );
}

/** A pencil over an open square: a new piece of work, as every chat app's compose button draws it. */
export function ComposeIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M11.2 4.6H6a2.6 2.6 0 0 0-2.6 2.6v10.6A2.6 2.6 0 0 0 6 20.4h10.6a2.6 2.6 0 0 0 2.6-2.6v-5.2" />
      <path d="M17.5 3.9a2 2 0 0 1 2.8 2.8l-7.6 7.6-3.6.8.8-3.6z" />
    </Glyph>
  );
}

/** Stops the reply under way, drawn the way every chat surface draws it: a square. */
export function StopIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="2.8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A cog: the account's row that leads to Settings, drawn the way every app draws settings. */
export function GearIcon(): React.JSX.Element {
  return (
    <Glyph className="gear-glyph">
      <path d="M10.4 5.3L10.8 2.8L13.2 2.8L13.6 5.3A6.9 6.9 0 0 1 15.7 6.1L17.7 4.6L19.4 6.3L17.9 8.3A6.9 6.9 0 0 1 18.7 10.4L21.2 10.8L21.2 13.2L18.7 13.6A6.9 6.9 0 0 1 17.9 15.7L19.4 17.7L17.7 19.4L15.7 17.9A6.9 6.9 0 0 1 13.6 18.7L13.2 21.2L10.8 21.2L10.4 18.7A6.9 6.9 0 0 1 8.3 17.9L6.3 19.4L4.6 17.7L6.1 15.7A6.9 6.9 0 0 1 5.3 13.6L2.8 13.2L2.8 10.8L5.3 10.4A6.9 6.9 0 0 1 6.1 8.3L4.6 6.3L6.3 4.6L8.3 6.1A6.9 6.9 0 0 1 10.4 5.3Z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  );
}

/** A page with its corner turned down and lines of text on it: the plan's own document. */
export function DocumentIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M14.2 3.4H7.2a2 2 0 0 0-2 2v13.2a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8Z" />
      <path d="M14.2 3.4V8h4.6" />
      <path d="M8.8 12.6h6.4" />
      <path d="M8.8 16.2h4.4" />
    </Glyph>
  );
}

/** A board on its stand with a line drawn across it: the plan's whiteboard. */
export function BoardIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.4" y="4" width="17.2" height="12" rx="1.8" />
      <path d="M12 16v4.2" />
      <path d="M8.6 20.2h6.8" />
      <path d="m7.4 12 2.8-3 2.6 2.2 3.8-3.6" />
    </Glyph>
  );
}

/** A pair of angle brackets with a slash between them: code. */
export function CodeIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M8.2 7.4 3.6 12l4.6 4.6" />
      <path d="M15.8 7.4 20.4 12l-4.6 4.6" />
      <path d="M13.6 5 10.4 19" />
    </Glyph>
  );
}

/** A prompt and a line run at it: what Luke's planning model wrote and ran. */
export function WorkIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4.6 6.8 9.8 12l-5.2 5.2" />
      <path d="M12.4 17.6h7" />
    </Glyph>
  );
}

/** A speech bubble with lines of words in it: what was said on a call. */
export function TranscriptIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M20.4 14.6a2 2 0 0 1-2 2H8.6l-4.8 3.8V5.6a2 2 0 0 1 2-2h12.6a2 2 0 0 1 2 2Z" />
      <path d="M7.8 8.4h8.4" />
      <path d="M7.8 12h5.4" />
    </Glyph>
  );
}
