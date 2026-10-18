import { DENSITY, type Density, PROFILE, type Profile, THEME, type Theme } from "@luke/ui";
import { EXAMPLES, type Example } from "./examples";

/**
 * catalog.tsx -- the catalog's page: the index of examples, the profile and
 * theme they are drawn at, and the one example chosen.
 *
 * The address is the whole state, `?example=<id>&profile=<p>&theme=<t>`,
 * and `&density=compact` for the site's compact surface, so
 * every view is a link a reader can share and a test can open, and the
 * shell keeps no state of its own. The profile and theme are the document's
 * own attributes (`main.tsx`), as they are on an app's root, so whatever an
 * example portals into the body is drawn at them too.
 */

/** What the catalog shows: one example, at one profile, in one theme, compact where the site's is asked for. */
export interface CatalogView {
  readonly example: Example;
  readonly profile: Profile;
  readonly theme: Theme;
  readonly density: Density | undefined;
}

/** The themes a reader picks between; `system` is the desktop's own and follows whatever the machine is set to. */
const THEMES = [THEME.DARK, THEME.LIGHT] as const;
const PROFILES = [PROFILE.DESKTOP, PROFILE.WEB] as const;
/** The site's densities: its own, which no attribute names, and the compact one. */
const DENSITIES = [undefined, DENSITY.COMPACT] as const;

/** `value` if it is one of `known`, else `fallback`. */
function oneOf<Value extends string>(
  value: string | null,
  known: readonly Value[],
  fallback: Value,
): Value {
  return known.find((candidate) => candidate === value) ?? fallback;
}

/** The view an address asks for, the first example at the desktop's dark where it names none. */
export function readView(search: string): CatalogView {
  const params = new URLSearchParams(search);
  const first = EXAMPLES[0];
  if (first === undefined) throw new Error("The catalog has no examples");
  const profile = oneOf(params.get("profile"), PROFILES, PROFILE.DESKTOP);
  return {
    example: EXAMPLES.find((example) => example.id === params.get("example")) ?? first,
    profile,
    theme: oneOf(params.get("theme"), THEMES, THEME.DARK),
    // The desktop has one density, so an address asking it for another gets its own.
    density:
      profile === PROFILE.WEB
        ? DENSITIES.find((candidate) => candidate === params.get("density"))
        : undefined,
  };
}

/** The address of `view`. */
function hrefOf(view: CatalogView): string {
  const params = new URLSearchParams({
    example: view.example.id,
    profile: view.profile,
    theme: view.theme,
  });
  if (view.density !== undefined) params.set("density", view.density);
  return `?${params.toString()}`;
}

/** One way to change one part of the view, current where it is the view's own. */
function ViewLink({
  view,
  current,
  children,
}: {
  view: CatalogView;
  current: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a className="catalog-link" href={hrefOf(view)} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}

/** One example under its heading, as the page draws it. */
function ExampleFrame({ example }: { example: Example }): React.JSX.Element {
  return (
    <main className="catalog-example">
      <h1 className="catalog-example-title">{example.title}</h1>
      <example.Render />
    </main>
  );
}

export function Catalog({ view }: { view: CatalogView }): React.JSX.Element {
  const { example, profile, theme, density } = view;
  return (
    <div className="catalog">
      <nav className="catalog-index" aria-label="Examples">
        <p className="catalog-index-title">Luke catalog</p>
        <ul>
          {EXAMPLES.map((entry) => (
            <li key={entry.id}>
              <ViewLink view={{ ...view, example: entry }} current={entry === example}>
                {entry.title}
              </ViewLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="catalog-stage">
        <div className="catalog-toolbar">
          <ul aria-label="Profile">
            {PROFILES.map((option) => (
              <li key={option}>
                <ViewLink view={{ ...view, profile: option }} current={option === profile}>
                  {option}
                </ViewLink>
              </li>
            ))}
          </ul>
          {profile === PROFILE.WEB ? (
            <ul aria-label="Density">
              {DENSITIES.map((option) => (
                <li key={option ?? "regular"}>
                  <ViewLink view={{ ...view, density: option }} current={option === density}>
                    {option ?? "regular"}
                  </ViewLink>
                </li>
              ))}
            </ul>
          ) : null}
          <ul aria-label="Theme">
            {THEMES.map((option) => (
              <li key={option}>
                <ViewLink view={{ ...view, theme: option }} current={option === theme}>
                  {option}
                </ViewLink>
              </li>
            ))}
          </ul>
        </div>
        <ExampleFrame example={example} />
      </div>
    </div>
  );
}
