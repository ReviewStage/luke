import type { ReactNode } from "react";

/**
 * section.tsx -- one titled group of samples within an example. Its heading
 * wears a class of its own, so the catalog's page rules never reach a shared
 * component an example draws as a heading.
 */
export function CatalogSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="catalog-section" aria-labelledby={id}>
      <h2 id={id} className="catalog-section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}
