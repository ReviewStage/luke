import React from "react";

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

export function MarkDoneIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M4.8 12.6 9.6 17.3 19.2 6.9" />
    </Glyph>
  );
}

export function ArchiveIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3" y="4" width="18" height="4.4" rx="1.1" />
      <path d="M4.8 8.4v9.8a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8V8.4" />
      <path d="M10 12.4h4" />
    </Glyph>
  );
}

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

export function ResetIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M2.5 5.1v5.2h5.2" />
      <path d="M4.6 14.6a7.8 7.8 0 1 0 1.9-8.1L2.5 10.3" />
    </Glyph>
  );
}

export function CloseIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5.2 5.2 18.8 18.8" />
      <path d="M18.8 5.2 5.2 18.8" />
    </Glyph>
  );
}

export function EllipsisIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function BackIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m14.6 5.8-6.2 6.2 6.2 6.2" />
    </Glyph>
  );
}

export function ForwardIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

export function ArrowLeftIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M19 12H5" />
      <path d="m11.6 5.4-6.6 6.6 6.6 6.6" />
    </Glyph>
  );
}

export function ArrowRightIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M5 12h14" />
      <path d="m12.4 5.4 6.6 6.6-6.6 6.6" />
    </Glyph>
  );
}

export function ArrowUpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 19V5" />
      <path d="m5.4 11.6 6.6-6.6 6.6 6.6" />
    </Glyph>
  );
}

export function ArrowDownIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 5v14" />
      <path d="m5.4 12.4 6.6 6.6 6.6-6.6" />
    </Glyph>
  );
}

export function SpeakerIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M4 9.4h2.9L11.6 5v14L6.9 14.6H4Z" />
      <path d="M14.8 9.3a4.1 4.1 0 0 1 0 5.4" />
      <path d="M17.6 6.9a7.6 7.6 0 0 1 0 10.2" />
    </Glyph>
  );
}

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

export function DownloadIcon(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M12 4.2v9.6" />
      <path d="m7.6 10 4.4 4.4L16.4 10" />
      <path d="M4.8 19.2h14.4" />
    </Glyph>
  );
}

export function UpdateIcon(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 16.2V7.8" />
      <path d="m8.4 11.4 3.6-3.6 3.6 3.6" />
    </Glyph>
  );
}

export function ArrowUpRightIcon(): React.JSX.Element {
  return (
    <Glyph className="ui-text-link-out ms-[0.12em] inline-block size-[0.78em] align-[-0.02em] opacity-55 transition-opacity duration-(--ui-duration-hover) ease-motion-exit group-hover/text-link:opacity-100 group-focus-visible/text-link:opacity-100">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </Glyph>
  );
}

export function ExternalIcon(): React.JSX.Element {
  return (
    <Glyph className="link-icon">
      <path d="M9.4 4.6H5.2A1.6 1.6 0 0 0 3.6 6.2v12.6a1.6 1.6 0 0 0 1.6 1.6h12.6a1.6 1.6 0 0 0 1.6-1.6v-4.2" />
      <path d="M14 3.6h6.4V10" />
      <path d="M10.4 13.6 20.1 3.9" />
    </Glyph>
  );
}

export function UserIcon(): React.JSX.Element {
  return (
    <Glyph>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5.4 19.8a6.6 6.6 0 0 1 13.2 0" />
    </Glyph>
  );
}

export function SearchIcon(): React.JSX.Element {
  return (
    <Glyph className="search-glyph">
      <circle cx="10.6" cy="10.6" r="6.1" />
      <path d="M15.2 15.2L20.2 20.2" />
    </Glyph>
  );
}

export function LaptopIcon(): React.JSX.Element {
  return (
    <Glyph className="filter-icon">
      <rect x="4.2" y="5.4" width="15.6" height="10.4" rx="1.7" />
      <path d="M2.4 18.8h19.2" />
    </Glyph>
  );
}

export function MicrophoneIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="9.2" y="2.6" width="5.6" height="10.6" rx="2.8" />
      <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.8V21" />
    </Glyph>
  );
}

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

export function ImageIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" />
      <circle cx="8.6" cy="9.6" r="1.6" />
      <path d="m3.8 17.4 4.8-4.6 3.4 3.2 3.6-3.6 4.8 4.6" />
    </Glyph>
  );
}

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

export function PlusIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 5.4v13.2" />
      <path d="M5.4 12h13.2" />
    </Glyph>
  );
}

