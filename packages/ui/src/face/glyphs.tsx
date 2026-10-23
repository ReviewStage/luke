/**
 * Every glyph the panel draws itself, in one place: drawn here rather than
 * pulled from an icon set, so they share one weight and one box and are sized
 * by the headings, labels, and controls they sit in. They are ours, not
 * anyone's brand mark, so they inherit `currentColor` like any other text — a
 * provider's own mark lives in `marks/provider-mark.tsx` and keeps its brand colour.
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

/**
 * Two halves of a plug joined, for the services an account connects: Settings'
 * Integrations page. Its paths are Tabler Icons' `plug-connected`
 * (https://tabler.io/icons, MIT licence, copyright (c) 2020-2026 Paweł Kuna),
 * drawn in our stroke.
 */
export function PlugIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z" />
      <path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z" />
      <path d="M3 21l2.5 -2.5" />
      <path d="M18.5 5.5l2.5 -2.5" />
      <path d="M10 11l-2 2" />
      <path d="M13 14l-2 2" />
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

/**
 * A push pin tilted the way 📌 is, as Slack, Notion, and Linear draw theirs:
 * keeps a task at the head of the sidebar. Its paths are Tabler Icons'
 * `pin` (https://tabler.io/icons, MIT licence, copyright (c) 2020-2026
 * Paweł Kuna), drawn in our stroke.
 */
export function PinIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
      <path d="M9 15l-4.5 4.5" />
      <path d="M14.5 4l5.5 5.5" />
    </Glyph>
  );
}

/**
 * The tilted pin struck through: lets a pinned task back among the rest. Its
 * paths are Tabler Icons' `pinned-off` (https://tabler.io/icons, MIT licence,
 * copyright (c) 2020-2026 Paweł Kuna), drawn in our stroke.
 */
export function UnpinIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M3 3l18 18" />
      <path d="M15 4.5l-3.249 3.249m-2.57 1.433l-2.181 .818l-1.5 1.5l7 7l1.5 -1.5l.82 -2.186m1.43 -2.563l3.25 -3.251" />
      <path d="M9 15l-4.5 4.5" />
      <path d="M14.5 4l5.5 5.5" />
    </Glyph>
  );
}

/** A check, drawn as a button's glyph: marks a task done. */
export function MarkDoneIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4.8 12.6 9.6 17.3 19.2 6.9" />
    </Glyph>
  );
}

/** A box under its lid: puts an agent, or a task left archived, away under Archived. */
export function ArchiveIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3" y="4" width="18" height="4.4" rx="1.1" />
      <path d="M4.8 8.4v9.8a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8V8.4" />
      <path d="M10 12.4h4" />
    </Glyph>
  );
}

/** A box with an arrow rising out of it: brings an archived task back. */
export function UnarchiveIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3" y="4" width="18" height="4.4" rx="1.1" />
      <path d="M4.8 8.4v9.8a1.8 1.8 0 0 0 1.8 1.8h1.8" />
      <path d="M19.2 8.4v9.8a1.8 1.8 0 0 1-1.8 1.8h-1.8" />
      <path d="M12 20v-7.6" />
      <path d="m9.2 15 2.8-2.8 2.8 2.8" />
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

/**
 * An arrow turning round to where it began: tries again what did not land.
 * Its paths are Lucide's `rotate-cw` (https://lucide.dev, ISC licence,
 * copyright (c) Lucide Contributors 2022), drawn in our stroke.
 */
export function RetryIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Glyph>
  );
}

/**
 * A ring round a mark of exclamation: something did not land. Its paths are
 * Lucide's `circle-alert` (https://lucide.dev, ISC licence, copyright (c)
 * Lucide Contributors 2022), drawn in our stroke.
 */
export function AlertIcon(): React.JSX.Element {
  return (
    <Glyph className="luke-glyph">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Glyph>
  );
}

/**
 * A ring round a check: something was done. Its paths are Lucide's
 * `circle-check` (https://lucide.dev, ISC licence, copyright (c) Lucide
 * Contributors 2022), drawn in our stroke.
 */
