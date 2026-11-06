import { useAtomValue } from "@effect/atom-react";
import { cn } from "@repo/ui";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { FileIcon } from "lucide-react";
import { useSideBundles } from "../bundle-loader.js";

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

const UNCOLORED_INK = "text-muted-foreground";

export function FileTypeIcon({
  name,
  className,
}: {
  name: string;
  className?: string | undefined;
}): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().fileTree);
  if (!AsyncResult.isSuccess(loaded)) return <FileIcon aria-hidden="true" />;
  const icon = loaded.value.fileIcon(name);
  return (
    <svg
      className={cn("file-type-icon fill-current", TYPE_INK[icon.type] ?? UNCOLORED_INK, className)}
      data-file-type={icon.type}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <use href={`#${icon.symbol}`} />
    </svg>
  );
}
