import { PRODUCT_NAME } from "@repo/features/product-name";
import { ProductMark, SidebarIdentity } from "@repo/ui";

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
