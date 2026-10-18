import type { ComponentProps, ReactNode } from "react";

/**
 * shimmer.tsx -- AI Elements' Shimmer: a line of words with a light passing along it, for work still under way.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens. The registry animates the gradient on `motion`, on a
 * timing of the library's own; here the light is one CSS loop
 * (`.shimmer`, in styles/tasks.css) whose play state
 * answers `--loop-motion`, so a capture run and reduced motion hold it
 * still as they hold every other endless loop (docs/DESIGN.md). The words
 * are drawn in the muted gray with the highlight in the foreground, so the
 * line reads as quiet as a status and never as a reply.
 */

export type ShimmerProps = Omit<ComponentProps<"span">, "children" | "className"> & {
  children: string;
};

export function Shimmer({ children, ...props }: ShimmerProps): ReactNode {
  return (
    <span className="shimmer" {...props}>
      {children}
    </span>
  );
}
