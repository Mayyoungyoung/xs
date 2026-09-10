import { build } from "esbuild";
import { mkdir, copyFile, writeFile, cp } from "node:fs/promises";
await mkdir("desktop-stage", { recursive: true });
await build({ entryPoints: ["desktop/main.ts"], outfile: "desktop-stage/main.cjs", platform: "node", format: "cjs", target: "node22", bundle: true, external: ["electron"], alias: { "next/server": "./desktop/response-shim.ts" }, logLevel: "info" });
await copyFile("desktop/preload.cjs", "desktop-stage/preload.cjs");
await cp("desktop/assets", "desktop-stage/assets", { recursive: true });
await writeFile("desktop-stage/package.json", JSON.stringify({ name: "momai-novel-desktop", productName: "墨脉", version: "1.1.0", description: "墨脉 AI 小说创作软件", main: "main.cjs", author: "Momai", license: "UNLICENSED" }, null, 2));
