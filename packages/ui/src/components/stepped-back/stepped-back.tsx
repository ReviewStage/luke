import type { ReactNode } from "react";

export function SteppedBack({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-stepped-back" data-stepped-back="">
      {children}
    </div>
  );
}
