// pm-field.tsx -- SPIKE: the React door to the minimal ProseMirror field editor (`pm-mount.ts`).

import { useLayoutEffect, useRef } from "react";
import { type FieldEditorProps, mountFieldEditor } from "./pm-mount";

/**
 * SPIKE, not production code. The editor itself is plain ProseMirror and
 * imports no React, so this door is the one thing that would stay in the
 * renderer bundle if the editor moved to a bundle of its own, loaded the
 * way `whiteboard.js` is (`whiteboard/contract.ts`).
 */

/** One field in its editor, in place of its drawn words; built once, on the value it opened with. */
export function PmFieldEditor(props: FieldEditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    const editor = mountFieldEditor(element, {
      ...latest.current,
      onDraft: (value) => latest.current.onDraft(value),
      onFinish: () => latest.current.onFinish(),
    });
    return editor.destroy;
  }, []);

  return <div ref={host} className="ph-no-capture spike-editor-host" />;
}
