import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
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

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/（.*?）|\(.*?\)/g, "")
    .replace(/学习|调用|笔记|原理|实践|指南|[0-9]/g, "")
    .replace(/[^\p{Script=Han}a-z0-9]+/gu, "");
}

export function isDuplicateTitleHeading(title: string, heading: string): boolean {
  const normalizedTitle = normalizeTitle(title);
  const normalizedHeading = normalizeTitle(heading);
  if (!normalizedTitle || !normalizedHeading) return false;
  if (normalizedTitle === normalizedHeading) return true;
  if (normalizedTitle.includes(normalizedHeading) || normalizedHeading.includes(normalizedTitle)) return true;
  const shorter = normalizedTitle.length < normalizedHeading.length ? normalizedTitle : normalizedHeading;
  const longer = normalizedTitle.length < normalizedHeading.length ? normalizedHeading : normalizedTitle;
  return shorter.length >= 8 && longer.includes(shorter);
}

export function stripDuplicateTitleHeading(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return markdown;
  const match = lines[firstContentIndex]?.match(/^#\s+(.+?)\s*$/);
  if (!match || !isDuplicateTitleHeading(title, match[1] ?? "")) return markdown;
  lines.splice(firstContentIndex, 1);
  return lines.join("\n").replace(/^\s+/, "");
}

function stripMarkdownForSummary(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`~|[\]-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDescription(body: string, title: string): string {
  const text = stripMarkdownForSummary(stripDuplicateTitleHeading(body, title));
  if (!text) return "暂无摘要。";
  return text.length > 150 ? `${text.slice(0, 150)}...` : text;
}

function rehypeSafeLinksAndAssets() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "element", (node: { tagName?: string; properties?: Record<string, unknown> }) => {
      if (node.tagName === "img") {
        const src = typeof node.properties?.src === "string" ? node.properties.src : "";
        if (src.startsWith("/assets/notes/")) node.properties = { ...node.properties, src: withBase(src) };
        node.properties = { ...node.properties, loading: "lazy" };
      }

      if (node.tagName === "a") {
        const href = typeof node.properties?.href === "string" ? node.properties.href : "";
        if (/^https?:\/\//i.test(href)) node.properties = { ...node.properties, rel: "noreferrer", target: "_blank" };
      }
    });
  };
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
      const title = frontMatter.title || extractTitle(body, slug);
      const sourcePath = relative(rootDir, path).split(sep).join("/");
      const category = frontMatter.category || dirname(relative(contentDir, path)).split(sep)[0] || "Other";
      return {
        slug,
        title,
        description: typeof frontMatter.description === "string" && frontMatter.description.trim() ? frontMatter.description.trim() : extractDescription(body, title),
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

export async function renderNoteHtml(markdown: string, title: string): Promise<string> {
  const content = stripDuplicateTitleHeading(markdown, title);
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSafeLinksAndAssets)
    .use(rehypeStringify)
    .process(content);
  return String(file);
}

export function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}
