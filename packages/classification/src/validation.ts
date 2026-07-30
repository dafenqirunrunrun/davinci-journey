import type { ArchiveProfile, ArchiveValidationIssue, NewArchiveProfileInput } from "./types";
import { isSafeSlug, toArchiveProfileId } from "./slug";

const DIRECTORY_PATTERN = /^content\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function words(value: string): Set<string> {
  return new Set(normalize(value).split(/[^a-z0-9]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  const intersection = [...a].filter((item) => b.has(item));
  return union.size === 0 ? 0 : intersection.length / union.size;
}

export function validateArchiveProfiles(profiles: ArchiveProfile[]): ArchiveValidationIssue[] {
  const issues: ArchiveValidationIssue[] = [];
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  const directories = new Map<string, string>();

  for (const profile of profiles) {
    if (!profile.id) issues.push({ field: "id", message: "归档方案 ID 不能为空。", severity: "error" });
    if (!profile.name) issues.push({ field: "name", message: "归档方案名称不能为空。", severity: "error" });
    if (!profile.category) issues.push({ field: "category", message: "主分类不能为空。", severity: "error" });
    if (!Array.isArray(profile.defaultTags)) {
      issues.push({ field: "defaultTags", message: "默认标签必须是数组。", severity: "error", relatedProfileIds: [profile.id] });
    }

    const idKey = normalize(profile.id);
    const nameKey = normalize(profile.name);
    const dirKey = normalize(profile.directory);

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.id)) {
      issues.push({ field: "id", message: "归档方案 ID 只能使用小写英文、数字和连字符。", severity: "error", relatedProfileIds: [profile.id] });
    }

    if (!DIRECTORY_PATTERN.test(profile.directory)) {
      issues.push({ field: "directory", message: "归档目录必须位于 content 下，并且只能使用小写英文、数字和连字符。", severity: "error", relatedProfileIds: [profile.id] });
    }

    if (ids.has(idKey)) {
      issues.push({ field: "id", message: "归档方案 ID 重复。", severity: "error", relatedProfileIds: [ids.get(idKey)!, profile.id] });
    }
    if (names.has(nameKey)) {
      issues.push({ field: "name", message: "归档方案名称重复。", severity: "error", relatedProfileIds: [names.get(nameKey)!, profile.id] });
    }
    if (directories.has(dirKey)) {
      issues.push({ field: "directory", message: "归档目录重复。", severity: "error", relatedProfileIds: [directories.get(dirKey)!, profile.id] });
    }

    ids.set(idKey, profile.id);
    names.set(nameKey, profile.id);
    directories.set(dirKey, profile.id);
  }

  return issues;
}

export function validateNewArchiveProfile(input: NewArchiveProfileInput, existing: ArchiveProfile[]): ArchiveValidationIssue[] {
  const directory = `content/${input.categorySlug}/${input.topicSlug}`;
  const id = toArchiveProfileId(input.categorySlug, input.topicSlug);
  const candidate: ArchiveProfile = {
    id,
    name: input.name,
    category: input.category,
    topic: input.topic,
    directory,
    defaultTags: input.defaultTags ?? []
  };
  const issues = validateArchiveProfiles([...existing, candidate]).filter((issue) => issue.relatedProfileIds?.includes(id));

  if (!isSafeSlug(input.categorySlug)) {
    issues.push({ field: "categorySlug", message: "分类 Slug 必须使用小写英文、数字和连字符，且不能包含保留目录。", severity: "error" });
  }
  if (!isSafeSlug(input.topicSlug)) {
    issues.push({ field: "topicSlug", message: "专题 Slug 必须使用小写英文、数字和连字符，且不能包含保留目录。", severity: "error" });
  }

  const candidateWords = words(`${input.category} ${input.topic} ${input.name}`);
  const similarIds = existing
    .filter((profile) => jaccard(candidateWords, words(`${profile.category} ${profile.topic ?? ""} ${profile.name}`)) >= 0.5)
    .map((profile) => profile.id);

  if (similarIds.length > 0) {
    issues.push({
      field: "name",
      message: "发现可能相似的归档方案，建议确认后再创建。",
      severity: "warning",
      relatedProfileIds: similarIds
    });
  }

  return issues;
}
