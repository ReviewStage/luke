import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { ViewingAsBanner } from "@repo/ui";
import { useLayoutEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";

/**
 * viewing-as.tsx -- the Viewing as strip across the top of the window while a maintainer is signed in as the member, over every place of it.
 *
 * It is drawn while the account says a maintainer opened its session
 * (`impersonated`, which only a browser tab's cookie session carries) and the
 * shell can end that sign-in (`stopImpersonating`), which the Mac app never
 * can. The strip stands above the window's content rather than over it: its
 * height is written on the root as `--viewing-as-height`, which the stage
 * keeps clear (`desktop.css`), so no toolbar or composer stands under it.
 */

/** The custom property the stage keeps clear of the strip by. */
const HEIGHT_PROPERTY = "--viewing-as-height";

/** The strip, while a maintainer is signed in as the member; nothing otherwise. */
export function ViewingAs(): React.JSX.Element | null {
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const stop = appPlatform().stopImpersonating;
  if (account?.status !== ACCOUNT_STATUS.SIGNED_IN || account.impersonated !== true) return null;
  const memberId = account.id;
  if (stop === undefined || memberId === undefined) return null;
  return (
    <ViewingAsStrip
      member={{ name: account.name, email: account.email }}
      onStop={() => stop(memberId)}
    />
  );
}

function ViewingAsStrip({
  member,
  onStop,
}: {
  member: { name?: string | undefined; email: string };
  onStop: () => Promise<string | undefined>;
}): React.JSX.Element {
  const strip = useRef<HTMLDivElement>(null);
  // Note that the height is measured as it changes, because the strip wraps
  // onto a second line where the window is narrow.
  useLayoutEffect(() => {
    const element = strip.current;
    if (element === null) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty(HEIGHT_PROPERTY, `${element.offsetHeight}px`);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_PROPERTY);
    };
  }, []);
  return (
    <div ref={strip} className="viewing-as">
      <ViewingAsBanner member={member} onStop={onStop} />
    </div>
  );
}
