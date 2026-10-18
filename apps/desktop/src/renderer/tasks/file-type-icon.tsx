import { useAtomValue } from "@effect/atom-react";
import { useSideBundles } from "@luke/panel/bundle-loader";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { FileIcon } from "lucide-react";

/**
 * file-type-icon.tsx -- a file's type as the file tree draws it: Pierre's coloured icon for its name, a blank page until the tree's bundle has loaded.
 *
 * The icons ride in the file tree bundle (`../bundle-loader.ts`), loaded the
 * first time one is drawn, so the bundle every window parses carries none of
 * them; a bundle that fails to load leaves the blank page standing. Note
 * that the stand-in is a page with nothing on it rather than the task's
 * document glyph, so a file never reads as a task while the icons load. The
 * icon's colour is its type's, as `styles/tasks.css` gives it.
 */

export function FileTypeIcon({ name }: { name: string }): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().fileTree);
  if (!AsyncResult.isSuccess(loaded)) return <FileIcon aria-hidden="true" />;
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
