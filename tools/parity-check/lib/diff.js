import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function padTo(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  out.data.fill(255);
  PNG.bitblt(png, out, 0, 0, Math.min(png.width, width), Math.min(png.height, height), 0, 0);
  return out;
}

/**
 * Groups differing pixels into rectangular hotspots using a coarse grid.
 */
function hotspots(mask, width, height, cell = 24, minRatio = 0.12) {
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hot = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let n = 0;
      let total = 0;
      for (let y = r * cell; y < Math.min(height, (r + 1) * cell); y += 2) {
        for (let x = c * cell; x < Math.min(width, (c + 1) * cell); x += 2) {
          total += 1;
          if (mask[y * width + x]) n += 1;
        }
      }
      if (total && n / total >= minRatio) hot[r * cols + c] = 1;
    }
  }
  // connected components (4-neighbour, allowing a 1 cell gap)
  const seen = new Uint8Array(cols * rows);
  const regions = [];
  for (let i = 0; i < hot.length; i += 1) {
    if (hot[i] && !seen[i]) {
      const stack = [i];
      seen[i] = 1;
      let minC = cols; let maxC = 0; let minR = rows; let maxR = 0; let count = 0;
      while (stack.length) {
        const k = stack.pop();
        const r = Math.floor(k / cols);
        const c = k % cols;
        count += 1;
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        for (let dr = -2; dr <= 2; dr += 1) {
          for (let dc = -2; dc <= 2; dc += 1) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const j = nr * cols + nc;
              if (hot[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
            }
          }
        }
      }
      regions.push({
        x: minC * cell,
        y: minR * cell,
        w: (maxC - minC + 1) * cell,
        h: (maxR - minR + 1) * cell,
        cells: count,
      });
    }
  }
  return regions.sort((a, b) => b.cells - a.cells).slice(0, 40).sort((a, b) => a.y - b.y);
}

/**
 * Pixel diff of two screenshots. Returns the diff PNG, similarity and hotspots.
 */
export function diffScreenshots(bufA, bufB, { threshold = 0.1 } = {}) {
  let a = PNG.sync.read(bufA);
  let b = PNG.sync.read(bufB);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  a = padTo(a, width, height);
  b = padTo(b, width, height);
  const out = new PNG({ width, height });
  const changed = pixelmatch(a.data, b.data, out.data, width, height, {
    threshold,
    includeAA: false,
    alpha: 0.15,
    diffColor: [230, 40, 90],
    diffColorAlt: [30, 120, 230],
  });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const d = out.data;
    // pixelmatch paints differing pixels in diffColor / diffColorAlt
    if ((d[o] === 230 && d[o + 1] === 40 && d[o + 2] === 90) || (d[o] === 30 && d[o + 1] === 120 && d[o + 2] === 230)) mask[i] = 1;
  }
  return {
    png: PNG.sync.write(out),
    width,
    height,
    changed,
    similarity: Math.round((1 - changed / (width * height)) * 1000) / 10,
    regions: hotspots(mask, width, height),
  };
}
