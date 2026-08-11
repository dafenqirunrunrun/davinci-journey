import type { ArchiveProfile } from "@davinci-journey/classification";

/**
 * Merge the persisted archive profiles (read from the target repo's
 * `config/archive-profiles.yml`) on top of the static seed list.
 *
 * `config/archive-profiles.yml` is the single source of truth: profiles the
 * app created in a previous publish live there and must survive into the
 * "全部归档方案" list. The static `initialArchiveProfiles` is only a fallback
 * seed (e.g. brand-new repo or browser preview) plus richer metadata for the
 * built-in profiles (default tags) that the config file writes back as empty.
 *
 * Merge rules per profile id:
 * - The persisted entry wins for structure (name/category/directory/...).
 * - `defaultTags` falls back to the seed entry when the persisted entry is
 *   empty, so built-in profiles keep their default tag suggestions.
 * - Seed profiles absent from the config are kept (fallback).
 */
export function mergeArchiveProfiles(loaded: ArchiveProfile[], seed: ArchiveProfile[] = initialArchiveProfiles): ArchiveProfile[] {
  const merged = new Map<string, ArchiveProfile>();
  for (const seedProfile of seed) {
    merged.set(seedProfile.id, seedProfile);
  }
  for (const profile of loaded) {
    const existing = merged.get(profile.id);
    if (!existing) {
      merged.set(profile.id, profile);
      continue;
    }
    merged.set(profile.id, {
      ...existing,
      ...profile,
      defaultTags: profile.defaultTags.length > 0 ? profile.defaultTags : existing.defaultTags
    });
  }
  return [...merged.values()];
}

export const initialArchiveProfiles: ArchiveProfile[] = [
  {
    id: "ai-agent-langgraph",
    name: "AI Agent / LangGraph",
    category: "AI Agent",
    topic: "LangGraph",
    directory: "content/ai-agent/langgraph",
    defaultTags: ["AI Agent", "LangGraph"]
  },
  {
    id: "ai-agent-memory",
    name: "AI Agent / Memory",
    category: "AI Agent",
    topic: "Memory",
    directory: "content/ai-agent/memory",
    defaultTags: ["AI Agent", "Memory"]
  },
  {
    id: "rag-retrieval",
    name: "RAG / Retrieval",
    category: "RAG",
    topic: "Retrieval",
    directory: "content/rag/retrieval",
    defaultTags: ["RAG", "Retrieval"]
  },
  {
    id: "rag-evaluation",
    name: "RAG / Evaluation",
    category: "RAG",
    topic: "Evaluation",
    directory: "content/rag/evaluation",
    defaultTags: ["RAG", "Evaluation"]
  },
  {
    id: "backend-python",
    name: "Backend / Python",
    category: "Backend",
    topic: "Python",
    directory: "content/backend/python",
    defaultTags: ["Backend", "Python"]
  },
  {
    id: "uncategorized",
    name: "其他 / 待整理",
    category: "Other",
    topic: "Uncategorized",
    directory: "content/other/uncategorized",
    defaultTags: []
  }
];
