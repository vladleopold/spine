import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    assetsDir: "static",
    target: "es2022",
    sourcemap: true,
    minify: "esbuild",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) return "vendor";
            if (id.includes("@esotericsoftware/spine-player")) return "spine";
            if (id.includes("ethers") || id.includes("jszip") || id.includes("lucide-react")) return "utils";
          }
        },
      },
    },
    esbuild: {
      drop: ["console", "debugger"],
      pure: ["console.log", "console.debug", "console.info"],
    },
  },
});
