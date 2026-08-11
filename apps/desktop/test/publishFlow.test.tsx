import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishFlow } from "../src/components/PublishFlow";

function markdownFile(content = "# LangGraph Checkpoint\n\n![图](./images/a.png)\n\nLangGraph checkpoint") {
  return new File([content], "checkpoint.md", { type: "text/markdown", lastModified: Date.UTC(2026, 6, 30) });
}

async function selectMarkdown(content?: string) {
  render(<PublishFlow />);
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [markdownFile(content)] } });
  await waitFor(() => expect(screen.getByText("检查图片")).toBeInTheDocument());
}

afterEach(() => {
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.doUnmock("@tauri-apps/api/core");
});

describe("PublishFlow", () => {
  it("选择真实 Markdown 后生成草稿", async () => {
    await selectMarkdown();
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText(/原始引用：\.\/images\/a\.png/)).toBeInTheDocument();
  });

  it("返回上一步数据不丢失", async () => {
    await selectMarkdown();
    fireEvent.click(screen.getByText("上一步"));
    expect(screen.getByText("checkpoint.md")).toBeInTheDocument();
    expect(screen.getByText("检测图片：1")).toBeInTheDocument();
  });

  it("图片缺失显示工作区生成前的阻断提示", async () => {
    await selectMarkdown();
    expect(screen.getByText(/生成正式工作区前必须处理/)).toBeInTheDocument();
  });

  it("修改标题不影响归档选择", async () => {
    await selectMarkdown();
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "自定义标题" } });
    fireEvent.click(screen.getByText("下一步"));
    expect(screen.getAllByText("AI Agent / LangGraph").length).toBeGreaterThan(0);
  });

  it("修改归档不影响图片结果", async () => {
    await selectMarkdown();
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("RAG / Retrieval"));
    fireEvent.click(screen.getByText("下一步"));
    expect(screen.getByText("图片总数：1")).toBeInTheDocument();
    expect(screen.getByText("缺失：1")).toBeInTheDocument();
  });

  it("新建归档方案只进入待提交变更并自动选中", async () => {
    await selectMarkdown();
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("+ 新建归档方案"));
    fireEvent.change(screen.getByLabelText("专题"), { target: { value: "Durable Execution" } });
    fireEvent.click(screen.getByText("创建并选中"));
    expect(screen.getByTestId("markdown-path")).toHaveTextContent("content/ai-agent/durable-execution/langgraph-checkpoint.md");
    expect(screen.getByText(/正式发布时写入 config\/archive-profiles.yml/)).toBeInTheDocument();
  });

  it("最终路径预览正确且不显示发布成功", async () => {
    await selectMarkdown();
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    expect(screen.getByText("生成发布工作区")).toBeInTheDocument();
    expect(screen.queryByText("发布成功")).not.toBeInTheDocument();
    expect(screen.getByText("content/ai-agent/langgraph/langgraph-checkpoint.md")).toBeInTheDocument();
  });

  it("恢复已保存目标仓库并与源 Markdown 分开显示", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const target = {
      repositoryRoot: "D:/target-site",
      displayPath: "D:/target-site",
      branch: "main",
      head: "1234567890abcdef",
      valid: true,
      errors: []
    };
    const invoke = vi.fn(async (command: string) => {
      if (command === "load_repository_target_settings") return target;
      if (command === "select_markdown_file") {
        return {
          absolutePath: "D:/external-notes/checkpoint.md",
          fileName: "checkpoint.md",
          directoryPath: "D:/external-notes",
          size: 32,
          modifiedAt: "2026-07-30T00:00:00Z",
          content: "# LangGraph Checkpoint",
          sourceFingerprint: "a".repeat(64)
        };
      }
      if (command === "resolve_image_dependencies") return [];
      return undefined;
    });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));

    render(<PublishFlow />);
    await waitFor(() => expect(screen.getByTestId("repository-root")).toHaveTextContent("D:/target-site"));
    fireEvent.click(screen.getByText("选择 Markdown 文件"));
    await waitFor(() => expect(screen.getByText("检查图片")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));

    expect(screen.getByText("D:/external-notes/checkpoint.md")).toBeInTheDocument();
    expect(screen.getByTestId("repository-root")).toHaveTextContent("D:/target-site");
    expect(invoke).not.toHaveBeenCalledWith("resolve_repository_root_command", expect.anything());
  });

  it("目标仓库无效时禁用工作区生成", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const invoke = vi.fn(async (command: string) => {
      if (command === "load_repository_target_settings") {
        return {
          repositoryRoot: "D:/not-site",
          displayPath: "D:/not-site",
          head: "",
          valid: false,
          message: "目标网站仓库结构不完整",
          errors: ["目标仓库缺少 content/ 目录。"]
        };
      }
      if (command === "select_markdown_file") {
        return {
          absolutePath: "D:/external-notes/checkpoint.md",
          fileName: "checkpoint.md",
          directoryPath: "D:/external-notes",
          size: 32,
          modifiedAt: "2026-07-30T00:00:00Z",
          content: "# LangGraph Checkpoint",
          sourceFingerprint: "a".repeat(64)
        };
      }
      if (command === "resolve_image_dependencies") return [];
      return undefined;
    });
    vi.doMock("@tauri-apps/api/core", () => ({ invoke }));

    render(<PublishFlow />);
    await waitFor(() => expect(screen.getByTestId("repository-root")).toHaveTextContent("D:/not-site"));
    fireEvent.click(screen.getByText("选择 Markdown 文件"));
    await waitFor(() => expect(screen.getByText("检查图片")).toBeInTheDocument());
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));

    expect(screen.getByText("生成发布工作区")).toBeDisabled();
  });
});
