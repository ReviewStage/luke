import type { ReactNode } from "react";

export function TabNotice({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-tab-notice flex items-center gap-control-gap border-b border-border px-list-inset py-row-inset text-caption text-muted-foreground [.ui-code-card>&]:border-b-0 [&>p]:m-0 [&>p]:flex-1">
      {children}
    </div>
  );
}
