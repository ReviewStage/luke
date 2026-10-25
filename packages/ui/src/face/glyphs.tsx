/**
 * Every glyph the panel draws itself that no icon set draws as well: drawn
 * here rather than pulled from one, so they share one weight and one box and
 * are sized by the headings, labels, and controls they sit in. What Lucide
 * already draws is Lucide's, behind `icons/lucide-glyphs.tsx`; the door to
 * both is `icons/icons.ts`. They are ours, not
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
    // Note that the ↗ follows its link's words' size, faint until the link lights; the pointer lights it only where there is a hover, because iOS plays a first tap as a hover, which a change it draws spends.
    <Glyph className="luke-text-link-out ms-[0.12em] inline-block size-[0.78em] align-[-0.02em] opacity-55 transition-opacity duration-(--luke-duration-hover) ease-motion-exit group-hover/text-link:opacity-100 group-focus-visible/text-link:opacity-100">
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

/** Holds what is playing: the two bars every transport draws for pause, at the triangle's weight. */
export function PauseIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="6.4" y="5.6" width="4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.6" y="5.6" width="4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Four corners turned out: a video grown to fill the screen. */
export function FullScreenIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4.8 9.4V4.8h4.6" />
      <path d="M14.6 4.8h4.6v4.6" />
      <path d="M19.2 14.6v4.6h-4.6" />
      <path d="M9.4 19.2H4.8v-4.6" />
    </Glyph>
  );
}

/** Four corners turned in: a full-screen video brought back to its place. */
export function ExitFullScreenIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M9.4 4.8v4.6H4.8" />
      <path d="M14.6 4.8v4.6h4.6" />
      <path d="M19.2 14.6h-4.6v4.6" />
      <path d="M4.8 14.6h4.6v4.6" />
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

/** Points into a submenu beside a menu row, in the chevron's own stroke. */
export function ChevronRightIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}
