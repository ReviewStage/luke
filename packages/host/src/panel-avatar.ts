/**
 * panel-avatar.ts -- the call's avatar grant and voice feed, relayed to the panel window's page and no other, and the call window's view of its video.
 *
 * Keyframe's session token can view the avatar and send it audio, so it
 * reaches one renderer: the panel's, which runs the session and draws its
 * video at the top of the Call tab. It is never written to the document,
 * which every window reads, and never broadcast. Nothing here calls
 * Electron, so what reaches the page is read and tested as the plain relay
 * it is.
 */

import type { AvatarGrant } from "@luke/features/avatar-grant";
import type { AvatarFeed } from "@luke/voice/avatar";
import type { AvatarViewSignal } from "@luke/voice/avatar-view";
import { PUSH, type PushName, type PushPayload } from "./contract/pushes.js";

/** The panel's page as the relay reaches it: its own pushes, and nothing wider. */
export interface AvatarPage {
  push<Name extends PushName>(push: Name, payload: PushPayload<Name>): void;
}

/**
 * The grant standing for the call, held so a page that draws after it was
 * handed over still receives it: a grant can come before the panel's
 * renderer has loaded. The feed is not held, since a chunk that found no
 * page has expired by the time one draws.
 */
export class PanelAvatarRelay {
  readonly #page: () => AvatarPage | undefined;
  #grant: AvatarGrant | undefined;

  /** `page` answers the panel's page once it has drawn, and nothing before. */
  constructor(page: () => AvatarPage | undefined) {
    this.#page = page;
  }

  /** The grant to join with, or nothing once the session is to close. */
  showAvatarSession(grant: AvatarGrant | undefined): void {
    this.#grant = grant;
    this.#page()?.push(PUSH.AVATAR_SESSION, grant);
  }

  feedAvatar(feed: AvatarFeed): void {
    this.#page()?.push(PUSH.AVATAR_FEED, feed);
  }

  /**
   * The call window's offer or close for its view of the avatar's video,
   * which the panel answers with the track it plays. Not held: a view a page
   * never heard of is offered again by the window that wants it.
   */
  signalView(signal: AvatarViewSignal): void {
    this.#page()?.push(PUSH.AVATAR_VIEW_SIGNAL, signal);
  }

  /** A fresh page has drawn: it is handed the grant standing, if one does. */
  pageDrew(): void {
    if (this.#grant === undefined) return;
    this.#page()?.push(PUSH.AVATAR_SESSION, this.#grant);
  }
}