export function McpIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M2.44 11.45l8.92-8.92c1.23-1.23 3.23-1.23 4.46 0 1.23 1.23 1.23 3.23 0 4.46l-6.73 6.73" />
      <path d="M9.18 13.63l6.64-6.64c1.23-1.23 3.23-1.23 4.46 0l.05.05c1.23 1.23 1.23 3.23 0 4.46l-8.06 8.06c-.41.41-.41 1.08 0 1.49l1.66 1.66" />
      <path d="M13.59 4.76 7 11.35c-1.23 1.23-1.23 3.23 0 4.46 1.23 1.23 3.23 1.23 4.46 0l6.59-6.59" />
    </Glyph>
  );
}

export function SidePanelIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.6" />
      <path d="M14.6 4.6v14.8" />
    </Glyph>
  );
}

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

export function SidebarIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="2.6" />
      <path d="M9.4 4.6v14.8" />
    </Glyph>
  );
}

export function ComposeIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M11.2 4.6H6a2.6 2.6 0 0 0-2.6 2.6v10.6A2.6 2.6 0 0 0 6 20.4h10.6a2.6 2.6 0 0 0 2.6-2.6v-5.2" />
      <path d="M17.5 3.9a2 2 0 0 1 2.8 2.8l-7.6 7.6-3.6.8.8-3.6z" />
    </Glyph>
  );
}

export function GearIcon(): React.JSX.Element {
  return (
    <Glyph className="gear-glyph">
      <path d="M10.4 5.3L10.8 2.8L13.2 2.8L13.6 5.3A6.9 6.9 0 0 1 15.7 6.1L17.7 4.6L19.4 6.3L17.9 8.3A6.9 6.9 0 0 1 18.7 10.4L21.2 10.8L21.2 13.2L18.7 13.6A6.9 6.9 0 0 1 17.9 15.7L19.4 17.7L17.7 19.4L15.7 17.9A6.9 6.9 0 0 1 13.6 18.7L13.2 21.2L10.8 21.2L10.4 18.7A6.9 6.9 0 0 1 8.3 17.9L6.3 19.4L4.6 17.7L6.1 15.7A6.9 6.9 0 0 1 5.3 13.6L2.8 13.2L2.8 10.8L5.3 10.4A6.9 6.9 0 0 1 6.1 8.3L4.6 6.3L6.3 4.6L8.3 6.1A6.9 6.9 0 0 1 10.4 5.3Z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  );
}

export function TerminalIcon(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.4" />
      <path d="m7 9.2 3.2 2.8L7 14.8" />
      <path d="M12.6 14.8h4.2" />
    </Glyph>
  );
}

export function MemoryIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M12 3.6a5.4 5.4 0 0 0-3.2 9.8c.7.5 1.1 1.3 1.1 2.1v1.5h4.2v-1.5c0-.8.4-1.6 1.1-2.1A5.4 5.4 0 0 0 12 3.6Z" />
      <path d="M9.9 19.6h4.2" />
    </Glyph>
  );
}

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

export function FolderIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M3.6 7.2a2 2 0 0 1 2-2h3.7l2 2.2h7.1a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z" />
    </Glyph>
  );
}

export function PlayIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M8 5.6v12.8l10-6.4z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function PauseIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="6.4" y="5.6" width="4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.6" y="5.6" width="4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function PreviousFrameIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="5.6" y="6.4" width="2.4" height="11.2" rx="1" fill="currentColor" stroke="none" />
      <path d="M18 6.4v11.2l-8.8-5.6z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function NextFrameIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M6 6.4v11.2l8.8-5.6z" fill="currentColor" stroke="none" />
      <rect x="16" y="6.4" width="2.4" height="11.2" rx="1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function RewindIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M11.6 6.4v11.2L3.2 12z" fill="currentColor" stroke="none" />
      <path d="M20.4 6.4v11.2L12 12z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function FastForwardIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <path d="M3.6 6.4v11.2L12 12z" fill="currentColor" stroke="none" />
      <path d="M12.4 6.4v11.2l8.4-5.6z" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

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

export function StopIcon(): React.JSX.Element {
  return (
    <Glyph className="control-icon">
      <rect x="6" y="6" width="12" height="12" rx="1.8" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

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

export function ChevronDownIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m5.8 9.4 6.2 6.2 6.2-6.2" />
    </Glyph>
  );
}

export function FoldChevronIcon(): React.JSX.Element {
  return (
    <Glyph className="ui-disclosure-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}

export function CodeIcon(): React.JSX.Element {
  return (
    <Glyph className="icon-button-glyph">
      <path d="M8.2 7.4 3.6 12l4.6 4.6" />
      <path d="M15.8 7.4 20.4 12l-4.6 4.6" />
      <path d="M13.6 5 10.4 19" />
    </Glyph>
  );
}

export function ChevronRightIcon(): React.JSX.Element {
  return (
    <Glyph className="settings-chevron">
      <path d="m9.4 5.8 6.2 6.2-6.2 6.2" />
    </Glyph>
  );
}
