import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The suite is server-side by default (Node environment, fake Prisma). A
 * component test opts into the DOM per file with `// @vitest-environment jsdom`
 * at the top, so the 278 server tests keep running exactly as before.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
