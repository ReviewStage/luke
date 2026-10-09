import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * shimmer.tsx -- AI Elements' Shimmer: a line of words with a light passing along it, for work still under way.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens. The registry animates the gradient on `motion`, on a
 * timing of the library's own; here the light is one CSS loop
 * (`animate-shimmer`, declared in styles/tailwind.css) whose play state
 * answers `--loop-motion`, so a capture run and reduced motion hold it
 * still as they hold every other endless loop (docs/DESIGN.md). The words
 * are drawn in the muted gray with the highlight in the foreground, so the
 * line reads as quiet as a status and never as a reply.
 */

export type ShimmerProps = Omit<ComponentProps<"span">, "children"> & {
  children: string;
};

export function Shimmer({ className, children, ...props }: ShimmerProps): ReactNode {
  return (
    <span
      className={cn(
        "inline-block animate-shimmer bg-[length:300%_100%] bg-clip-text text-transparent [animation-play-state:var(--loop-motion)] [background-image:linear-gradient(90deg,var(--color-muted-foreground)_0%,var(--color-muted-foreground)_40%,var(--color-foreground)_50%,var(--color-muted-foreground)_60%,var(--color-muted-foreground)_100%)]",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
