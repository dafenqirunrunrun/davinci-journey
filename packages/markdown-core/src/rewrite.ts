import { parseMarkdown } from "./parse";

export interface MarkdownImageRewrite {
  referenceId: string;
  nextSource: string;
}

export interface RewriteMarkdownImagesInput {
  fileName: string;
  content: string;
  rewrites: MarkdownImageRewrite[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceFirstOutsideCode(content: string, pattern: RegExp, replacement: string): string {
  const lines = content.split(/(\r?\n)/);
  let inFence = false;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (pattern.test(line)) {
      lines[index] = line.replace(pattern, replacement);
      return lines.join("");
    }
  }
  return content;
}

export function rewriteMarkdownImages(input: RewriteMarkdownImagesInput): string {
  const references = parseMarkdown({ fileName: input.fileName, content: input.content }).imageReferences;
  const rewriteById = new Map(input.rewrites.map((rewrite) => [rewrite.referenceId, rewrite.nextSource]));
  let output = input.content;

  for (const reference of references) {
    const nextSource = rewriteById.get(reference.id);
    if (!nextSource) continue;
    if (reference.type === "markdown") {
      const pattern = new RegExp(`(!\\[[^\\]]*\\]\\()${escapeRegExp(reference.source)}((?:\\s+["'][^"']*["'])?\\))`);
      output = replaceFirstOutsideCode(output, pattern, `$1${nextSource}$2`);
    } else if (reference.type === "html") {
      const pattern = new RegExp(`(<img\\b[^>]*\\bsrc=["'])${escapeRegExp(reference.source)}(["'][^>]*>)`, "i");
      output = replaceFirstOutsideCode(output, pattern, `$1${nextSource}$2`);
    } else if (reference.type === "obsidian") {
      const pattern = new RegExp(escapeRegExp(reference.raw));
      output = replaceFirstOutsideCode(output, pattern, `![${reference.alt ?? ""}](${nextSource})`);
    }
  }

  return output;
}
