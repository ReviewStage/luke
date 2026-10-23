import type { ComponentProps, ReactNode } from "react";

/**
 * shimmer.tsx -- a line of words with a light passing along it, for work still under way.
 *
 * After the AI Elements registry's Shimmer (https://elements.ai-sdk.dev),
 * restyled to Luke's tokens. The light is one CSS loop whose play state
 * answers `--luke-loop-motion`, so a capture run and reduced motion hold it
 * still as they hold every other endless loop. The words are drawn in the
 * muted gray with the highlight in the foreground, so the line reads as quiet
 * as a status and never as a reply.
 */

export type ShimmerProps = Omit<ComponentProps<"span">, "children" | "className"> & {
  children: string;
};

export function Shimmer({ children, ...props }: ShimmerProps): ReactNode {
  return (
    <span className="luke-shimmer" {...props}>
      {children}
    </span>
  );
}
