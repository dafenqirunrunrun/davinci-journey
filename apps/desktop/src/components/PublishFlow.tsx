import { useMemo, useRef, useState } from "react";
import {
  applyArchiveProfileChanges,
  createArchiveProfile,
  getArchivePathPreview,
  recommendArchiveProfile,
  slugify,
  writeArchiveFrontMatter,
  type ArchiveProfile,
  type NewArchiveProfileInput
} from "@davinci-journey/classification";
import { parseMarkdown, type MarkdownImageReference } from "@davinci-journey/markdown-core";
import { initialArchiveProfiles } from "../archiveProfiles";
import { canContinueFromAssets, emptyDraft, type PublishDraft, type ResolvedImageDependency, type SelectedMarkdownFile } from "../publishState";

const steps = ["选择 Markdown", "检查图片", "编辑文章信息", "选择归档方案", "预览与发布"];
const MAX_MARKDOWN_SIZE = 10 * 1024 * 1024;

const emptyForm: NewArchiveProfileInput = {
  name: "",
  category: "AI Agent",
  topic: "",
  categorySlug: "ai-agent",
  topicSlug: "",
  defaultTags: [],
  description: ""
};

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function makeSlug(value: string, fallback: string): string {
  return slugify(value.replace(/\.[^.]+$/, "")) || slugify(fallback) || "untitled-note";
}

function dependencyFromReference(reference: MarkdownImageReference): ResolvedImageDependency {
  if (reference.pathKind === "remote") {
    return { referenceId: reference.id, originalSource: reference.source, status: "remote", message: "远程图片，本轮不会自动下载。" };
  }
  if (reference.pathKind === "embedded") {
    const payload = reference.source.split(",", 2)[1] ?? "";
    return {
      referenceId: reference.id,
      originalSource: "data:image/*;base64,...",
      status: "embedded",
      size: Math.ceil((payload.length * 3) / 4),
      message: "嵌入图片需要在后续阶段提取为文件。"
    };
  }
  if (reference.source.split(/[\\/]+/).filter((part) => part === "..").length > 2) {
    return { referenceId: reference.id, originalSource: reference.source, status: "unsafe", message: "图片路径包含明显越界片段，已阻止自动解析。" };
  }
  return {
    referenceId: reference.id,
    originalSource: reference.source,
    status: "missing",
    fileName: reference.source.split(/[\\/]/).pop(),
    message: "浏览器预览无法直接读取相邻本地图片；Tauri 适配层会按 Markdown 所在目录解析该引用。"
  };
}

async function selectedFileFromBrowser(file: File): Promise<SelectedMarkdownFile> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (!["md", "markdown"].includes(ext ?? "")) {
    throw new Error(`文件扩展名不受支持：${file.name}。请选择 .md 或 .markdown 文件。`);
  }
  if (file.size > MAX_MARKDOWN_SIZE) {
    throw new Error(`Markdown 文件过大：${file.name}。当前上限为 10 MB。`);
  }
  const content =
    typeof file.text === "function"
      ? await file.text()
      : await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error(`无法读取 Markdown 文件：${file.name}。请确认文件可读并使用 UTF-8 编码。`));
          reader.readAsText(file, "utf-8");
        });
  if (content.includes("\u0000")) {
    throw new Error(`无法读取 Markdown 文件：${file.name}。该文件看起来不是 UTF-8 文本文档。`);
  }
  return {
    absolutePath: "",
    fileName: file.name,
    directoryPath: "本地选择",
    size: file.size,
    modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
    content
  };
}

function createDraftFromFile(markdownFile: SelectedMarkdownFile, profiles: ArchiveProfile[]): PublishDraft {
  const parsedDocument = parseMarkdown({ fileName: markdownFile.fileName, content: markdownFile.content });
  const recommendation = recommendArchiveProfile(
    {
      frontMatter: parsedDocument.frontMatter,
      title: parsedDocument.title ?? markdownFile.fileName,
      body: parsedDocument.body,
      codeLanguages: parsedDocument.codeLanguages
    },
    profiles
  );
  const title = parsedDocument.title ?? markdownFile.fileName.replace(/\.[^.]+$/, "");
  const slug = typeof parsedDocument.frontMatter.slug === "string" ? parsedDocument.frontMatter.slug : makeSlug(title, markdownFile.fileName);
  const dependencies = parsedDocument.imageReferences.map(dependencyFromReference);
  const selectedProfile = recommendation.archiveProfileId;
  const profile = profiles.find((item) => item.id === selectedProfile) ?? profiles[0]!;
  const preview = getArchivePathPreview(profile, slug);

  return {
    id: `draft-${Date.now()}`,
    source: { markdownFile, parsedDocument },
    assets: { dependencies, userResolutions: {} },
    article: {
      title,
      description: typeof parsedDocument.frontMatter.description === "string" ? parsedDocument.frontMatter.description : "",
      slug,
      tags: Array.isArray(parsedDocument.frontMatter.tags) ? parsedDocument.frontMatter.tags.map(String) : profile.defaultTags,
      date: typeof parsedDocument.frontMatter.date === "string" ? parsedDocument.frontMatter.date : "2026-07-30",
      updated: "2026-07-30",
      draft: parsedDocument.frontMatter.draft === true,
      featured: parsedDocument.frontMatter.featured === true
    },
    archive: {
      selectedProfileId: selectedProfile,
      recommendedProfileIds: [recommendation.archiveProfileId, ...recommendation.alternatives.map((item) => item.archiveProfileId)],
      pendingProfileChanges: []
    },
    preview: {
      markdownPath: preview.markdownPath,
      assetDirectory: preview.imageDirectory
    },
    status: canContinueFromAssets(dependencies) ? "ready" : "needs_attention"
  };
}

