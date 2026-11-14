# Parity Check

A local tool that compares an original web page with its migrated AEM Edge Delivery Services (EDS) page at the site's own breakpoints, and lists every visible difference on side-by-side screenshots.

## Overview

Parity Check loads both pages in a headless browser at each breakpoint you choose. It matches their content and reports what differs: layout, spacing, typography, colour, images and content. You review the issues in a chat-style interface, then hand them to AEM Coder or download a PDF report. It runs on your machine, without an AI service.

## Features

**1. One page or several pages**
* Compare a single original and migrated page, or a list of up to 100 pairs. Paste a list, paste two columns from a spreadsheet, or attach a CSV / TXT file. If you only have the original URLs, give the migrated site and each page gets the same path there, without `.html`.
* Lists of more than 5 pages run 3 pages at a time, and a run can be stopped.

**2. Site breakpoints**
* Breakpoints are added as chips: type a width, pick a common one, or detect them from the original page's CSS. Only the widths you choose are tested.
* Breakpoints and ignored elements are remembered per site. Cookie banners are ignored by default; add your own selectors for chat widgets, ads or feeds.

**3. Parity checks**
* Missing, extra or changed content. Wording issues name the exact words, e.g. *"hosts" → "host"; extra "2" at the end*.
* Columns per row, spacing, font family, size, weight, line height, letter spacing, casing and alignment, text and background colour, buttons, image size and crop.
* Elements hidden or shown per width, social embeds, failed fonts and requests, and breakpoints that differ between the two pages.
* Content is matched by what it says, not by where it sits, so moved sections and elements built differently aren't reported as missing.

**4. Results and review**
* A **Comparison complete** card with the parity score (0–100, higher is closer) and High / Medium / Low counts. For several pages it shows the selected page, with all pages listed below.
* **Visual parity**: both pages side by side at each width, scrolling together, with every issue pinned. A pin covering several issues lists them when clicked.
* Mark each issue **Needs fix** (`F`) or **Approve** (`A`); move between issues with `←` `→`.

**5. Hand-off**
* **Copy for AEM Coder**: a ready prompt with the selected page's open issues (element, original and migrated values, widths). Approved issues are left out.
* **Download report**: a PDF with every issue and close-ups.
* **History** of past comparisons, and chat requests such as `show high issues`, `issue #3 at 768`, `breakpoints` or `re-run`.

## File Overview

```
tools/parity-check/
├── server.js            # Local web server: job queue (3 pages at a time for long lists), API, PDF export
├── sites.json           # Saved breakpoints and ignored elements per site
├── package.json         # Dependencies: Playwright (browser), pixelmatch + pngjs (pixel diff)
├── lib/
│   ├── run.js           # Runs one comparison: every width, both pages, writes the report
│   ├── capture.js       # Opens a page at one width: screenshot + element data
│   ├── extract.js       # Reads elements, styles and media queries inside the page
│   ├── breakpoints.js   # Detects breakpoints from the page's CSS
│   ├── match.js         # Pairs original and migrated elements by content
│   ├── rules.js         # The parity checks; turns differences into issues and a score
│   ├── words.js         # Word-level text comparison for wording issues
│   ├── diff.js          # Pixel difference between the two screenshots
│   ├── fixes.js         # CSS suggestions per block file (PDF report, "show all fixes")
│   ├── prompt.js        # The AEM Coder prompt
│   └── export.js        # The printable report behind the PDF
├── public/              # The interface: chat, form, result cards, Visual parity
├── demo/                # Two demo pages with deliberate differences
├── reports/             # Generated reports (local only, not committed)
└── README.md            # This documentation
```

The whole folder is listed in the repository's `.hlxignore`, so none of it is served by Edge Delivery.

## Workflow

| Step | What happens |
|------|--------------|
| **Enter pages** | One pair in the form, or a list under **Several pages** |
| **Choose breakpoints** | Your chips, the saved ones for the site, or detected from the original's CSS |
| **Capture** | Each page is opened at each width; screenshot and element data are taken once late content has loaded |
| **Match** | Original and migrated elements are paired by their text, then images and controls by position |
| **Check** | Rules compare the pairs (content, layout, spacing, typography, colour, images) and give each width a score |
| **Review** | The result card, summary panel and Visual parity show the issues; approve the intended ones |
| **Hand off** | Copy the prompt for AEM Coder, or download the PDF report |

**Capabilities:** single and batch comparison · per-site breakpoints · content-based matching · exact-word wording issues · side-by-side pins · review and approve · AEM Coder prompt · PDF report · history

## How to Use

1. **Install Node.js and Git** (one time)
   * Node.js 18 or later: download the LTS installer from [nodejs.org](https://nodejs.org).
   * Git: on a Mac, run `git --version` in Terminal; if it isn't installed, macOS offers to install it.

2. **Get the code** (one time)
   ```sh
   git clone https://github.com/ShivaniM123/parity-check.git
   cd parity-check
   git checkout aem-20261109-1805    # the branch with the tool, until it's merged into main
   ```

3. **Install the tool** (one time)
   ```sh
   cd tools/parity-check
   npm install
   npx playwright install chromium   # the browser that takes the screenshots
   ```

4. **Start it**
   ```sh
   npm start
   ```
   Open **http://127.0.0.1:4300** and keep the terminal open while you use it. Stop it with `Ctrl` + `C`.

5. **Run a comparison**
   * To check the setup, click **Use the demo pages**, then **Run comparison**.
   * For your own pages, enter the original and migrated URLs (an `aem.page` URL, or `http://localhost:3000/...` while `aem up` runs), add breakpoints, and click **Run comparison**.

## Points to Note

* **Updating:** restarting the tool doesn't download new code. Stop it, run `git pull` and `npm install` in `tools/parity-check`, start it again and reload the tab.
* **Reports stay on your machine** in `reports/`. AEM Coder can't open them; use **Copy for AEM Coder** and paste the prompt instead.
* **Port 4300 busy:** start with `PORT=4310 npm start` and open http://127.0.0.1:4310.
* **"Cannot find package 'playwright'"** or **"Executable doesn't exist":** redo step 3.
* **It's a first pass, not a final verdict.** Carousels, tabs, accordions, content that changes between loads and third-party widgets can produce wrong issues. The screenshots are the ground truth; approve intended differences and add noisy areas to **Ignore elements**.
