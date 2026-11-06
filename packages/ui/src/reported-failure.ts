import type { ReactNode } from "react";

export interface ReportedFailure {
  readonly shown: () => string | undefined;
  readonly hidden: () => void;
  readonly copy: (text: string) => Promise<void>;
}

export const UNREPORTED = {
  INPUT: "input",
  TOOL: "tool",
  NO_REPORTER: "no-reporter",
} as const;

export type Unreported = (typeof UNREPORTED)[keyof typeof UNREPORTED];

export interface ShownError {
  readonly words: ReactNode;
  readonly failure: ReportedFailure | Unreported;
}

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

export function inputProblem(words: ReactNode): ShownError | undefined {
  return said(words) ? { words, failure: UNREPORTED.INPUT } : undefined;
}

export function isReported(
  failure: ReportedFailure | Unreported | undefined,
): failure is ReportedFailure {
  return typeof failure === "object";
}
