import type { ArchivePathPreview, ArchiveProfile } from "./types";

export function getArchivePathPreview(profile: ArchiveProfile, articleSlug: string): ArchivePathPreview {
  const markdownPath = `${profile.directory}/${articleSlug}.md`;
  const imageDirectory = `public/assets/notes/${articleSlug}/`;
  return {
    markdownPath,
    imageDirectory,
    tree: [
      "content",
      `└── ${profile.directory.replace(/^content\//, "").split("/").join("\n    └── ")}`,
      `        └── ${articleSlug}.md`
    ]
  };
}
