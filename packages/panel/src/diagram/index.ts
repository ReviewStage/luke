import {
  DIAGRAM_APPEARANCE,
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
  type DiagramModule,
} from "@luke/ui/diagram-contract";
import mermaid, { type MermaidConfig } from "mermaid";

/**
 * index.ts -- the diagram bundle: Mermaid drawing a plan's fence as a picture the panel's policy admits, imported by the panel (`@luke/ui/diagram-contract`).
 *
 * The panel's policy is `style-src 'self'` (`../index.html`), and Mermaid's
 * SVG carries its theme in a `<style>` element, which the policy refuses:
 * put in the page, every node draws black. So the SVG is drawn as an
 * `<img>` from a `data:` address instead, a document of its own whose style
 * applies inside it. Mermaid measures each label in the page as it lays the
 * diagram out, where that same style was refused, so the label's box is
 * measured in the wrong type and its words clip. So each diagram is laid out
 * twice: once to read its stylesheet, which is then adopted as a constructed
 * sheet (CSSOM, which the policy admits, as the terminal's are), and again
 * under it, so the second layout measures in the type it draws in; the sheet
 * is let go once the picture is taken.
 *
 * `securityLevel: "strict"` drops Mermaid's click handlers and sanitizes its
 * labels, and an `<img>` runs nothing in any case. Draws run one at a time,
 * because Mermaid's configuration is global and a draw in the other
 * appearance must not land between a draw's two layouts.
 */

/** The window's own type, as `styles/base.css` sets it, so a label reads as the words around it. */
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';

/**
 * Mermaid's colours in each appearance, from the window's tokens
 * (`styles/base.css`), made opaque over the section's fill a diagram is drawn
 * on, since Mermaid derives its shades from a colour it can mix: the
 * primary ink for words, the secondary ink for lines and arrows, the
 * strong hairline for a box's edge, and the section's fill a step raised
 * for a box's ground.
 */
const THEME_VARIABLES = {
  [DIAGRAM_APPEARANCE.LIGHT]: {
    darkMode: false,
    background: "transparent",
    primaryColor: "#ffffff",
    primaryBorderColor: "#c9c9cf",
    primaryTextColor: "#1f1f1f",
    secondaryColor: "#f5f5f6",
    tertiaryColor: "#f5f5f6",
    lineColor: "#8a8a92",
    textColor: "#1f1f1f",
    actorBkg: "#ffffff",
    actorBorder: "#c9c9cf",
    actorTextColor: "#1f1f1f",
    signalColor: "#666666",
    signalTextColor: "#1f1f1f",
    noteBkgColor: "#f5f5f6",
    noteBorderColor: "#c9c9cf",
    noteTextColor: "#1f1f1f",
    edgeLabelBackground: "#f5f5f6",
    clusterBkg: "#fafafa",
    clusterBorder: "#dcdce0",
    fontSize: "14px",
  },
  [DIAGRAM_APPEARANCE.DARK]: {
    darkMode: true,
    background: "transparent",
    primaryColor: "#2c2c30",
    primaryBorderColor: "#55555c",
    primaryTextColor: "#f2f2f3",
    secondaryColor: "#333338",
    tertiaryColor: "#26262a",
    lineColor: "#8e8e96",
    textColor: "#f2f2f3",
    actorBkg: "#2c2c30",
    actorBorder: "#55555c",
    actorTextColor: "#f2f2f3",
    signalColor: "#a3a3a8",
    signalTextColor: "#f2f2f3",
    noteBkgColor: "#3a3a3f",
    noteBorderColor: "#55555c",
    noteTextColor: "#f2f2f3",
    edgeLabelBackground: "#1e1e21",
    clusterBkg: "#232326",
    clusterBorder: "#46464c",
    fontSize: "14px",
  },
} as const satisfies Record<DiagramAppearance, MermaidConfig["themeVariables"]>;

/** What a refused fence answers. */
const REFUSED: DiagramDrawing = { kind: DIAGRAM_DRAWING.REFUSED };

/** Mermaid's configuration in an appearance. */
function configIn(appearance: DiagramAppearance): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    fontFamily: FONT_FAMILY,
    themeVariables: THEME_VARIABLES[appearance],
    sequence: { mirrorActors: false },
  };
}

/** The last draw, which the next one waits behind. */
let drawing: Promise<unknown> = Promise.resolve();

/** How many diagrams this window has laid out, which names each layout's element apart. */
let laidOut = 0;

/** Text as base64, by its UTF-8 bytes, as a `data:` address carries it. */
function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** An SVG Mermaid drew, parsed. */
function parsedSvg(svg: string): SVGSVGElement | undefined {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  return root instanceof SVGSVGElement ? root : undefined;
}

/**
 * The picture's address: the SVG given its own size off its view box, since
 * Mermaid draws it 100% wide, which as an `<img>` would stretch a small
 * diagram across the column; the stylesheet holds it to the column.
 */
function pictureOf(svg: SVGSVGElement): string {
  const [, , width, height] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/u).map(Number);
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }
  return `data:image/svg+xml;base64,${base64(new XMLSerializer().serializeToString(svg))}`;
}

/** One fence laid out twice, the second time under the first's stylesheet, and taken as a picture. */
async function drawnNow(code: string, appearance: DiagramAppearance): Promise<DiagramDrawing> {
  mermaid.initialize(configIn(appearance));
  if ((await mermaid.parse(code, { suppressErrors: true })) === false) return REFUSED;
  laidOut += 1;
  const id = `plan-diagram-${laidOut}`;
  const first = parsedSvg((await mermaid.render(id, code)).svg);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(first?.querySelector("style")?.textContent ?? "");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  try {
    const drawn = parsedSvg((await mermaid.render(id, code)).svg);
    return drawn === undefined ? REFUSED : { kind: DIAGRAM_DRAWING.DRAWN, url: pictureOf(drawn) };
  } finally {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet);
  }
}

/** A fence drawn once every draw before it has finished; anything Mermaid throws is a refusal. */
function draw(code: string, appearance: DiagramAppearance): Promise<DiagramDrawing> {
  const drawn = drawing.then(() => drawnNow(code, appearance)).catch(() => REFUSED);
  drawing = drawn;
  return drawn;
}

export const diagram: DiagramModule = { draw };
