import type { ReactNode, Ref } from "react";

export const TOOLBAR_INSET = {
  PAGE: "page",
  COLUMN: "column",
} as const;

export type ToolbarInset = (typeof TOOLBAR_INSET)[keyof typeof TOOLBAR_INSET];

export const TOOLBAR_LOOK = {
  WINDOW: "window",
  PHONE: "phone",
  TABS: "tabs",
} as const;

export type ToolbarLook = (typeof TOOLBAR_LOOK)[keyof typeof TOOLBAR_LOOK];

export function ToolbarFrame({
  start = TOOLBAR_INSET.PAGE,
  end = TOOLBAR_INSET.PAGE,
  look = TOOLBAR_LOOK.WINDOW,
  place,
  measure = false,
  folded = false,
  wrapHeading = false,
  wrapped = false,
  frameRef,
  children,
}: {
  start?: ToolbarInset | undefined;
  end?: ToolbarInset | undefined;
  look?: ToolbarLook | undefined;
  place?: string | undefined;
  measure?: boolean | undefined;
  folded?: boolean | undefined;
  wrapHeading?: boolean | undefined;
  wrapped?: boolean | undefined;
  frameRef?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <header
      ref={frameRef}
      className={place === undefined ? "ui-toolbar" : `ui-toolbar ${place}-head`}
      data-start={start}
      data-end={end}
      data-look={look}
      data-measure={measure ? "true" : undefined}
      data-folded={folded ? "true" : undefined}
      data-wrap-heading={wrapHeading ? "true" : undefined}
      data-wrapped={wrapped ? "true" : undefined}
    >
      {children}
    </header>
  );
}
