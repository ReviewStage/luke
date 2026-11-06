export const DIAGRAM_APPEARANCE = {
  LIGHT: "light",
  DARK: "dark",
} as const;

export type DiagramAppearance = (typeof DIAGRAM_APPEARANCE)[keyof typeof DIAGRAM_APPEARANCE];

export const DIAGRAM_DRAWING = {
  DRAWN: "drawn",
  REFUSED: "refused",
} as const;

export type DiagramDrawing =
  | { readonly kind: typeof DIAGRAM_DRAWING.DRAWN; readonly url: string }
  | { readonly kind: typeof DIAGRAM_DRAWING.REFUSED };

export interface DiagramModule {
  readonly draw: (code: string, appearance: DiagramAppearance) => Promise<DiagramDrawing>;
}
