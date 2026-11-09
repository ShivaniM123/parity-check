# Parity Check

A local web app that compares an **original page** with its **migrated Edge Delivery Services page** at the site's own breakpoints. It marks every difference on side-by-side screenshots and recommends a CSS fix for each one.

## Run it

```sh
cd tools/parity-check
npm install        # once: Playwright, pixelmatch, pngjs
npx playwright install chromium   # once, if Chromium isn't installed yet
npm start          # http://127.0.0.1:4300
```

`PORT` and `HOST` environment variables override the defaults. Click **Try the demo pair** to see a full report in about 20 seconds.

## Workflow

1. **Enter both URLs.** The original page, and the migrated page (`https://{branch}--{repo}--{owner}.aem.page/{path}` or `http://localhost:3000/{path}` while running `aem up`).
2. **Detect from original.** The tool loads the original page and reads every `@media` rule from all its stylesheets, cross-origin ones included. It then shows the breakpoints it found, ranked by how many rules use them. `min-width`, `max-width` (767px → 768), range syntax (`width >= 900px`) and `em`/`rem` units are all understood.
3. **Pick the test widths.** These are the breakpoints plus a mobile base (375), an optional "edge" width (breakpoint − 1px) and a wide desktop width (1440). You can add extra widths.
4. **Save breakpoints for this site.** They're stored per host in `sites.json` and load automatically next time, so each site keeps its own breakpoints. Commit the file to share them with the team.
5. **Run comparison.**

## The report

- **Parity score per width.** It combines pixel similarity, the share of elements matched, and issues weighted by severity.
- **Breakpoint mismatch banner.** It lists breakpoints the original uses that the migrated CSS lacks, and the reverse. One click re-runs the comparison at those boundaries.
- **Viewer** with four modes: *Side by side* (synced scroll), *Overlay* (opacity slider), *Swipe* and *Pixel diff* (with hotspots). Numbered markers show each issue on both screenshots. A dashed marker shows where missing content should be.
- **Issue list.** Each issue has a severity, a category, the original and migrated values (with color swatches) and the migrated element's selector. It also has a **recommended fix**: the target file (`blocks/<block>/<block>.css` or `styles/styles.css`) and a ready-to-paste CSS rule.
- **Across breakpoints.** A matrix of issues × widths shows which problems happen everywhere and which only happen in some ranges.
- **All fixes.** Every fix merged per file. A rule gets a media query only if the issue doesn't occur at every tested width, and the query uses the **original site's breakpoints** (`@media (640px <= width < 1024px)`). Where a migrated design token holds the same value, the fix uses it (`var(--heading-font-size-xl)`).

## What it checks

| Category | Rules |
| --- | --- |
| Layout | Columns per row in grids/cards (both directions), content column width / gutters, text wrapping |
| Typography | Font family (rolled up to `--heading-font-family` / `--body-font-family`), size, weight, line height, letter spacing, case, alignment, link decoration, web fonts that fail to load |
| Color | Text color, effective background (section/card backgrounds) |
| Component | Buttons: background, radius, padding, border |
| Spacing | Vertical gap between consecutive elements. The fix goes on whichever margin or section padding creates the gap |
| Image | Aspect ratio / crop, rendered size (ignored when the image just fills its container), broken images |
| Responsive | Elements hidden at a width (or shown when the original hides them), horizontal scrolling |
| Content | Missing sections (header/footer issues point to the nav/footer fragment), extra content, randomized content at the same spot, heading-level changes |
| Page | Height difference, failed requests |

Elements are matched by text first: unique exact matches, then duplicates resolved by position, then fuzzy matches. A vertical mapping learned from those anchors then matches images and controls. Translate transforms are removed before measuring, so scroll-reveal animations don't create false spacing issues. Shuffled content is left out of the spacing rules.

## Notes

- Fixes are recommendations computed from rendered styles. Review them before pasting, especially `margin`/`padding` changes, because margins collapse.
- Cookie banners and chat widgets can be hidden before capture (Advanced → *Hide before capture*). Use the same option to exclude dynamic areas.
- Long pages are captured up to *Max capture height* (12,000px by default).
- Reports are written to `reports/` (git-ignored). The whole folder is in `.hlxignore`, so none of it is served by the site.
