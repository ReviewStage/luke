import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

export function OptionsIcon(): React.JSX.Element {
  return (
    <svg
      className="options-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.6 8.4h5.2" />
      <path d="M13.2 8.4h7.2" />
      <circle cx="11" cy="8.4" r="2.2" />
      <path d="M3.6 15.6h2.6" />
      <path d="M10.6 15.6h9.8" />
      <circle cx="8.4" cy="15.6" r="2.2" />
    </svg>
  );
}

export function BranchGlyph(): React.JSX.Element {
  return (
    <svg className="row-branch-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="4.2" cy="3.4" r="1.55" />
        <circle cx="4.2" cy="12.6" r="1.55" />
        <circle cx="11.8" cy="5.2" r="1.55" />
        <path d="M4.2 5v6M11.8 6.9c0 2.5-2.6 3-5.4 3.4" />
      </g>
    </svg>
  );
}

export function CheckGlyph(): React.JSX.Element {
  return (
    <svg className="row-check" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d="M2.4 6.6l2.5 2.5 4.7-5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
