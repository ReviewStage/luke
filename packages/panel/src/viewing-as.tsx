import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { ViewingAsBanner } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

const HEIGHT_PROPERTY = "--viewing-as-height";

export function ViewingAs(): React.JSX.Element | null {
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
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
  const stopping = useMutation({ mutationFn: onStop });
  const strip = useRef<HTMLDivElement>(null);
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
      <ViewingAsBanner
        member={member}
        stop={{
          run: () => stopping.mutate(),
          busy: stopping.isPending,
          refusal: stopping.data,
          failed: stopping.isError,
        }}
      />
    </div>
  );
}
