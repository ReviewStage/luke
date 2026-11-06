import type { ReactNode } from "react";

export const PAGE_FRAME = {
  PAGE: "page",
  TOOLBAR: "toolbar",
} as const;

export type PageFrame = (typeof PAGE_FRAME)[keyof typeof PAGE_FRAME];

export const PAGE_WIDTH = {
  MEASURE: "measure",
  FULL: "full",
} as const;

export type PageWidth = (typeof PAGE_WIDTH)[keyof typeof PAGE_WIDTH];

type HeadedByPage = {
  frame: typeof PAGE_FRAME.PAGE;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  toolbar?: never;
  label?: never;
};

type HeadedByToolbar = {
  frame: typeof PAGE_FRAME.TOOLBAR;
  toolbar?: ReactNode;
  label: string;
  title?: never;
  description?: never;
  actions?: never;
};

export type PageHeading = (HeadedByPage | HeadedByToolbar) & { width?: PageWidth };
