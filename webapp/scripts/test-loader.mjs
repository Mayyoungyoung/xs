import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return next("next/server.js", context);
    const candidate = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : specifier.startsWith(".") && context.parentURL ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
    if (candidate) {
      for (const suffix of ["", ".ts", ".tsx"]) if (existsSync(candidate + suffix) && /\.tsx?$/.test(candidate + suffix)) return { url: pathToFileURL(candidate + suffix).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && /\.tsx?$/.test(url) && !url.includes("/node_modules/")) {
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      return { source, format: "module", shortCircuit: true };
    }
    return next(url, context);
  },
});
