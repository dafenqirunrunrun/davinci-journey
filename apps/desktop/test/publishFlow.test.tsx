import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  it("图片缺失阻止最终发布提示", async () => {
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

  it("新建归档方案只进入待提交变更", async () => {
    await selectMarkdown();
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("下一步"));
    fireEvent.click(screen.getByText("+ 新建归档方案"));
    fireEvent.change(screen.getByLabelText("专题"), { target: { value: "Durable Execution" } });
    fireEvent.click(screen.getByText("创建并选中"));
    expect(screen.getByTestId("markdown-path")).toHaveTextContent("content/ai-agent/durable-execution/langgraph-checkpoint.md");
    expect(screen.getByText(/不会直接写入 archive-profiles.yml/)).toBeInTheDocument();
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
});
