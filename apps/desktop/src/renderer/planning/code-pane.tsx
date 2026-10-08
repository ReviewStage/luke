import type { PlanCode } from "@sidecar/hosted/planning-view";
import { useEffect, useRef, useState } from "react";
import { isPointed, rangeLabel, unreadableLine } from "./code-pane-model";

/**
 * code-pane.tsx -- the code Luke puts on screen during a planning call: a small window inside the Plans tab showing the lines he is talking about.
 *
 * Luke names a file of the plan's folder and the lines that matter as he
 * starts to speak about them; the host reads them from the folder and
 * colours them, and the pane draws them numbered from where they sit in the
 * file, the lines he means lit and scrolled into view. It folds to its
 * heading, and the next code Luke puts up opens it again.
 */

/** The file's window of lines, the lines pointed at lit and scrolled into view whenever they change. */
function CodeLines({ code }: { code: PlanCode }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const first = code.firstLine ?? 1;
  const { path, startLine, endLine } = code.ref;

  useEffect(() => {
    const target = scroller.current?.querySelector<HTMLElement>("[data-pointed='true']");
    target?.scrollIntoView({ block: "center" });
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
  // Note that the fold holds the code it was made over, so the next code Luke
  // puts up unfolds the pane and is never missed behind it.
  const [foldedOver, setFoldedOver] = useState<PlanCode | undefined>(undefined);
  const folded = foldedOver === code;
  const unreadable = unreadableLine(code);
  const label = rangeLabel(code.ref);

  return (
    <section className="code-pane" data-folded={String(folded)} aria-label="Code on screen">
      <header className="code-pane-header">
        <span className="code-pane-path">{code.ref.path}</span>
        {label === undefined ? null : <span className="code-pane-range">{label}</span>}
        <button
          type="button"
          className="code-pane-button"
          aria-label={folded ? "Show code" : "Hide code"}
          onClick={() => setFoldedOver(folded ? undefined : code)}
        >
          {folded ? "Show" : "Hide"}
        </button>
      </header>
      {folded ? null : unreadable !== undefined ? (
        <p className="code-pane-note" role="alert">
          {unreadable}
        </p>
      ) : (
        <CodeLines code={code} />
      )}
    </section>
  );
}