export function CircleCheckIcon(): React.JSX.Element {
  return (
    <Glyph className="luke-glyph">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Glyph>
  );
}

/**
 * An in-tray: something was posted to the Inbox. Its paths are Lucide's
 * `inbox` (https://lucide.dev, ISC licence, copyright (c) Lucide
 * Contributors 2022), drawn in our stroke.
 */
export function InboxIcon(): React.JSX.Element {
  return (
    <Glyph className="luke-glyph">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Glyph>
  );
}

/** Stands down without choosing: the cancel a control becomes mid-action. */
export function CloseIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5.2 5.2 18.8 18.8" />
      <path d="M18.8 5.2 5.2 18.8" />
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

/** Points back out of one: the control that returns to the front page. */
export function BackIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m14.6 5.8-6.2 6.2 6.2 6.2" />
    </Glyph>
  );
}

/** Points on, the mirror of `BackIcon`: a calendar's next month. */
export function ForwardIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

/** An arrow pointing left: back to the place the window stood on before. */
export function ArrowLeftIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M19 12H5" />
      <path d="m11.6 5.4-6.6 6.6 6.6 6.6" />
    </Glyph>
  );
}

/** An arrow pointing right: forward again to where back came from. */
export function ArrowRightIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5 12h14" />
      <path d="m12.4 5.4 6.6 6.6-6.6 6.6" />
    </Glyph>
  );
}

/** An arrow pointing up: a row moved one place up its list. */
export function ArrowUpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 19V5" />
      <path d="m5.4 11.6 6.6-6.6 6.6 6.6" />
    </Glyph>
  );
}

/** An arrow pointing down: a row moved one place down its list. */
export function ArrowDownIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 5v14" />
      <path d="m5.4 12.4 6.6 6.6 6.6-6.6" />
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

/** The speaker struck through, on a call whose voice is silenced on this Mac. */
export function SpeakerOffIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 9.4h2.9L11.6 5v14L6.9 14.6H4Z" />
      <path d="M14.8 9.3a4.1 4.1 0 0 1 0 5.4" />
      <path d="M17.6 6.9a7.6 7.6 0 0 1 0 10.2" />
      <path d="M4 3.4 20 19.4" />
    </Glyph>
  );
}

/** A camera: a call's video, put up again where it was put away. */
export function VideoIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.2" y="6.6" width="12" height="10.8" rx="2" />
      <path d="m15.2 10.6 5.6-3.2v9.2l-5.6-3.2" />
    </Glyph>
  );
}

/** The camera struck through: a call's video put away, the call itself going on. */
export function VideoOffIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3.2" y="6.6" width="12" height="10.8" rx="2" />
      <path d="m15.2 10.6 5.6-3.2v9.2l-5.6-3.2" />
      <path d="M4 3.4 20 19.4" />
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

/** An arrow rising in a circle: the sidebar's way into a newer release. */
export function UpdateIcon(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 16.2V7.8" />
      <path d="m8.4 11.4 3.6-3.6 3.6 3.6" />
    </Glyph>
  );
}

