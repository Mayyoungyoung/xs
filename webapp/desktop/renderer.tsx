import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
import { desktopBridge } from "../lib/desktop-bridge";

async function start() {
  const bridge = desktopBridge();
  if (!bridge) throw new Error("软件初始化失败，请重新打开墨脉。");
  const settings = await bridge.readSettings();
  if (settings.apiKey) sessionStorage.setItem("momai-session-key", JSON.stringify({ provider: settings.provider, key: settings.apiKey }));
  if (settings.searchKey) sessionStorage.setItem("momai-search-key", JSON.stringify({ provider: "zhipu", key: settings.searchKey }));
  localStorage.setItem("momai-model-choice", JSON.stringify({ provider: settings.provider, model: settings.model, ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}) }));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("/api/")) return originalFetch(input, init);
    const id = crypto.randomUUID();
    const signal = init?.signal;
    signal?.throwIfAborted();
    const cancel = () => bridge.cancelApi(id);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const headers = new Headers(init?.headers);
      const response = await bridge.callApi({
        id, path: url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined,
        key: headers.get("X-Momai-API-Key") ?? undefined,
        // The search credential is forwarded separately so it never merges with the writing key.
        searchKey: headers.get("X-Momai-Search-Key") ?? undefined,
        searchProvider: headers.get("X-Momai-Search-Provider") ?? undefined,
      });
      signal?.throwIfAborted();
      return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
    } finally { signal?.removeEventListener("abort", cancel); }
  };
  createRoot(document.getElementById("root")!).render(<Home />);
}
void start().catch((reason) => { const target = document.getElementById("root"); if (target) { target.textContent = reason instanceof Error ? reason.message : "软件启动失败，请重新打开。"; } });
