import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Sources of the buckyos repository that the client shares (README, "Shared sources"): a sibling
// checkout, or .buckyos in CI.
const desktopShared = ["../buckyos", ".buckyos"]
  .map((checkout) => resolve(import.meta.dirname, checkout, "src/frame/desktop/src/shared"))
  .find((folder) => existsSync(folder));
if (!desktopShared) {
  throw new Error("The buckyos repository is required: check it out (branch main) next to this one, or as .buckyos");
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: [{ find: /^@buckyos-desktop\//, replacement: `${desktopShared}/` }],
    // The shared sources import these too; there is one copy, this project's.
    dedupe: ["buckyos"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Only the application entry belongs to this Vite project. Historical
  // checkouts and preview HTML under .tmp must not trigger dependency scans.
  optimizeDeps: {
    entries: ["index.html"],
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    fs: { allow: [searchForWorkspaceRoot(import.meta.dirname), desktopShared, resolve(import.meta.dirname, "../buckyos-websdk")] },
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. Ignore native build output and historical test/checkouts.
      ignored: ["**/src-tauri/**", "**/.tmp/**", "**/auto_test/**"],
    },
  },
}));
