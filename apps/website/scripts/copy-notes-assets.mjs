// Copy the repository-root public/assets/notes images into the Astro site's
// dist output so published article images are served by GitHub Pages.
//
// The desktop publish tool writes processed images to <repo>/public/assets/notes/.
// Astro only bundles apps/website/public, so these repo-root assets must be
// copied into dist after `astro build`.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const websiteRoot = join(scriptDir, "..");
const repoRoot = join(websiteRoot, "..", "..");
const src = join(repoRoot, "public", "assets", "notes");
const dest = join(websiteRoot, "dist", "assets", "notes");

if (!existsSync(src)) {
  console.log("copy-notes-assets: no notes images to copy.");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, force: true });
console.log(`copy-notes-assets: copied ${src} -> ${dest}`);
