import { parse } from "yaml";
import type { ArchiveProfile, ArchiveProfilesConfig } from "./types";
import { validateArchiveProfiles } from "./validation";

export function parseArchiveProfilesConfig(raw: string): ArchiveProfilesConfig {
  const parsed = parse(raw) as Partial<ArchiveProfilesConfig> | null;
  const archiveProfiles = parsed?.archiveProfiles;

  if (!Array.isArray(archiveProfiles)) {
    throw new Error("归档配置必须包含 archiveProfiles 数组。");
  }

  const profiles = archiveProfiles.map((profile) => ({
    ...profile,
    defaultTags: Array.isArray((profile as ArchiveProfile).defaultTags) ? (profile as ArchiveProfile).defaultTags : []
  })) as ArchiveProfile[];

  const errors = validateArchiveProfiles(profiles).filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.message).join("\n"));
  }

  return { archiveProfiles: profiles };
}
