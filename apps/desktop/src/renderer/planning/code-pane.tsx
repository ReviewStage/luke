import type { CodeToken, PlanCode } from "@sidecar/hosted/planning-view";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { type CSSProperties, useEffect, useRef } from "react";
import { isPointed, rangeLabel } from "./code-pane-model";

/**
 * code-pane.tsx -- the code Luke puts on screen during a planning call: the side panel's Code tab, showing the lines he is talking about.
 *
 * Luke names a file of the plan's repository and the lines that matter as he
 * starts to speak about them; the service reads them from its checkout of
 * the repository, the host colours them, and the pane draws them numbered
 * from where they sit in the file, the lines he means lit and scrolled into
 * view, under the repository they came from.
 */

/**
 * Scrolls `lines` alone until `target` stands in its middle, read from the
 * lines' start, so lines pointed at are never left off to one side of a long
 * line scrolled along. Note that this is not `scrollIntoView`, because that
 * scrolls every box around the line as well, and the pane often arrives
 * sliding in from past the window's edge, so the window's own layout would be
 * scrolled sideways after it.
 */
function centreWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  lines.scrollTop += line.top + line.height / 2 - (box.top + box.height / 2);
  lines.scrollLeft = 0;
}

/**
 * A run's colour in each appearance, as the properties `planning.css` picks
 * between, so the code follows the appearance without being drawn again;
 * nothing for a run in the theme's own foreground.
 */
function runColours({ color, lightColor }: CodeToken): CSSProperties | undefined {
  if (color === undefined && lightColor === undefined) return undefined;
  const colours: Record<string, string> = {};
  if (color !== undefined) colours["--run-dark"] = color;
  if (lightColor !== undefined) colours["--run-light"] = lightColor;
  return cssCustomProperties(colours);
}

/** The file's window of lines, the lines pointed at lit and scrolled into view whenever they change. */
function CodeLines({ code }: { code: PlanCode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const first = code.firstLine;
  const { path, startLine, endLine } = code.ref;

  useEffect(() => {
    const lines = scroller.current;
    const target = lines?.querySelector<HTMLElement>("[data-pointed='true']");
    if (lines && target) centreWithin(lines, target);
  }, [path, startLine, endLine]);

  return (
    <div className="code-lines" ref={scroller}>
      {code.lines.map((tokens, index) => {
        const line = first + index;
        return (
          <div
            // Note that a line's place in the file is its identity: the window never reorders.
            key={line}
            className="code-line"
            data-pointed={String(isPointed(code.ref, line))}
          >
            <span className="code-line-number">{line}</span>
            <code className="code-line-text">
              {tokens.map((token, at) => (
                <span key={at} style={runColours(token)}>
                  {token.text}
                </span>
              ))}
            </code>
          </div>
        );
      })}
    </div>
  );
}

/** The pane: a heading naming the repository, the file, and the lines pointed at, over the lines. */
export function CodePane({ code }: { code: PlanCode }): React.JSX.Element {
  const label = rangeLabel(code.ref);

  return (
    <section className="code-pane ph-no-capture" aria-label="Code on screen">
      <header className="code-pane-header">
        <span className="code-pane-repository">{code.repository}</span>
        <span className="code-pane-path">{code.ref.path}</span>
        {label === undefined ? null : <span className="code-pane-range">{label}</span>}
      </header>
      <CodeLines code={code} />
    </section>
  );
}
