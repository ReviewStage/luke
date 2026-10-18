# `@luke/ui`

The React that more than one app mounts: the face and the glyphs traced from
`@luke/brand`'s generated art, every provider's brand mark, the chart, `cn`, and
the custom-property bridge a component's `style` reads; and the DOM-free view
models a page is drawn from (the site's account initials, activity calendar,
daily series, and animations roster).

- A view model is a `.ts` module that imports no React, at a subpath of its
  own (`@luke/ui/<name>`), so an app that reads one never resolves React
  through it.
- A component takes its data and its callbacks as props. A shared context
  lands only when three components need the same door, because a context is a
  second way in that every app has to provide.
- Nothing here reaches an app: no `window.luke`, no `#shared/`, `#renderer/`,
  or `#main/` import. The desktop's bridge and the site's fetches stay in the
  app that mounts the component, and `repository-checks.sh` refuses either
  spelled under `src/`.
- A component draws with its own `luke-*` classes over the `--luke-*` tokens,
  never an app's Tailwind theme, whose `--color-*` each app maps to a
  different role; `repository-checks.sh` refuses a theme colour utility or the
  `-(--name)` shorthand here. The chart's frame is `src/chart/chart.css`.
- A module that pulls a heavy library gets a subpath of its own and stays out
  of the barrel: the chart is `@luke/ui/chart`, so recharts reaches only the
  bundle that draws a chart.
- A provider's mark is the brand's own vector, drawn once in
  `marks/provider-mark.tsx` for every app. A mark whose brand names one ink per
  ground wears an `integration-mark-*` class, and each app that mounts it sets
  those inks for the grounds it draws.
