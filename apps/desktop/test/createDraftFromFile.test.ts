import { describe, expect, it, vi } from "vitest";
import type { ArchiveProfile } from "@davinci-journey/classification";
import type { DesktopBridge, SelectedMarkdownFileDto } from "../src/desktopBridge";
import { createDraftFromFile } from "../src/components/PublishFlow";

const profiles: ArchiveProfile[] = [
  {
    id: "ai-agent-langgraph",
    name: "AI Agent / LangGraph",
    category: "AI Agent",
    topic: "LangGraph",
    directory: "content/ai-agent/langgraph",
    defaultTags: ["AI Agent", "LangGraph"]
  }
];

function markdownFile(content: string): SelectedMarkdownFileDto {
  return {
    absolutePath: "D:/notes/a.md",
    fileName: "a.md",
    directoryPath: "D:/notes",
    size: content.length,
    modifiedAt: "2026-07-30T00:00:00Z",
    content,
    sourceFingerprint: "a".repeat(64)
  };
}

function stubBridge(): DesktopBridge {
  return {
    resolveImageDependencies: vi.fn(async () => [])
  } as unknown as DesktopBridge;
}

describe("createDraftFromFile slug dedup", () => {
  it("keeps a free explicit slug unchanged", async () => {
    const draft = await createDraftFromFile(
      markdownFile("---\nslug: \"8\"\n---\n# 标题"),
      profiles,
      stubBridge(),
      ["7", "9"]
    );
    expect(draft.article.slug).toBe("8");
  });

  it("appends -2 when the explicit slug is already used in the repo", async () => {
    const draft = await createDraftFromFile(
      markdownFile("---\nslug: \"8\"\n---\n# 标题"),
      profiles,
      stubBridge(),
      ["8", "复习-8.3"]
    );
    expect(draft.article.slug).toBe("8-2");
  });

  it("dedupes a slug generated from the title too", async () => {
    const draft = await createDraftFromFile(
      markdownFile("# LangGraph Checkpoint"),
      profiles,
      stubBridge(),
      ["langgraph-checkpoint"]
    );
    expect(draft.article.slug).toBe("langgraph-checkpoint-2");
  });

  it("defaults to no dedup when existingSlugs is omitted", async () => {
    const draft = await createDraftFromFile(
      markdownFile("# LangGraph Checkpoint"),
      profiles,
      stubBridge()
    );
    expect(draft.article.slug).toBe("langgraph-checkpoint");
  });
});
