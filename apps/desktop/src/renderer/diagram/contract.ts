/**
 * contract.ts -- what the panel and the diagram bundle say to each other: the one draw call, and the appearances and answers it speaks in.
 *
 * Mermaid is too large for the bundle every window parses, so it ships as a
 * bundle of its own (`diagram.js`, built from `./index.ts`) that the panel
 * loads the first time a plan shows a ```` ```mermaid ```` fence
 * (`../plan-diagram.tsx`). Unlike the other bundles it is an ES module with
 * its diagram types split into chunks of their own, because Mermaid reaches
 * each type through a dynamic import, which a single script would inline
 * whole; so a flowchart loads the flowchart's chunk and no other. That
 * bundle sets one global, `window.lukeDiagram`, and this file is the whole of
 * what the two share. Nothing here imports a value, so the panel carries none
 * of Mermaid.
 */

/** The window's appearance a diagram is drawn in, as the system's `prefers-color-scheme` says. */
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

/** What the diagram bundle sets on `window` once it has loaded. */
export interface DiagramModule {
  /** A fence's code drawn in an appearance; never a rejection. */
  readonly draw: (code: string, appearance: DiagramAppearance) => Promise<DiagramDrawing>;
}

declare global {
  interface Window {
    lukeDiagram?: DiagramModule;
  }
}

/** The file the diagram bundle's entry is, beside `index.html`; its chunks stand in `diagram/`. */
export const DIAGRAM_ASSET = { SCRIPT: "diagram.js" } as const;

/** The diagram bundle as its script set it on `window`; nothing before the script has run. */
export function diagramModuleNow(): DiagramModule | undefined {
  return window.lukeDiagram;
}
