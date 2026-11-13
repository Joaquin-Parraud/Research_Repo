import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // The pdf.js worker is an ES module. nginx's stock mime.types does not know ".mjs"
        // (it would serve application/octet-stream and the browser refuses to run it), so
        // the emitted worker asset gets a ".js" extension, which every server maps correctly.
        assetFileNames: (asset) => {
          const name = asset.names?.[0] ?? asset.name ?? "";
          return name.endsWith(".mjs") ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Real styles for the stylesheets whose layout tests assert computed styles.
    css: { include: [/SourceList\.module\.css$/] },
  },
});
