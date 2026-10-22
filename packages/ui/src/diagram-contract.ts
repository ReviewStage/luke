/**
 * diagram-contract.ts -- what the panel and the diagram bundle say to each other: the one draw call, and the appearances and answers it speaks in.
 *
 * Mermaid is too large for the bundle every window parses, so it ships as a
 * bundle of its own (`diagram.js`, built from
 * `apps/desktop/src/renderer/diagram/index.ts`) that the panel imports the
 * first time a plan shows a ```` ```mermaid ```` fence
 * (`apps/desktop/src/renderer/plan-diagram.tsx`). Mermaid reaches each
 * diagram type through a dynamic import of its own, so a flowchart loads the
 * flowchart's chunk and no other. That bundle exports one module, `diagram`,
 * and this file is the whole of what the two share. Nothing here imports a
 * value, so the panel carries none of Mermaid.
 */

/** The window's appearance a diagram is drawn in, as its root's theme says (`tokens/appearance.ts`). */
export const DIAGRAM_APPEARANCE = {
  LIGHT: "light",
  DARK: "dark",
} as const;

export type DiagramAppearance = (typeof DIAGRAM_APPEARANCE)[keyof typeof DIAGRAM_APPEARANCE];

/** How a draw ended: a picture, or code Mermaid refused. */
export const DIAGRAM_DRAWING = {
  DRAWN: "drawn",
  REFUSED: "refused",
} as const;

/**
 * A diagram as drawn: its picture as a `data:image/svg+xml` address, drawn
 * as an `<img>` because the panel's policy refuses the `<style>` Mermaid's
 * SVG carries; or the code refused, which the panel shows as its code.
 */
export type DiagramDrawing =
  | { readonly kind: typeof DIAGRAM_DRAWING.DRAWN; readonly url: string }
  | { readonly kind: typeof DIAGRAM_DRAWING.REFUSED };

/** What the diagram bundle's entry exports, which the panel imports the first time a fence is drawn. */
export interface DiagramModule {
  /** A fence's code drawn in an appearance; never a rejection. */
  readonly draw: (code: string, appearance: DiagramAppearance) => Promise<DiagramDrawing>;
}
