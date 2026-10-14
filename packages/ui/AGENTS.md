# `@luke/ui`

The React that more than one app mounts: the face and the glyphs traced from
`@luke/brand`'s generated art, every provider's brand mark, and the
custom-property bridge a component's `style` reads.

- A component takes its data and its callbacks as props. A shared context
  lands only when three components need the same door, because a context is a
  second way in that every app has to provide.
- Nothing here reaches an app: no `window.luke`, no `#shared/`, `#renderer/`,
  or `#main/` import. The desktop's bridge and the site's fetches stay in the
  app that mounts the component, and `repository-checks.sh` refuses either
  spelled under `src/`.
- No Tailwind utility is spelled here yet, so neither app's stylesheet scans
  this package. The first module that spells one adds the `@source` line to
  each app that mounts it.
- A provider's mark is the brand's own vector, drawn once in
  `marks/provider-mark.tsx` for every app. A mark whose brand names one ink per
  ground wears an `integration-mark-*` class, and each app that mounts it sets
  those inks for the grounds it draws.
