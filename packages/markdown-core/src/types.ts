export interface ParseMarkdownInput {
  content: string;
  fileName: string;
}

export interface MarkdownHeading {
  depth: number;
  text: string;
  line?: number;
}

export type MarkdownImageReferenceType = "markdown" | "html" | "obsidian" | "remote" | "base64";

export type MarkdownImagePathKind = "relative" | "absolute" | "remote" | "embedded" | "unknown";

export interface MarkdownImageReference {
  id: string;
  raw: string;
  source: string;
  alt?: string;
  title?: string;
  type: MarkdownImageReferenceType;
  pathKind: MarkdownImagePathKind;
  line?: number;
  column?: number;
  obsidianWidth?: number;
}

export interface MarkdownParseWarning {
  code: string;
  message: string;
  line?: number;
}

export interface ParsedMarkdownDocument {
  frontMatter: Record<string, unknown>;
  body: string;
  title?: string;
  headings: MarkdownHeading[];
  imageReferences: MarkdownImageReference[];
  codeLanguages: string[];
  wordCount: number;
  warnings: MarkdownParseWarning[];
}
