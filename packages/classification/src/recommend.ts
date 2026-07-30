import type { ArchiveProfile, ArchiveRecommendation, MarkdownArchiveInput } from "./types";

type Score = { profile: ArchiveProfile; score: number; reasons: string[] };

const RULES: Record<string, { keywords: string[]; languages?: string[] }> = {
  "ai-agent-langgraph": { keywords: ["langgraph", "checkpoint", "durable execution", "stategraph", "graph state"] },
  "ai-agent-memory": { keywords: ["memory", "agent memory", "short term memory", "long term memory", "conversation state"] },
  "rag-retrieval": { keywords: ["rag", "retrieval", "embedding", "vector", "hybrid search", "rerank", "bm25"] },
  "rag-evaluation": { keywords: ["rag evaluation", "eval", "evaluation", "benchmark", "faithfulness", "recall"] },
  "backend-python": { keywords: ["python", "fastapi", "django", "sqlalchemy", "pytest"], languages: ["python", "py"] }
};

function textOf(input: MarkdownArchiveInput): string {
  return `${input.title}\n${input.body}`.toLowerCase();
}

function matchesFrontMatter(profile: ArchiveProfile, frontMatter?: Record<string, unknown>): boolean {
  const archiveProfile = frontMatter?.archiveProfile;
  const category = frontMatter?.category;
  const topic = frontMatter?.topic;
  return archiveProfile === profile.id || (category === profile.category && (!topic || topic === profile.topic));
}

export function recommendArchiveProfile(input: MarkdownArchiveInput, profiles: ArchiveProfile[]): ArchiveRecommendation {
  const text = textOf(input);
  const scores: Score[] = profiles.map((profile) => {
    let score = 0;
    const reasons: string[] = [];

    if (matchesFrontMatter(profile, input.frontMatter)) {
      score += 60;
      reasons.push("已有 Front Matter 与该归档方案匹配");
    }

    if (input.recentArchiveProfileIds?.includes(profile.id)) {
      score += 8;
      reasons.push("用户最近选择过该归档方案");
    }

    const rule = RULES[profile.id] ?? { keywords: [profile.category, profile.topic ?? profile.name] };
    for (const keyword of rule.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += input.title.toLowerCase().includes(keyword.toLowerCase()) ? 18 : 10;
        reasons.push(`${input.title.toLowerCase().includes(keyword.toLowerCase()) ? "标题" : "正文"}包含 ${keyword}`);
      }
    }

    for (const language of rule.languages ?? []) {
      if (input.codeLanguages?.map((item) => item.toLowerCase()).includes(language)) {
        score += 12;
        reasons.push(`代码语言包含 ${language}`);
      }
    }

    return { profile, score, reasons };
  });

  const ranked = scores.sort((a, b) => b.score - a.score || a.profile.name.localeCompare(b.profile.name));
  const winner = ranked[0] ?? { profile: profiles[0]!, score: 0, reasons: [] };
  const confidence = Math.max(0.35, Math.min(0.96, Number((winner.score / 100).toFixed(2))));

  return {
    archiveProfileId: winner.profile.id,
    confidence,
    reasons: winner.reasons.length > 0 ? winner.reasons.slice(0, 4) : ["未发现强匹配关键词，建议暂存到待整理归档方案"],
    alternatives: ranked
      .slice(1, 4)
      .map((item) => ({ archiveProfileId: item.profile.id, confidence: Math.max(0.2, Math.min(0.9, Number((item.score / 100).toFixed(2)))) }))
  };
}
