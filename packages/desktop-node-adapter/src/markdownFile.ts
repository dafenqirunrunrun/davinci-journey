import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { MarkdownFileReadOptions, SelectedMarkdownFile } from "./types";

const ALLOWED_EXTENSIONS = new Set([".md", ".markdown"]);

function userError(message: string): Error {
  return new Error(message);
}

function hasBinaryContent(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
}

export async function readSelectedMarkdownFile(filePath: string, options: MarkdownFileReadOptions = { maxSizeBytes: 10 * 1024 * 1024 }): Promise<SelectedMarkdownFile> {
  const normalized = path.resolve(filePath);
  const linkInfo = await lstat(normalized).catch(() => {
    throw userError(`无法找到 Markdown 文件：${path.basename(filePath)}。请重新选择存在的 .md 或 .markdown 文件。`);
  });

  if (linkInfo.isSymbolicLink()) {
    const real = await realpath(normalized);
    const realInfo = await stat(real);
    if (!realInfo.isFile()) {
      throw userError(`无法读取 Markdown 文件：${path.basename(filePath)}。软链接目标不是普通文件。`);
    }
  } else if (!linkInfo.isFile()) {
    throw userError(`无法读取 Markdown 文件：${path.basename(filePath)}。请选择普通 Markdown 文件。`);
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw userError(`文件扩展名不受支持：${path.basename(filePath)}。请选择 .md 或 .markdown 文件。`);
  }

  const info = await stat(normalized);
  if (info.size > options.maxSizeBytes) {
    throw userError(`Markdown 文件过大：${path.basename(filePath)}。当前上限为 ${Math.round(options.maxSizeBytes / 1024 / 1024)} MB。`);
  }

  const buffer = await readFile(normalized);
  if (hasBinaryContent(buffer)) {
    throw userError(`无法读取 Markdown 文件：${path.basename(filePath)}。该文件看起来不是 UTF-8 文本文档。`);
  }

  const content = buffer.toString("utf8");
  return {
    absolutePath: normalized,
    fileName: path.basename(normalized),
    directoryPath: path.dirname(normalized),
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    content
  };
}
