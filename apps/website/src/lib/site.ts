export const SITE_NAME = "达芬奇的奇妙之旅";
export const SITE_DESCRIPTION = "记录 AI Agent、RAG、LLM 应用开发与工程实践";
export const SITE_ORIGIN = "https://dafenqirunrunrun.github.io";
export const REPOSITORY_URL = "https://github.com/dafenqirunrunrun/davinci-journey";

export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}` || normalized;
}

export function absoluteUrl(path: string): string {
  return new URL(withBase(path), SITE_ORIGIN).toString();
}
