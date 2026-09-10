import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({ root: path.resolve("desktop"), base: "./", plugins: [react()], resolve: { alias: { "@": path.resolve(".") } }, publicDir: false, build: { outDir: "../desktop-stage/renderer", emptyOutDir: true }, css: { postcss: path.resolve(".") } });
