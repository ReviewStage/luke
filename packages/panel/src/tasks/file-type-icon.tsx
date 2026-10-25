import { useAtomValue } from "@effect/atom-react";
import { cn } from "@luke/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { FileIcon } from "lucide-react";
import { useSideBundles } from "../bundle-loader.js";

/**
 * file-type-icon.tsx -- a file's type as the file tree draws it: Pierre's coloured icon for its name, a blank page until the tree's bundle has loaded.
 *
 * The icons ride in the file tree bundle (`../bundle-loader.ts`), loaded the
 * first time one is drawn, so the bundle every window parses carries none of
 * them; a bundle that fails to load leaves the blank page standing. Note
 * that the stand-in is a page with nothing on it rather than the task's
 * document glyph, so a file never reads as a task while the icons load. The
 * icon's colour is its type's.
 */

/**
 * Each type's ink, Pierre's own colour for it in the complete set
 * (`@pierre/trees`' stylesheet), in the palette `base.css` repeats from it.
 * A type Pierre colours nowhere takes the muted ink the tree gives it.
 */
const TYPE_INK: Readonly<Record<string, string>> = {
  default: "text-file-icon-gray",
  text: "text-file-icon-gray",
  npm: "text-file-icon-red",
  postcss: "text-file-icon-red",
  ruby: "text-file-icon-red",
  svelte: "text-file-icon-red",
  yml: "text-file-icon-red",
  git: "text-file-icon-vermilion",
  claude: "text-file-icon-orange",
  html: "text-file-icon-orange",
  json: "text-file-icon-orange",
  rust: "text-file-icon-orange",
  svg: "text-file-icon-orange",
  swift: "text-file-icon-orange",
  zig: "text-file-icon-orange",
  zip: "text-file-icon-orange",
  babel: "text-file-icon-yellow",
  browserslist: "text-file-icon-yellow",
  javascript: "text-file-icon-yellow",
  bash: "text-file-icon-green",
  markdown: "text-file-icon-green",
  svgo: "text-file-icon-green",
  vue: "text-file-icon-green",
  mcp: "text-file-icon-teal",
  prettier: "text-file-icon-teal",
  table: "text-file-icon-teal",
  go: "text-file-icon-cyan",
  oxc: "text-file-icon-cyan",
  react: "text-file-icon-cyan",
  tailwind: "text-file-icon-cyan",
  biome: "text-file-icon-blue",
  c: "text-file-icon-blue",
  cpp: "text-file-icon-blue",
  docker: "text-file-icon-blue",
  python: "text-file-icon-blue",
  typescript: "text-file-icon-blue",
  vscode: "text-file-icon-blue",
  webpack: "text-file-icon-blue",
  bootstrap: "text-file-icon-indigo",
  css: "text-file-icon-indigo",
  eslint: "text-file-icon-indigo",
  terraform: "text-file-icon-indigo",
  wasm: "text-file-icon-indigo",
  astro: "text-file-icon-purple",
  database: "text-file-icon-purple",
  vite: "text-file-icon-purple",
  graphql: "text-file-icon-pink",
  image: "text-file-icon-pink",
  sass: "text-file-icon-pink",
  bun: "text-file-icon-mauve",
};

/** The ink of a type Pierre colours nowhere. */
const UNCOLOURED_INK = "text-muted-foreground";

export function FileTypeIcon({
  name,
  className,
}: {
  name: string;
  /** The place's own size and room for the icon, where it stands at a size of its own. */
  className?: string | undefined;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().fileTree);
  if (!AsyncResult.isSuccess(loaded)) return <FileIcon aria-hidden="true" />;
  const icon = loaded.value.fileIcon(name);
  return (
    <svg
      className={cn(
        "file-type-icon fill-current",
        TYPE_INK[icon.type] ?? UNCOLOURED_INK,
        className,
      )}
      data-file-type={icon.type}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <use href={`#${icon.symbol}`} />
    </svg>
  );
}
