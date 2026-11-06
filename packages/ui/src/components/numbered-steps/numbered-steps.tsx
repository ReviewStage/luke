import type { ReactNode } from "react";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { LEAD_ROW, LEAD_SLOT, LEAD_WORDS } from "./lead-row.js";

const NUMBER =
  "ui-numbered-step-number inline-flex size-ui-20 flex-none items-center justify-center rounded-full bg-well text-caption text-muted-foreground tabular-nums";

export function NumberedSteps({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <ol className="ui-numbered-steps flex list-none flex-col gap-block-gap p-0 m-0">{children}</ol>
  );
}

export function NumberedStep({
  number,
  title,
  children,
}: {
  number: number;
  title: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <li className={`ui-numbered-step ${LEAD_ROW}`}>
      <span className={LEAD_SLOT} aria-hidden="true">
        <span className={NUMBER}>{number}</span>
      </span>
      <div className={LEAD_WORDS}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL}>
          {title}
        </Text>
        {children}
      </div>
    </li>
  );
}
