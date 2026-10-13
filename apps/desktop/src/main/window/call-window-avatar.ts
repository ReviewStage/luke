/**
 * call-window-avatar.ts -- the call's avatar grant and voice feed, relayed to the floating call window's page and no other.
 *
 * Keyframe's session token can view the avatar and send it audio, so it
 * reaches one renderer: the call window's, which runs the session. It is
 * never written to the document, which every window reads, and never
 * broadcast. Nothing here calls Electron, so what reaches the page is read
 * and tested as the plain relay it is.
 */

import type { UnparsedWireValue } from "@sidecar/wire";
import { channels } from "#shared/bridge";
import type { AvatarFeed, AvatarGrant } from "#shared/messages/avatar";

/** The call window's page as the relay reaches it: its own `webContents`, and nothing wider. */
export interface CallWindowPage {
  send(channel: string, payload: UnparsedWireValue): void;
}

/**
 * The grant standing for the call, held so a page that draws after it was
 * handed over still receives it: the window opens on the first `STARTING`,
 * which can come before its renderer has loaded, and a renderer that died is
 * stood back up mid-call. The feed is not held, since a chunk that found no
 * page has expired by the time one draws.
 */
export class CallAvatarRelay {
  readonly #page: () => CallWindowPage | undefined;
  #grant: AvatarGrant | undefined;

  /** `page` answers the call window's page once it has drawn, and nothing before. */
  constructor(page: () => CallWindowPage | undefined) {
    this.#page = page;
  }

  /** The grant to join with, or nothing once the session is to close. */
  showAvatarSession(grant: AvatarGrant | undefined): void {
    this.#grant = grant;
    // SAFETY: the grant is the structured-clone value `avatarGrantFromWire` reads on the page.
    this.#page()?.send(channels.onAvatarSession, grant as UnparsedWireValue);
  }

  feedAvatar(feed: AvatarFeed): void {
    // SAFETY: the feed is the structured-clone value `avatarFeedFromWire` admitted.
    this.#page()?.send(channels.onAvatarFeed, feed as UnparsedWireValue);
  }

  /** A fresh page has drawn: it is handed the grant standing, if one does. */
  pageDrew(): void {
    if (this.#grant === undefined) return;
    // SAFETY: as in `showAvatarSession`.
    this.#page()?.send(channels.onAvatarSession, this.#grant as UnparsedWireValue);
  }
}
