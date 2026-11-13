# Parity Check

Compare an **original page** with its **migrated AEM Edge Delivery Services page** at the site's breakpoints. Parity Check lists every visible difference (layout, spacing, typography, colour, images, content) on side-by-side screenshots, and turns them into a PDF report or a prompt for AEM Coder.

It runs on your machine, with no AI service. Only the two pages you compare are loaded.

## Start the tool

You need **Node.js 18 or later** (`node -v` to check).

First time only, in a terminal:

```sh
cd path/to/your-repo/tools/parity-check
npm install
npx playwright install chromium
```

Then start it:

```sh
npm start
```

Open **http://127.0.0.1:4300** and keep the terminal open while you use it. To check it works, click **Use the demo pages**, then **Run comparison**.

- **Stop:** `Ctrl` + `C` in the terminal.
- **After pulling new code:** run `npm install`, then `npm start` again.
- **Port 4300 busy:** `PORT=4310 npm start`, then open http://127.0.0.1:4310.

## Run a comparison

1. Enter the **original page** and the **migrated page** (an `aem.page` URL, or `http://localhost:3000/...` while `aem up` runs).
2. Add **breakpoints** as chips: type a width, pick a common one, or click **Detect from original**. Leave it empty to detect them when you run. Only the widths you choose are tested.
3. Optional: under **Ignore elements**, list selectors for things that change on every load (chat widgets, ads, feeds).
4. Click **Run comparison**.

Breakpoints and ignored elements are remembered per site.

### Several pages at once

1. In the form, switch to **Several pages**.
2. Add one page per line: the original URL, then the migrated URL. Separate them with spaces, a tab, a comma or `->`. You can paste two columns from a spreadsheet, or drop or attach a **CSV / TXT** file (save Excel or Sheets as CSV first). Header rows and lines without a URL are skipped.
3. To list only the original URLs, fill in **Migrated site** (e.g. `https://main--site--org.aem.page`). Each page gets the same path there, without `.html`.
4. Your breakpoints apply to every page. Leave them empty to use each site's saved breakpoints, or detect them from that site's first page.

Up to 100 pages per run. Lists of up to 5 pages run one after another; longer lists run **3 pages at a time**, roughly 3× faster. Each page still captures its widths one by one, in its own browser. A single comparison started during a batch waits for it, then runs alone. The batch card shows each page's progress, then its score and High count. **Stop** skips the pages still waiting; the ones already running finish. Click a page to open its summary; use ‹ › in the summary panel or the page list in **Visual parity** to move between pages. **Copy for AEM Coder** in the summary panel copies the prompt for the selected page only.

Pasting three or more URLs into the chat box fills this list for you.

## Use the results

- **Comparison summary** (right panel): score, High / Medium / Low counts, top issues, and quick actions.
- **Chat | Visual parity** (top bar): switch between the conversation and both pages side by side, with each issue pinned and highlighted. The panes scroll together section by section.
- **Review:** mark each issue **Needs fix** (`F`) or **Approve** (`A`) if the difference is intended. Use `←` `→` to move between issues.
- **Copy for AEM Coder:** copies a ready prompt with every open issue (element, original and migrated values, widths). Paste it into AEM Coder; approved issues are left out.
- **Download report:** a PDF with every issue, close-ups and suggested CSS.

You can also ask in the chat, e.g. `show high issues`, `what's wrong on mobile?`, `issue #3 at 375`, `re-run`, `history`.

## What it checks

Missing, extra or changed content · columns per row · spacing · font family, size, weight, line height, letter spacing, casing, alignment · text and background colour · buttons · image size and crop · elements hidden or shown per width · social embeds · failed fonts and requests.

Content is matched by what it says, not by where it sits. So moved sections, and elements built differently but looking the same, aren't reported as missing.

## Limits

It's a fast first pass, not a final verdict. It can be wrong on layouts it hasn't seen (carousels, tabs, accordions, forms), on content that changes between loads (feeds, related lists, dates), and on third-party widgets. The screenshots are the ground truth.

On a new site, check the first few pages' issues in **Visual parity**, add noisy areas to **Ignore elements**, and approve intended differences. If an issue is wrong, report the two URLs, the width and the issue title.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Cannot find package 'playwright'` | Run `npm install` in `tools/parity-check`. |
| No browser / `Executable doesn't exist` | Run `npx playwright install chromium`. |
| Old issues after an update | Restart the tool and re-run. Old reports keep their results. |
| A cookie banner or chat bubble is flagged | Add its selector to **Ignore elements**. |
