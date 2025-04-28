import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({}),
    viteStaticCopy({
      targets: [
        {
          src: "src/manifest.json",
          dest: ".",
        },
        {
          src: "public",
          dest: ".",
        },
      ],
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        devtools: "./devtools.html",
        popup: "./popup.html",
      },
    },
    outDir: "dist",
    assetsDir: ".",
  },
});
