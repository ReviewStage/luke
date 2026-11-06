import {
  DIAGRAM_DRAWING,
  type DiagramAppearance,
  type DiagramDrawing,
  type DiagramModule,
} from "@repo/ui/diagram-contract";
import { writeWithheldSheet } from "@repo/ui/session-replay-marks";
import mermaid, { type MermaidConfig } from "mermaid";
import { diagramThemeVariables } from "./diagram-theme.js";

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';

const FONT_SIZE = "14px";

const REFUSED: DiagramDrawing = { kind: DIAGRAM_DRAWING.REFUSED };

function configIn(appearance: DiagramAppearance): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    fontFamily: FONT_FAMILY,
    themeVariables: {
      ...diagramThemeVariables(appearance),
      background: "transparent",
      fontSize: FONT_SIZE,
    },
    sequence: { mirrorActors: false },
  };
}

let drawing: Promise<unknown> = Promise.resolve();

let laidOut = 0;

function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parsedSvg(svg: string): SVGSVGElement | undefined {
  const root = new DOMParser().parseFromString(svg, "text/html").body.firstElementChild;
  return root instanceof SVGSVGElement ? root : undefined;
}

function pictureOf(svg: SVGSVGElement): string {
  const [, , width, height] = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/u).map(Number);
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
  }
  return `data:image/svg+xml;base64,${base64(new XMLSerializer().serializeToString(svg))}`;
}

async function laidOutIn(scratch: HTMLElement, id: string, code: string): Promise<DiagramDrawing> {
  const first = parsedSvg((await mermaid.render(id, code, scratch)).svg);
  const sheet = new CSSStyleSheet();
  writeWithheldSheet(sheet, first?.querySelector("style")?.textContent ?? "");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  try {
    const drawn = parsedSvg((await mermaid.render(id, code, scratch)).svg);
    return drawn === undefined ? REFUSED : { kind: DIAGRAM_DRAWING.DRAWN, url: pictureOf(drawn) };
  } finally {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((each) => each !== sheet);
  }
}

async function drawnNow(code: string, appearance: DiagramAppearance): Promise<DiagramDrawing> {
  mermaid.initialize(configIn(appearance));
  if ((await mermaid.parse(code, { suppressErrors: true })) === false) return REFUSED;
  laidOut += 1;
  const scratch = document.createElement("div");
  scratch.className = "ph-no-capture";
  document.body.append(scratch);
  try {
    return await laidOutIn(scratch, `description-diagram-${laidOut}`, code);
  } finally {
    scratch.remove();
  }
}

function draw(code: string, appearance: DiagramAppearance): Promise<DiagramDrawing> {
  const drawn = drawing.then(() => drawnNow(code, appearance)).catch(() => REFUSED);
  drawing = drawn;
  return drawn;
}

export const diagram: DiagramModule = { draw };
