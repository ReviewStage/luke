import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * utils.ts -- the class-name joiner the AI Elements components are written against.
 *
 * What the shadcn registry's `@/lib/utils` is: conditional classes joined,
 * then merged so a caller's `className` wins over a component's own
 * utility for the same property.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
