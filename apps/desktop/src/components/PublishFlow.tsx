import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyArchiveProfileChanges,
  createArchiveProfile,
  ensureUniqueSlug,
  getArchivePathPreview,
  recommendArchiveProfile,
  slugify,
  writeArchiveFrontMatter,
  type ArchiveProfile,
  type ArchiveProfileChange,
  type NewArchiveProfileInput
} from "@davinci-journey/classification";
import { normalizeLeadingTitleHeading, parseMarkdown } from "@davinci-journey/markdown-core";
import { initialArchiveProfiles, mergeArchiveProfiles } from "../archiveProfiles";
import { createBrowserBridge, createDesktopBridge, desktopErrorMessage, isCancelError, type DeploymentCheckResult, type DesktopBridge, type InspectRemotePublishResult, type PrePublishCheckResult, type PublishLockStatus, type PushPublishResult, type RepositoryRootResult, type SelectedMarkdownFileDto, type StageTransactionResult } from "../desktopBridge";
import { canContinueFromAssets, emptyDraft, type PublishDraft, type RemotePublishState, type RemotePublishStatus, type ResolvedImageDependency, type SelectedMarkdownFile } from "../publishState";
import { getPublishWriteEligibility, publishWriteBlockReasonText } from "../publishWriteEligibility";
import { BatchPublishFlow } from "./BatchPublishFlow";

const steps = ["选择 Markdown", "检查图片", "编辑文章信息", "选择归档方案", "预览工作区", "写入并提交", "推送与上线"];
// 使用本地当前日期（YYYY-MM-DD），而不是写死某个日期。
function currentDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
const today = currentDate();

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

export async function createDraftFromFile(
  markdownFile: SelectedMarkdownFileDto,
  profiles: ArchiveProfile[],
  bridge: DesktopBridge,
  existingSlugs: readonly string[] = []
): Promise<PublishDraft> {
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
  const slug = ensureUniqueSlug(
    typeof parsedDocument.frontMatter.slug === "string" ? parsedDocument.frontMatter.slug : makeSlug(title, markdownFile.fileName),
    existingSlugs
  );
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
    remote: {
      status: "idle",
      repositoryRoot: "",
      remoteName: "origin",
      branch: "master",
      localCommitHash: ""
    },
    status: canContinueFromAssets(dependencies) ? "ready" : "needs_attention"
  };
}

