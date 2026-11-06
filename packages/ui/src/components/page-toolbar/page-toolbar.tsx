import type { ReactNode } from "react";
import { ToolbarFrame, type ToolbarInset } from "../toolbar/toolbar-frame.js";

export function PageToolbar({
  lead,
  heading,
  actions,
  start,
}: {
  lead?: ReactNode;
  heading?: ReactNode;
  actions?: ReactNode;
  start?: ToolbarInset | undefined;
}): React.JSX.Element {
  return (
    <ToolbarFrame start={start}>
      {lead}
      {heading === undefined ? null : <div className="ui-toolbar-heading">{heading}</div>}
      {actions === undefined ? null : <div className="ui-toolbar-actions">{actions}</div>}
    </ToolbarFrame>
  );
}