/** An arrow up and to the right, set after a link's words: a press leaves the place for another. */
export function ArrowUpRightIcon(): React.JSX.Element {
  return (
    <Glyph className="luke-text-link-out">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
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

/** An arrow back up and to the left: the way back to the task a call is about. */
export function ReturnIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M17.5 17.5 6.5 6.5" />
      <path d="M6.5 15.5v-9h9" />
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

/**
 * The Model Context Protocol's mark, its three strokes redrawn in this
 * file's weight and box rather than shipped as the project's artwork: the
 * composer's button over the MCP servers an agent is handed.
 */
export function McpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M2.44 11.45l8.92-8.92c1.23-1.23 3.23-1.23 4.46 0 1.23 1.23 1.23 3.23 0 4.46l-6.73 6.73" />
      <path d="M9.18 13.63l6.64-6.64c1.23-1.23 3.23-1.23 4.46 0l.05.05c1.23 1.23 1.23 3.23 0 4.46l-8.06 8.06c-.41.41-.41 1.08 0 1.49l1.66 1.66" />
      <path d="M13.59 4.76 7 11.35c-1.23 1.23-1.23 3.23 0 4.46 1.23 1.23 3.23 1.23 4.46 0l6.59-6.59" />
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

/** A cog: the account's row that leads to Settings, drawn the way every app draws settings. */
export function GearIcon(): React.JSX.Element {
  return (
    <Glyph className="gear-glyph">
      <path d="M10.4 5.3L10.8 2.8L13.2 2.8L13.6 5.3A6.9 6.9 0 0 1 15.7 6.1L17.7 4.6L19.4 6.3L17.9 8.3A6.9 6.9 0 0 1 18.7 10.4L21.2 10.8L21.2 13.2L18.7 13.6A6.9 6.9 0 0 1 17.9 15.7L19.4 17.7L17.7 19.4L15.7 17.9A6.9 6.9 0 0 1 13.6 18.7L13.2 21.2L10.8 21.2L10.4 18.7A6.9 6.9 0 0 1 8.3 17.9L6.3 19.4L4.6 17.7L6.1 15.7A6.9 6.9 0 0 1 5.3 13.6L2.8 13.2L2.8 10.8L5.3 10.4A6.9 6.9 0 0 1 6.1 8.3L4.6 6.3L6.3 4.6L8.3 6.1A6.9 6.9 0 0 1 10.4 5.3Z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  );
}

/** A terminal's prompt: the Settings page about the coding agents that run in one. Outline, like the other pages' glyphs. */
export function TerminalIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.4" />
      <path d="m7 9.2 3.2 2.8L7 14.8" />
      <path d="M12.6 14.8h4.2" />
    </Glyph>
  );
}

/**
 * The box an agent's mark stands in, held empty: an agent whose harness is
 * not known yet. Note that it draws nothing rather than a stand-in glyph,
 * because the harness's mark lands in the same box and a glyph there first
 * would read as the agent's own; the name beside it says whose it is.
 */
export function AgentPlaceholderIcon(): React.JSX.Element {
  return <Glyph>{null}</Glyph>;
}

/** A lit bulb: what Luke's agents remember for the workspace. */
export function MemoryIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 3.6a5.4 5.4 0 0 0-3.2 9.8c.7.5 1.1 1.3 1.1 2.1v1.5h4.2v-1.5c0-.8.4-1.6 1.1-2.1A5.4 5.4 0 0 0 12 3.6Z" />
      <path d="M9.9 19.6h4.2" />
    </Glyph>
  );
}

/** A page with its corner turned down and lines of text on it: the task's own document. */
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

/** A folder with its tab: a repository whose owner's picture is not drawn. */
export function FolderIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M3.6 7.2a2 2 0 0 1 2-2h3.7l2 2.2h7.1a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z" />
    </Glyph>
  );
}

/** Starts a run: the triangle every transport draws for play. */
export function PlayIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M8 5.6v12.8l10-6.4z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Stops what is playing: the square every transport draws for stop, at the triangle's weight. */
export function StopIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="6" y="6" width="12" height="12" rx="1.8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** A board on its stand with a line drawn across it: the task's whiteboard. */
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

/** Points down into a menu: the half of a split button that opens its choices. */
export function ChevronDownIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m5.8 9.4 6.2 6.2 6.2-6.2" />
    </Glyph>
  );
}

/** Points at a fold's body, turned down by its stylesheet while the fold is open. */
export function FoldChevronIcon(): React.JSX.Element {
  return (
    <Glyph className="luke-disclosure-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
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

/**
 * A sound wave's bars: a call into an agent, which starts one where none is
 * up. Its path is Lucide's `audio-lines` (ISC licence), drawn in our stroke.
 */
export function WaveformIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M2 10v3" />
      <path d="M6 6v11" />
      <path d="M10 3v18" />
      <path d="M14 8v7" />
      <path d="M18 5v13" />
      <path d="M22 10v3" />
    </Glyph>
  );
}

