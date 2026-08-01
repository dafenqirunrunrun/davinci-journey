import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyArchiveProfileChanges,
  createArchiveProfile,
  getArchivePathPreview,
  recommendArchiveProfile,
  slugify,
  writeArchiveFrontMatter,
  type ArchiveProfile,
  type ArchiveProfileChange,
  type NewArchiveProfileInput
} from "@davinci-journey/classification";
import { parseMarkdown } from "@davinci-journey/markdown-core";
import { initialArchiveProfiles } from "../archiveProfiles";
import { createBrowserBridge, createDesktopBridge, desktopErrorMessage, isCancelError, type DesktopBridge, type PrePublishCheckResult, type RepositoryRootResult, type SelectedMarkdownFileDto, type StageTransactionResult } from "../desktopBridge";
import { canContinueFromAssets, emptyDraft, type PublishDraft, type ResolvedImageDependency, type SelectedMarkdownFile } from "../publishState";

const steps = ["选择 Markdown", "检查图片", "编辑文章信息", "选择归档方案", "预览并发布", "写入仓库"];
const today = "2026-07-30";

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

async function createDraftFromFile(markdownFile: SelectedMarkdownFileDto, profiles: ArchiveProfile[], bridge: DesktopBridge): Promise<PublishDraft> {
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
  const selectedProfile = recommendation.archiveProfileId;
  const profile = profiles.find((item) => item.id === selectedProfile) ?? profiles[0]!;
  const preview = getArchivePathPreview(profile, slug);
  const dependencies = await bridge.resolveImageDependencies({ markdownFile, references: parsedDocument.imageReferences });

  return {
    id: `draft-${Date.now()}`,
    source: { markdownFile, parsedDocument },
    assets: { dependencies, userResolutions: {} },
    article: {
      title,
      description: typeof parsedDocument.frontMatter.description === "string" ? parsedDocument.frontMatter.description : "",
      slug,
      tags: Array.isArray(parsedDocument.frontMatter.tags) ? parsedDocument.frontMatter.tags.map(String) : profile.defaultTags,
      date: typeof parsedDocument.frontMatter.date === "string" ? parsedDocument.frontMatter.date : today,
      updated: today,
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
    repository: {},
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
        workspaceId: draft.preview.workspaceResult?.workspaceId ?? draft.id,
        sourceMarkdownPath: draft.source.markdownFile?.absolutePath || draft.source.markdownFile?.fileName || "",
        outputMarkdownPath: preview.markdownPath,
        outputAssetDirectory: preview.imageDirectory,
        plannedFiles: [
          { type: "create", path: preview.markdownPath },
          ...draft.assets.dependencies
            .filter((item) => item.status === "resolved")
            .map((item) => ({ type: "create" as const, path: `${preview.imageDirectory}${item.fileName ?? "image"}`, source: item.resolvedPath }))
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
  const [commitMessage, setCommitMessage] = useState("");
  const [repositoryTarget, setRepositoryTarget] = useState<RepositoryRootResult | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFilePicker = useRef<((file?: File) => void) | undefined>();

  const bridge = useMemo(
    () =>
      createDesktopBridge(
        () =>
          new Promise<File | undefined>((resolve) => {
            pendingFilePicker.current = resolve;
            inputRef.current?.click();
          })
      ),
    []
  );
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
  const repoRoot = repositoryTarget?.valid ? repositoryTarget.repositoryRoot : "";

  useEffect(() => {
    let active = true;
    bridge
      .loadRepositoryTargetSettings()
      .then((result) => {
        if (!active || !result) return;
        setRepositoryTarget(result);
        setDraft((current) => ({
          ...current,
          repository: { ...current.repository, repositoryRootResult: result }
        }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bridge]);

  async function loadMarkdownFile(markdownFile: SelectedMarkdownFileDto, activeBridge: DesktopBridge) {
    const next = updatePreview(await createDraftFromFile(markdownFile, profiles, activeBridge), profiles);
    setDraft({ ...next, repository: { repositoryRootResult: repositoryTarget } });
    setStep(2);
  }

  async function selectMarkdown() {
    setDraft({ ...emptyDraft, repository: { repositoryRootResult: repositoryTarget }, status: "parsing" });
    try {
      const markdownFile = await bridge.selectMarkdownFile({ maxBytes: 10 * 1024 * 1024 });
      await loadMarkdownFile(markdownFile, bridge);
    } catch (error) {
      if (isCancelError(error)) {
        setDraft({ ...emptyDraft, repository: { repositoryRootResult: repositoryTarget } });
        return;
      }
      setDraft({ ...emptyDraft, repository: { repositoryRootResult: repositoryTarget }, status: "failed", error: desktopErrorMessage(error) });
    }
  }

  async function handleBrowserInput(file?: File) {
    if (pendingFilePicker.current) {
      pendingFilePicker.current(file);
      pendingFilePicker.current = undefined;
      return;
    }
    if (!file) return;
    setDraft({ ...emptyDraft, repository: { repositoryRootResult: repositoryTarget }, status: "parsing" });
    try {
      const browserBridge = createBrowserBridge(() => Promise.resolve(file));
      const markdownFile = await browserBridge.selectMarkdownFile({ maxBytes: 10 * 1024 * 1024 });
      await loadMarkdownFile(markdownFile, browserBridge);
    } catch (error) {
      setDraft({ ...emptyDraft, repository: { repositoryRootResult: repositoryTarget }, status: "failed", error: desktopErrorMessage(error) });
    }
    pendingFilePicker.current = undefined;
  }

  function selectProfile(profileId: string) {
    setDraft((current) => updatePreview({ ...current, archive: { ...current.archive, selectedProfileId: profileId }, preview: { ...current.preview, workspaceResult: undefined } }, profiles));
  }

  function updateArticle(next: Partial<PublishDraft["article"]>) {
    setDraft((current) => updatePreview({ ...current, article: { ...current.article, ...next }, preview: { ...current.preview, workspaceResult: undefined } }, profiles));
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
          },
          preview: { ...current.preview, workspaceResult: undefined }
        },
        [...profiles, result.profile]
      )
    );
    setShowCreate(false);
  }

  function rememberRepositoryTarget(result: RepositoryRootResult) {
    setRepositoryTarget(result);
    setDraft((current) => ({
      ...current,
      preview: { ...current.preview, workspaceResult: undefined },
      repository: { ...current.repository, repositoryRootResult: result },
      error: result.valid ? undefined : result.message ?? result.errors[0]
    }));
  }

  async function chooseRepositoryTarget() {
    try {
      rememberRepositoryTarget(await bridge.selectRepositoryRoot());
    } catch (error) {
      setDraft((current) => ({ ...current, error: desktopErrorMessage(error) }));
    }
  }

  async function revalidateRepositoryTarget() {
    if (!repositoryTarget?.repositoryRoot) {
      await chooseRepositoryTarget();
      return;
    }
    try {
      rememberRepositoryTarget(await bridge.validateRepositoryRoot(repositoryTarget.repositoryRoot));
    } catch (error) {
      setDraft((current) => ({ ...current, error: desktopErrorMessage(error) }));
    }
  }

  async function generateWorkspace() {
    if (!draft.source.markdownFile || !draft.source.parsedDocument || !selectedProfile) return;
    if (!repoRoot) {
      setDraft((current) => ({
        ...current,
        status: canContinueFromAssets(current.assets.dependencies) ? "ready" : "needs_attention",
        error: "尚未选择有效的个人网站仓库。请选择“达芬奇的奇妙之旅”所在的 Git 仓库后继续。"
      }));
      return;
    }
    setDraft((current) => ({ ...current, status: "generating_workspace", error: undefined }));
    try {
      const result = await bridge.generatePublishWorkspace({
        repositoryRoot: repoRoot,
        sourceMarkdownPath: draft.source.markdownFile.absolutePath,
        sourceFingerprint: (draft.source.markdownFile as SelectedMarkdownFileDto).sourceFingerprint,
        markdownContent: draft.source.markdownFile.content,
        article: draft.article,
        archiveProfile: selectedProfile,
        imageReferences: draft.source.parsedDocument.imageReferences,
        dependencies: draft.assets.dependencies,
        pendingArchiveProfiles: draft.archive.pendingProfileChanges.filter((change) => change.type === "create").map((change) => change.profile)
      });
      setDraft((current) => updatePreview({ ...current, status: "workspace_ready", preview: { ...current.preview, workspaceResult: result } }, profiles));
    } catch (error) {
      setDraft((current) => ({ ...current, status: "failed", error: desktopErrorMessage(error) }));
    }
  }

  async function discardWorkspace() {
    const workspaceId = draft.preview.workspaceResult?.workspaceId;
    if (!workspaceId) return;
    await bridge.discardPublishWorkspace(workspaceId, repoRoot);
    setDraft((current) => updatePreview({ ...current, status: canContinueFromAssets(current.assets.dependencies) ? "ready" : "needs_attention", preview: { ...current.preview, workspaceResult: undefined } }, profiles));
  }

  // ─── Repository Publish Operations ─────────────────────────────────────────

  async function inspectRepo() {
    const workspaceId = draft.preview.workspaceResult?.workspaceId;
    if (!workspaceId) return;
    setDraft((current) => ({ ...current, status: "checking_repo", error: undefined }));
    try {
      if (!repoRoot) {
        setDraft((current) => ({
          ...current,
          status: "precheck_failed",
          error: "尚未选择有效的个人网站仓库。请选择“达芬奇的奇妙之旅”所在的 Git 仓库后继续。",
          repository: { ...current.repository, failedStage: "precheck" }
        }));
        return;
      }
      const verifiedTarget = await bridge.validateRepositoryRoot(repoRoot);
      rememberRepositoryTarget(verifiedTarget);
      if (!verifiedTarget.valid) {
        setDraft((current) => ({
          ...current,
          status: "precheck_failed",
          error: verifiedTarget.message ?? verifiedTarget.errors[0] ?? "目标网站仓库无效。",
          repository: { ...current.repository, repositoryRootResult: verifiedTarget, failedStage: "precheck" }
        }));
        return;
      }
      const preCheck = await bridge.inspectRepositoryPublish({
        repositoryRoot: verifiedTarget.repositoryRoot,
        workspaceId
      });
      setDraft((current) => ({
        ...current,
        status: "confirm_write",
        repository: { ...current.repository, repositoryRootResult: verifiedTarget, preCheckResult: preCheck, failedStage: undefined }
      }));
    } catch (error) {
      setDraft((current) => ({ ...current, status: "precheck_failed", error: desktopErrorMessage(error), repository: { ...current.repository, failedStage: "precheck" } }));
    }
  }

  async function recheckRepo() {
    await inspectRepo();
  }

  async function applyWorkspace() {
    if (!draft.preview.workspaceResult) return;
    if (!repoRoot) {
      setDraft((current) => ({ ...current, status: "write_failed", error: "尚未选择有效的个人网站仓库，请先选择目标仓库。", repository: { ...current.repository, failedStage: "write" } }));
      return;
    }
    setDraft((current) => ({ ...current, status: "writing", error: undefined }));
    try {
      const result = await bridge.applyPublishWorkspace({
        repositoryRoot: repoRoot,
        workspaceId: draft.preview.workspaceResult.workspaceId,
        operation: draft.repository.preCheckResult?.targetConflicts.targetExists ? "update" : "create",
        archiveProfileChanges: draft.archive.pendingProfileChanges
          .filter((c) => c.type === "create")
          .map((c) => ({
            id: c.profile.id,
            name: c.profile.name,
            category: c.profile.category,
            topic: c.profile.topic,
            directory: c.profile.directory,
            defaultTags: c.profile.defaultTags,
            description: c.profile.description
          }))
      });
      setDraft((current) => ({
        ...current,
        status: "written",
        repository: { ...current.repository, applyResult: result, transactionId: result.transactionId, failedStage: undefined }
      }));
      // Generate default commit message
      const slug = draft.article.slug;
      const topic = selectedProfile?.topic?.toLowerCase() ?? "note";
      setCommitMessage(`docs(${topic}): add ${slug} with assets`);
    } catch (error) {
      setDraft((current) => ({ ...current, status: "write_failed", error: desktopErrorMessage(error), repository: { ...current.repository, failedStage: "write" } }));
    }
  }

  async function viewDiff() {
    const txId = draft.repository.transactionId;
    if (!txId) return;
    setDraft((current) => ({ ...current, status: "viewing_diff", error: undefined }));
    try {
      const paths = draft.repository.applyResult?.plannedChanges.map((c) => c.path) ?? [];
      const diffResult = await bridge.getPublishDiff({
        repositoryRoot: repoRoot,
        paths
      });
      setDraft((current) => ({
        ...current,
        status: "viewing_diff",
        repository: { ...current.repository, diffResult: JSON.stringify(diffResult) }
      }));
    } catch (error) {
      setDraft((current) => ({ ...current, status: "written", error: desktopErrorMessage(error) }));
    }
  }

  async function stageTransaction() {
    const txId = draft.repository.transactionId;
    if (!txId) return;
    setDraft((current) => ({ ...current, status: "staging", error: undefined }));
    try {
      const stageResult = await bridge.stagePublishTransaction({
        repositoryRoot: repoRoot,
        transactionId: txId
      });
      if (!stageResult.canCommit) {
        setDraft((current) => ({
          ...current,
          status: "stage_failed",
          repository: { ...current.repository, stageResult, failedStage: "stage" },
          error: stageResult.message ?? "暂存失败"
        }));
        return;
      }
      setDraft((current) => ({
        ...current,
        status: "confirm_commit",
        repository: { ...current.repository, stageResult, failedStage: undefined }
      }));
    } catch (error) {
      setDraft((current) => ({ ...current, status: "stage_failed", error: desktopErrorMessage(error), repository: { ...current.repository, failedStage: "stage" } }));
    }
  }

  async function doCommit() {
    const txId = draft.repository.transactionId;
    if (!txId || !commitMessage.trim()) return;
    setDraft((current) => ({ ...current, status: "confirm_commit", error: undefined }));
    try {
      const commitResult = await bridge.commitPublishTransaction({
        repositoryRoot: repoRoot,
        transactionId: txId,
        message: commitMessage.trim()
      });
      setDraft((current) => ({
        ...current,
        status: "committed",
        repository: { ...current.repository, commitResult, failedStage: undefined }
      }));
    } catch (error) {
      setDraft((current) => ({ ...current, status: "commit_failed", error: desktopErrorMessage(error), repository: { ...current.repository, failedStage: "commit" } }));
    }
  }

  async function doRollback() {
    const txId = draft.repository.transactionId;
    if (!txId) return;
    setDraft((current) => ({ ...current, status: "rolling_back", error: undefined }));
    try {
      await bridge.rollbackRepositoryPublish({
        repositoryRoot: repoRoot,
        transactionId: txId
      });
      setDraft((current) => updatePreview({
        ...current,
        status: "workspace_ready",
        repository: {},
        preview: { ...current.preview, workspaceResult: undefined }
      }, profiles));
    } catch (error) {
      setDraft((current) => ({ ...current, status: "written", error: desktopErrorMessage(error) }));
    }
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
        <div className="panel upload-panel" onDragOver={(event) => event.preventDefault()}>
          <p className="eyebrow">第 1 步</p>
          <h2>选择 Markdown</h2>
          <p className="muted-text">
            {bridge.mode === "tauri"
              ? "Tauri 桌面模式会读取真实文件路径，并在下一步解析相邻图片。"
              : "浏览器预览模式只能读取 Markdown 内容，不能访问相邻图片或生成临时发布工作区。"}
          </p>
          <RepositoryTargetPanel
            target={repositoryTarget}
            onChoose={() => void chooseRepositoryTarget()}
            onRevalidate={() => void revalidateRepositoryTarget()}
          />
          <input ref={inputRef} className="visually-hidden" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void handleBrowserInput(event.target.files?.[0])} />
          <button className="primary-button" type="button" onClick={() => void selectMarkdown()}>
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
                  <p>
                    状态：{statusLabel(dependency.status)}
                    {dependency.size ? ` · ${formatSize(dependency.size)}` : ""}
                    {dependency.mimeType ? ` · ${dependency.mimeType}` : ""}
                  </p>
                  {dependency.message && <p className="muted-text">{dependency.message}</p>}
                </div>
              </div>
            ))}
          </div>
          {!canContinueFromAssets(draft.assets.dependencies) && <p className="warning-text">存在缺失、冲突、不安全或不支持的图片，生成正式工作区前必须处理。</p>}
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
          <label className="check-row">
            <input type="checkbox" checked={draft.article.draft} onChange={(event) => updateArticle({ draft: event.target.checked })} /> 草稿
          </label>
          <label className="check-row">
            <input type="checkbox" checked={draft.article.featured} onChange={(event) => updateArticle({ featured: event.target.checked })} /> 精选
          </label>
          <StepActions onBack={() => setStep(2)} onNext={() => setStep(4)} />
        </div>
      )}

      {step === 4 && (
        <div className="archive-layout">
          <div className="panel list-panel">
            <div className="section-title">
              <StepHeader title="归档方案" eyebrow="第 4 步" />
              <button className="ghost-button" type="button" onClick={() => setShowCreate((value) => !value)}>
                + 新建归档方案
              </button>
            </div>
            {recommendation && (
              <article className="recommendation">
                <p className="eyebrow">推荐归档</p>
                <button className="profile-row recommended" type="button" onClick={() => selectProfile(recommendation.archiveProfileId)}>
                  <span>
                    <strong>{profiles.find((profile) => profile.id === recommendation.archiveProfileId)?.name}</strong>
                    <small>匹配度：{Math.round(recommendation.confidence * 100)}%</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
                <ul className="reason-list">
                  {recommendation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </article>
            )}
            <LabeledInput label="搜索归档方案" value={search} onChange={setSearch} />
            <div className="profile-group">
              <h3>全部归档方案</h3>
              {filteredProfiles.map((profile) => (
                <button className={`profile-row ${draft.archive.selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id} type="button" onClick={() => selectProfile(profile.id)}>
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.directory}</small>
                  </span>
                  <span aria-hidden="true">{draft.archive.selectedProfileId === profile.id ? "●" : "○"}</span>
                </button>
              ))}
            </div>
          </div>
          <aside className="panel preview-panel">
            <StepHeader title={selectedProfile?.name ?? "未选择"} eyebrow="最终结果预览" />
            <PathBlock title="Markdown" value={draft.preview.markdownPath ?? ""} testId="markdown-path" />
            <PathBlock title="图片资源" value={draft.preview.assetDirectory ?? ""} testId="image-path" />
            {draft.archive.pendingProfileChanges.length > 0 && <p className="warning-text">新建归档方案只保存在当前发布草稿中，正式发布时一并写入。</p>}
            <StepActions onBack={() => setStep(3)} onNext={() => setStep(5)} />
          </aside>
          {showCreate && (
            <aside className="drawer" aria-label="新建归档方案">
              <div className="section-title">
                <StepHeader title="新建归档方案" eyebrow="待提交变更" />
                <button className="icon-button" aria-label="关闭新建归档方案" type="button" onClick={() => setShowCreate(false)}>
                  x
                </button>
              </div>
              <LabeledInput label="主分类" value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value, categorySlug: slugify(value), name: `${value} / ${current.topic}` }))} />
              <LabeledInput label="专题" value={form.topic} onChange={(value) => setForm((current) => ({ ...current, topic: value, topicSlug: slugify(value), name: `${current.category} / ${value}` }))} />
              <LabeledInput label="分类 Slug" value={form.categorySlug} onChange={(value) => setForm((current) => ({ ...current, categorySlug: value }))} />
              <LabeledInput label="专题 Slug" value={form.topicSlug} onChange={(value) => setForm((current) => ({ ...current, topicSlug: value }))} />
              <LabeledInput label="归档方案名称" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
              <LabeledInput label="默认标签" value={form.defaultTags?.join(", ") ?? ""} onChange={(value) => setForm((current) => ({ ...current, defaultTags: value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
              <LabeledInput label="描述" value={form.description ?? ""} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
              <PathBlock title="最终目录" value={`content/${form.categorySlug || "category"}/${form.topicSlug || "topic"}`} />
              <button className="primary-button full" type="button" onClick={createPendingProfile}>
                创建并选中
              </button>
            </aside>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="panel preview-summary">
          <StepHeader title="预览并发布" eyebrow="第 5 步" />
          <PathBlock title="源 Markdown" value={draft.source.markdownFile?.absolutePath || draft.source.markdownFile?.fileName || "未选择"} />
          <RepositoryTargetPanel
            target={repositoryTarget}
            onChoose={() => void chooseRepositoryTarget()}
            onRevalidate={() => void revalidateRepositoryTarget()}
          />
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
          {draft.archive.pendingProfileChanges.filter((c): c is Extract<ArchiveProfileChange, { type: "create" }> => c.type === "create").map((c) => (
            <PathBlock key={c.profile.id} title={`新建：${c.profile.name}`} value={`${c.profile.name} → ${c.profile.directory}`} pre />
          ))}
          {draft.error && <p className="error-message">{draft.error}</p>}
          {draft.preview.workspaceResult && <WorkspaceResult bridge={bridge} result={draft.preview.workspaceResult} onDiscard={() => void discardWorkspace()} onRegenerate={() => void generateWorkspace()} />}
          <div className="actions">
            <button className="secondary-button" type="button" onClick={() => setStep(4)}>
              上一步
            </button>
            <button className="primary-button" type="button" disabled={draft.status === "generating_workspace" || !repositoryTarget?.valid} onClick={() => void generateWorkspace()}>
              {draft.status === "generating_workspace" ? "正在生成..." : "生成发布工作区"}
            </button>
            <button className="primary-button" type="button" disabled={draft.status !== "workspace_ready" || !repositoryTarget?.valid} onClick={() => { setStep(6); void inspectRepo(); }}>
              写入正式仓库
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="panel repository-publish-panel">
          <StepHeader title="写入正式仓库" eyebrow="第 6 步" />

          {draft.status === "checking_repo" && (
            <div className="status-message">
              <p>正在检查仓库状态...</p>
            </div>
          )}

          {draft.status === "precheck_failed" && (
            <FailureState
              title="预检失败"
              error={draft.error ?? "预检失败"}
              onRetry={() => void recheckRepo()}
              onBack={() => setStep(5)}
            />
          )}

          {draft.status === "confirm_write" && draft.repository.preCheckResult && (
            <PreCheckResult
              preCheck={draft.repository.preCheckResult}
              repoRootInfo={draft.repository.repositoryRootResult}
              plannedChanges={draft.preview.workspacePlan?.plannedFiles ?? []}
              pendingProfiles={draft.archive.pendingProfileChanges}
              onConfirm={() => void applyWorkspace()}
              onBack={() => setStep(5)}
              onDiscard={() => { setStep(5); void discardWorkspace(); }}
            />
          )}

          {draft.status === "writing" && (
            <div className="status-message">
              <p>正在写入正式仓库...</p>
            </div>
          )}

          {draft.status === "write_failed" && (
            <FailureState
              title="写入失败"
              error={draft.error ?? "写入正式仓库失败"}
              onRetry={() => void applyWorkspace()}
              onBack={() => setStep(5)}
            />
          )}

          {draft.status === "written" && draft.repository.applyResult && (
            <WriteResult
              result={draft.repository.applyResult}
              onViewDiff={() => void viewDiff()}
              onRollback={() => void doRollback()}
              onStage={() => void stageTransaction()}
              error={draft.error}
            />
          )}

          {draft.status === "viewing_diff" && draft.repository.diffResult && (
            <DiffView
              diffData={draft.repository.diffResult}
              onStage={() => void stageTransaction()}
              onBack={() => setDraft((current) => ({ ...current, status: "written" }))}
            />
          )}

          {draft.status === "staging" && (
            <div className="status-message">
              <p>正在暂存文件...</p>
            </div>
          )}

          {draft.status === "stage_failed" && (
            <StageConflictState
              stageResult={draft.repository.stageResult}
              error={draft.error ?? "暂存失败"}
              onRecheck={() => void recheckRepo()}
              onRetryStage={() => void stageTransaction()}
            />
          )}

          {draft.status === "confirm_commit" && (
            <CommitView
              message={commitMessage}
              stagedFiles={draft.repository.stageResult?.stagedFiles ?? []}
              onMessageChange={setCommitMessage}
              onCommit={() => void doCommit()}
              onBack={() => setDraft((current) => ({ ...current, status: "written" }))}
              error={draft.error}
            />
          )}

          {draft.status === "commit_failed" && (
            <FailureState
              title="提交失败"
              error={draft.error ?? "创建本地 Commit 失败"}
              onRetry={() => void doCommit()}
              onBack={() => setDraft((current) => ({ ...current, status: "written" }))}
            />
          )}

          {draft.status === "committed" && draft.repository.commitResult && (
            <CommitResultView
              result={draft.repository.commitResult}
            />
          )}

          {draft.status === "rolling_back" && (
            <div className="status-message">
              <p>正在回滚...</p>
            </div>
          )}

          {draft.error && draft.status !== "written" && draft.status !== "confirm_commit" && draft.status !== "precheck_failed" && draft.status !== "write_failed" && draft.status !== "stage_failed" && draft.status !== "commit_failed" && (
            <p className="error-message">{draft.error}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function PreCheckResult({ preCheck, repoRootInfo, plannedChanges, pendingProfiles, onConfirm, onBack, onDiscard }: {
  preCheck: PrePublishCheckResult;
  repoRootInfo?: RepositoryRootResult;
  plannedChanges: { type: string; path: string }[];
  pendingProfiles: ArchiveProfileChange[];
  onConfirm: () => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const canWrite = preCheck.gitStatus.safeToPublish
    && preCheck.workspaceStatus.passed
    && preCheck.sourceFingerprintStatus.sourceUnchanged
    && preCheck.targetConflicts.canProceed
    && Boolean(repoRootInfo?.valid);

  const createProfiles = pendingProfiles.filter((c): c is Extract<ArchiveProfileChange, { type: "create" }> => c.type === "create");

  return (
    <div className="confirm-write">
      <h3>正式写入确认</h3>

      <section className="write-section">
        <h4>目标仓库</h4>
        <code>{repoRootInfo?.repositoryRoot || preCheck.gitStatus.repositoryRoot || "未解析"}</code>
        <div className="status-grid">
          <span>当前分支：{repoRootInfo?.branch ?? preCheck.gitStatus.branch ?? "（无）"}</span>
          <span>当前 HEAD：{(repoRootInfo?.head ?? preCheck.gitStatus.head).slice(0, 7)}</span>
        </div>
        {!repoRootInfo?.valid && <p className="error-message">仓库根目录无效，无法确认写入。</p>}
      </section>

      <section className="write-section">
        <h4>Git 状态</h4>
        <div className="status-grid">
          <span>分支：{preCheck.gitStatus.branch ?? "（无）"}</span>
          <span>HEAD：{preCheck.gitStatus.head.slice(0, 7)}</span>
          <span>安全发布：{preCheck.gitStatus.safeToPublish ? "✅" : "❌"}</span>
          <span>无关未跟踪文件：{preCheck.gitStatus.unrelatedUntrackedCount}</span>
        </div>
        {preCheck.gitStatus.message && <p className="warning-text">{preCheck.gitStatus.message}</p>}
      </section>

      <section className="write-section">
        <h4>文章</h4>
        <p>操作：{preCheck.targetConflicts.targetExists ? "更新" : "创建"}</p>
        {plannedChanges.filter((f) => f.path.startsWith("content/")).map((f, i) => (
          <code key={i}>{f.path}</code>
        ))}
      </section>

      <section className="write-section">
        <h4>图片</h4>
        <p>新增：{plannedChanges.filter((f) => f.path.startsWith("public/")).length}</p>
      </section>

      <section className="write-section">
        <h4>归档配置</h4>
        {createProfiles.length > 0 ? (
          <div>
            <p>新增归档方案：{createProfiles.map((c) => c.profile.name).join("、")}</p>
            <code>config/archive-profiles.yml</code>
          </div>
        ) : (
          <p className="muted-text">无变更</p>
        )}
      </section>

      <section className="write-section">
        <h4>冲突检查</h4>
        <div className="status-grid">
          <span>目标文件冲突：{preCheck.targetConflicts.canProceed ? "0" : "1"}</span>
          <span>未提交目标修改：{preCheck.targetConflicts.uncommittedFiles.length}</span>
          <span>源文件变化：{preCheck.sourceFingerprintStatus.markdownChanged ? "有变化" : "无"}</span>
        </div>
        {preCheck.targetConflicts.message && <p className="warning-text">{preCheck.targetConflicts.message}</p>}
        {preCheck.sourceFingerprintStatus.message && <p className="error-message">{preCheck.sourceFingerprintStatus.message}</p>}
      </section>

      <section className="write-section">
        <h4>工作区验证</h4>
        {preCheck.workspaceStatus.checks.map((check, i) => (
          <span className="check-item" key={i}>{check}</span>
        ))}
        {preCheck.workspaceStatus.warnings.map((w, i) => (
          <span className="warning-text" key={i}>{w}</span>
        ))}
      </section>

      <div className="actions">
        <button className="secondary-button" type="button" onClick={onBack}>返回修改</button>
        <button className="secondary-button" type="button" onClick={onDiscard}>丢弃工作区</button>
        <button className="primary-button" type="button" disabled={!canWrite} onClick={onConfirm}>
          确认写入正式仓库
        </button>
      </div>
    </div>
  );
}

function RepositoryTargetPanel({ target, onChoose, onRevalidate }: {
  target?: RepositoryRootResult;
  onChoose: () => void;
  onRevalidate: () => void;
}) {
  const valid = Boolean(target?.valid);
  return (
    <section className="write-section" aria-label="目标网站仓库">
      <div className="section-title">
        <div>
          <p className="eyebrow">发布目标</p>
          <h3>目标网站仓库</h3>
        </div>
        <div className="actions compact-actions">
          <button className="secondary-button" type="button" onClick={onChoose}>
            更换目标仓库
          </button>
          <button className="secondary-button" type="button" disabled={!target?.repositoryRoot} onClick={onRevalidate}>
            重新验证仓库
          </button>
        </div>
      </div>
      <code data-testid="repository-root">{target?.displayPath || target?.repositoryRoot || "未选择"}</code>
      {valid ? (
        <div className="status-grid">
          <span>当前分支：{target?.branch ?? "（无）"}</span>
          <span>当前 HEAD：{target?.head ? target.head.slice(0, 7) : "未知"}</span>
        </div>
      ) : (
        <p className="warning-text">
          {target?.message ?? "尚未选择有效的个人网站仓库。请选择“达芬奇的奇妙之旅”所在的 Git 仓库后继续。"}
        </p>
      )}
      {!valid && target?.errors && target.errors.length > 0 && (
        <div className="validation-list">
          {target.errors.map((error) => (
            <span className="check-fail" key={error}>{error}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function WriteResult({ result, onViewDiff, onRollback, onStage, error }: {
  result: NonNullable<import("../publishState").PublishDraft["repository"]["applyResult"]>;
  onViewDiff: () => void;
  onRollback: () => void;
  onStage: () => void;
  error?: string;
}) {
  const creates = result.plannedChanges.filter((c) => c.operation === "create");
  const updates = result.plannedChanges.filter((c) => c.operation === "update");

  return (
    <div className="write-result">
      <p className="eyebrow">已写入正式仓库</p>
      <p className="muted-text">尚未提交 Git</p>

      <section className="write-section">
        <h4>变更</h4>
        {creates.length > 0 && (
          <div>
            <p><strong>新增（{creates.length}）</strong></p>
            {creates.map((c, i) => <code key={i}>+ {c.path}</code>)}
          </div>
        )}
        {updates.length > 0 && (
          <div>
            <p><strong>修改（{updates.length}）</strong></p>
            {updates.map((c, i) => <code key={i}>~ {c.path}</code>)}
          </div>
        )}
      </section>

      {error && <p className="error-message">{error}</p>}

      <div className="actions">
        <button className="primary-button" type="button" onClick={onViewDiff}>
          查看 Git Diff
        </button>
        <button className="primary-button" type="button" onClick={onStage}>
          准备提交
        </button>
        <button className="secondary-button" type="button" onClick={onRollback}>
          回滚本次写入
        </button>
      </div>
    </div>
  );
}

function DiffView({ diffData, onStage, onBack }: {
  diffData: string;
  onStage: () => void;
  onBack: () => void;
}) {
  let parsedDiff: { diffs: { path: string; operation: string; diffText: string; isBinary: boolean }[] } | null = null;
  try {
    parsedDiff = JSON.parse(diffData);
  } catch { /* use raw diff data */ }

  return (
    <div className="diff-view">
      <h3>Git Diff</h3>

      {parsedDiff ? (
        parsedDiff.diffs.map((diff, i) => (
          <div className="diff-file" key={i}>
            <h4>{diff.isBinary ? "🖼" : "📄"} {diff.path} ({diff.operation})</h4>
            {diff.isBinary ? (
              <p className="muted-text">二进制文件，仅显示元数据</p>
            ) : (
              <pre className="diff-text">{diff.diffText || "（无差异内容）"}</pre>
            )}
          </div>
        ))
      ) : (
        <pre className="diff-text">{diffData}</pre>
      )}

      <div className="actions">
        <button className="secondary-button" type="button" onClick={onBack}>返回</button>
        <button className="primary-button" type="button" onClick={onStage}>
          准备提交
        </button>
      </div>
    </div>
  );
}

function CommitView({ message, stagedFiles, onMessageChange, onCommit, onBack, error }: {
  message: string;
  stagedFiles: string[];
  onMessageChange: (msg: string) => void;
  onCommit: () => void;
  onBack: () => void;
  error?: string;
}) {
  return (
    <div className="commit-view">
      <h3>准备提交</h3>
      <p>准备提交 {stagedFiles.length} 个文件</p>

      <section className="write-section">
        <h4>Commit Message</h4>
        <label className="search-label">
          提交信息
          <input
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder="docs(scope): description"
          />
        </label>
      </section>

      <section className="write-section">
        <h4>已暂存</h4>
        {stagedFiles.map((f, i) => <code key={i}>{f}</code>)}
      </section>

      {error && <p className="error-message">{error}</p>}

      <div className="actions">
        <button className="secondary-button" type="button" onClick={onBack}>返回</button>
        <button className="primary-button" type="button" disabled={!message.trim()} onClick={onCommit}>
          确认创建本地 Commit
        </button>
      </div>
    </div>
  );
}

function CommitResultView({ result }: {
  result: import("../desktopBridge").CommitTransactionResult;
}) {
  return (
    <div className="commit-result">
      <p className="eyebrow">本地 Commit 已创建</p>
      <div className="commit-info">
        <p>Hash：<code>{result.shortHash}</code></p>
        <p>分支：{result.branch}</p>
        <p>Message：{result.message}</p>
      </div>

      <section className="write-section">
        <h4>已提交文件</h4>
        {result.committedFiles.map((f, i) => <code key={i}>{f}</code>)}
      </section>

      <p className="muted-text">本地提交已完成，尚未推送到 GitHub。</p>
      <button className="secondary-button" type="button" disabled title="推送到 GitHub（下一阶段）">
        推送到 GitHub（下一阶段）
      </button>
    </div>
  );
}

function FailureState({ title, error, onRetry, onBack }: {
  title: string;
  error: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="failure-state">
      <h3>{title}</h3>
      <p className="error-message">{error}</p>
      <div className="actions">
        <button className="secondary-button" type="button" onClick={onBack}>
          返回
        </button>
        <button className="primary-button" type="button" onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}

function StageConflictState({ stageResult, error, onRecheck, onRetryStage }: {
  stageResult?: StageTransactionResult;
  error: string;
  onRecheck: () => void;
  onRetryStage: () => void;
}) {
  const unrelated = stageResult?.hasUnrelatedStaged ? stageResult.unrelatedFiles : [];
  return (
    <div className="failure-state">
      <h3>暂存冲突</h3>
      <p className="error-message">{error}</p>

      {unrelated.length > 0 && (
        <div className="write-section">
          <h4>无关文件</h4>
          {unrelated.map((f, i) => <code key={i}>{f}</code>)}
        </div>
      )}

      <p className="warning-text">
        暂存区中存在与本次发布无关的文件。
        <br />
        为了避免把其他修改一起提交，本次自动提交已停止。
        <br />
        请在终端或 VS Code 的源代码管理面板中处理现有暂存文件，
        处理完成后点击“重新检查 Git 状态”。
      </p>

      <div className="actions">
        <button className="secondary-button" type="button" onClick={onRecheck}>
          重新检查 Git 状态
        </button>
        <button className="primary-button" type="button" onClick={onRetryStage}>
          重试暂存
        </button>
      </div>
    </div>
  );
}

function WorkspaceResult({ bridge, result, onDiscard, onRegenerate }: { bridge: DesktopBridge; result: NonNullable<import("../publishState").PublishDraft["preview"]["workspaceResult"]>; onDiscard: () => void; onRegenerate: () => void }) {
  return (
    <article className="workspace-card">
      <p className="eyebrow">发布工作区已生成</p>
      <h3>{result.workspaceId}</h3>
      <PathBlock title="工作区" value={result.workspacePath} />
      <PathBlock title="Markdown" value={result.targetMarkdownPath} />
      <PathBlock title="图片目录" value={`${result.targetAssetDirectory} · ${result.assets.filter((asset) => asset.status === "written" || asset.status === "reused").length} 个资源`} />
      <div className="validation-list">
        {result.validation.checks.map((check) => (
          <span className={check.passed ? "check-pass" : "check-fail"} key={check.code}>
            {check.passed ? "通过" : "失败"} · {check.label}
          </span>
        ))}
      </div>
      <div className="actions">
        <button className="secondary-button" type="button" onClick={() => void bridge.revealPublishWorkspace(result.workspacePath)}>
          在文件管理器中查看
        </button>
        <button className="secondary-button" type="button" onClick={onRegenerate}>
          重新生成
        </button>
        <button className="secondary-button" type="button" onClick={onDiscard}>
          丢弃工作区
        </button>
      </div>
    </article>
  );
}

function StepHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
  );
}

function StepActions({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="actions">
      <button className="secondary-button" type="button" onClick={onBack}>
        上一步
      </button>
      <button className="primary-button" type="button" onClick={onNext}>
        下一步
      </button>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="search-label">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function PathBlock({ title, value, testId, pre = false }: { title: string; value: string; testId?: string; pre?: boolean }) {
  return (
    <div className="path-block">
      <h3>{title}</h3>
      {pre ? <pre data-testid={testId}>{value}</pre> : <code data-testid={testId}>{value}</code>}
    </div>
  );
}

function FileSummary({ file, parsedTitle, imageCount }: { file: SelectedMarkdownFile; parsedTitle?: string; imageCount: number }) {
  return (
    <div className="file-summary">
      <strong>{file.fileName}</strong>
      <span>{formatSize(file.size)}</span>
      <span>修改时间：{file.modifiedAt?.slice(0, 10) ?? "未知"}</span>
      <span>检测标题：{parsedTitle ?? "未检测到标题"}</span>
      <span>检测图片：{imageCount}</span>
    </div>
  );
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
