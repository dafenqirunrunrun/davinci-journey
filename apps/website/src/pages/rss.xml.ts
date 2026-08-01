import { getNotes } from "../lib/content";
import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "../lib/site";

export function GET() {
  const items = getNotes()
    .map(
      (note) => `<item>
        <title><![CDATA[${note.title}]]></title>
        <description><![CDATA[${note.description}]]></description>
        <link>${absoluteUrl(note.urlPath)}</link>
        <guid>${absoluteUrl(note.urlPath)}</guid>
        ${note.updated || note.date ? `<pubDate>${new Date(note.updated || note.date || "").toUTCString()}</pubDate>` : ""}
      </item>`
    )
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <title>${SITE_NAME}</title>
        <description>${SITE_DESCRIPTION}</description>
        <link>${absoluteUrl("/")}</link>
        ${items}
      </channel>
    </rss>`,
    {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8"
      }
    }
  );
}
