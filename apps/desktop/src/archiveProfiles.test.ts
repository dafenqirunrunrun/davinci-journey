import { describe, expect, it } from "vitest";
import type { ArchiveProfile } from "@davinci-journey/classification";
import { initialArchiveProfiles, mergeArchiveProfiles } from "./archiveProfiles";

function profile(overrides: Partial<ArchiveProfile>): ArchiveProfile {
  return {
    id: "p-1",
    name: "P / 1",
    category: "P",
    topic: "1",
    directory: "content/p/1",
    defaultTags: [],
    ...overrides
  };
}

describe("mergeArchiveProfiles", () => {
  it("returns the seed list when no persisted profiles are loaded", () => {
    const merged = mergeArchiveProfiles([]);
    expect(merged).toEqual(initialArchiveProfiles);
  });

  it("appends persisted profiles that are missing from the seed", () => {
    const created = profile({ id: "ai-agent-sft", name: "AI Agent / sft", directory: "content/ai-agent/sft", description: "sft 笔记" });
    const merged = mergeArchiveProfiles([created]);
    expect(merged).toHaveLength(initialArchiveProfiles.length + 1);
    expect(merged[merged.length - 1]).toEqual(created);
    expect(merged.some((item) => item.id === "ai-agent-sft")).toBe(true);
  });

  it("lets the persisted entry win for structure on the same id", () => {
    const persisted = profile({
      id: initialArchiveProfiles[0]!.id,
      name: "Renamed / Profile",
      category: "Renamed",
      topic: "Topic",
      directory: "content/renamed/topic"
    });
    const merged = mergeArchiveProfiles([persisted]);
    expect(merged).toHaveLength(initialArchiveProfiles.length);
    const found = merged.find((item) => item.id === initialArchiveProfiles[0]!.id)!;
    expect(found.name).toBe("Renamed / Profile");
    expect(found.category).toBe("Renamed");
    expect(found.directory).toBe("content/renamed/topic");
  });

  it("keeps the seed defaultTags when the persisted entry has none", () => {
    const seedProfile = initialArchiveProfiles.find((item) => item.defaultTags.length > 0);
    if (!seedProfile) {
      expect(initialArchiveProfiles.length).toBeGreaterThan(0);
      return;
    }
    const persisted = profile({
      id: seedProfile.id,
      name: seedProfile.name,
      category: seedProfile.category,
      topic: seedProfile.topic,
      directory: seedProfile.directory,
      defaultTags: []
    });
    const merged = mergeArchiveProfiles([persisted]);
    const found = merged.find((item) => item.id === seedProfile.id)!;
    expect(found.defaultTags).toEqual(seedProfile.defaultTags);
  });

  it("uses the persisted defaultTags when they are non-empty", () => {
    const persisted = profile({
      id: initialArchiveProfiles[0]!.id,
      name: "P / 1",
      category: "P",
      topic: "1",
      directory: "content/p/1",
      defaultTags: ["Custom", "Tags"]
    });
    const merged = mergeArchiveProfiles([persisted]);
    const found = merged.find((item) => item.id === initialArchiveProfiles[0]!.id)!;
    expect(found.defaultTags).toEqual(["Custom", "Tags"]);
  });

  it("does not duplicate a profile present in both lists", () => {
    const persisted = profile({ id: initialArchiveProfiles[0]!.id });
    const merged = mergeArchiveProfiles([persisted]);
    const ids = merged.map((item) => item.id);
    expect(ids.filter((id) => id === initialArchiveProfiles[0]!.id)).toHaveLength(1);
  });
});
