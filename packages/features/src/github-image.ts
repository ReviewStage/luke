/**
 * github-image.ts -- which images in GitHub's own rendering of a pull request the window may draw, and how each is read: an upload by its asset's id, re-signed on the App's token, a file of a repository through its contents on that token, or a public image as it stands.
 *
 * GitHub's rendering of a description or a comment (`body_html`) names an
 * upload two ways: `github.com/user-attachments/assets/<id>` (or the
 * repository's own `.../assets/<id>`), which answers only a browser signed
 * in to GitHub, and a `private-user-images.githubusercontent.com` address
 * signed for about five minutes. Both name the same asset by its id, so an
 * upload is read by its id alone, and the service asks GitHub for a freshly
 * signed address on the App's token for the agent's repository, as
 * ReviewStage/stage's image proxy does; the signed address never reaches
 * the window. Every other image GitHub links goes through its own image
 * proxy, `camo.githubusercontent.com`, or stands on its older public upload
 * host, and is read as it is. A file of a repository, an image a
 * description links on its own branch (`raw.githubusercontent.com`, or
 * `github.com/<owner>/<name>/raw/...`), which GitHub's rendering leaves as
 * written and which a private repository answers no stranger, is named by
 * its repository, ref, and path, and is read through the repository's
 * contents on the App's token, only where the repository is the agent's
 * own; its type is its extension's, and a file of any other extension is
 * none. A ref is the address's first segment after the repository, so a
 * branch with a slash in its name names no file the window reads. Anything
 * else, or anything with credentials in it, is not an image the window
 * draws: it is drawn as a link.
 */

/** How an image GitHub's rendering names is read. */
export const GITHUB_IMAGE_SOURCE = {
  /** An upload, read by its asset's id, re-signed on the App's token for the agent's repository. */
  ASSET: "asset",
  /** A public image on GitHub's own image proxy or older upload host, read as it is. */
  PUBLIC: "public",
  /** A file of a repository, read through its contents on the App's token, only in the agent's own repository. */
  FILE: "file",
} as const;

/** The media types an image read from GitHub may be, each drawn from a `data:` URL the window makes. */
export const GITHUB_IMAGE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  GIF: "image/gif",
  SVG: "image/svg+xml",
} as const;

export type GitHubImageType = (typeof GITHUB_IMAGE_TYPE)[keyof typeof GITHUB_IMAGE_TYPE];

/** A repository's file the window may draw: its repository as `owner/name`, its ref, its path's segments as written, and the type its extension names. */
export interface GitHubFileImage {
  readonly source: typeof GITHUB_IMAGE_SOURCE.FILE;
  readonly repository: string;
  readonly ref: string;
  readonly path: readonly string[];
  readonly contentType: GitHubImageType;
}

/** An image GitHub's rendering names, as the window may ask for it. */
export type GitHubImage =
  | { readonly source: typeof GITHUB_IMAGE_SOURCE.ASSET; readonly assetId: string }
  | { readonly source: typeof GITHUB_IMAGE_SOURCE.PUBLIC; readonly url: string }
  | GitHubFileImage;

export const GITHUB_IMAGE_BOUNDS = {
  /** The most bytes one image read from GitHub carries; a larger one is drawn as its link. */
  MAX_BYTES: 8 * 1024 * 1024,
  /** The most characters an image's address may spell to be asked for. */
  MAX_URL_CHARS: 2_048,
} as const;

/** GitHub's hosts, by what each holds. */
const HOST = {
  GITHUB: "github.com",
  PRIVATE_UPLOADS: "private-user-images.githubusercontent.com",
  PUBLIC_UPLOADS: "user-images.githubusercontent.com",
  CAMO: "camo.githubusercontent.com",
  RAW: "raw.githubusercontent.com",
} as const;

/** The type a repository's file is read as, by its extension; a file of any other is no image the window draws. */
const FILE_TYPES: ReadonlyMap<string, GitHubImageType> = new Map([
  ["png", GITHUB_IMAGE_TYPE.PNG],
  ["jpg", GITHUB_IMAGE_TYPE.JPEG],
  ["jpeg", GITHUB_IMAGE_TYPE.JPEG],
  ["webp", GITHUB_IMAGE_TYPE.WEBP],
  ["gif", GITHUB_IMAGE_TYPE.GIF],
  ["svg", GITHUB_IMAGE_TYPE.SVG],
]);

