# Parity Check

A local web app that compares an **original page** with its **migrated Edge Delivery Services page** at the site's own breakpoints. It marks every difference on side-by-side screenshots and recommends a CSS fix for each one.

## Run it

```sh
cd tools/parity-check
npm install        # once: Playwright, pixelmatch, pngjs
npx playwright install chromium   # once, if Chromium isn't installed yet
npm start          # http://127.0.0.1:4300
```

`PORT` and `HOST` environment variables override the defaults. Type `demo` in the chat to see a full comparison in about 20 seconds.

## Chat

The app opens as a chat. Requests are understood by simple local rules, with no AI service involved; nothing leaves your machine except the page loads.

Start a comparison either way:

- **Form** (shown in the welcome message, or the *Form* button next to *Send*): original URL, migrated URL and a **breakpoint block**:
  - each breakpoint is a chip; × removes it, *Clear all* removes every one;
  - type a width in px and press *Enter* or *+ Add breakpoint* (invalid or duplicate values get an inline message);
  - *Common* presets (480, 600, 768, 900, 1024, 1200, 1280, 1440) add or remove a breakpoint in one click;
  - *Detect from original* adds the breakpoints found in the original's CSS to your list, and you remove any you don't need.

  If you leave it empty, breakpoints are detected when you run. There are also toggles to also test mobile 375 / edges (breakpoint − 1px) / desktop 1440, optional selectors to ignore (chat widgets, ads, live feeds) and *Save breakpoints for this site*. A live preview shows the widths that will be tested.
- **Typed**, e.g. `compare https://www.example.com/about with https://main--site--org.aem.page/about breakpoints 768, 1024, 1280`. Your breakpoints are used as-is and the comparison runs right away. Without `breakpoints …`, the chat detects them from the original and shows them on a setup card first. If you paste one URL, the chat asks for the other.

The migrated page can also be `http://localhost:3000/{path}` while running `aem up`.

**Breakpoint detection** reads every `@media` rule from all the original's stylesheets, cross-origin ones included. `min-width`, `max-width` (767px → 768), range syntax (`width >= 900px`) and `em`/`rem` units are all understood.

**On the setup card**, before running, breakpoints are editable chips: click × to remove one, type in *+ breakpoint* to add one, or click a detected bar. You can also type:
`add breakpoint 1280` · `remove 640` · `breakpoints 600, 900, 1200` (replaces them) · `add edge widths` · `run`.

Breakpoints saved for a site (`sites.json`, per host) are reused automatically, so each site keeps its own breakpoints. Commit the file to share them.

Then ask follow-up questions:

| Ask | You get |
| --- | --- |
| `summary` · `score` | Parity score, per-width scores, breakpoint mismatch, top issues |
| `show high issues` · `what's wrong on mobile?` · `typography issues at 1024` | Filtered issue list; click one to see it on the page |
| `issue #3 at 375` | One issue with Original/Migrated close-ups and its fix |
| `show all fixes` · `fixes for cards` | CSS merged per file, ready to copy |
| `breakpoints` | Original vs migrated breakpoints, with a re-run at the mismatched widths |
| `re-run` | Same comparison again, with the same breakpoints |
| `download the PDF report` · `download html` | The report file (see below) |
| `history` | Earlier comparisons, which can be reopened in the chat |

## Visual parity toggle

The **Visual parity** switch at the top of the chat opens a panel beside the conversation. Clicking any issue in the chat also switches it on. The viewer borrows patterns from free tools reviewers already know:

| View (key) | Modelled on | What it does |
| --- | --- | --- |
| Side by side (`1`) | — | Both pages with synced scroll and one numbered pin per element |
| Overlay (`2`) | PerfectPixel extension | Migrated over original with an opacity slider. **Difference** (`D`) blends the two: identical pixels turn black and every mismatch lights up. *⇅* swaps which page is on top |
| Swipe (`3`) | BackstopJS report scrubber | Press anywhere on the page and drag to wipe between Original and Migrated |
| Pixel diff (`4`) | BackstopJS / pixelmatch | Changed pixels in red, with hotspot boxes |
| Breakpoints (`5`) | Responsive Viewer / Polypane | Every tested width side by side at true relative size, with a dot per issue. Click one to open it |

The selected issue is spotlighted on both pages: the rest of the page dims and both sides scroll to the element. Each label shows that side's value (e.g. `16px` on the original, `18px` on the migrated page). Spacing issues get **VisBug-style measurement guides** showing the gap on each side. Missing content gets a dashed box where it should be.

Each issue in the list shows Original/Migrated close-ups, the values, a **computed-style comparison** (DevTools-style, with differing properties highlighted; *Show all* lists every property), the element, and the recommended fix.

### Review (Chromatic / Percy style)

Mark each issue **Needs fix** (`F`) or **Approve** (`A`) if the difference is intended. Each decision jumps to the next unreviewed issue, and a progress bar shows how much of the width is reviewed. *Hide approved* filters approved issues out. Decisions are saved with the report (`reports/<id>/review.json`), and the downloaded report uses them: approved differences are listed separately, and issues to fix are tagged.

Keys: `←` `→` navigate · `F` needs fix · `A` approve · `1`–`5` views · `D` difference · `Esc` clear.

*Full page ↗* opens the same report full-screen, with the **Across breakpoints** matrix and **All fixes** tabs.

## Downloadable report

**Download PDF report** (or the HTML version) produces a shareable report of every issue:

- A cover with the parity score, issue counts, review progress, breakpoints and any breakpoint mismatch.
- A matrix of issues × tested widths.
- For each width, an overview of both pages with every issue outlined and numbered. Each issue follows with its severity, an explanation, **Original and Migrated close-ups with the problem outlined** (drawn into the image), the computed styles that differ, the values, the element and the CSS fix. Approved differences are listed at the end of each width.
- All recommended CSS fixes, merged per file.

The HTML file is self-contained, with images embedded. The PDF is printed by Chromium and cached until the report changes.

## How fixes are written

A fix gets a media query only if the issue doesn't occur at every tested width, and the query uses the **original site's breakpoints** (`@media (640px <= width < 1024px)`). Where a migrated design token holds the same value, the fix uses it (`var(--heading-font-size-xl)`). Fixes target `blocks/<block>/<block>.css` or `styles/styles.css`.

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
| Embeds | Twitter/X, Instagram, TikTok, Facebook, YouTube, Vimeo, Spotify, Google Maps, LinkedIn: compared as embeds, never as text. Reported when one is missing, extra, or rendered on one page but still the plain fallback (e.g. the tweet text) on the other. Capture waits up to 6s for provider scripts to render them |
| Page | Height difference, failed requests |

Elements are matched by text first: unique exact matches, then duplicates resolved by position, then fuzzy matches. A vertical mapping learned from those anchors then matches images and controls. Translate transforms are removed before measuring, so scroll-reveal animations don't create false spacing issues. Shuffled content is left out of the spacing rules.

## Notes

- Fixes are recommendations computed from rendered styles. Review them before pasting, especially `margin`/`padding` changes, because margins collapse.
- Common cookie banners (OneTrust, Usercentrics and similar) are hidden before capture.
- Long pages are captured up to 12,000px tall.
- The conversation is kept in the browser (local storage). *New chat* clears it; reports stay available under History.
- Reports are written to `reports/` (git-ignored). The whole folder is in `.hlxignore`, so none of it is served by the site.
