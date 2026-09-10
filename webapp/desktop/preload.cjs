// A sandboxed Electron preload uses its limited CommonJS environment.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("momaiDesktop", {
  readLibrary: () => ipcRenderer.invoke("library:read"),
  saveLibrary: (library, revision) => ipcRenderer.invoke("library:save", library, revision),
  readRecovery: () => ipcRenderer.invoke("library:recovery"),
  readSettings: () => ipcRenderer.invoke("settings:read"),
  saveKey: (key) => ipcRenderer.invoke("settings:key", key),
  saveModel: (model) => ipcRenderer.invoke("settings:model", model),
  info: () => ipcRenderer.invoke("app:info"),
  openDataFolder: () => ipcRenderer.invoke("app:open-data"),
  changeDataFolder: () => ipcRenderer.invoke("app:change-data"),
  callApi: (request) => ipcRenderer.invoke("api:request", request),
  cancelApi: (id) => ipcRenderer.send("api:cancel", id),
  ready: () => ipcRenderer.invoke("app:renderer-ready"),
});
