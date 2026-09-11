export type DesktopModelChoice = { provider: string; model: string; baseUrl?: string };
export type DesktopBridge = {
  readLibrary: () => Promise<unknown>;
  saveLibrary: (library: unknown, revision: number) => Promise<number>;
  readRecovery: () => Promise<unknown>;
  readSettings: () => Promise<{ apiKey: string } & DesktopModelChoice>;
  saveKey: (key: string) => Promise<void>;
  saveModel: (choice: DesktopModelChoice) => Promise<void>;
  info: () => Promise<{ dataPath: string }>;
  openDataFolder: () => Promise<void>;
  changeDataFolder: () => Promise<{ dataPath: string; previousPath: string } | null>;
  callApi: (request: { id: string; path: string; method: string; body?: string; key?: string }) => Promise<{ status: number; body: string }>;
  cancelApi: (id: string) => void;
  ready?: () => Promise<void>;
};
declare global { interface Window { momaiDesktop?: DesktopBridge } }
export function desktopBridge() { return typeof window === "undefined" ? undefined : window.momaiDesktop; }
