/**
 * account-picture.ts -- the one rule for which address a person's sign-in picture may be drawn from.
 *
 * The only hosts a picture may be loaded from, matching the renderer's image
 * policy exactly (`apps/desktop/src/renderer/index.html`'s `img-src`): Google
 * serves profile photos from `googleusercontent.com` and GitHub from
 * `avatars.githubusercontent.com`. A picture anywhere else is dropped rather
 * than handed to a renderer whose CSP would refuse it, and the set is fixed
 * by this build, like every address the renderer is given. The desktop's
 * sign-in reads its own account's picture through this
 * (`packages/credentials/src/account/client.ts`), and the service reads a
 * personal workspace's owner's picture through it. Someone a pull request
 * names on GitHub is drawn by their GitHub avatar alone (`githubAvatarUrl`).
 */

const GOOGLE_PICTURE_HOST = "googleusercontent.com";
const GITHUB_PICTURE_HOST = "avatars.githubusercontent.com";

/** The address as an https URL, where it reads as one; nothing otherwise. */
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

/** The address itself, normalized, where it is an https address on a host a picture may be drawn from; nothing otherwise. */
export function pinnedPictureUrl(value: string | null | undefined): string | undefined {
  const url = httpsUrl(value);
  if (url === undefined) return undefined;
  const host = url.hostname;
  const googleHosted = host === GOOGLE_PICTURE_HOST || host.endsWith(`.${GOOGLE_PICTURE_HOST}`);
  return googleHosted || host === GITHUB_PICTURE_HOST ? url.toString() : undefined;
}

/** A GitHub account's avatar, normalized, where it is served from GitHub's own avatar host; nothing otherwise, a Google address among them. */
export function githubAvatarUrl(value: string | null | undefined): string | undefined {
  const url = httpsUrl(value);
  return url?.hostname === GITHUB_PICTURE_HOST ? url.toString() : undefined;
}
