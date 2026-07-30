import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { MarkdownImageReference } from "@davinci-journey/markdown-core";
import { detectImageMime } from "./mime";
import type { ResolveImageDependenciesInput, ResolvedImageDependency } from "./types";

const COMMON_ATTACHMENT_DIRS = ["attachments", "assets", "images", "img", "附件"];

function decodeSource(source: string): string {
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function isUnsafePath(candidate: string): boolean {
  const parts = candidate.replace(/\\/g, "/").split("/");
  let leadingParents = 0;
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") leadingParents += 1;
    else break;
  }
  return leadingParents > 2;
}

function normalizeCandidate(baseDirectory: string, source: string): string {
  const decoded = decodeSource(source).replace(/\\/g, path.sep);
  return path.isAbsolute(decoded) ? path.normalize(decoded) : path.resolve(baseDirectory, decoded);
}

async function fileDependency(reference: MarkdownImageReference, candidate: string): Promise<ResolvedImageDependency> {
  const info = await stat(candidate).catch(() => undefined);
  if (!info) {
    return {
      referenceId: reference.id,
      originalSource: reference.source,
      status: "missing",
      message: `无法找到图片 ${path.basename(reference.source)}。请重新选择图片，或修改 Markdown 中的引用。`
    };
  }
  if (!info.isFile()) {
    return {
      referenceId: reference.id,
      originalSource: reference.source,
      status: "unsupported",
      resolvedPath: candidate,
      message: "图片引用指向的不是普通文件。"
    };
  }

  const buffer = await readFile(candidate);
  const mimeType = detectImageMime(buffer, candidate);
  if (!mimeType) {
    return {
      referenceId: reference.id,
      originalSource: reference.source,
      status: "unsupported",
      resolvedPath: candidate,
      fileName: path.basename(candidate),
      size: info.size,
      message: "文件内容不是受支持的图片格式。"
    };
  }

  return {
    referenceId: reference.id,
    originalSource: reference.source,
    status: "resolved",
    resolvedPath: candidate,
    fileName: path.basename(candidate),
    mimeType,
    size: info.size,
    sha256: createHash("sha256").update(buffer).digest("hex")
  };
}

async function findByName(root: string, fileName: string, limit = 20): Promise<string[]> {
  const matches: string[] = [];
  async function walk(directory: string) {
    if (matches.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      if (entry.isFile() && entry.name === fileName) matches.push(fullPath);
      if (matches.length >= limit) return;
    }
  }
  await walk(root);
  return matches;
}

async function obsidianCandidates(reference: MarkdownImageReference, markdownDirectory: string, input: ResolveImageDependenciesInput): Promise<string[]> {
  const source = decodeSource(reference.source);
  const candidates = [
    path.resolve(markdownDirectory, source),
    ...COMMON_ATTACHMENT_DIRS.map((directory) => path.resolve(markdownDirectory, directory, source)),
    ...(input.obsidian?.attachmentDirectories ?? []).map((directory) => path.resolve(directory, source))
  ];

  if (input.obsidian?.enabled && input.obsidian.vaultRoot) {
    candidates.push(...(await findByName(input.obsidian.vaultRoot, path.basename(source))));
  }

  return [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
}

export async function resolveImageDependencies(input: ResolveImageDependenciesInput): Promise<ResolvedImageDependency[]> {
  const markdownDirectory = input.markdownFile.directoryPath;
  const results: ResolvedImageDependency[] = [];

  for (const reference of input.references) {
    if (reference.pathKind === "remote") {
      results.push({ referenceId: reference.id, originalSource: reference.source, status: "remote", message: "远程图片，本轮不会自动下载。" });
      continue;
    }

    if (reference.pathKind === "embedded") {
      const payload = reference.source.split(",", 2)[1] ?? "";
      results.push({
        referenceId: reference.id,
        originalSource: "data:image/*;base64,...",
        status: "embedded",
        size: Math.ceil((payload.length * 3) / 4),
        message: "嵌入图片需要在后续阶段提取为文件。"
      });
      continue;
    }

    if (isUnsafePath(reference.source)) {
      results.push({ referenceId: reference.id, originalSource: reference.source, status: "unsafe", message: "图片路径包含越界片段，已阻止自动解析。" });
      continue;
    }

    if (reference.type === "obsidian") {
      const existing = [];
      for (const candidate of await obsidianCandidates(reference, markdownDirectory, input)) {
        const info = await stat(candidate).catch(() => undefined);
        if (info?.isFile()) existing.push(candidate);
      }
      if (existing.length > 1) {
        results.push({ referenceId: reference.id, originalSource: reference.source, status: "ambiguous", candidates: existing, message: "找到多个同名图片候选，请手动选择。" });
        continue;
      }
      results.push(await fileDependency(reference, existing[0] ?? path.resolve(markdownDirectory, reference.source)));
      continue;
    }

    results.push(await fileDependency(reference, normalizeCandidate(markdownDirectory, reference.source)));
  }

  return results;
}
