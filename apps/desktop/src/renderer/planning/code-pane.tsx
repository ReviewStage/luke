import type { PlanCode } from "@sidecar/hosted/planning-view";
import { useEffect, useRef } from "react";
import { isPointed, rangeLabel, unreadableLine } from "./code-pane-model";

/**
 * code-pane.tsx -- the code Luke puts on screen during a planning call: the side panel's Code tab, showing the lines he is talking about.
 *
 * Luke names a file of the plan's folder and the lines that matter as he
 * starts to speak about them; the host reads them from the folder and
 * colours them, and the pane draws them numbered from where they sit in the
 * file, the lines he means lit and scrolled into view.
 */

/**
 * Scrolls `lines` alone until `target` stands in its middle. Note that this is
 * not `scrollIntoView`, because that scrolls every box around the line as
 * well, and the pane often arrives sliding in from past the window's edge, so
 * the window's own layout would be scrolled sideways after it.
 */
function centreWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  lines.scrollTop += line.top + line.height / 2 - (box.top + box.height / 2);
}

/** The file's window of lines, the lines pointed at lit and scrolled into view whenever they change. */
function CodeLines({ code }: { code: PlanCode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const first = code.firstLine ?? 1;
  const { path, startLine, endLine } = code.ref;

  useEffect(() => {
    const lines = scroller.current;
    const target = lines?.querySelector<HTMLElement>("[data-pointed='true']");
    if (lines && target) centreWithin(lines, target);
  }, [path, startLine, endLine]);

  return (
    <div className="code-lines" ref={scroller}>
      {(code.lines ?? []).map((tokens, index) => {
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
                <span
                  key={at}
                  style={token.color === undefined ? undefined : { color: token.color }}
                >
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

/** The pane: a heading naming the file and the lines pointed at, over the lines, or why none were drawn. */
export function CodePane({ code }: { code: PlanCode }): React.JSX.Element {
  const unreadable = unreadableLine(code);
  const label = rangeLabel(code.ref);

  return (
    <section className="code-pane" aria-label="Code on screen">
      <header className="code-pane-header">
        <span className="code-pane-path">{code.ref.path}</span>
        {label === undefined ? null : <span className="code-pane-range">{label}</span>}
      </header>
      {unreadable !== undefined ? (
        <p className="code-pane-note" role="alert">
          {unreadable}
        </p>
      ) : (
        <CodeLines code={code} />
      )}
    </section>
  );
}
