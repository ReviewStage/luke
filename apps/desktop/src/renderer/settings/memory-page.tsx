import { RefreshIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { MarkdownMessage } from "../markdown-message";
import {
  MEMORY_EMPTY_NOTE,
  MEMORY_PAGE_NOTE,
  MEMORY_SIGNED_OUT_NOTE,
  MEMORY_UNREADABLE_NOTE,
  MEMORY_VIEW_STATUS,
  type MemoryView,
  notebookFileNote,
  notebookOmittedNote,
} from "./memory-view";

/**
 * What Luke has saved, read from the service and drawn as the Markdown it is
 * written in: `MEMORY.md`, `USER.md`, and his newest dated notes, each under
 * the path the service holds it at. A window and never a form — nothing here
 * writes, and the way to change what he remembers is to tell him.
 *
 * The page asks once each time it is opened and again on the refresh press,
 * and holds the answer only while it is drawn: leaving the page drops it,
 * so nothing of the notebook outlives the look. Like the Conversation tab,
 * the whole page blocks itself from session replay: a recording is the
 * rendered panel, and what Luke remembers about a person belongs on their
 * screen and in no recording of it.
 */
export function MemorySection({
  signedIn,
  panelOpen,
}: {
  /** Whether an account stands; the notebook is the account's, so nothing is asked without one. */
  signedIn: boolean;
  /** True while the panel is the shape on screen; a page in an inert stage asks nothing. */
  panelOpen: boolean;
}): React.JSX.Element {
  const { act } = useAct();
  const [view, setView] = useState<MemoryView>({ status: MEMORY_VIEW_STATUS.READING });
  // Bumped by the refresh press; the read effect below keys on it, so a
  // press re-runs the same read rather than a second copy of it.
  const [asked, setAsked] = useState(0);
  const refresh = useCallback(() => setAsked((count) => count + 1), []);

  useEffect(() => {
    if (!signedIn || !panelOpen) return;
    let standing = true;
    setView({ status: MEMORY_VIEW_STATUS.READING });
    act(ACT_KIND.NOTEBOOK_READ)
      .then((notebook) => {
        if (!standing) return;
        setView(
          notebook === undefined
            ? { status: MEMORY_VIEW_STATUS.UNREADABLE }
            : { status: MEMORY_VIEW_STATUS.READ, notebook },
        );
      })
      .catch(() => {
        if (standing) setView({ status: MEMORY_VIEW_STATUS.UNREADABLE });
      });
    // A page left before its answer landed draws nothing of it: the answer
    // belongs to the look that asked.
    return () => {
      standing = false;
    };
  }, [act, signedIn, panelOpen, asked]);

  return (
    <section
      className="settings-section settings-plain memory-page ph-no-capture"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      <div className="settings-row memory-head">
        <p className="settings-note">{signedIn ? MEMORY_PAGE_NOTE : MEMORY_SIGNED_OUT_NOTE}</p>
        {signedIn ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Read again"
            title="Read again"
            disabled={view.status === MEMORY_VIEW_STATUS.READING}
            onClick={refresh}
          >
            <RefreshIcon />
          </button>
        ) : null}
      </div>
      {signedIn ? <MemoryBody view={view} /> : null}
    </section>
  );
}

function MemoryBody({ view }: { view: MemoryView }): React.JSX.Element {
  switch (view.status) {
    case MEMORY_VIEW_STATUS.READING:
      return (
        <p className="settings-note memory-state" aria-live="polite">
          Reading…
        </p>
      );
    case MEMORY_VIEW_STATUS.UNREADABLE:
      return (
        <p className="error-message memory-state" role="alert">
          {MEMORY_UNREADABLE_NOTE}
        </p>
      );
    case MEMORY_VIEW_STATUS.READ: {
      const { files, omittedNotes } = view.notebook;
      if (files.length === 0) {
        return <p className="settings-note memory-state">{MEMORY_EMPTY_NOTE}</p>;
      }
      const omitted = notebookOmittedNote(omittedNotes);
      return (
        <>
          {files.map((file) => (
            <article key={file.path} className="memory-file">
              <h3 className="memory-file-path">
                <code>{file.path}</code>
              </h3>
              <small className="memory-file-note">{notebookFileNote(file)}</small>
              {file.content.trim() === "" ? (
                <p className="settings-note">Empty.</p>
              ) : (
                <MarkdownMessage words={file.content} className="memory-words" />
              )}
            </article>
          ))}
          {omitted ? <p className="settings-note memory-state">{omitted}</p> : null}
        </>
      );
    }
  }
}
