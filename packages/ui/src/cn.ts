import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn.ts -- the class-name joiner every Tailwind-written component is written against.
 *
 * What the shadcn registry's `@/lib/utils` is: conditional classes joined,
 * then merged so a caller's `className` wins over a component's own
 * utility for the same property. The desktop's AI Elements components and
 * the site's chart both call it.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
