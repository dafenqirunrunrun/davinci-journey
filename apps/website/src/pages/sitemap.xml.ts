import { getArchiveProfiles, getNotes, uniqueValues } from "../lib/content";
import { absoluteUrl } from "../lib/site";

export function GET() {
  const notes = getNotes();
  const categories = uniqueValues([...getArchiveProfiles().map((profile) => profile.category), ...notes.map((note) => note.category)]);
  const tags = uniqueValues(notes.flatMap((note) => note.tags));
  const noteUrls = notes
    .map((note) => {
      const lastmod = note.gitUpdatedAt
        ? new Date(note.gitUpdatedAt * 1000).toISOString().slice(0, 10)
        : undefined;
      return `<url><loc>${absoluteUrl(note.urlPath)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    })
    .join("");
  const staticPaths = [
    "/",
    "/notes/",
    "/categories/",
    "/tags/",
    "/search/",
    "/about/",
    ...categories.map((category) => `/categories/${encodeURIComponent(category)}/`),
    ...tags.map((tag) => `/tags/${encodeURIComponent(tag)}/`)
  ];

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${staticPaths.map((path) => `<url><loc>${absoluteUrl(path)}</loc></url>`).join("")}
      ${noteUrls}
    </urlset>`,
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8"
      }
    }
  );
}
