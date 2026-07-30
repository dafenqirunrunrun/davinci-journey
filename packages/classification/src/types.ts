export interface ArchiveProfile {
  id: string;
  name: string;
  category: string;
  topic?: string;
  directory: string;
  defaultTags: string[];
  description?: string;
  icon?: string;
  colorToken?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ArchiveProfilesConfig {
  archiveProfiles: ArchiveProfile[];
}

export type ArchiveProfileChange =
  | {
      type: "create";
      profile: ArchiveProfile;
    }
  | {
      type: "update";
      before: ArchiveProfile;
      after: ArchiveProfile;
    };

export interface ArchiveValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
  relatedProfileIds?: string[];
}

export interface MarkdownArchiveInput {
  frontMatter?: Record<string, unknown>;
  title: string;
  body: string;
  codeLanguages?: string[];
  recentArchiveProfileIds?: string[];
}

export interface ArchiveRecommendationAlternative {
  archiveProfileId: string;
  confidence: number;
}

export interface ArchiveRecommendation {
  archiveProfileId: string;
  confidence: number;
  reasons: string[];
  alternatives: ArchiveRecommendationAlternative[];
}

export interface NewArchiveProfileInput {
  name: string;
  category: string;
  topic: string;
  categorySlug: string;
  topicSlug: string;
  defaultTags?: string[];
  description?: string;
}

export interface ArchivePathPreview {
  markdownPath: string;
  imageDirectory: string;
  tree: string[];
}

export interface ArticleInfo {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  date: string;
  updated: string;
  draft: boolean;
  featured: boolean;
}
