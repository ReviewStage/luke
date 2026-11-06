import type { ComponentProps, ReactNode } from "react";
import { FIND_SKIP_ATTRIBUTE } from "../../find-skip.js";
import { REPLAY_LEFT_OUT } from "../../session-replay-marks.js";

export type ShimmerProps = Omit<ComponentProps<"span">, "children" | "className"> & {
  children: string;
};

export function Shimmer({ children, style, ...props }: ShimmerProps): ReactNode {
  return (
    <span className="ui-shimmer-frame" style={style}>
      <span className="ui-shimmer" {...props}>
        {children}
      </span>
      <span
        className={`ui-shimmer-light ${REPLAY_LEFT_OUT}`}
        aria-hidden="true"
        {...{ [FIND_SKIP_ATTRIBUTE]: "" }}
      >
        <span className="ui-shimmer-light-words">{children}</span>
      </span>
    </span>
  );
}
