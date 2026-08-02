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
  featured: boolean;
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

/**
 * AST-based remark plugin that removes a leading H1 from the article body.
 *
 * The article page already renders the Front Matter `title` as the single page
 * `<h1>`. If the body begins with its own H1, that node is a duplicated page
 * title and is removed. Only the FIRST content node is inspected; later H1s,
 * code blocks, and H2/H3 are untouched. No CSS hiding, no regex parsing.
 */
function remarkRemoveLeadingArticleH1() {
  return (tree: { children?: Array<{ type?: string; depth?: number; value?: string }> }) => {
    const children = tree.children ?? [];
    let index = 0;
    // Skip leading whitespace-only text / yaml front matter / empty nodes.
    while (index < children.length) {
      const node = children[index];
      if (!node) break;
      const isBlank =
        (node.type === "text" || node.type === "html" || node.type === "yaml") &&
        typeof node.value === "string" &&
        node.value.trim() === "";
      if (isBlank) {
        index++;
        continue;
      }
      break;
    }
    const first = children[index];
    if (first && first.type === "heading" && first.depth === 1) {
      children.splice(index, 1);
    }
  };
}

// remarkRemoveLeadingArticleH1 is a unified remark transformer; cast to satisfy
// the unified plugin type overload.
const remarkRemoveLeadingArticleH1Plugin = remarkRemoveLeadingArticleH1 as unknown as import("unified").Plugin;

export function stripDuplicateTitleHeading(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return markdown;
  const match = lines[firstContentIndex]?.match(/^#\s+(.+?)\s*$/);
  if (!match || !isDuplicateTitleHeading(title, match[1] ?? "")) return markdown;
  lines.splice(firstContentIndex, 1);
  return lines.join("\n").replace(/^\s+/, "");
}

type MdastNode = {
  type?: string;
  value?: string;
  depth?: number;
  children?: MdastNode[];
};

/** TOC headings whose following link list must be excluded from excerpts. */
const TOC_HEADINGS = new Set(["目录", "table of contents", "toc", "contents"]);

/** Extract readable plain text from a single Markdown AST node. */
function nodeToPlainText(node: MdastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "inlineCode" || node.type === "code") return node.value ?? "";
  if (node.type === "image" || node.type === "html" || node.type === "definition") return "";
  if (node.children) return (node.children ?? []).map(nodeToPlainText).join("");
  return "";
}

/** Truncate a Chinese-friendly excerpt to roughly 100–160 characters. */
function truncateExcerpt(text: string, maxLength = 150): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSentenceEnd = Math.max(
    slice.lastIndexOf("。"),
    slice.lastIndexOf("！"),
    slice.lastIndexOf("？")
  );
  if (lastSentenceEnd > maxLength * 0.6) {
    return text.slice(0, lastSentenceEnd + 1);
  }
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.6) {
    return text.slice(0, lastSpace) + "…";
  }
  return slice + "…";
}

/**
 * Generate a clean auto-excerpt from the Markdown body when Front Matter
 * `description` is empty. AST-based — no regex summary extraction.
 *
 * Rules: ignores Front Matter, the leading duplicate H1 and all headings,
 * code blocks, tables, HTML, and any Table-of-Contents heading plus its list.
 * The excerpt comes from the first meaningful paragraph or blockquote, with
 * Markdown formatting stripped and text truncated to ~150 characters.
 */
export function extractDescription(body: string, _title: string): string {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as { children: MdastNode[] };
  const children = tree.children ?? [];

  let excerpt = "";
  let inToc = false;

  for (const node of children) {
    const type = node.type;

    // Ignore YAML front matter and blank text/html nodes.
    if (type === "yaml") continue;
    if ((type === "text" || type === "html") && !(node.value ?? "").trim()) continue;

    // Headings never become excerpt content.
    if (type === "heading") {
      const headingText = nodeToPlainText(node).trim().toLowerCase();
      if (TOC_HEADINGS.has(headingText)) {
        inToc = true; // skip the following TOC link list
      } else {
        inToc = false;
      }
      if (excerpt) break; // reached a later section heading
      continue;
    }

    // Inside a TOC, skip the link list entirely.
    if (inToc) {
      if (type === "list") continue;
      inToc = false;
    }

    // Lists, code, tables, images, thematic breaks and raw HTML are not excerpt sources.
    if (
      type === "list" ||
      type === "code" ||
      type === "table" ||
      type === "image" ||
      type === "thematicBreak" ||
      type === "html"
    ) {
      continue;
    }

    // First meaningful paragraph or blockquote becomes the excerpt.
    if (type === "paragraph" || type === "blockquote") {
      const text = nodeToPlainText(node).replace(/\s+/g, " ").trim();
      if (text) {
        excerpt = text;
        break;
      }
    }
  }

  if (!excerpt) return "暂无摘要。";
  return truncateExcerpt(excerpt);
}

/**
 * Resolve the article description.
 *
 * Priority: a non-empty Front Matter `description` wins; otherwise fall back
 * to the AST-based auto-excerpt; otherwise a concise empty state.
 * Empty/whitespace-only/null descriptions all trigger auto-excerpt.
 */
export function resolveDescription(frontMatterDescription: unknown, body: string, title: string): string {
  if (typeof frontMatterDescription === "string" && frontMatterDescription.trim()) {
    return frontMatterDescription.trim();
  }
  return extractDescription(body, title);
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
        description: resolveDescription(frontMatter.description, body, title),
        category,
        topic: frontMatter.topic,
        tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
        date: frontMatter.date,
        updated: frontMatter.updated,
        featured: frontMatter.featured === true,
        sourcePath,
        urlPath: `/notes/${slug}/`,
        body
      };
    })
    .filter((note) => note.slug && !note.sourcePath.includes("fixtures/"))
    .sort(sortNotesDescending);
}

/**
 * Sort notes newest-first by `updated`, falling back to `date`.
 * Exposed for testing the homepage's "最新笔记" ordering.
 */
export function sortNotesDescending<T extends { updated?: string; date?: string }>(a: T, b: T): number {
  return (b.updated || b.date || "").localeCompare(a.updated || a.date || "");
}

export async function renderNoteHtml(markdown: string, _title: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRemoveLeadingArticleH1Plugin)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSafeLinksAndAssets)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

export function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));
}
