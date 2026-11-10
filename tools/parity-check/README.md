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

When a comparison finishes, the chat shows a **Comparison complete** card with the original and migrated pages, the parity score out of 100 with High / Medium / Low counts, the tested widths and *Show visual parity*. On wide screens the **Comparison summary** panel on the right stays pinned while the chat scrolls:

- **High / Medium / Low tiles**. Click one to list those issues in the chat.
- **Top issues** with their widths: most severe first, as many as fit the panel (no scrolling). *View all* lists the rest. Click one to see it on the page. *View all* lists every issue.
- **Quick actions**: *Download report* (PDF), *Copy for AEM Coder*, *Run new comparison*.

Below 1000px the panel hides, and the card shows the top issues and actions instead. Past comparisons are under *History* in the top bar.

The app opens as a chat. Requests are understood by simple local rules, with no AI service involved; nothing leaves your machine except the page loads.

Start a comparison either way:

- **Form** (shown in the welcome message, or the *Form* button next to *Send*): original URL, migrated URL and a **breakpoint block**:
  - each breakpoint is a chip; × removes it, *Clear all* removes every one;
  - type a width in px and press *Enter* or *+ Add breakpoint* (invalid or duplicate values get an inline message);
  - *Common* presets (480, 600, 768, 900, 1024, 1200, 1280, 1440) add or remove a breakpoint in one click;
  - *Detect from original* adds the breakpoints found in the original's CSS to your list, and you remove any you don't need.

  If you leave it empty, breakpoints are detected when you run. Only the breakpoints you choose are tested; no default widths are added. There are optional selectors to ignore (chat widgets, ads, live feeds). A live preview shows the widths that will be tested.

  URLs are forgiving: `www.site.com/page` becomes `https://www.site.com/page` (and `localhost:3000/x` becomes `http://…`), and each URL is checked as you leave the field. Recently used pages are suggested as you type.
- **Typed**, e.g. `compare https://www.example.com/about with https://main--site--org.aem.page/about breakpoints 768, 1024, 1280`. Your breakpoints are used as-is and the comparison runs right away. Without `breakpoints …`, the chat detects them from the original and shows them on a setup card first. If you paste one URL, the chat asks for the other.

The migrated page can also be `http://localhost:3000/{path}` while running `aem up`.

**Breakpoint detection** reads every `@media` rule from all the original's stylesheets, cross-origin ones included. `min-width`, `max-width` (767px → 768), range syntax (`width >= 900px`) and `em`/`rem` units are all understood.

**On the setup card**, before running, breakpoints are editable chips: click × to remove one, type in *+ breakpoint* to add one, or click a detected bar. You can also type:
`add breakpoint 1280` · `remove 640` · `breakpoints 600, 900, 1200` (replaces them) · `run`.

**It remembers each site.** Every run stores the breakpoints and ignored elements per host in `sites.json`. The next time you enter an original URL from that site, they're filled in (with a note, so you can edit them), along with the migrated page it was last compared with. There's no "save" step. Commit `sites.json` to share breakpoints with the team.

**While it runs**, each tested width shows as a step (pending → working → ✓ with its score), with an estimate of the time left. The browser tab title shows the progress (`(2/4) Comparing…`, then `✓ Comparison done`), so you can work elsewhere.

Then ask follow-up questions:

| Ask | You get |
| --- | --- |
| `summary` · `score` | Parity score, per-width scores, breakpoint mismatch, top issues |
| `show high issues` · `what's wrong on mobile?` · `typography issues at 1024` | Filtered issue list; click one to see it on the page |
| `issue #3 at 375` | One issue with Original/Migrated close-ups and its fix |
| `show all fixes` · `fixes for cards` | CSS merged per file, ready to copy |
| `prompt for AEM Coder` | See and copy the prompt for AEM Coder (also *Copy for AEM Coder* on the results card) |
| `breakpoints` | Original vs migrated breakpoints, with a re-run at the mismatched widths |
| `re-run` | Same comparison again, with the same breakpoints |
| `download the PDF report` | The report file (see below) |
| `history` | Earlier comparisons, which can be reopened in the chat |

