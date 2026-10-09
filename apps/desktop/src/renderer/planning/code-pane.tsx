import type { PlanCode } from "@sidecar/hosted/planning-view";
import { useEffect, useRef } from "react";
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

/** The file's window of lines, the lines pointed at lit and scrolled into view whenever they change. */
function CodeLines({ code }: { code: PlanCode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const first = code.firstLine;
  const { path, startLine, endLine } = code.ref;

  useEffect(() => {
    const target = scroller.current?.querySelector<HTMLElement>("[data-pointed='true']");
    target?.scrollIntoView({ block: "center" });
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
