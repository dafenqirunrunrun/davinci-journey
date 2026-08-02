import { unified } from "unified";
import remarkParse from "remark-parse";

type NodeLike = {
  type?: string;
  depth?: number;
  value?: string;
  children?: NodeLike[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

/**
 * Normalize the leading title heading of a Markdown body for publication.
 *
 * The published article's page title comes from Front Matter `title`. If the
 * body begins with its own H1, that H1 is a duplicated page title and is
 * removed from the publish OUTPUT copy only.
 *
 * Rules:
 * - Only operates on the returned copy; the caller's string is untouched.
 * - Does nothing when `hasTitle` is false (no Front Matter title to dedupe).
 * - Only removes the FIRST content node when it is a depth-1 heading.
 * - Skips leading blank / whitespace-only lines.
 * - Never touches H2/H3, later H1s, or headings inside code blocks
 *   (it works on the parsed AST, not raw regex).
 */
export function normalizeLeadingTitleHeading(markdown: string, hasTitle: boolean): string {
  if (!hasTitle) return markdown;

  const tree = unified().use(remarkParse).parse(markdown) as NodeLike;
  const children = tree.children ?? [];

  let index = 0;
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
  if (!first || first.type !== "heading" || first.depth !== 1) {
    return markdown;
  }

  const start = first.position?.start?.offset;
  const end = first.position?.end?.offset;
  if (start === undefined || end === undefined) {
    return markdown;
  }

  // Remove the leading H1 node while preserving the rest of the markdown.
  // The node's end offset typically lands at the start of the next line;
  // strip a single trailing newline to avoid a blank first line.
  let tail = markdown.slice(end);
  tail = tail.replace(/^\r?\n/, "");

  return markdown.slice(0, start) + tail;
}