export function updatePreview(draft: PublishDraft, profiles: ArchiveProfile[]): PublishDraft {
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
  const [baseProfiles, setBaseProfiles] = useState<ArchiveProfile[]>(initialArchiveProfiles);
  const [existingSlugs, setExistingSlugs] = useState<string[]>([]);
  const [draft, setDraft] = useState<PublishDraft>(emptyDraft);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewArchiveProfileInput>(emptyForm);
  const [search, setSearch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [repositoryTarget, setRepositoryTarget] = useState<RepositoryRootResult | undefined>();
  const [publishLock, setPublishLock] = useState<PublishLockStatus | undefined>();
  const [batchOpen, setBatchOpen] = useState(false);
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
        if (result.repositoryRoot) {
          void bridge.inspectPublishLock(result.repositoryRoot).then((lock) => {
            if (active) setPublishLock(lock);
          }).catch(() => undefined);
        }
        setDraft((current) => ({
          ...current,
          repository: { ...current.repository, repositoryRootResult: result }
        }));
        void refreshArchiveProfiles(result.repositoryRoot);
        void refreshExistingSlugs(result.repositoryRoot);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bridge]);

  /**
   * Reload the persisted archive profiles from the target repo's
   * `config/archive-profiles.yml` so profiles created in an earlier publish
   * survive into new drafts (previously they only lived in one draft and were
   * silently lost, forcing the user to re-create them). Called on repo select,
   * app start, and after a successful commit.
   */
  async function refreshArchiveProfiles(repositoryRoot?: string) {
    if (!repositoryRoot) return;
    try {
      const loaded = await bridge.loadArchiveProfiles(repositoryRoot);
      if (Array.isArray(loaded) && loaded.length > 0) {
        setBaseProfiles(mergeArchiveProfiles(loaded));
      }
    } catch {
      // 读取仓库归档配置失败时保留当前方案，不打断发布流程。
    }
  }

  /**
   * Reload the set of slugs already used in the repo's `content/**` notes.
   * When the new note's slug collides with one of these, `createDraftFromFile`
   * appends a `-2`/`-3`… suffix so the website build never fails on a
   * duplicate slug again.
   */
  async function refreshExistingSlugs(repositoryRoot?: string) {
    if (!repositoryRoot) return;
    try {
      const loaded = await bridge.loadExistingNoteSlugs(repositoryRoot);
      if (Array.isArray(loaded)) {
        setExistingSlugs(loaded);
      }
    } catch {
      // 读取现有 slug 失败时保留当前集合，去重退化为仅基于已加载数据的尽力而为。
    }
  }

  async function loadMarkdownFile(markdownFile: SelectedMarkdownFileDto, activeBridge: DesktopBridge) {
    const next = updatePreview(await createDraftFromFile(markdownFile, profiles, activeBridge, existingSlugs), profiles);
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

  function rememberRepositoryTarget(result: RepositoryRootResult, options: { preserveWorkspace?: boolean } = {}) {
    setRepositoryTarget(result);
    if (result.repositoryRoot) {
      void bridge.inspectPublishLock(result.repositoryRoot).then(setPublishLock).catch(() => setPublishLock(undefined));
      void refreshArchiveProfiles(result.repositoryRoot);
      void refreshExistingSlugs(result.repositoryRoot);
    } else {
      setPublishLock(undefined);
    }
    setDraft((current) => ({
      ...current,
      preview: options.preserveWorkspace ? current.preview : { ...current.preview, workspaceResult: undefined },
      repository: { ...current.repository, repositoryRootResult: result },
      error: result.valid ? undefined : result.message ?? result.errors[0]
    }));
  }

  async function refreshPublishLock(repositoryRoot = repoRoot) {
    if (!repositoryRoot) {
      setPublishLock(undefined);
      return;
    }
    try {
      setPublishLock(await bridge.inspectPublishLock(repositoryRoot));
    } catch {
      setPublishLock(undefined);
    }
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
      rememberRepositoryTarget(await bridge.validateRepositoryRoot(repositoryTarget.repositoryRoot), { preserveWorkspace: true });
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
      // Normalize the leading H1 in the publish OUTPUT copy only.
      // The original source markdown (and its fingerprint) is never modified.
      const hasTitle = Boolean(draft.article.title?.trim());
      const normalizedContent = normalizeLeadingTitleHeading(draft.source.markdownFile.content, hasTitle);
      const removedLeadingH1 = normalizedContent !== draft.source.markdownFile.content;

      const result = await bridge.generatePublishWorkspace({
        repositoryRoot: repoRoot,
        sourceMarkdownPath: draft.source.markdownFile.absolutePath,
        sourceFingerprint: (draft.source.markdownFile as SelectedMarkdownFileDto).sourceFingerprint,
        markdownContent: normalizedContent,
        article: draft.article,
        archiveProfile: selectedProfile,
        imageReferences: draft.source.parsedDocument.imageReferences,
        dependencies: draft.assets.dependencies,
        pendingArchiveProfiles: draft.archive.pendingProfileChanges.filter((change) => change.type === "create").map((change) => change.profile)
      });
      setDraft((current) => updatePreview({
        ...current,
        status: "workspace_ready",
        preview: { ...current.preview, workspaceResult: result, leadingTitleRemoved: removedLeadingH1 }
      }, profiles));
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
      rememberRepositoryTarget(verifiedTarget, { preserveWorkspace: true });
      await refreshPublishLock(verifiedTarget.repositoryRoot);
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

  function getRepositoryRootForWrite(): string {
    return draft.repository.preCheckResult?.gitStatus.repositoryRoot || draft.repository.repositoryRootResult?.repositoryRoot || repoRoot;
  }

  async function applyWorkspace() {
    if (!draft.preview.workspaceResult) return;
    const writeRepositoryRoot = getRepositoryRootForWrite();
    if (!writeRepositoryRoot) {
      setDraft((current) => ({ ...current, status: "write_failed", error: "尚未选择有效的个人网站仓库，请先选择目标仓库。", repository: { ...current.repository, failedStage: "write" } }));
      return;
    }
    setDraft((current) => ({ ...current, status: "writing", error: undefined }));
    try {
      const result = await bridge.applyPublishWorkspace({
        repositoryRoot: writeRepositoryRoot,
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
      await refreshPublishLock(writeRepositoryRoot);
    }
  }

  async function viewDiff() {
    const txId = draft.repository.transactionId;
    if (!txId) return;
    setDraft((current) => ({ ...current, status: "viewing_diff", error: undefined }));
    try {
      const paths = draft.repository.applyResult?.plannedChanges.map((c) => c.path) ?? [];
      const diffResult = await bridge.getPublishDiff({
        repositoryRoot: getRepositoryRootForWrite(),
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
        repositoryRoot: getRepositoryRootForWrite(),
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
        repositoryRoot: getRepositoryRootForWrite(),
        transactionId: txId,
        message: commitMessage.trim()
      });
      setDraft((current) => ({
        ...current,
        status: "committed",
        repository: { ...current.repository, commitResult, failedStage: undefined }
      }));
      await refreshPublishLock(getRepositoryRootForWrite());
      // The commit persisted any newly created archive profiles to the repo
      // config; reload the base list so the next draft sees them immediately.
      void refreshArchiveProfiles(getRepositoryRootForWrite());
      // The commit added a new note with its (possibly deduped) slug; refresh so
      // the next draft dedupes against it too.
      void refreshExistingSlugs(getRepositoryRootForWrite());
    } catch (error) {
      setDraft((current) => ({ ...current, status: "commit_failed", error: desktopErrorMessage(error), repository: { ...current.repository, failedStage: "commit" } }));
      await refreshPublishLock(getRepositoryRootForWrite());
    }
  }

  // ─── Remote Publish (Step 7) ──────────────────────────────────────────────

  /** Pre-push inspection: validates remote + branch + sync state. */
  async function startRemotePublish() {
    const commitHash = draft.repository.commitResult?.commitHash;
    const repoRoot = getRepositoryRootForWrite();
    if (!commitHash || !repoRoot) return;

    setDraft((current) => ({
      ...current,
      remote: {
        ...current.remote,
        status: "checking",
        repositoryRoot: repoRoot,
        localCommitHash: commitHash,
        branch: current.repository.commitResult?.branch || "master",
        error: undefined
      }
    }));

    try {
      const inspect: InspectRemotePublishResult = await bridge.inspectRemotePublish({
        repositoryRoot: repoRoot,
        commitHash,
        remoteName: "origin",
        branch: "master"
      });

      if (inspect.pushedAlready) {
        setDraft((current) => ({
          ...current,
          remote: {
            ...current.remote,
            status: "pushed",
            remoteUrl: inspect.remoteUrl,
            remoteOwner: inspect.remoteOwner,
            remoteRepo: inspect.remoteRepo,
            remoteCommitHash: commitHash,
            ahead: inspect.ahead,
            behind: inspect.behind,
            untrackedFiles: inspect.untrackedFiles,
            inspectMessage: "该 Commit 已推送到远程。"
          }
        }));
        return;
      }

      if (!inspect.canPush) {
        setDraft((current) => ({
          ...current,
          remote: {
            ...current.remote,
            status: "remote_conflict",
            remoteUrl: inspect.remoteUrl,
            remoteOwner: inspect.remoteOwner,
            remoteRepo: inspect.remoteRepo,
            ahead: inspect.ahead,
            behind: inspect.behind,
            untrackedFiles: inspect.untrackedFiles,
            inspectMessage: inspect.message
          }
        }));
        return;
      }

      setDraft((current) => ({
        ...current,
        remote: {
          ...current.remote,
          status: "ready_to_push",
          remoteUrl: inspect.remoteUrl,
          remoteOwner: inspect.remoteOwner,
          remoteRepo: inspect.remoteRepo,
          ahead: inspect.ahead,
          behind: inspect.behind,
          untrackedFiles: inspect.untrackedFiles,
          inspectMessage: inspect.message
        }
      }));
    } catch (error) {
      setDraft((current) => ({
        ...current,
        remote: { ...current.remote, status: "push_failed", error: desktopErrorMessage(error) }
      }));
    }
  }

  /** User confirmed push. */
  async function confirmPush() {
    const commitHash = draft.remote.localCommitHash;
    const repoRoot = getRepositoryRootForWrite();
    if (!commitHash || !repoRoot) return;

    setDraft((current) => ({ ...current, remote: { ...current.remote, status: "pushing", error: undefined } }));
    try {
      const pushResult: PushPublishResult = await bridge.pushPublishCommit({
        repositoryRoot: repoRoot,
        commitHash,
        remoteName: "origin",
        branch: "master"
      });

      const remoteHead = pushResult.remoteHead || commitHash;
      setDraft((current) => ({
        ...current,
        remote: {
          ...current.remote,
          status: "verifying_remote",
          remoteCommitHash: remoteHead
        }
      }));

      // Proceed to deployment tracking.
      await runDeploymentTracking(commitHash, repoRoot);
    } catch (error) {
      setDraft((current) => ({
        ...current,
        remote: { ...current.remote, status: "push_failed", error: desktopErrorMessage(error) }
      }));
    }
  }

  /** Track the Deploy Pages workflow for the pushed commit. */
  async function runDeploymentTracking(commitHash: string, repoRoot: string) {
    setDraft((current) => ({ ...current, remote: { ...current.remote, status: "waiting_for_workflow" } }));
    try {
      const first = await bridge.checkGithubPagesDeployment({
        repositoryRoot: repoRoot,
        commitHash,
        workflowName: "Deploy Pages",
        branch: "master"
      });

      // If gh is unavailable, degrade gracefully to `pushed`.
      if (!first.ghAvailable) {
        setDraft((current) => ({
          ...current,
          remote: {
            ...current.remote,
            status: "pushed",
            workflowStatus: undefined,
            workflowConclusion: undefined
          }
        }));
        return;
      }

      // gh available → wait for terminal phase (server-side 30 attempts × 10s).
      const final = await bridge.waitGithubPagesDeployment({
        repositoryRoot: repoRoot,
        commitHash,
        workflowName: "Deploy Pages",
        branch: "master"
      });

      applyDeploymentResult(final, commitHash);
    } catch (error) {
      setDraft((current) => ({
        ...current,
        remote: { ...current.remote, status: "deployment_failed", error: desktopErrorMessage(error) }
      }));
    }
  }

  function applyDeploymentResult(result: DeploymentCheckResult, commitHash: string) {
    const phase = result.phase;
    setDraft((current) => ({
      ...current,
      remote: {
        ...current.remote,
        status: phase === "success" ? "deployment_succeeded" : "deployment_failed",
        workflowRunId: result.runId,
        workflowUrl: result.runUrl,
        workflowStatus: result.runStatus,
        workflowConclusion: result.runConclusion,
        error: phase === "success" ? undefined : (result.ghMessage ?? "网站部署未成功。")
      }
    }));

    if (phase === "success") {
      void verifyPublishedArticle(commitHash);
    }
  }

  /** Verify the public article URL is reachable. */
  async function verifyPublishedArticle(commitHash: string) {
    const slug = draft.article.slug;
    const articleUrl = await bridge.getPublicArticleUrl(slug);
    setDraft((current) => ({
      ...current,
      remote: {
        ...current.remote,
        status: "website_verifying",
        publicArticleUrl: articleUrl,
        publicSiteUrl: "https://dafenqirunrunrun.github.io/davinci-journey/"
      }
    }));

    const result = await bridge.verifyPublicArticle({
      url: articleUrl,
      expectedTitle: draft.article.title
    });

    if (result.reachable) {
      setDraft((current) => ({
        ...current,
        remote: { ...current.remote, status: "published" }
      }));
    } else {
      setDraft((current) => ({
        ...current,
        remote: {
          ...current.remote,
          status: "verification_failed",
          error: result.message
        }
      }));
    }
  }

  /** Reset the flow to publish another note. */
  async function resetForNextPublish() {
    const repoRoot = getRepositoryRootForWrite();
    try {
      if (repoRoot) {
        await bridge.resetPublishFlow({ repositoryRoot: repoRoot });
      }
      setDraft(emptyDraft);
      setCommitMessage("");
      setStep(1);
    } catch (error) {
      setDraft((current) => ({
        ...current,
        remote: { ...current.remote, status: "verification_failed", error: desktopErrorMessage(error) }
      }));
    }
  }

  async function doRollback() {
    const txId = draft.repository.transactionId;
    if (!txId) return;
    setDraft((current) => ({ ...current, status: "rolling_back", error: undefined }));
    try {
      await bridge.rollbackRepositoryPublish({
        repositoryRoot: getRepositoryRootForWrite(),
        transactionId: txId
      });
      setDraft((current) => updatePreview({
        ...current,
        status: "workspace_ready",
        repository: {},
        preview: { ...current.preview, workspaceResult: undefined }
      }, profiles));
      await refreshPublishLock(getRepositoryRootForWrite());
    } catch (error) {
      setDraft((current) => ({ ...current, status: "written", error: desktopErrorMessage(error) }));
      await refreshPublishLock(getRepositoryRootForWrite());
    }
  }

  async function cleanupStaleLock() {
    const repositoryRoot = repositoryTarget?.repositoryRoot || repoRoot;
    if (!repositoryRoot || publishLock?.state !== "stale") return;
    try {
      const result = await bridge.cleanupStalePublishLock({
        repositoryRoot,
        transactionId: publishLock.transactionId
      });
      setPublishLock(result);
    } catch (error) {
      setDraft((current) => ({ ...current, error: desktopErrorMessage(error) }));
      await refreshPublishLock(repositoryRoot);
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

      {step === 1 &&
        (batchOpen ? (
          <BatchPublishFlow profiles={profiles} repositoryRoot={repoRoot} existingSlugs={existingSlugs} onClose={() => setBatchOpen(false)} />
        ) : (
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
            publishLock={publishLock}
            onChoose={() => void chooseRepositoryTarget()}
            onRevalidate={() => void revalidateRepositoryTarget()}
            onCleanupStaleLock={() => void cleanupStaleLock()}
          />
          <input ref={inputRef} className="visually-hidden" type="file" accept=".md,.markdown,text/markdown" onChange={(event) => void handleBrowserInput(event.target.files?.[0])} />
          <div className="actions">
            <button className="primary-button" type="button" onClick={() => void selectMarkdown()}>
              选择 Markdown 文件
            </button>
            <button className="secondary-button" type="button" onClick={() => setBatchOpen(true)}>
              批量选择 Markdown
            </button>
          </div>
          {draft.source.markdownFile && <FileSummary file={draft.source.markdownFile} parsedTitle={draft.source.parsedDocument?.title} imageCount={draft.source.parsedDocument?.imageReferences.length ?? 0} />}
          {draft.error && <p className="error-message">{draft.error}</p>}
        </div>
        ))}

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
            {draft.archive.pendingProfileChanges.length > 0 && <p className="warning-text">新建归档方案将在正式发布时写入 config/archive-profiles.yml，之后会自动出现在“全部归档方案”中。</p>}
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
            publishLock={publishLock}
            onChoose={() => void chooseRepositoryTarget()}
            onRevalidate={() => void revalidateRepositoryTarget()}
            onCleanupStaleLock={() => void cleanupStaleLock()}
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
          {draft.preview.leadingTitleRemoved && (
            <p className="info-text" data-testid="leading-title-removed">
              已自动移除正文重复一级标题，页面标题将使用 Front Matter title。
            </p>
          )}
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
              workspaceId={draft.preview.workspaceResult?.workspaceId}
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
              onPush={() => { setStep(7); void startRemotePublish(); }}
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

      {step === 7 && (
        <div className="panel repository-publish-panel">
          <StepHeader title="推送与上线" eyebrow="第 7 步" />

          {draft.remote.status === "checking" && (
            <div className="status-message"><p>正在检查远程仓库状态...</p></div>
          )}

          {draft.remote.status === "ready_to_push" && (
            <PushConfirmationView
              remote={draft.remote}
              onConfirm={() => void confirmPush()}
              onBack={() => setStep(6)}
            />
          )}

          {draft.remote.status === "remote_conflict" && (
            <RemoteConflictView remote={draft.remote} onRecheck={() => void startRemotePublish()} />
          )}

          {(draft.remote.status === "pushing" || draft.remote.status === "verifying_remote" || draft.remote.status === "waiting_for_workflow" || draft.remote.status === "website_verifying") && (
            <DeploymentTimeline remote={draft.remote} />
          )}

          {draft.remote.status === "pushed" && (
            <PushedView remote={draft.remote} onReset={() => void resetForNextPublish()} />
          )}

          {draft.remote.status === "published" && (
            <PublishSuccessView remote={draft.remote} articleTitle={draft.article.title} onReset={() => void resetForNextPublish()} />
          )}

          {draft.remote.status === "push_failed" && (
            <PublishFailedView
              title="推送失败"
              message="推送失败，文章仍安全保存在本地 Commit 中。"
              detail={draft.remote.error}
              actions={[
                { label: "重新检查", onClick: () => void startRemotePublish() },
                { label: "重新推送", onClick: () => void confirmPush() }
              ]}
              onBack={() => setStep(6)}
            />
          )}

          {draft.remote.status === "deployment_failed" && (
            <PublishFailedView
              title="部署失败"
              message="GitHub 推送成功，但网站部署失败。"
              detail={draft.remote.error}
              actions={[
                { label: "重新检查部署状态", onClick: () => void startRemotePublish() },
                { label: "打开 GitHub Actions", onClick: () => window.open("https://github.com/dafenqirunrunrun/davinci-journey/actions", "_blank") }
              ]}
              onBack={() => setStep(6)}
            />
          )}

          {draft.remote.status === "verification_failed" && (
            <PublishFailedView
              title="网站验证失败"
              message="GitHub Pages 部署已成功，但暂未确认文章页面可访问。"
              detail={draft.remote.error}
              actions={[
                { label: "重新检查网页", onClick: () => void verifyPublishedArticle(draft.remote.localCommitHash) },
                { label: "打开网站首页", onClick: () => window.open(draft.remote.publicSiteUrl || "https://dafenqirunrunrun.github.io/davinci-journey/", "_blank") }
              ]}
              onBack={() => setStep(6)}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

export function PreCheckResult({ preCheck, repoRootInfo, workspaceId, plannedChanges, pendingProfiles, onConfirm, onBack, onDiscard }: {
  preCheck: PrePublishCheckResult;
  repoRootInfo?: RepositoryRootResult;
  workspaceId?: string;
  plannedChanges: { type: string; path: string }[];
  pendingProfiles: ArchiveProfileChange[];
  onConfirm: () => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const eligibility = getPublishWriteEligibility({ preCheck, repositoryRootInfo: repoRootInfo, workspaceId });

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
          <span>无关已暂存文件：{preCheck.gitStatus.unrelatedStagedCount}</span>
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
        <button className="primary-button" type="button" disabled={!eligibility.allowed} onClick={onConfirm}>
          确认写入正式仓库
        </button>
      </div>
      {!eligibility.allowed && (
        <div className="eligibility-reasons" role="status" aria-live="polite">
          <p className="muted-text">暂时无法写入：</p>
          <ul>
            {eligibility.reasons.map((reason) => (
              <li key={reason}>{publishWriteBlockReasonText[reason]}</li>
            ))}
          </ul>
        </div>
      )}
      {import.meta.env.DEV && (
        <details className="eligibility-diagnostics">
          <summary>写入资格诊断</summary>
          <pre>{JSON.stringify({ allowed: eligibility.allowed, ...eligibility.diagnostics, blockingReasons: eligibility.reasons }, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function RepositoryTargetPanel({ target, publishLock, onChoose, onRevalidate, onCleanupStaleLock }: {
  target?: RepositoryRootResult;
  publishLock?: PublishLockStatus;
  onChoose: () => void;
  onRevalidate: () => void;
  onCleanupStaleLock: () => void;
}) {
  const valid = Boolean(target?.valid);
  const hasLockWarning = Boolean(publishLock && publishLock.state !== "missing");
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
      {hasLockWarning && (
        <div className="validation-list" role="status" aria-live="polite">
          {publishLock?.state === "stale" && (
            <>
              <span className="warning-text">检测到上次异常结束留下的发布锁。</span>
              {publishLock.transactionId && <code>{publishLock.transactionId}</code>}
              <div className="actions compact-actions">
                <button className="secondary-button" type="button" onClick={onCleanupStaleLock}>
                  清理失效锁
                </button>
                <button className="secondary-button" type="button" onClick={onRevalidate}>
                  重新检查
                </button>
              </div>
            </>
          )}
          {publishLock?.state === "active" && (
            <span className="warning-text">另一个发布流程正在进行中，请等待完成后重新检查。</span>
          )}
          {publishLock?.state === "invalid" && (
            <span className="error-message">发布锁文件损坏，请检查后再继续。</span>
          )}
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

function CommitResultView({ result, onPush }: {
  result: import("../desktopBridge").CommitTransactionResult;
  onPush: () => void;
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
      <div className="actions">
        <button className="primary-button" type="button" onClick={onPush}>
          推送到 GitHub
        </button>
      </div>
    </div>
  );
}

function PushConfirmationView({ remote, onConfirm, onBack }: {
  remote: RemotePublishState;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="push-confirmation">
      <h3>准备推送到 GitHub</h3>

      <section className="write-section">
        <h4>远程仓库</h4>
        <p>{remote.remoteOwner}/{remote.remoteRepo}</p>
        <code>{remote.remoteUrl}</code>
      </section>

      <section className="write-section">
        <h4>分支</h4>
        <p><code>{remote.branch}</code></p>
      </section>

      <section className="write-section">
        <h4>本地 Commit</h4>
        <p><code>{remote.localCommitHash.slice(0, 7)}</code></p>
      </section>

      <section className="write-section">
        <h4>领先远程</h4>
        <p>{remote.ahead} 个 Commit{remote.behind ? ` · 落后 ${remote.behind} 个` : ""}</p>
      </section>

      {remote.untrackedFiles != null && remote.untrackedFiles > 0 && (
        <p className="muted-text">
          未跟踪文件：{remote.untrackedFiles} 个，这些文件不在任何 Commit 中，不会被推送。
        </p>
      )}

      <div className="actions">
        <button className="secondary-button" type="button" onClick={onBack}>返回检查</button>
        <button className="primary-button" type="button" onClick={onConfirm}>
          确认推送到 GitHub
        </button>
      </div>
    </div>
  );
}

function RemoteConflictView({ remote, onRecheck }: {
  remote: RemotePublishState;
  onRecheck: () => void;
}) {
  return (
    <div className="failure-state">
      <h3>远程状态冲突</h3>
      <p className="warning-text">{remote.inspectMessage || "远程与本地不一致，无法推送。"}</p>
      <div className="actions">
        <button className="primary-button" type="button" onClick={onRecheck}>
          重新检查
        </button>
      </div>
    </div>
  );
}

function DeploymentTimeline({ remote }: { remote: RemotePublishState }) {
  const committed = true;
  const pushed = ["verifying_remote", "waiting_for_workflow", "website_verifying"].includes(remote.status);
  const deploying = remote.status === "waiting_for_workflow";
  const verifying = remote.status === "website_verifying";

  return (
    <div className="deployment-timeline">
      <h3>正在发布</h3>
      <ol className="timeline">
        <li className={committed ? "done" : ""}><span>✓</span> 本地 Commit</li>
        <li className={pushed ? "done" : ""}><span>{pushed ? "✓" : "○"}</span> 推送 GitHub</li>
        <li className={deploying ? "active" : ""}><span>{deploying ? "●" : verifying ? "✓" : "○"}</span> GitHub Pages 构建中</li>
        <li className={verifying ? "active" : ""}><span>{verifying ? "●" : "○"}</span> 验证公开文章</li>
      </ol>
      <p className="muted-text">请稍候，部署可能需要几分钟。</p>
    </div>
  );
}

function PushedView({ remote, onReset }: {
  remote: RemotePublishState;
  onReset: () => void;
}) {
  return (
    <div className="push-result">
      <p className="eyebrow">已成功推送到 GitHub</p>
      <p className="muted-text">
        当前无法自动确认 GitHub Pages 部署状态，请稍后查看 GitHub Actions 或打开公开网站。
      </p>
      <div className="actions">
        <button className="secondary-button" type="button" onClick={() => window.open("https://github.com/dafenqirunrunrun/davinci-journey/actions", "_blank")}>
          打开 GitHub Actions
        </button>
        <button className="secondary-button" type="button" onClick={() => window.open("https://dafenqirunrunrun.github.io/davinci-journey/", "_blank")}>
          打开公开网站
        </button>
        <button className="primary-button" type="button" onClick={() => void onReset()}>
          发布下一篇
        </button>
      </div>
    </div>
  );
}

function PublishSuccessView({ remote, articleTitle, onReset }: {
  remote: RemotePublishState;
  articleTitle: string;
  onReset: () => void;
}) {
  return (
    <div className="publish-success">
      <p className="eyebrow">公开发布成功</p>

      <section className="write-section">
        <h4>文章</h4>
        <p>{articleTitle || "已发布文章"}</p>
      </section>

      <section className="write-section">
        <h4>本地 Commit</h4>
        <p><code>{remote.localCommitHash.slice(0, 7)}</code></p>
      </section>

      <section className="write-section">
        <h4>远程仓库</h4>
        <p>{remote.remoteOwner}/{remote.remoteRepo}</p>
      </section>

      <section className="write-section">
        <h4>GitHub Pages</h4>
        <p>部署成功</p>
      </section>

      {remote.publicArticleUrl && (
        <section className="write-section">
          <h4>公开文章</h4>
          <a href={remote.publicArticleUrl} target="_blank" rel="noreferrer">{remote.publicArticleUrl}</a>
        </section>
      )}

      <div className="actions">
        {remote.publicArticleUrl && (
          <button className="secondary-button" type="button" onClick={() => window.open(remote.publicArticleUrl, "_blank")}>
            打开公开文章
          </button>
        )}
        <button className="secondary-button" type="button" onClick={() => window.open("https://dafenqirunrunrun.github.io/davinci-journey/", "_blank")}>
          打开网站首页
        </button>
        <button className="secondary-button" type="button" onClick={() => window.open(`https://github.com/dafenqirunrunrun/davinci-journey/commit/${remote.localCommitHash}`, "_blank")}>
          打开 GitHub Commit
        </button>
        <button className="primary-button" type="button" onClick={onReset}>
          发布下一篇
        </button>
      </div>
    </div>
  );
}

function PublishFailedView({ title, message, detail, actions, onBack }: {
  title: string;
  message: string;
  detail?: string;
  actions: { label: string; onClick: () => void }[];
  onBack: () => void;
}) {
  return (
    <div className="failure-state">
      <h3>{title}</h3>
      <p className="error-message">{message}</p>
      {detail && <p className="muted-text">{detail}</p>}
      <div className="actions">
        {actions.map((action) => (
          <button className="primary-button" type="button" key={action.label} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
        <button className="secondary-button" type="button" onClick={onBack}>
          返回
        </button>
      </div>
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
