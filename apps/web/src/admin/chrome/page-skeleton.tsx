import { type AdminTab, plainLeftClick, tabHref } from "../routing";
import { SkeletonBody, type SkeletonShape } from "../skeleton";
import { PageHeader, type ViewerAccount } from "./page-header";

/**
 * The loading stand-in every view wears: the page's own header and controls,
 * drawn for real, over the bones its own sections name. The header is the
 * loaded page's own component, so the two cannot drift apart — which is what
 * four page-shaped copies of it could not promise.
 */
export function PageSkeleton({
  title,
  account,
  onSignOut,
  controls,
  loading,
  back,
  shapes,
}: {
  title: string;
  account: ViewerAccount | undefined;
  onSignOut: () => void;
  controls: React.ReactNode;
  /** What the visually hidden line says this page is reading. */
  loading: string;
  back?: { tab: AdminTab; label: string; onBack: () => void };
  shapes: readonly SkeletonShape[];
}): React.JSX.Element {
  return (
    <main
      className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10"
      aria-busy="true"
    >
      <PageHeader
        title={title}
        account={account}
        accountSkeleton
        onSignOut={onSignOut}
        controls={controls}
      />
      <p className="sr-only">Loading. {loading}</p>
      {back === undefined ? null : (
        <a
          href={tabHref(back.tab)}
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          onClick={(event) => {
            if (!plainLeftClick(event)) return;
            event.preventDefault();
            back.onBack();
          }}
        >
          <span aria-hidden="true">←</span> {back.label}
        </a>
      )}
      <SkeletonBody shapes={shapes} />
    </main>
  );
}
