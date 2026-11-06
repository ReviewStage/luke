export const GITHUB_IMAGE_SOURCE = {
  ASSET: "asset",
  PUBLIC: "public",
  FILE: "file",
} as const;

export const GITHUB_IMAGE_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  GIF: "image/gif",
  SVG: "image/svg+xml",
} as const;

export type GitHubImageType = (typeof GITHUB_IMAGE_TYPE)[keyof typeof GITHUB_IMAGE_TYPE];

export interface GitHubFileImage {
  readonly source: typeof GITHUB_IMAGE_SOURCE.FILE;
  readonly repository: string;
  readonly ref: string;
  readonly path: readonly string[];
  readonly contentType: GitHubImageType;
}

export type GitHubImage =
  | { readonly source: typeof GITHUB_IMAGE_SOURCE.ASSET; readonly assetId: string }
  | { readonly source: typeof GITHUB_IMAGE_SOURCE.PUBLIC; readonly url: string }
  | GitHubFileImage;

export const GITHUB_IMAGE_BOUNDS = {
  MAX_BYTES: 8 * 1024 * 1024,
  MAX_URL_CHARS: 2_048,
} as const;

const HOST = {
  GITHUB: "github.com",
  PRIVATE_UPLOADS: "private-user-images.githubusercontent.com",
  PUBLIC_UPLOADS: "user-images.githubusercontent.com",
  CAMO: "camo.githubusercontent.com",
  RAW: "raw.githubusercontent.com",
} as const;

const FILE_TYPES: ReadonlyMap<string, GitHubImageType> = new Map([
  ["png", GITHUB_IMAGE_TYPE.PNG],
  ["jpg", GITHUB_IMAGE_TYPE.JPEG],
  ["jpeg", GITHUB_IMAGE_TYPE.JPEG],
  ["webp", GITHUB_IMAGE_TYPE.WEBP],
  ["gif", GITHUB_IMAGE_TYPE.GIF],
  ["svg", GITHUB_IMAGE_TYPE.SVG],
]);

export function imageTypeOfPath(path: string): GitHubImageType | undefined {
  const extension = /\.([^./]+)$/u.exec(path)?.[1]?.toLowerCase() ?? "";
  return FILE_TYPES.get(extension);
}

const RAW_SEGMENT = "raw";

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const SIGNED_FILE = /^\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.\w+$/iu;

const SECURE = "https:";

function githubAssetId(segments: readonly string[]): string | undefined {
  const [first, second, third, fourth, ...rest] = segments;
  if (first === "user-attachments" && second === "assets" && fourth === undefined) return third;
  return third === "assets" && rest.length === 0 ? fourth : undefined;
}

function assetIdOf(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const id =
    url.hostname === HOST.GITHUB
      ? githubAssetId(segments)
      : SIGNED_FILE.exec(segments.at(-1) ?? "")?.[1];
  return id !== undefined && ASSET_ID.test(id) ? id.toLowerCase() : undefined;
}

function decodedSegment(segment: string): string | undefined {
  if (!/^(?:[^%]|%[0-9a-f]{2})+$/iu.test(segment)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  return decoded === "." || decoded === ".." || decoded.includes("/") ? undefined : decoded;
}

function fileOf(segments: readonly string[]): GitHubFileImage | undefined {
  const decoded = segments.map(decodedSegment).filter((segment) => segment !== undefined);
  if (decoded.length !== segments.length || decoded.length < 4) return undefined;
  const [owner = "", name = "", ref = "", ...path] = decoded;
  const contentType = imageTypeOfPath(path.at(-1) ?? "");
  if (contentType === undefined) return undefined;
  return {
    source: GITHUB_IMAGE_SOURCE.FILE,
    repository: `${owner}/${name}`,
    ref,
    path,
    contentType,
  };
}

export function githubImageOf(address: string): GitHubImage | undefined {
  if (address.length > GITHUB_IMAGE_BOUNDS.MAX_URL_CHARS || !URL.canParse(address)) {
    return undefined;
  }
  const url = new URL(address);
  if (url.protocol !== SECURE || url.username !== "" || url.password !== "") return undefined;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (url.hostname === HOST.RAW) return fileOf(segments);
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

export function isUploadOf(address: string, assetId: string): boolean {
  const image = githubImageOf(address);
  return image?.source === GITHUB_IMAGE_SOURCE.ASSET && image.assetId === assetId.toLowerCase();
}
