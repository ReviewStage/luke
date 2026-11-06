import type { ReactNode } from "react";

export function MessageHead({
  sender,
  children,
}: {
  sender: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-message-head flex min-w-0 max-w-full flex-wrap items-baseline gap-x-ui-4 gap-y-ui-2 px-ui-4 text-caption-inline text-muted-foreground">
      <span className="ui-message-head-sender flex min-w-0 max-w-full items-center">{sender}</span>
      {children == null ? null : (
        <span className="flex min-w-0 max-w-full items-center">{children}</span>
      )}
    </div>
  );
}
