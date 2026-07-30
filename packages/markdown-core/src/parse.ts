import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { parse as parseYaml } from "yaml";
import type {
  MarkdownHeading,
  MarkdownImagePathKind,
  MarkdownImageReference,
  MarkdownImageReferenceType,
  ParseMarkdownInput,
  ParsedMarkdownDocument
} from "./types";

type NodeLike = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  title?: string;
  lang?: string;
  depth?: number;
  children?: NodeLike[];
  position?: {
    start?: {
      line?: number;
      column?: number;
    };
  };
};

function nodeText(node: NodeLike): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function stripFrontMatter(content: string): { frontMatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontMatter: {}, body: content };

  const parsed = parseYaml(match[1] ?? "");
  return {
    frontMatter: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
    body: content.slice(match[0].length)
  };
}

function isRemote(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function isBase64(source: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(source);
}

function isAbsolute(source: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(source) || source.startsWith("/") || source.startsWith("\\\\");
}

function pathKind(source: string): MarkdownImagePathKind {
  if (isRemote(source)) return "remote";
  if (isBase64(source)) return "embedded";
  if (isAbsolute(source)) return "absolute";
  if (source.trim().length > 0) return "relative";
  return "unknown";
}

function referenceType(source: string, fallback: MarkdownImageReferenceType): MarkdownImageReferenceType {
  if (isRemote(source)) return "remote";
  if (isBase64(source)) return "base64";
  return fallback;
}

function makeId(index: number): string {
  return `image-${String(index + 1).padStart(3, "0")}`;
}

function extractHtmlAttrs(raw: string): { source?: string; alt?: string; title?: string } {
  const src = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  const alt = raw.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
  const title = raw.match(/\btitle\s*=\s*["']([^"']*)["']/i)?.[1];
  return { source: src, alt, title };
}

function extractObsidian(value: string, line?: number, column?: number): Omit<MarkdownImageReference, "id">[] {
  const results: Omit<MarkdownImageReference, "id">[] = [];
  const pattern = /!\[\[([^\]|]+)(?:\|(\d+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    const source = (match[1] ?? "").trim();
    const width = match[2] ? Number(match[2]) : undefined;
    results.push({
      raw: match[0],
      source,
      alt: source,
      type: "obsidian",
      pathKind: pathKind(source),
      line,
      column: column ? column + match.index : undefined,
      obsidianWidth: width
    });
  }

  return results;
}

function countWords(body: string): number {
  const latin = body.match(/[A-Za-z0-9_]+/g)?.length ?? 0;
  const cjk = body.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latin + cjk;
}

export function parseMarkdown(input: ParseMarkdownInput): ParsedMarkdownDocument {
  const { frontMatter, body } = stripFrontMatter(input.content);
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).parse(input.content) as NodeLike;
  const headings: MarkdownHeading[] = [];
  const imageReferences: MarkdownImageReference[] = [];
  const codeLanguages = new Set<string>();

  visit(tree as never, (node: NodeLike) => {
    if (node.type === "heading") {
      headings.push({
        depth: node.depth ?? 1,
        text: nodeText(node).trim(),
        line: node.position?.start?.line
      });
    }

    if (node.type === "code" && node.lang) {
      codeLanguages.add(node.lang.toLowerCase());
    }

    if (node.type === "image" && node.url) {
      const type = referenceType(node.url, "markdown");
      imageReferences.push({
        id: makeId(imageReferences.length),
        raw: node.url,
        source: node.url,
        alt: node.alt,
        title: typeof node.title === "string" ? node.title : undefined,
        type,
        pathKind: pathKind(node.url),
        line: node.position?.start?.line,
        column: node.position?.start?.column
      });
    }

    if (node.type === "html" && typeof node.value === "string" && /<img\b/i.test(node.value)) {
      const attrs = extractHtmlAttrs(node.value);
      if (attrs.source) {
        const type = referenceType(attrs.source, "html");
        imageReferences.push({
          id: makeId(imageReferences.length),
          raw: node.value,
          source: attrs.source,
          alt: attrs.alt,
          title: attrs.title,
          type,
          pathKind: pathKind(attrs.source),
          line: node.position?.start?.line,
          column: node.position?.start?.column
        });
      }
    }

    if (node.type === "text" && typeof node.value === "string") {
      for (const ref of extractObsidian(node.value, node.position?.start?.line, node.position?.start?.column)) {
        imageReferences.push({ ...ref, id: makeId(imageReferences.length) });
      }
    }
  });

  const title = typeof frontMatter.title === "string" ? frontMatter.title : headings.find((heading) => heading.depth === 1)?.text;

  return {
    frontMatter,
    body,
    title,
    headings,
    imageReferences,
    codeLanguages: [...codeLanguages],
    wordCount: countWords(body),
    warnings: []
  };
}
