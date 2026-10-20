/**
 * update-acts.ts -- the updater's acts as main carries them: a check, the install, and the releases page and changelog opened.
 *
 * Each is handed to the update service as it stands; none reads which window
 * asked, as none did on `app:act`.
 */

import { actPortFor, type PlatformActProcedures } from "@luke/host/act-port";
import { UPDATE_ACT_KIND } from "@luke/host/contract";
import type { WebContents } from "electron";
import type { UpdateServiceHost } from "../services/update-service-host";

type UpdateActKind = (typeof UPDATE_ACT_KIND)[keyof typeof UPDATE_ACT_KIND];

export interface UpdateActsDependencies {
  updates: Pick<UpdateServiceHost, "check" | "install" | "openLatestRelease" | "openChangelog">;
}

const updatePort = actPortFor<WebContents>();

export function updateProcedures({
  updates,
}: UpdateActsDependencies): Pick<PlatformActProcedures<WebContents>, UpdateActKind> {
  return {
    [UPDATE_ACT_KIND.UPDATE_CHECK]: updatePort[UPDATE_ACT_KIND.UPDATE_CHECK].handler(() =>
      updates.check(),
    ),
    [UPDATE_ACT_KIND.UPDATE_INSTALL]: updatePort[UPDATE_ACT_KIND.UPDATE_INSTALL].handler(() =>
      updates.install(),
    ),
    [UPDATE_ACT_KIND.UPDATE_OPEN_RELEASE]: updatePort[UPDATE_ACT_KIND.UPDATE_OPEN_RELEASE].handler(
      () => updates.openLatestRelease(),
    ),
    [UPDATE_ACT_KIND.UPDATE_OPEN_CHANGELOG]: updatePort[
      UPDATE_ACT_KIND.UPDATE_OPEN_CHANGELOG
    ].handler(() => updates.openChangelog()),
  };
}
