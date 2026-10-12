import { useAtomValue } from "@effect/atom-react";
import { DocumentIcon } from "@sidecar/panel";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { fileTreeModuleAtom } from "./file-tree-bundle";

/**
 * file-type-icon.tsx -- a file's type as the file tree draws it: Pierre's coloured icon for its name, a plain document until the tree's bundle has loaded.
 *
 * The icons ride in the file tree bundle (`file-tree-bundle.ts`), loaded the
 * first time one is drawn, so the bundle every window parses carries none of
 * them; a bundle that fails to load leaves the document glyph standing. The
 * icon's colour is its type's, as `styles/planning.css` gives it.
 */

export function FileTypeIcon({ name }: { name: string }): React.JSX.Element {
  const loaded = useAtomValue(fileTreeModuleAtom);
  if (!AsyncResult.isSuccess(loaded)) return <DocumentIcon />;
  const icon = loaded.value.fileIcon(name);
  return (
    <svg
      className="file-type-icon"
      data-file-type={icon.type}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <use href={`#${icon.symbol}`} />
    </svg>
  );
}
