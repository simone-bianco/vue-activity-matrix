import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    vue(),
    dts({ entryRoot: "src", include: ["src/**/*.ts", "src/**/*.vue"] }),
  ],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "vue-activity-matrix",
    },
    rollupOptions: { external: ["vue", "@simone-bianco/vue-ui-components"] },
  },
});
