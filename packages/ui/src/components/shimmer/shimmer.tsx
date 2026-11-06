import type { ComponentProps, ReactNode } from "react";
import { FIND_SKIP_ATTRIBUTE } from "../../find-skip.js";

/**
 * shimmer.tsx -- a line of words with a light passing along it, for work still under way.
 *
 * After the AI Elements registry's Shimmer (https://elements.ai-sdk.dev),
 * restyled to our tokens. The words are drawn in the muted gray, and the
 * light is a second copy of them in the foreground, seen through a window
 * with soft edges that slides across them while the copy slides back the
 * same distance, so it stands over the words. The copy is hidden from a
 * reader and from a find over the page (`FIND_SKIP_ATTRIBUTE`), so the words
 * are heard and found once. Note that both slides are `transform` alone,
 * because the compositor runs those without the window's main thread, where
 * a light drawn as a moving background on clipped text repaints the line
 * every frame. The loop's play state answers `--ui-loop-motion`, so a
 * capture run and reduced motion hold it still, with the window off the
 * words, as they hold every other endless loop. The line reads as quiet as a
 * status and never as a reply.
 */

export type ShimmerProps = Omit<ComponentProps<"span">, "children" | "className"> & {
  children: string;
};

export function Shimmer({ children, ...props }: ShimmerProps): ReactNode {
  return (
    <span className="ui-shimmer-frame">
      <span className="ui-shimmer" {...props}>
        {children}
      </span>
      <span className="ui-shimmer-light" aria-hidden="true" {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
        <span className="ui-shimmer-light-words">{children}</span>
      </span>
    </span>
  );
}
