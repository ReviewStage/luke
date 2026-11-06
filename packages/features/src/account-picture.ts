const GOOGLE_PICTURE_HOST = "googleusercontent.com";
const GITHUB_PICTURE_HOST = "avatars.githubusercontent.com";

const GOOGLE_PICTURE_SIZE = /=s\d+(-c)?$/u;

const GITHUB_AVATAR_REVISION = "4";

function httpsUrl(value: string | null | undefined): URL | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" ? url : undefined;
}

export function pinnedPictureUrl(value: string | null | undefined): string | undefined {
  const url = httpsUrl(value);
  if (url === undefined) return undefined;
  const host = url.hostname;
  const googleHosted = host === GOOGLE_PICTURE_HOST || host.endsWith(`.${GOOGLE_PICTURE_HOST}`);
  return googleHosted || host === GITHUB_PICTURE_HOST ? url.toString() : undefined;
}

export function githubAvatarUrl(value: string | null | undefined): string | undefined {
  const url = httpsUrl(value);
  return url?.hostname === GITHUB_PICTURE_HOST ? url.toString() : undefined;
}

export function githubUserAvatarUrl(person: { readonly login: string }): string {
  const url = new URL(`https://${GITHUB_PICTURE_HOST}/`);
  url.pathname = `/${encodeURIComponent(person.login)}`;
  url.searchParams.set("v", GITHUB_AVATAR_REVISION);
  return url.toString();
}

export function githubAccountAvatarUrl(accountId: number): string {
  const url = new URL(`https://${GITHUB_PICTURE_HOST}/`);
  url.pathname = `/u/${encodeURIComponent(String(accountId))}`;
  url.searchParams.set("v", GITHUB_AVATAR_REVISION);
  return url.toString();
}

export function githubAppAvatarUrl(appId: number): string {
  const url = new URL(`https://${GITHUB_PICTURE_HOST}/`);
  url.pathname = `/in/${encodeURIComponent(String(appId))}`;
  url.searchParams.set("v", GITHUB_AVATAR_REVISION);
  return url.toString();
}

export function githubAvatarAt(value: string, pixels: number): string {
  const url = httpsUrl(value);
  if (url?.hostname !== GITHUB_PICTURE_HOST) return value;
  url.searchParams.set("s", String(Math.round(pixels)));
  return url.toString();
}

export function accountPictureAt(value: string, pixels: number): string {
  const url = httpsUrl(value);
  if (url === undefined) return value;
  if (url.hostname === GITHUB_PICTURE_HOST) return githubAvatarAt(value, pixels);
  const host = url.hostname;
  const googleHosted = host === GOOGLE_PICTURE_HOST || host.endsWith(`.${GOOGLE_PICTURE_HOST}`);
  if (!googleHosted || !GOOGLE_PICTURE_SIZE.test(url.pathname)) return value;
  url.pathname = url.pathname.replace(GOOGLE_PICTURE_SIZE, `=s${String(Math.round(pixels))}-c`);
  return url.toString();
}
