import { defineConfig } from "astro/config";
import remarkGfm from "remark-gfm";

export default defineConfig({
  site: "https://dafenqirunrunrun.github.io",
  base: "/davinci-journey",
  output: "static",
  markdown: {
    remarkPlugins: [remarkGfm]
  }
});