function updatePreview(draft: PublishDraft, profiles: ArchiveProfile[]): PublishDraft {
  const profile = profiles.find((item) => item.id === draft.archive.selectedProfileId) ?? profiles[0];
  if (!profile || !draft.article.slug) return draft;
  const preview = getArchivePathPreview(profile, draft.article.slug);
  return {
    ...draft,
    preview: {
      ...draft.preview,
      markdownPath: preview.markdownPath,
      assetDirectory: preview.imageDirectory,
      workspacePlan: {
        workspaceId: draft.id,
        sourceMarkdownPath: draft.source.markdownFile?.absolutePath || draft.source.markdownFile?.fileName || "",
        outputMarkdownPath: preview.markdownPath,
        outputAssetDirectory: preview.imageDirectory,
        plannedFiles: [
          { type: "create", path: preview.markdownPath },
          ...draft.assets.dependencies.filter((item) => item.status === "resolved").map((item) => ({ type: "create" as const, path: `${preview.imageDirectory}${item.fileName ?? "image"}`, source: item.resolvedPath }))
        ]
      }
    }
  };
}

export function PublishFlow() {
  const [step, setStep] = useState(1);
  const [baseProfiles] = useState(initialArchiveProfiles);
  const [draft, setDraft] = useState<PublishDraft>(emptyDraft);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewArchiveProfileInput>(emptyForm);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const profiles = useMemo(() => applyArchiveProfileChanges(baseProfiles, draft.archive.pendingProfileChanges), [baseProfiles, draft.archive.pendingProfileChanges]);
  const selectedProfile = profiles.find((profile) => profile.id === draft.archive.selectedProfileId) ?? profiles[0];
  const recommendation = draft.source.parsedDocument
    ? recommendArchiveProfile(
        {
          frontMatter: draft.source.parsedDocument.frontMatter,
          title: draft.article.title,
          body: draft.source.parsedDocument.body,
          codeLanguages: draft.source.parsedDocument.codeLanguages
        },
        profiles
      )
    : undefined;
  const frontMatterPreview = selectedProfile && draft.source.markdownFile ? writeArchiveFrontMatter(draft.source.markdownFile.content, draft.article, selectedProfile) : "";
  const filteredProfiles = profiles.filter((profile) => `${profile.name} ${profile.category} ${profile.topic ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const assetCounts = draft.assets.dependencies.reduce<Record<string, number>>((counts, dependency) => ({ ...counts, [dependency.status]: (counts[dependency.status] ?? 0) + 1 }), {});

  async function handleFile(file?: File) {
    if (!file) return;
    setDraft({ ...emptyDraft, status: "parsing" });
    try {
      const markdownFile = await selectedFileFromBrowser(file);
      const next = updatePreview(createDraftFromFile(markdownFile, profiles), profiles);
      setDraft(next);
      setStep(2);
    } catch (error) {
      setDraft({ ...emptyDraft, status: "failed", error: error instanceof Error ? error.message : "读取 Markdown 文件失败，请重新选择。" });
    }
  }

  function selectProfile(profileId: string) {
    setDraft((current) => updatePreview({ ...current, archive: { ...current.archive, selectedProfileId: profileId } }, profiles));
  }

  function updateArticle(next: Partial<PublishDraft["article"]>) {
    setDraft((current) => updatePreview({ ...current, article: { ...current.article, ...next } }, profiles));
  }

  function createPendingProfile() {
    const result = createArchiveProfile(form, profiles);
    if (!result.canCreate) return;
    setDraft((current) =>
      updatePreview(
        {
          ...current,
          archive: {
            ...current.archive,
            selectedProfileId: result.profile.id,
            pendingProfileChanges: [...current.archive.pendingProfileChanges, { type: "create", profile: result.profile }]
          }
        },
        [...profiles, result.profile]
      )
    );
    setShowCreate(false);
  }

  return (
    <section>
      <nav aria-label="发布步骤" className="stepper">
        {steps.map((item, index) => (
          <button className={step === index + 1 ? "active" : ""} key={item} type="button" onClick={() => setStep(index + 1)}>
            {index + 1}. {item}
          </button>
        ))}
      </nav>

      {step === 1 && (
        <div className="panel upload-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          void handleFile(event.dataTransfer.files[0]);
        }}>
          <p className="eyebrow">第 1 步</p>
          <h2>选择 Markdown</h2>
          <p className="muted-text">选择一个真实的 `.md` 或 `.markdown` 文件，系统会读取内容并解析图片引用。</p>
          <input ref={inputRef} className="visually-hidden" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void handleFile(event.target.files?.[0])} />
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>
            选择 Markdown 文件
          </button>
          {draft.source.markdownFile && <FileSummary file={draft.source.markdownFile} parsedTitle={draft.source.parsedDocument?.title} imageCount={draft.source.parsedDocument?.imageReferences.length ?? 0} />}
          {draft.error && <p className="error-message">{draft.error}</p>}
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <StepHeader title="检查图片" eyebrow="第 2 步" />
          <div className="asset-list">
            {draft.assets.dependencies.map((dependency) => (
              <div className="asset-row" key={dependency.referenceId}>
                <div className="thumb">{dependency.fileName?.slice(0, 2) ?? "图"}</div>
                <div>
                  <strong>{dependency.fileName ?? dependency.originalSource}</strong>
                  <p>原始引用：{dependency.originalSource}</p>
                  <p>状态：{statusLabel(dependency.status)}{dependency.size ? ` · ${formatSize(dependency.size)}` : ""}{dependency.mimeType ? ` · ${dependency.mimeType}` : ""}</p>
                  {dependency.message && <p className="muted-text">{dependency.message}</p>}
                </div>
              </div>
            ))}
          </div>
          {!canContinueFromAssets(draft.assets.dependencies) && <p className="warning-text">存在缺失、冲突、不安全或不支持的图片，最终发布前必须处理。</p>}
          <StepActions onBack={() => setStep(1)} onNext={() => setStep(3)} />
        </div>
      )}

      {step === 3 && (
        <div className="panel form-panel">
          <StepHeader title="编辑文章信息" eyebrow="第 3 步" />
          <LabeledInput label="标题" value={draft.article.title} onChange={(value) => updateArticle({ title: value })} />
          <LabeledInput label="摘要" value={draft.article.description} onChange={(value) => updateArticle({ description: value })} />
          <LabeledInput label="Slug" value={draft.article.slug} onChange={(value) => updateArticle({ slug: value })} />
          <LabeledInput label="标签" value={draft.article.tags.join(", ")} onChange={(value) => updateArticle({ tags: value.split(",").map((item) => item.trim()).filter(Boolean) })} />
          <label className="check-row"><input type="checkbox" checked={draft.article.draft} onChange={(event) => updateArticle({ draft: event.target.checked })} /> 草稿</label>
          <label className="check-row"><input type="checkbox" checked={draft.article.featured} onChange={(event) => updateArticle({ featured: event.target.checked })} /> 精选</label>
          <StepActions onBack={() => setStep(2)} onNext={() => setStep(4)} />
        </div>
      )}

      {step === 4 && (
        <div className="archive-layout">
          <div className="panel list-panel">
            <div className="section-title">
              <StepHeader title="归档方案" eyebrow="第 4 步" />
              <button className="ghost-button" type="button" onClick={() => setShowCreate((value) => !value)}>＋ 新建归档方案</button>
            </div>
            {recommendation && selectedProfile && (
              <article className="recommendation">
                <p className="eyebrow">推荐归档</p>
                <button className="profile-row recommended" type="button" onClick={() => selectProfile(recommendation.archiveProfileId)}>
                  <span><strong>{profiles.find((profile) => profile.id === recommendation.archiveProfileId)?.name}</strong><small>匹配度：{Math.round(recommendation.confidence * 100)}%</small></span>
                  <span aria-hidden="true">→</span>
                </button>
                <ul className="reason-list">{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </article>
            )}
            <LabeledInput label="搜索归档方案" value={search} onChange={setSearch} />
            <div className="profile-group">
              <h3>全部归档方案</h3>
              {filteredProfiles.map((profile) => (
                <button className={`profile-row ${draft.archive.selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id} type="button" onClick={() => selectProfile(profile.id)}>
                  <span><strong>{profile.name}</strong><small>{profile.directory}</small></span>
                  <span aria-hidden="true">{draft.archive.selectedProfileId === profile.id ? "●" : "○"}</span>
                </button>
              ))}
            </div>
          </div>
          <aside className="panel preview-panel">
            <StepHeader title={selectedProfile?.name ?? "未选择"} eyebrow="最终结构预览" />
            <PathBlock title="Markdown" value={draft.preview.markdownPath ?? ""} testId="markdown-path" />
            <PathBlock title="图片资源" value={draft.preview.assetDirectory ?? ""} testId="image-path" />
            {draft.archive.pendingProfileChanges.length > 0 && <p className="warning-text">新建归档方案将在发布草稿中修改配置，当前不会写入 archive-profiles.yml。</p>}
            <StepActions onBack={() => setStep(3)} onNext={() => setStep(5)} />
          </aside>
          {showCreate && (
            <aside className="drawer" aria-label="新建归档方案">
              <div className="section-title">
                <StepHeader title="新建归档方案" eyebrow="待提交变更" />
                <button className="icon-button" aria-label="关闭新建归档方案" type="button" onClick={() => setShowCreate(false)}>×</button>
              </div>
              <LabeledInput label="主分类" value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value, categorySlug: slugify(value) }))} />
              <LabeledInput label="专题" value={form.topic} onChange={(value) => setForm((current) => ({ ...current, topic: value, topicSlug: slugify(value), name: `${current.category} / ${value}` }))} />
              <LabeledInput label="分类 Slug" value={form.categorySlug} onChange={(value) => setForm((current) => ({ ...current, categorySlug: value }))} />
              <LabeledInput label="专题 Slug" value={form.topicSlug} onChange={(value) => setForm((current) => ({ ...current, topicSlug: value }))} />
              <LabeledInput label="归档方案名称" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <LabeledInput label="默认标签" value={form.defaultTags?.join(", ") ?? ""} onChange={(value) => setForm((current) => ({ ...current, defaultTags: value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
              <PathBlock title="最终目录" value={`content/${form.categorySlug || "category"}/${form.topicSlug || "topic"}`} />
              <button className="primary-button full" type="button" onClick={createPendingProfile}>创建并选中</button>
            </aside>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="panel preview-summary">
          <StepHeader title="预览与发布" eyebrow="第 5 步" />
          <PathBlock title="最终 Markdown 路径" value={draft.preview.markdownPath ?? ""} />
          <PathBlock title="最终图片目录" value={draft.preview.assetDirectory ?? ""} />
          <div className="status-grid">
            <span>图片总数：{draft.assets.dependencies.length}</span>
            <span>已找到：{assetCounts.resolved ?? 0}</span>
            <span>缺失：{assetCounts.missing ?? 0}</span>
            <span>远程：{assetCounts.remote ?? 0}</span>
            <span>嵌入：{assetCounts.embedded ?? 0}</span>
          </div>
          <PathBlock title="Front Matter" value={frontMatterPreview.split("---")[1]?.trim() ?? ""} pre />
          <PathBlock title="计划文件变更" value={(draft.preview.workspacePlan?.plannedFiles ?? []).map((file) => `${file.type}: ${file.path}`).join("\n") || "暂无可写入文件计划"} pre />
          {draft.archive.pendingProfileChanges.length > 0 && <p className="warning-text">包含 {draft.archive.pendingProfileChanges.length} 个新建归档方案草稿，将在后续原子化发布时与文章和图片一起写入。</p>}
          <div className="actions">
            <button className="secondary-button" type="button" onClick={() => setStep(4)}>上一步</button>
            <button className="primary-button" type="button">生成发布草稿</button>
          </div>
        </div>
      )}
    </section>
  );
}

function StepHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>;
}

function StepActions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return <div className="actions"><button className="secondary-button" type="button" onClick={onBack}>上一步</button><button className="primary-button" type="button" onClick={onNext}>下一步</button></div>;
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="search-label">{label}<input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PathBlock({ title, value, testId, pre = false }: { title: string; value: string; testId?: string; pre?: boolean }) {
  return <div className="path-block"><h3>{title}</h3>{pre ? <pre data-testid={testId}>{value}</pre> : <code data-testid={testId}>{value}</code>}</div>;
}

function FileSummary({ file, parsedTitle, imageCount }: { file: SelectedMarkdownFile; parsedTitle?: string; imageCount: number }) {
  return <div className="file-summary"><strong>{file.fileName}</strong><span>{formatSize(file.size)}</span><span>修改时间：{file.modifiedAt?.slice(0, 10) ?? "未知"}</span><span>检测标题：{parsedTitle ?? "未检测到标题"}</span><span>检测图片：{imageCount}</span></div>;
}

function statusLabel(status: ResolvedImageDependency["status"]): string {
  const labels: Record<ResolvedImageDependency["status"], string> = {
    resolved: "已找到",
    missing: "缺失",
    remote: "远程图片",
    embedded: "嵌入图片",
    ambiguous: "存在多个候选",
    unsupported: "不支持格式",
    unsafe: "不安全路径"
  };
  return labels[status];
}
