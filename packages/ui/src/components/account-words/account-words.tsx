import type { ReactNode } from "react";
import { OneLine } from "../one-line/one-line.js";

export function AccountWords({
  words,
  children,
}: {
  words?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <OneLine
      className="ui-account-words min-w-0 flex-[1_1_0] font-text text-muted-foreground"
      words={words}
    >
      {children}
    </OneLine>
  );
}
