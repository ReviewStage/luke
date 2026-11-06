import { TextLink as SharedTextLink, TEXT_LINK_LOOK, Tooltip } from "@repo/ui";
import { linkFace } from "@repo/ui/link-face";
import type { ReactNode } from "react";
import { opensAsLink } from "./tasks/use-open-link.js";

const HINT_MAX_CHARS = 500;

function hintOf(href: string): string {
  return href.length <= HINT_MAX_CHARS ? href : `${href.slice(0, HINT_MAX_CHARS - 1)}…`;
}

export function TextLink({
  href,
  words,
  children,
  onOpen,
}: {
  href: string;
  words: string | undefined;
  children: ReactNode;
  onOpen?: ((href: string) => void) | undefined;
}): React.JSX.Element {
  const face = words === undefined ? undefined : linkFace(href, words);
  const opens = onOpen !== undefined && opensAsLink(href);
  return (
    <Tooltip label={hintOf(href)}>
      <SharedTextLink
        href={opens ? href : undefined}
        look={TEXT_LINK_LOOK.UNDERLINED}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen?.(href);
        }}
      >
        {face?.shortened === true ? face.words : children}
      </SharedTextLink>
    </Tooltip>
  );
}