## Visual parity toggle

The **Visual parity** switch in the top bar (next to *History*) swaps the chat for a full-screen comparison. Clicking any issue in the chat also switches it on. Switch it off, or click *← Back to chat*, to return to the conversation. The viewer borrows patterns from free tools reviewers already know:

| View (key) | Modelled on | What it does |
| --- | --- | --- |
| Side by side (`1`) | — | Both pages with synced scroll and one numbered pin per element |
| Breakpoints (`2`) | Responsive Viewer / Polypane | Every tested width side by side at true relative size, with a dot per issue. Click one to open it |

The selected issue is spotlighted on both pages: the rest of the page dims and both sides scroll to the element. Each label shows that side's value (e.g. `16px` on the original, `18px` on the migrated page). Spacing issues get **VisBug-style measurement guides** showing the gap on each side. Missing content gets a dashed box where it should be.

Each issue in the list shows Original/Migrated close-ups, the values, a **computed-style comparison** (DevTools-style, with differing properties highlighted; *Show all* lists every property), the element, and the recommended fix.

### Review (Chromatic / Percy style)

Mark each issue **Needs fix** (`F`) or **Approve** (`A`) if the difference is intended. Each decision jumps to the next unreviewed issue, and a progress bar shows how much of the width is reviewed. Decisions are saved with the report (`reports/<id>/review.json`), and the downloaded report uses them: approved differences are listed separately, and issues to fix are tagged.

*Start review →* (or `N`) jumps to the next issue nobody has decided on yet.

Keys: `←` `→` navigate · `F` needs fix · `A` approve · `N` next unreviewed · `1` `2` views · `Esc` clear.

## Prompt for AEM Coder

*Copy for AEM Coder* on the results card copies the whole prompt in one click. Paste it into the AEM Coder chat (⌘V) and send. Nothing needs editing. AEM Coder runs in its own workspace, not on the machine running this tool, so the prompt carries everything it needs and doesn't point to local report files. To see the prompt first, type `prompt for AEM Coder` in the chat.

The prompt contains the two URLs, the original's breakpoints, a few rules (block-scoped CSS, don't edit `scripts/aem.js`, layout changes at the original's breakpoints, check the preview) and each open issue as plain facts: the element, the property, the Original and Migrated values and the widths, grouped by block. It carries no suggested CSS or fix advice. The generated rules are often too specific or wrong for the codebase, and AEM Coder fixes better from the facts and its own reading of the blocks. Differences you approved in review are left out. A copy is saved next to the report as `fix-prompt.md`.

## Downloadable report

**PDF report** produces a shareable report of every issue:

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
| Embeds | Twitter/X, Instagram, TikTok, Facebook, YouTube, Vimeo, Spotify, Google Maps, LinkedIn: compared as posts, never as text. Posts are matched by their ID (tweet, video, post) or by their text, so a tweet that migration turned into a plain quote + link still counts as present. Reported only when the pages look different (rendered card vs plain text), or when the post is really missing or extra. Capture waits up to 6s for provider scripts to render |
| Page | Height difference, failed requests |

Elements are matched by text first: unique exact matches, then duplicates resolved by position, then fuzzy matches. A vertical mapping learned from those anchors then matches images and controls. Translate transforms are removed before measuring, so scroll-reveal animations don't create false spacing issues. Shuffled content is left out of the spacing rules.

## Notes

- Fixes are recommendations computed from rendered styles. Review them before pasting, especially `margin`/`padding` changes, because margins collapse.
- Common cookie banners (OneTrust, Usercentrics and similar) are hidden before capture.
- Long pages are captured up to 12,000px tall.
- The conversation is kept in the browser (local storage). *Run new comparison* (in the Comparison summary panel) clears it and opens an empty form; reports stay available under History.
- Reports are written to `reports/` (git-ignored). The whole folder is in `.hlxignore`, so none of it is served by the site.
