import { parse, stringify } from "yaml";
import type { ArchiveProfile, ArticleInfo } from "./types";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const systemFields = new Set(["title", "description", "archiveProfile", "category", "topic", "tags", "slug", "date", "updated", "draft", "featured"]);

export interface FrontMatterWriteResult {
  markdown: string;
  frontMatter: Record<string, unknown>;
  warnings: string[];
}

function cleanExistingFrontMatter(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined || field === null) continue;
    if (typeof field === "number" && Number.isNaN(field)) continue;
    output[key] = field;
  }
  return output;
}

function validDate(value: string, fallback: string): string {
  return ISO_DATE.test(value) ? value : fallback;
}

export function buildArchiveFrontMatter(existingInput: Record<string, unknown>, article: ArticleInfo, profile: ArchiveProfile, fallbackDate = "2026-07-30"): FrontMatterWriteResult {
  const warnings: string[] = [];
  const existing = cleanExistingFrontMatter(existingInput);
  const preserved = Object.fromEntries(Object.entries(existing).filter(([key]) => !systemFields.has(key)));
  const existingDate = typeof existing.date === "string" && ISO_DATE.test(existing.date) ? existing.date : undefined;
  if (article.date && !ISO_DATE.test(article.date)) warnings.push("发布日期不是有效 ISO 日期，已使用兜底日期。");
  if (article.updated && !ISO_DATE.test(article.updated)) warnings.push("更新时间不是有效 ISO 日期，已使用兜底日期。");

  const frontMatter = {
    ...preserved,
    title: article.title,
    description: article.description,
    archiveProfile: profile.id,
    category: profile.category,
    ...(profile.topic ? { topic: profile.topic } : {}),
    tags: article.tags,
    slug: article.slug,
    date: existingDate ?? validDate(article.date, fallbackDate),
    updated: validDate(article.updated, fallbackDate),
    draft: article.draft,
    featured: article.featured
  };

  return { frontMatter, markdown: stringify(frontMatter).trim(), warnings };
}

export function writeArchiveFrontMatter(markdown: string, article: ArticleInfo, profile: ArchiveProfile): string {
  const match = markdown.match(FRONT_MATTER);
  const body = match ? markdown.slice(match[0].length) : markdown;
  const existing = match ? (parse(match[1] ?? "") as Record<string, unknown>) : {};
  const result = buildArchiveFrontMatter(existing, article, profile);

  return `---\n${result.markdown}\n---\n\n${body.trimStart()}`;
}
