import { AttentionMark, BANNER_LOOK, Banner, BUTTON_VARIANT, Button, STATUS_TONE } from "@repo/ui";
import type { ReactNode } from "react";

interface TaskBannerAction {
  readonly label: ReactNode;
  readonly onPress: () => void;
}

export function TaskBanner({
  children,
  action,
}: {
  children: ReactNode;
  action: TaskBannerAction;
}): React.JSX.Element {
  return (
    <Banner
      look={BANNER_LOOK.STRIP}
      tone={STATUS_TONE.ATTENTION}
      glyph={<AttentionMark />}
      actions={
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={action.onPress}>
          {action.label}
        </Button>
      }
    >
      <span className="task-banner-words">{children}</span>
    </Banner>
  );
}
