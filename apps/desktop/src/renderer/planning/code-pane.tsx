import type { CodeRef } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { useEffect, useRef, useState } from "react";
import {
  CODE_PANE_EMPTY_LINE,
  isPointed,
  quickOpenMatches,
  rangeLabel,
  selectedRef,
  sourceLabel,
  unreadableLine,
} from "./code-pane-model";

/**
 * code-pane.tsx -- the code on screen during a planning call: a small window inside the Plans tab that both sides of the call point at.
 *
 * Luke puts a file up as he talks about it, with the lines he means lit; the
 * developer opens a file through the quick open, or drags down the line
 * numbers to light lines of their own, and Luke is told what they point at.
 * Either way the pane draws what the host read from the plan's folder, so
 * the two sides always look at the same lines. A selection is drawn the
 * moment it is made and stands until the host's read of it lands.
 */

export interface CodePaneControl {
  /** The code on screen, absent while neither side has put any up. */
  code: PlanCode | undefined;
  /** The developer points at code: a file opened, or lines of it selected. */
  onShowCode: (ref: CodeRef) => void;
  /** The plan's files for the quick open, read when it opens. */
  listFiles: () => Promise<readonly string[]>;
}

/** The quick open: a filter over the plan's files, Enter or a press opening the best match. */
function QuickOpen({
  listFiles,
  onOpen,
  onClose,
}: {
  listFiles: () => Promise<readonly string[]>;
  onOpen: (path: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [files, setFiles] = useState<readonly string[] | undefined>(undefined);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let current = true;
    listFiles().then(
      (listed) => {
        if (current) setFiles(listed);
      },
      () => {
        if (current) setFiles([]);
      },
    );
    return () => {
      current = false;
    };
  }, [listFiles]);
  const matches = files === undefined ? [] : quickOpenMatches(files, query);
  return (
    <div className="code-quick-open">
      <input
        className="code-quick-open-input"
        placeholder="Open a file of the plan's folder…"
        aria-label="Open a file"
        // biome-ignore lint/a11y/noAutofocus: the quick open is opened by a press to type into it at once.
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          const best = matches[0];
          if (event.key === "Enter" && best !== undefined) onOpen(best);
        }}
      />
      <ul className="code-quick-open-list">
        {files === undefined ? <li className="code-quick-open-note">Reading the folder…</li> : null}
        {files !== undefined && matches.length === 0 ? (
          <li className="code-quick-open-note">No file matches.</li>
        ) : null}
        {matches.map((path) => (
          <li key={path}>
            <button type="button" className="code-quick-open-row" onClick={() => onOpen(path)}>
              {path}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The file's window of lines, numbered from where it starts in the file, the
 * lines pointed at lit and scrolled into view whenever they change. A drag
 * down the numbers selects lines, and letting go points at them.
 */
function CodeLines({
  code,
  pointed,
  onSelect,
}: {
  code: PlanCode;
  pointed: CodeRef;
  onSelect: (ref: CodeRef) => void;
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ anchor: number; line: number } | undefined>(undefined);
  const first = code.firstLine ?? 1;
  const lit = drag === undefined ? pointed : selectedRef(code.ref.path, drag.anchor, drag.line);

  useEffect(() => {
    const target = scroller.current?.querySelector<HTMLElement>("[data-pointed='true']");
    target?.scrollIntoView({ block: "center" });
  }, [pointed.path, pointed.startLine, pointed.endLine]);

  // A drag ends wherever the pointer is let go, in the pane or out of it.
  useEffect(() => {
    if (drag === undefined) return;
    const finish = () => {
      setDrag(undefined);
      onSelect(selectedRef(code.ref.path, drag.anchor, drag.line));
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [drag, code.ref.path, onSelect]);

  return (
    <div className="code-lines" ref={scroller}>
      {(code.lines ?? []).map((tokens, index) => {
        const line = first + index;
        return (
          <div
            // Note that a line's place in the file is its identity: the window never reorders.
            key={line}
            className="code-line"
            data-pointed={String(isPointed(lit, line))}
          >
            <button
              type="button"
              className="code-line-number"
              aria-label={`Line ${line}`}
              onMouseDown={(event) =>
                setDrag({
                  anchor: event.shiftKey && lit.startLine !== undefined ? lit.startLine : line,
                  line,
                })
              }
              onMouseEnter={() =>
                setDrag((current) => (current === undefined ? undefined : { ...current, line }))
              }
            >
              {line}
            </button>
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

/**
 * The pane: a heading naming the file, the lines pointed at, and who put it
 * up, over the lines themselves; or the quick open; or a line saying what the
 * pane is for. It folds to its heading and opens again on a press.
 */
export function CodePane({ control }: { control: CodePaneControl }): React.JSX.Element {
  const { code, onShowCode, listFiles } = control;
  const [opening, setOpening] = useState(false);
  // Note that a fold and a selection each hold the code they were made over,
  // so a new read from the host clears the selection made ahead of it and
  // unfolds the pane, which Luke putting code up must never go unseen behind.
  const [foldedOver, setFoldedOver] = useState<{ code: PlanCode | undefined } | undefined>(
    undefined,
  );
  const [selected, setSelected] = useState<
    { ref: CodeRef; over: PlanCode | undefined } | undefined
  >(undefined);
  const folded = foldedOver !== undefined && foldedOver.code === code;
  const selection = selected !== undefined && selected.over === code ? selected.ref : undefined;

  const select = (ref: CodeRef) => {
    setSelected({ ref, over: code });
    onShowCode(ref);
  };
  const open = (path: string) => {
    setOpening(false);
    onShowCode({ path });
  };
  const pointed = selection ?? code?.ref;
  const unreadable = code === undefined ? undefined : unreadableLine(code);
  const label = pointed === undefined ? undefined : rangeLabel(pointed);

  return (
    <section className="code-pane" data-folded={String(folded)} aria-label="Code on screen">
      <header className="code-pane-header">
        <span className="code-pane-path">{code?.ref.path ?? "Code"}</span>
        {label === undefined ? null : <span className="code-pane-range">{label}</span>}
        {code === undefined ? null : (
          <span className="code-pane-source" data-source={code.source}>
            {sourceLabel(code)}
          </span>
        )}
        <span className="code-pane-actions">
          <button type="button" className="code-pane-button" onClick={() => setOpening(!opening)}>
            {opening ? "Cancel" : "Open file…"}
          </button>
          <button
            type="button"
            className="code-pane-button"
            aria-label={folded ? "Show code" : "Hide code"}
            onClick={() => setFoldedOver(folded ? undefined : { code })}
          >
            {folded ? "Show" : "Hide"}
          </button>
        </span>
      </header>
      {folded ? null : opening ? (
        <QuickOpen listFiles={listFiles} onOpen={open} onClose={() => setOpening(false)} />
      ) : code === undefined ? (
        <p className="code-pane-note">{CODE_PANE_EMPTY_LINE}</p>
      ) : unreadable !== undefined ? (
        <p className="code-pane-note" role="alert">
          {unreadable}
        </p>
      ) : (
        <CodeLines code={code} pointed={pointed ?? code.ref} onSelect={select} />
      )}
    </section>
  );
}
