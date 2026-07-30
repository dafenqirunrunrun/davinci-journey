import { parse, stringify } from "yaml";
import type { ArchiveProfile, ArticleInfo } from "./types";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function writeArchiveFrontMatter(markdown: string, article: ArticleInfo, profile: ArchiveProfile): string {
  const match = markdown.match(FRONT_MATTER);
  const body = match ? markdown.slice(match[0].length) : markdown;
  const existing = match ? (parse(match[1] ?? "") as Record<string, unknown>) : {};
  const data = {
    ...existing,
    title: article.title,
    description: article.description,
    archiveProfile: profile.id,
    category: profile.category,
    topic: profile.topic,
    tags: article.tags,
    slug: article.slug,
    date: article.date,
    updated: article.updated,
    draft: article.draft,
    featured: article.featured
  };

  return `---\n${stringify(data).trim()}\n---\n\n${body.trimStart()}`;
}
