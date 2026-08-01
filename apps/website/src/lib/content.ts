import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { withBase } from "./site";

const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
const contentDir = join(rootDir, "content");
const archiveConfigPath = join(rootDir, "config", "archive-profiles.yml");
const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface NoteFrontMatter {
  title?: string;
  description?: string;
  category?: string;
  topic?: string;
  tags?: string[];
  slug?: string;
  date?: string;
  updated?: string;
  draft?: boolean;
  featured?: boolean;
}

export interface NoteEntry {
  slug: string;
  title: string;
  description: string;
  category: string;
  topic?: string;
  tags: string[];
  date?: string;
  updated?: string;
  sourcePath: string;
  urlPath: string;
  body: string;
}

export interface ArchiveProfile {
  id: string;
  name: string;
  category: string;
  topic?: string;
  directory: string;
  defaultTags: string[];
}

function walkMarkdownFiles(directory: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function fallbackSlug(path: string): string {
  return basename(path, ".md").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "note";
}

function extractTitle(body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("/assets/notes/")) return withBase(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (/^[./a-z0-9_-]/i.test(trimmed) && !trimmed.includes("..")) return escapeHtml(trimmed);
  return "#";
}

function renderInline(markdown: string): string {
  const escaped = escapeHtml(markdown);
  return escaped
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_match, alt: string, src: string, title: string | undefined) => {
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${safeUrl(src)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, href: string) => {
      return `<a href="${safeUrl(href)}" rel="noreferrer" target="_blank">${escapeHtml(text)}</a>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function getArchiveProfiles(): ArchiveProfile[] {
  const raw = readFileSync(archiveConfigPath, "utf8");
  const parsed = parse(raw) as { archiveProfiles?: ArchiveProfile[] } | null;
  return (parsed?.archiveProfiles ?? []).map((profile) => ({
    ...profile,
    defaultTags: Array.isArray(profile.defaultTags) ? profile.defaultTags : []
  }));
}

export function getNotes(): NoteEntry[] {
  if (!statSync(contentDir).isDirectory()) return [];
  return walkMarkdownFiles(contentDir)
    .map((path) => {
      const raw = readFileSync(path, "utf8");
      const match = raw.match(frontMatterPattern);
      const frontMatter = (match ? parse(match[1] ?? "") : {}) as NoteFrontMatter;
      const body = match ? raw.slice(match[0].length) : raw;
      const slug = frontMatter.slug || fallbackSlug(path);
      const sourcePath = relative(rootDir, path).split(sep).join("/");
      const category = frontMatter.category || dirname(relative(contentDir, path)).split(sep)[0] || "Other";
      return {
        slug,
        title: frontMatter.title || extractTitle(body, slug),
        description: frontMatter.description || "这篇笔记尚未填写摘要。",
        category,
        topic: frontMatter.topic,
        tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
        date: frontMatter.date,
        updated: frontMatter.updated,
        sourcePath,
        urlPath: `/notes/${slug}/`,
        body
      };
    })
    .filter((note) => note.slug && !note.sourcePath.includes("fixtures/"))
    .sort((a, b) => (b.updated || b.date || "").localeCompare(a.updated || a.date || ""));
}

export function renderNoteHtml(markdown: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let codeBlock: string[] | undefined;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  }

  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("```")) {
      if (codeBlock) {
        blocks.push(`<pre><code>${escapeHtml(codeBlock.join("\n"))}</code></pre>`);
        codeBlock = undefined;
      } else {
        flushParagraph();
        codeBlock = [];
      }
      continue;
    }

    if (codeBlock) {
      codeBlock.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 2;
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  if (codeBlock) blocks.push(`<pre><code>${escapeHtml(codeBlock.join("\n"))}</code></pre>`);
  return blocks.join("\n");
}

export function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}
