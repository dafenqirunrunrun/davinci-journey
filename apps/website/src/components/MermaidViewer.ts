/**
 * Client-side Mermaid renderer for the note detail page.
 *
 * The unified pipeline emits ` ```mermaid ` fences as
 * `<pre><code class="language-mermaid">…</code></pre>`. This module finds those
 * blocks, replaces each with a dedicated source/output wrapper, renders the
 * diagram with `mermaid.render`, and re-renders whenever the site theme
 * (light/dark) changes so diagrams match the current palette.
 *
 * `securityLevel: "strict"` keeps diagram content inert (no script execution),
 * consistent with the project's "no arbitrary HTML/JS from Markdown" rule.
 */

interface MermaidBlock {
  id: string;
  code: string;
}

let blocks: MermaidBlock[] = [];
let root: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let renderSeq = 0;

function isDarkTheme(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

async function renderAll(): Promise<void> {
  if (!root) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: isDarkTheme() ? "dark" : "default",
    securityLevel: "strict"
  });
  renderSeq += 1;
  for (const block of blocks) {
    const output = root.querySelector<HTMLElement>(`#${block.id}`);
    if (!output) continue;
    try {
      const { svg } = await mermaid.render(`${block.id}-r${renderSeq}`, block.code);
      output.innerHTML = svg;
    } catch {
      output.textContent = "（Mermaid 渲染失败，请检查图表语法）";
    }
  }
}

/** Scan `container` for mermaid code blocks and render them. Idempotent. */
export function initMermaid(container: HTMLElement): void {
  if (root || blocks.length > 0) return;
  root = container;
  container.querySelectorAll<HTMLElement>("pre > code.language-mermaid").forEach((code) => {
    const pre = code.closest("pre");
    if (!pre) return;
    const id = `mmd-${(renderSeq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-block";
    wrapper.innerHTML = '<div class="mermaid-source" hidden></div><div class="mermaid-output"></div>';
    const sourceEl = wrapper.querySelector<HTMLElement>(".mermaid-source");
    const outputEl = wrapper.querySelector<HTMLElement>(".mermaid-output");
    const codeText = code.textContent ?? "";
    if (sourceEl) sourceEl.textContent = codeText;
    if (outputEl) outputEl.id = id;
    blocks.push({ id, code: codeText });
    pre.replaceWith(wrapper);
  });
  if (blocks.length === 0) return;
  observer = new MutationObserver(() => {
    void renderAll();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  void renderAll();
}