/**
 * A speech bubble, for a plan's comments: the side panel's Comments tab and
 * the summary's row. Its path is Lucide's `message-square` (ISC licence),
 * drawn in our stroke.
 */
export function CommentsIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M21 16a2 2 0 0 1-2 2H7.83a2 2 0 0 0-1.414.586l-2.2 2.2A.71.71 0 0 1 3 20.286V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Glyph>
  );
}

/** Points into a submenu beside a menu row, in the chevron's own stroke. */
export function ChevronRightIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

/*
 * The writing glyphs: what the format toolbar, Turn into, and the `/` menu
 * draw for each mark and block, the same set the pull request box's toolbar
 * draws. Their paths are Lucide's (https://lucide.dev, ISC licence, copyright
 * (c) 2026 Lucide Icons and Contributors), each named beside it, drawn in our
 * stroke.
 */

/** Bold words: Lucide's `bold`. */
export function BoldIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />
    </Glyph>
  );
}

/** Italic words: Lucide's `italic`. */
export function ItalicIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M19 4h-9" />
      <path d="M14 20H5" />
      <path d="M15 4 9 20" />
    </Glyph>
  );
}

/** Words struck through: Lucide's `strikethrough`. */
export function StrikethroughIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <path d="M4 12h16" />
    </Glyph>
  );
}

/** Code among words, two angle brackets: Lucide's `code`. */
export function InlineCodeIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </Glyph>
  );
}

/** Two links of a chain: a link on words, Lucide's `link`. */
export function LinkIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Glyph>
  );
}

/** The chain broken: a link taken off words, Lucide's `unlink`. */
export function UnlinkIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
      <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
      <path d="M8 2v3" />
      <path d="M2 8h3" />
      <path d="M16 19v3" />
      <path d="M19 16h3" />
    </Glyph>
  );
}

/** A line of plain text: Lucide's `type`. */
export function TextBlockIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 4v16" />
      <path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" />
      <path d="M9 20h6" />
    </Glyph>
  );
}

/** A first-level heading: Lucide's `heading-1`. */
export function Heading1Icon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="m17 12 3-2v8" />
    </Glyph>
  );
}

/** A second-level heading: Lucide's `heading-2`. */
export function Heading2Icon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" />
    </Glyph>
  );
}

/** A third-level heading: Lucide's `heading-3`. */
export function Heading3Icon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" />
      <path d="M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" />
    </Glyph>
  );
}

/** A bulleted list: Lucide's `list`. */
export function BulletedListIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path d="M8 5h13" />
      <path d="M8 12h13" />
      <path d="M8 19h13" />
    </Glyph>
  );
}

/** A numbered list: Lucide's `list-ordered`. */
export function NumberedListIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M11 5h10" />
      <path d="M11 12h10" />
      <path d="M11 19h10" />
      <path d="M4 4h1v5" />
      <path d="M4 9h2" />
      <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" />
    </Glyph>
  );
}

/** A list of things to do, each ticked: Lucide's `list-checks`. */
export function TodoListIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
    </Glyph>
  );
}

/** Quoted words under a bar: Lucide's `text-quote`. */
export function QuoteIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M17 5H3" />
      <path d="M21 12H8" />
      <path d="M21 19H8" />
      <path d="M3 12v7" />
    </Glyph>
  );
}

/** A block of code, brackets in a frame: Lucide's `square-code`. */
export function CodeBlockIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m10 9-3 3 3 3" />
      <path d="m14 15 3-3-3-3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </Glyph>
  );
}

/** A rule across the page between blocks: Lucide's `minus`. */
export function DividerIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5 12h14" />
    </Glyph>
  );
}

/** A grid of cells under a header row: a table laid into a document, Lucide's `table`. */
export function TableIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M12 3v18" />
    </Glyph>
  );
}

/** A speech bubble with a plus: a comment begun on words, Lucide's `message-square-plus`. */
export function CommentAddIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
      <path d="M12 8v6" />
      <path d="M9 11h6" />
    </Glyph>
  );
}
