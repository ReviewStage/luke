interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalProps {
  readonly onInput: (data: string) => void;
  readonly onResize: (size: TerminalSize) => void;
  readonly onLink: (url: string) => void;
}

export const TERMINAL_FIND = {
  NEXT: "next",
  PREVIOUS: "previous",
  TYPED: "typed",
} as const;

export type TerminalFindWay = (typeof TERMINAL_FIND)[keyof typeof TERMINAL_FIND];

interface TerminalFindTally {
  readonly count: number;
  readonly at: number;
  readonly more: boolean;
}

export interface TerminalFind {
  readonly find: (query: string, way: TerminalFindWay) => void;
  readonly clear: () => void;
  readonly onTally: (listener: (tally: TerminalFindTally) => void) => () => void;
  readonly selection: () => string;
}

export interface TerminalHandle {
  readonly write: (data: string | Uint8Array, written: () => void) => void;
  readonly size: () => TerminalSize;
  readonly focus: () => void;
  readonly reset: () => void;
  readonly find: TerminalFind;
  readonly unmount: () => void;
}

export interface TerminalModule {
  readonly mount: (host: HTMLElement, props: TerminalProps) => TerminalHandle;
}
