import type { ArchiveProfile, ArchiveProfileChange, ArchiveValidationIssue, NewArchiveProfileInput } from "./types";
import { toArchiveProfileId } from "./slug";
import { validateNewArchiveProfile } from "./validation";

export interface CreateArchiveProfileResult {
  profile: ArchiveProfile;
  issues: ArchiveValidationIssue[];
  canCreate: boolean;
}

export function buildArchiveProfile(input: NewArchiveProfileInput): ArchiveProfile {
  const now = new Date().toISOString();
  return {
    id: toArchiveProfileId(input.categorySlug, input.topicSlug),
    name: input.name,
    category: input.category,
    topic: input.topic,
    directory: `content/${input.categorySlug}/${input.topicSlug}`,
    defaultTags: input.defaultTags ?? [],
    description: input.description,
    createdAt: now,
    updatedAt: now
  };
}

export function createArchiveProfile(input: NewArchiveProfileInput, existing: ArchiveProfile[]): CreateArchiveProfileResult {
  const profile = buildArchiveProfile(input);
  const issues = validateNewArchiveProfile(input, existing);
  return {
    profile,
    issues,
    canCreate: !issues.some((issue) => issue.severity === "error")
  };
}

export function applyArchiveProfileChanges(currentProfiles: ArchiveProfile[], changes: ArchiveProfileChange[]): ArchiveProfile[] {
  return changes.reduce((profiles, change) => {
    if (change.type === "create") {
      return profiles.some((profile) => profile.id === change.profile.id) ? profiles : [...profiles, change.profile];
    }

    return profiles.map((profile) => (profile.id === change.before.id ? change.after : profile));
  }, currentProfiles);
}