/** The segment `github.com/<owner>/<name>/raw/<ref>/<path>` names a repository's file under. */
const RAW_SEGMENT = "raw";

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A signed upload's file name: GitHub's number for it, then the asset's id, then its extension. */
const SIGNED_FILE = /^\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.\w+$/iu;

const SECURE = "https:";

/** An upload's id on `github.com`: `/user-attachments/assets/<id>`, or `/<owner>/<name>/assets/<id>`. */
function githubAssetId(segments: readonly string[]): string | undefined {
  const [first, second, third, fourth, ...rest] = segments;
  if (first === "user-attachments" && second === "assets" && fourth === undefined) return third;
  return third === "assets" && rest.length === 0 ? fourth : undefined;
}

/** The asset id a URL names an upload by, where it names one. */
function assetIdOf(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const id =
    url.hostname === HOST.GITHUB
      ? githubAssetId(segments)
      : SIGNED_FILE.exec(segments.at(-1) ?? "")?.[1];
  return id !== undefined && ASSET_ID.test(id) ? id.toLowerCase() : undefined;
}

/** A path segment as it is written, or nothing where it is no segment a file's path may hold. */
function decodedSegment(segment: string): string | undefined {
  if (!/^(?:[^%]|%[0-9a-f]{2})+$/iu.test(segment)) return undefined;
  const decoded = decodeURIComponent(segment);
  return decoded === "." || decoded === ".." || decoded.includes("/") ? undefined : decoded;
}

/** The repository's file `<owner>/<name>/<ref>/<path>` names, where its path ends in an image's extension. */
function fileOf(segments: readonly string[]): GitHubFileImage | undefined {
  const decoded = segments.map(decodedSegment).filter((segment) => segment !== undefined);
  if (decoded.length !== segments.length || decoded.length < 4) return undefined;
  const [owner = "", name = "", ref = "", ...path] = decoded;
  const extension = /\.([^.]+)$/u.exec(path.at(-1) ?? "")?.[1]?.toLowerCase() ?? "";
  const contentType = FILE_TYPES.get(extension);
  if (contentType === undefined) return undefined;
  return {
    source: GITHUB_IMAGE_SOURCE.FILE,
    repository: `${owner}/${name}`,
    ref,
    path,
    contentType,
  };
}

/** How the image an address names is read, or nothing where it is no image the window draws. */
export function githubImageOf(address: string): GitHubImage | undefined {
  if (address.length > GITHUB_IMAGE_BOUNDS.MAX_URL_CHARS || !URL.canParse(address)) {
    return undefined;
  }
  const url = new URL(address);
  if (url.protocol !== SECURE || url.username !== "" || url.password !== "") return undefined;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (url.hostname === HOST.RAW) return fileOf(segments);
  // Note that `github.com/<owner>/<name>/raw/<ref>/<path>` names the same file the raw host does.
  if (url.hostname === HOST.GITHUB && segments[2] === RAW_SEGMENT) {
    return fileOf([...segments.slice(0, 2), ...segments.slice(3)]);
  }
  if (url.hostname === HOST.GITHUB || url.hostname === HOST.PRIVATE_UPLOADS) {
    const assetId = assetIdOf(url);
    return assetId === undefined ? undefined : { source: GITHUB_IMAGE_SOURCE.ASSET, assetId };
  }
  if (url.hostname === HOST.CAMO || url.hostname === HOST.PUBLIC_UPLOADS) {
    return { source: GITHUB_IMAGE_SOURCE.PUBLIC, url: url.href };
  }
  return undefined;
}

/**
 * Whether an address GitHub answered a re-signing with names the very upload
 * asked for, on one of its own upload hosts: a signed address for a private
 * repository's, or the plain asset address a public repository's keeps.
 */
export function isUploadOf(address: string, assetId: string): boolean {
  const image = githubImageOf(address);
  return image?.source === GITHUB_IMAGE_SOURCE.ASSET && image.assetId === assetId.toLowerCase();
}
