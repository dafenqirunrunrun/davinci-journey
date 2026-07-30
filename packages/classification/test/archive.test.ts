import { describe, expect, it } from "vitest";
import {
  createArchiveProfile,
  getArchivePathPreview,
  parseArchiveProfilesConfig,
  recommendArchiveProfile,
  validateArchiveProfiles,
  writeArchiveFrontMatter
} from "../src";

const rawConfig = `
archiveProfiles:
  - id: ai-agent-langgraph
    name: AI Agent / LangGraph
    category: AI Agent
    topic: LangGraph
    directory: content/ai-agent/langgraph
    defaultTags:
      - AI Agent
      - LangGraph
  - id: ai-agent-memory
    name: AI Agent / Memory
    category: AI Agent
    topic: Memory
    directory: content/ai-agent/memory
    defaultTags:
      - AI Agent
      - Memory
  - id: rag-retrieval
    name: RAG / Retrieval
    category: RAG
    topic: Retrieval
    directory: content/rag/retrieval
    defaultTags:
      - RAG
      - Retrieval
  - id: rag-evaluation
    name: RAG / Evaluation
    category: RAG
    topic: Evaluation
    directory: content/rag/evaluation
    defaultTags:
      - RAG
      - Evaluation
  - id: backend-python
    name: Backend / Python
    category: Backend
    topic: Python
    directory: content/backend/python
    defaultTags:
      - Backend
      - Python
  - id: uncategorized
    name: 其他 / 待整理
    category: Other
    topic: Uncategorized
    directory: content/other/uncategorized
    defaultTags: []
`;

const profiles = parseArchiveProfilesConfig(rawConfig).archiveProfiles;

describe("archive profile config", () => {
  it("正确读取归档配置", () => {
    expect(profiles).toHaveLength(6);
    expect(profiles[0]?.id).toBe("ai-agent-langgraph");
  });

  it("非法目录被拒绝", () => {
    const issues = validateArchiveProfiles([{ ...profiles[0]!, id: "bad", directory: "../private" }]);
    expect(issues.some((issue) => issue.field === "directory" && issue.severity === "error")).toBe(true);
  });

  it("重复 ID 被拒绝", () => {
    const issues = validateArchiveProfiles([profiles[0]!, { ...profiles[1]!, id: profiles[0]!.id }]);
    expect(issues.some((issue) => issue.field === "id" && issue.severity === "error")).toBe(true);
  });

  it("重复目录被拒绝", () => {
    const issues = validateArchiveProfiles([profiles[0]!, { ...profiles[1]!, directory: profiles[0]!.directory }]);
    expect(issues.some((issue) => issue.field === "directory" && issue.severity === "error")).toBe(true);
  });
});

describe("archive recommendation", () => {
  it("根据 LangGraph 关键词推荐正确归档", () => {
    const result = recommendArchiveProfile(
      {
        title: "LangGraph Checkpoint 原理",
        body: "本文讨论 checkpoint、stategraph 和 durable execution。",
        codeLanguages: ["python"]
      },
      profiles
    );
    expect(result.archiveProfileId).toBe("ai-agent-langgraph");
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
  });

  it("根据 RAG 关键词推荐正确归档", () => {
    const result = recommendArchiveProfile(
      {
        title: "RAG Hybrid Search Retrieval",
        body: "Embedding、vector、BM25 和 rerank 的检索实践。",
        codeLanguages: []
      },
      profiles
    );
    expect(result.archiveProfileId).toBe("rag-retrieval");
  });
});

describe("archive creation and paths", () => {
  it("创建新专题后自动生成可选中的归档方案", () => {
    const result = createArchiveProfile(
      {
        name: "AI Agent / Durable Execution",
        category: "AI Agent",
        topic: "Durable Execution",
        categorySlug: "ai-agent",
        topicSlug: "durable-execution",
        defaultTags: ["AI Agent", "Durable Execution"],
        description: "Agent durable execution notes"
      },
      profiles
    );
    expect(result.canCreate).toBe(true);
    expect(result.profile.id).toBe("ai-agent-durable-execution");
    expect(result.profile.directory).toBe("content/ai-agent/durable-execution");
  });

  it("创建新分类后自动生成可选中的归档方案", () => {
    const result = createArchiveProfile(
      {
        name: "AI Infra / Inference",
        category: "AI Infra",
        topic: "Inference",
        categorySlug: "ai-infra",
        topicSlug: "inference",
        defaultTags: ["AI Infra", "Inference"]
      },
      profiles
    );
    expect(result.canCreate).toBe(true);
    expect(result.profile.id).toBe("ai-infra-inference");
  });

  it("最终路径实时更新", () => {
    const preview = getArchivePathPreview(profiles[0]!, "langgraph-checkpoint");
    expect(preview.markdownPath).toBe("content/ai-agent/langgraph/langgraph-checkpoint.md");
    expect(preview.imageDirectory).toBe("public/assets/notes/langgraph-checkpoint/");
  });

  it("Front Matter 正确写入 archiveProfile", () => {
    const output = writeArchiveFrontMatter(
      "# LangGraph",
      {
        title: "LangGraph Checkpoint",
        description: "状态恢复",
        slug: "langgraph-checkpoint",
        tags: ["LangGraph"],
        date: "2026-07-30",
        updated: "2026-07-30",
        draft: false,
        featured: false
      },
      profiles[0]!
    );
    expect(output).toContain('archiveProfile: ai-agent-langgraph');
    expect(output).toContain("category: AI Agent");
    expect(output).toContain("topic: LangGraph");
  });
});
