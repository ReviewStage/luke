import type { ElementType, ReactNode } from "react";
import { cn } from "./utils";

/**
 * shimmer.tsx -- AI Elements' Shimmer: text that a light sweeps across while the work it names is under way.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) with its
 * sweep moved from `motion` to a CSS animation (`.ai-shimmer` in
 * planning.css), as Stage has it, so the renderer carries no animation
 * library and the sweep stops with every other loop on `--loop-motion`.
 */

export type ShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
};

export function Shimmer({ children, as: Component = "span", className }: ShimmerProps): ReactNode {
  return <Component className={cn("ai-shimmer inline-block", className)}>{children}</Component>;
}
