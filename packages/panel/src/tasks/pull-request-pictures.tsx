import type { FileChip } from "@luke/features/attachment-model";
import { githubImageOf } from "@luke/features/github-image";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ProviderMark, SKELETON_SHAPE, Skeleton } from "@luke/ui";
import { linksToPicture } from "@luke/ui/github-html";
import { PICTURE_STATE, pictureNow, usePicture } from "@luke/ui/picture-cache";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useAct } from "../act.js";
import { PictureBlock } from "../picture-block.js";
import { AttachmentViewer, type ViewerAction } from "./attachment-viewer.js";
import { type GitHubPictureDrawer, GitHubPictureLink } from "./transcript-blocks.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * pull-request-pictures.tsx -- the pictures in a pull request's words, as its Pull request tab draws them: each read through the service, drawn as a plan's picture is, and opened over the window rather than in the browser.
 *
 * GitHub's rendering (`body_html`) names each picture by an address the
 * window may not read itself, so each is read once through the service on
 * the App's token as the agent's (`githubImageOf`) and kept in the window's
 * picture cache (`@luke/ui/picture-cache`). A picture standing alone is
 * drawn as a plan's picture is (`../picture-block.tsx`), its press
 * (Enlarge) opening the window's file viewer (`attachment-viewer.tsx`)
 * over the description or comment it stands in, walking that entry's
 * pictures, with Open on GitHub, to the address GitHub linked it to, beside the
 * viewer's own Download. GitHub
 * wraps every picture in a link to itself, which `@luke/ui/github-html`
 * lets go of, so the press is the picture's own. A picture inside a link
 * the words keep, a bot's badge to its page, stands inline as GitHub drew
 * it and its press follows the link. The viewer shows the `data:` URL each
 * picture was read as, so opening one reads nothing again; a picture still
 * being read joins the walk as its read lands, and one GitHub answered no
 * picture for stands as its link and is left out.
 */

/** What the viewer's own press is named, and what a picture with no words of its own is saved as. */
const PICTURE_WORDS = {
  OPEN_ON_GITHUB: "Open on GitHub",
  UNNAMED: "Picture",
} as const;

/** A picture an entry's words name: its address, the address GitHub linked it to where it did, and its words. */
interface EntryPicture {
  readonly src: string;
  readonly original: string;
  readonly alt: string;
}

/** How a picture drawn in an entry's words opens that entry's viewer, and says its read landed. */
interface EntryViewerDoor {
  readonly open: (agentId: string, src: string) => void;
  readonly landed: () => void;
}

const EntryViewerContext = createContext<EntryViewerDoor | undefined>(undefined);

/** How the tab reads a picture GitHub names through the service, on the App's token as the agent's (`githubImageOf`). */
export function useGitHubImageRead(): (
  owner: string,
  address: string,
) => ReturnType<ReturnType<typeof useAct>["act"]> {
  const { act } = useAct();
  return useCallback(
    (owner: string, address: string) =>
      act(ACT_KIND.CODING_AGENTS_GITHUB_IMAGE, { agentId: owner, src: address }),
    [act],
  );
}

/**
 * The link a picture stands alone in, as GitHub wraps every picture it
 * renders: the one `@luke/ui/github-html` lets go of where it leads to the
 * picture or to GitHub's own image addresses. None where the picture
 * stands in no link, or shares its link with anything else.
 */
function soleLinkOf(image: Element): Element | undefined {
  const link = image.parentElement;
  if (link?.tagName !== "A") return undefined;
  const held = [...link.childNodes].filter(
    (child) => child.nodeType !== Node.TEXT_NODE || (child.textContent ?? "").trim() !== "",
  );
  return held.length === 1 && held[0] === image ? link : undefined;
}

/**
 * The pictures GitHub's rendering names that the tab reads and draws with
 * a press of their own, in the order they stand, each once, beside the
 * address GitHub linked each to, which Open on GitHub opens: a lasting
 * upload's page where the picture is drawn from a signed address that
 * expires. A picture inside a link the words keep is the link's. Note that
 * the rendering is parsed into an inert document, which loads none of its
 * pictures and runs none of its scripts.
 */
function picturesOf(html: string): readonly EntryPicture[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set<string>();
  return [...document.images].flatMap((image) => {
    const src = image.getAttribute("src") ?? "";
    const link = image.closest("a");
    const href = soleLinkOf(image)?.getAttribute("href") ?? "";
    if (link !== null && !linksToPicture(href, src)) return [];
    if (seen.has(src) || githubImageOf(src) === undefined) return [];
    seen.add(src);
    return [{ src, original: link === null ? src : href, alt: image.getAttribute("alt") ?? "" }];
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

/** An entry's pictures the window holds now, as the viewer takes files, each beside its address. */
function heldFiles(
  agentId: string,
  pictures: readonly EntryPicture[],
): readonly { readonly src: string; readonly original: string; readonly file: FileChip }[] {
  return pictures.flatMap(({ src, original, alt }) => {
    const state = pictureNow(agentId, src);
    if (state.kind !== PICTURE_STATE.READY) return [];
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
  pictures: readonly EntryPicture[];
  src: string;
  onSrc: (src: string) => void;
  onClose: () => void;
}): ReactNode {
  const openLink = useOpenLink();
  const files = heldFiles(agentId, pictures);
  const at = files.findIndex((each) => each.src === src);
  const action: ViewerAction = {
    label: PICTURE_WORDS.OPEN_ON_GITHUB,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onPress: (file) => {
      // Note that the file is matched as the viewer was handed it, because two pictures may hold the same bytes.
      const shown = files.find((each) => each.file === file);
      if (shown !== undefined) openLink(shown.original);
    },
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
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const door = useMemo<EntryViewerDoor>(
    () => ({ open: (agentId, src) => setViewing({ agentId, src }), landed: redraw }),
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
 * from its `data:` URL once read: standing alone, as a plan's picture is,
 * its press opening the entry's viewer; inside a link, inline as GitHub
 * drew it. Its link where GitHub answered none the window draws.
 */
function GitHubPicture({
  agentId,
  src,
  alt,
  linked,
}: {
  agentId: string;
  src: string;
  alt: string;
  linked: boolean;
}): React.JSX.Element {
  const state = usePicture(agentId, src, useGitHubImageRead());
  const door = useContext(EntryViewerContext);
  // Note that a picture landing tells the entry, so a viewer already open walks it too.
  useEffect(() => door?.landed(), [door, state.kind]);
  if (state.kind === PICTURE_STATE.MISSING) return <GitHubPictureLink src={src} alt={alt} />;
  if (!linked) {
    const open = door === undefined ? undefined : () => door.open(agentId, src);
    return <PictureBlock state={state} alt={alt} caption={undefined} onOpen={open} />;
  }
  return state.kind === PICTURE_STATE.READY ? (
    <img className="pull-request-picture" src={state.url} alt={alt} />
  ) : (
    <span className="pull-request-picture-waiting" role="img" aria-label={alt}>
      <Skeleton shape={SKELETON_SHAPE.BLOCK} />
    </span>
  );
}

/** How the tab draws a picture GitHub's rendering names: one it may read through the service as the agent's, and none else. */
export function usePictureDrawer(agentId: string): GitHubPictureDrawer {
  return useCallback(
    (src, alt, linked) =>
      githubImageOf(src) === undefined ? undefined : (
        <GitHubPicture agentId={agentId} src={src} alt={alt} linked={linked} />
      ),
    [agentId],
  );
}
