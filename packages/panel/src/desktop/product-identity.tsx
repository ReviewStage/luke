import { PRODUCT_NAME } from "@repo/features/product-name";
import { ProductMark, SidebarIdentity } from "@repo/ui";

/**
 * The product at the head of the sidebar: its mark and its name. The head does
 * not say what the app is doing, and the mark holds still. A surface that is
 * ours but not the app itself, the web's admin dashboard, names itself under
 * its name (`qualifier`), muted, so the head reads as the app's and still says
 * where the reader is.
 */
export function ProductIdentity({
  qualifier,
}: {
  qualifier?: string | undefined;
}): React.JSX.Element {
  return (
    <SidebarIdentity
      name={PRODUCT_NAME}
      qualifier={qualifier}
      mark={<ProductMark fill small />}
      replayUnmasked
    />
  );
}
