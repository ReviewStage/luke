import type { FileChip } from "@repo/features/attachment-model";
import { githubImageOf } from "@repo/features/github-image";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { ACT_KIND } from "@repo/host/acts";
import { ProviderMark, SKELETON_SHAPE, Skeleton } from "@repo/ui";
import { linksToPicture } from "@repo/ui/github-html";
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

const PICTURE_WORDS = {
  OPEN_ON_GITHUB: "Open on GitHub",
  UNNAMED: "Picture",
} as const;

interface EntryPicture {
  readonly src: string;
  readonly original: string;
  readonly alt: string;
}

interface EntryViewerDoor {
  readonly open: (agentId: string, src: string) => void;
}

const EntryViewerContext = createContext<EntryViewerDoor | undefined>(undefined);

export function useGitHubImageRead(): PictureReader {
  return useCallback(
    (owner: string, address: string) =>
      askAct(ACT_KIND.AGENTS_GITHUB_IMAGE, { agentId: owner, src: address }),
    [],
  );
}

function soleLinkOf(image: Element): Element | undefined {
  const link = image.parentElement;
  if (link?.tagName !== "A") return undefined;
  const held = [...link.childNodes].filter(
    (child) => child.nodeType !== Node.TEXT_NODE || (child.textContent ?? "").trim() !== "",
  );
  return held.length === 1 && held[0] === image ? link : undefined;
}

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

function viewerName(alt: string, mediaType: string): string {
  const words = alt.trim() === "" ? PICTURE_WORDS.UNNAMED : alt.trim();
  const extension = mediaType.slice(mediaType.indexOf("/") + 1).replace(/\+.*$/u, "");
  return `${words.replaceAll(/[/\\:]/gu, "-")}.${extension}`;
}

function mediaTypeOf(url: string): string {
  return /^data:([^;,]+)/u.exec(url)?.[1] ?? "application/octet-stream";
}

function heldFiles(
  pictures: readonly EntryPicture[],
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
  const read = useGitHubImageRead();
  const reads = useQueries({
    queries: pictures.map(({ src }) => pictureQuery(agentId, src, read)),
    combine: (results) => results.map((result) => result.data),
  });
  const files = heldFiles(pictures, reads);
  const at = files.findIndex((each) => each.src === src);
  const action: ViewerAction = {
    label: PICTURE_WORDS.OPEN_ON_GITHUB,
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
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
  const state = usePicture(pictureQuery(agentId, src, useGitHubImageRead()), pictureUnread);
  const door = useContext(EntryViewerContext);
  if (state.kind === PICTURE_STATE.MISSING || (linked && state.kind === PICTURE_STATE.FAILED)) {
    return <GitHubPictureLink src={src} alt={alt} />;
  }
  if (!linked) {
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

function PictureSkeleton({ alt }: { alt: string }): React.JSX.Element {
  return (
    <span className="pull-request-picture-skeleton" role="img" aria-label={alt}>
      <Skeleton shape={SKELETON_SHAPE.BLOCK} />
    </span>
  );
}

export function usePictureDrawer(agentId: string): GitHubPictureDrawer {
  return useCallback(
    (src, alt, linked) =>
      githubImageOf(src) === undefined ? undefined : (
        <GitHubPicture agentId={agentId} src={src} alt={alt} linked={linked} />
      ),
    [agentId],
  );
}
