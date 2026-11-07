import type { FileChip } from "@repo/features/attachment-model";
import { githubImageOf } from "@repo/features/github-image";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { ACT_KIND } from "@repo/host/acts";
import { ProviderMark, SKELETON_SHAPE, Skeleton } from "@repo/ui";
import { type RenderingPicture, renderingPictures } from "@repo/ui/github-html";
import { PICTURE_STATE, type PictureRead, usePicture } from "@repo/ui/picture-read";
import { useQueries } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { askAct } from "../act.js";
import { pictureUnread } from "../failure-report.js";
import { PictureBlock } from "../picture-block.js";
import { type PictureReader, pictureQuery } from "../picture-query.js";
import { AttachmentViewer, type ViewerAction } from "./attachment-viewer.js";
import { type GitHubPictureDrawer, GitHubPictureLink } from "./transcript-blocks.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * pull-request-pictures.tsx -- the pictures in a pull request's words, as its Pull request tab draws them: each read through the service, drawn as a description's picture is, and opened over the window rather than in the browser.
 *
 * GitHub's rendering (`body_html`) names each picture by an address the
 * window may not read itself, so each is read once through the service on
 * the App's token as the agent's (`githubImageOf`) and kept in the window's
 * picture cache (`@repo/ui/picture-read`). A picture standing alone is
 * drawn as a description's picture is (`../picture-block.tsx`), its press
 * (Enlarge) opening the window's file viewer (`attachment-viewer.tsx`)
 * over the description or comment it stands in, walking that entry's
 * pictures, with Open on GitHub, to the address GitHub linked it to, beside the
 * viewer's own Download. GitHub
 * wraps every picture in a link to itself, which `@repo/ui/github-html`
 * lets go of, so the press is the picture's own. A picture inside a link
 * the words keep, a bot's badge to its page, stands inline as GitHub drew
 * it and its press follows the link, and a picture that shares its line
 * with words, a bot's glyph beside its verdict, stands in that line as GitHub
 * drew it, with no press. The viewer shows the `data:` URL each
 * picture was read as, so opening one reads nothing again; a picture still
 * being read joins the walk as its read lands, and one GitHub answered no
 * picture for stands as its link and is left out.
 */

/** What the viewer's own press is named, and what a picture with no words of its own is saved as. */
const PICTURE_WORDS = {
  OPEN_ON_GITHUB: "Open on GitHub",
  UNNAMED: "Picture",
} as const;

/** How a picture drawn in an entry's words opens that entry's viewer. */
interface EntryViewerDoor {
  readonly open: (agentId: string, src: string) => void;
}

const EntryViewerContext = createContext<EntryViewerDoor | undefined>(undefined);

/** How the tab reads a picture GitHub names through the service, on the App's token as the agent's (`githubImageOf`). */
export function useGitHubImageRead(): PictureReader {
  return useCallback(
    (owner: string, address: string) =>
      askAct(ACT_KIND.AGENTS_GITHUB_IMAGE, { agentId: owner, src: address }),
    [],
  );
}

/**
 * The pictures GitHub's rendering names that the tab reads and draws with
 * a press of their own, in the order they stand, each once, beside the
 * address GitHub linked each to, which Open on GitHub opens: a lasting
 * upload's page where the picture is drawn from a signed address that
 * expires. A picture inside a link the words keep is the link's
 * (`renderingPictures`).
 */
function picturesOf(html: string): readonly RenderingPicture[] {
  const seen = new Set<string>();
  return renderingPictures(html).filter(({ src }) => {
    if (seen.has(src) || githubImageOf(src) === undefined) return false;
    seen.add(src);
    return true;
  });
}

/** What the viewer saves a picture as: its words, or a plain name, under its type's extension. */
function viewerName(alt: string, mediaType: string): string {
  const words = alt.trim() === "" ? PICTURE_WORDS.UNNAMED : alt.trim();
  const extension = mediaType.slice(mediaType.indexOf("/") + 1).replace(/\+.*$/u, "");
  return `${words.replaceAll(/[/\\:]/gu, "-")}.${extension}`;
}

/** The media type a `data:` URL names. */
function mediaTypeOf(url: string): string {
  return /^data:([^;,]+)/u.exec(url)?.[1] ?? "application/octet-stream";
}

/** An entry's pictures that landed, each read as `reads` answers it at its place, as the viewer takes files, each beside its address. */
function heldFiles(
  pictures: readonly RenderingPicture[],
  reads: readonly (PictureRead | undefined)[],
): readonly { readonly src: string; readonly original: string; readonly file: FileChip }[] {
  return pictures.flatMap(({ src, original, alt }, index) => {
    const state = reads[index];
    if (state?.kind !== PICTURE_STATE.READY) return [];
    const mediaType = mediaTypeOf(state.url);
    const file = { name: viewerName(alt, mediaType), mediaType, url: state.url };
    return [{ src, original, file }];
  });
}

/** The viewer over an entry's pictures, from the one named, walking those the window holds. */
function EntryViewer({
  agentId,
  pictures,
  src,
  onSrc,
  onClose,
}: {
  agentId: string;
  pictures: readonly RenderingPicture[];
  src: string;
  onSrc: (src: string) => void;
  onClose: () => void;
}): ReactNode {
  const openLink = useOpenLink();
  const read = useGitHubImageRead();
  // Note that every picture of the entry is watched, so one still being read joins the walk as it lands.
  const reads = useQueries({
    queries: pictures.map(({ src }) => pictureQuery(agentId, src, read)),
    combine: (results) => results.map((result) => result.data),
  });
  const files = heldFiles(pictures, reads);
  const at = files.findIndex((each) => each.src === src);
  const action: ViewerAction = {
    label: PICTURE_WORDS.OPEN_ON_GITHUB,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    // Note that the file is matched as the viewer was handed it, because two pictures may hold the same bytes.
    address: (file) => files.find((each) => each.file === file)?.original,
    onOpen: openLink,
  };
  return at < 0 ? null : (
    <AttachmentViewer
      files={files.map((each) => each.file)}
      at={at}
      onAt={(next) => {
        const shown = files[next];
        if (shown !== undefined) onSrc(shown.src);
      }}
      onClose={onClose}
      action={action}
    />
  );
}

/**
 * GitHub's rendering of one description or comment, its pictures opening
 * the viewer over that entry's pictures, from the one pressed, until it is
 * closed.
 */
export function EntryPictures({
  html,
  children,
}: {
  html: string;
  children: ReactNode;
}): React.JSX.Element {
  const pictures = useMemo(() => picturesOf(html), [html]);
  const [viewing, setViewing] = useState<{ readonly agentId: string; readonly src: string }>();
  const door = useMemo<EntryViewerDoor>(
    () => ({ open: (agentId, src) => setViewing({ agentId, src }) }),
    [],
  );
  return (
    <EntryViewerContext.Provider value={door}>
      {children}
      {viewing === undefined ? null : (
        <EntryViewer
          agentId={viewing.agentId}
          pictures={pictures}
          src={viewing.src}
          onSrc={(src) => setViewing({ agentId: viewing.agentId, src })}
          onClose={() => setViewing(undefined)}
        />
      )}
    </EntryViewerContext.Provider>
  );
}

/**
 * One picture GitHub's rendering names, read through the service, drawn
 * from its `data:` URL once read: standing alone, as a description's picture is,
 * its press opening the entry's viewer; in a line of words or inside a
 * link, inline as GitHub drew it. Its link where GitHub answered none the
 * window draws.
 */
function GitHubPicture({
  agentId,
  src,
  alt,
  inline,
}: {
  agentId: string;
  src: string;
  alt: string;
  inline: boolean;
}): React.JSX.Element {
  const state = usePicture(pictureQuery(agentId, src, useGitHubImageRead()), pictureUnread);
  const door = useContext(EntryViewerContext);
  // Note that an inline picture whose read did not land is its link too, because it stands in a line, where no Retry may stand.
  if (state.kind === PICTURE_STATE.MISSING || (inline && state.kind === PICTURE_STATE.FAILED)) {
    return <GitHubPictureLink src={src} alt={alt} />;
  }
  if (!inline) {
    const open = door === undefined ? undefined : () => door.open(agentId, src);
    return <PictureBlock state={state} alt={alt} caption={undefined} onOpen={open} />;
  }
  return state.kind === PICTURE_STATE.READY ? (
    <img
      className="inline-block h-auto max-w-full rounded-ui-6 align-middle"
      src={state.url}
      alt={alt}
    />
  ) : (
    <PictureSkeleton alt={alt} />
  );
}

/** An inline picture while it is read: a block the size a picture stands at, named by its alternative words. */
function PictureSkeleton({ alt }: { alt: string }): React.JSX.Element {
  return (
    <span className="pull-request-picture-skeleton" role="img" aria-label={alt}>
      <Skeleton shape={SKELETON_SHAPE.BLOCK} />
    </span>
  );
}

/** How the tab draws a picture GitHub's rendering names: one it may read through the service as the agent's, and none else. */
export function usePictureDrawer(agentId: string): GitHubPictureDrawer {
  return useCallback(
    (src, alt, inline) =>
      githubImageOf(src) === undefined ? undefined : (
        <GitHubPicture agentId={agentId} src={src} alt={alt} inline={inline} />
      ),
    [agentId],
  );
}
