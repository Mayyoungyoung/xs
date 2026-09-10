import { packager } from "@electron/packager";
import { readFile, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const electronVersion = JSON.parse(await readFile("node_modules/electron/package.json", "utf8")).version;
const zipName = `electron-v${electronVersion}-win32-x64.zip`;
const cached = await access(`desktop-runtime/${zipName}`).then(() => true, () => false);
if (cached) {
  const checksums = JSON.parse(await readFile("node_modules/electron/checksums.json", "utf8"));
  const hash = createHash("sha256"); for await (const chunk of createReadStream(`desktop-runtime/${zipName}`)) hash.update(chunk);
  if (hash.digest("hex") !== checksums[zipName]) throw new Error("桌面运行组件校验失败，停止打包。");
}
let output;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    output = await packager({ dir: "desktop-stage", out: "../desktop-release", name: "Momai", electronVersion, ...(cached ? { electronZipDir: "desktop-runtime" } : {}), platform: "win32", arch: "x64", tmpdir: false, icon: "desktop/assets/momai.ico", asar: true, prune: false, overwrite: true, appCopyright: "墨脉", win32metadata: { CompanyName: "Momai", FileDescription: "墨脉小说创作软件", ProductName: "墨脉" } });
    break;
  } catch (error) {
    if (attempt === 2 || error.code !== "EPERM") throw error;
    process.stdout.write("Windows 正在检查新解压的运行组件，稍后重试打包。\n");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
process.stdout.write(output.join("\n") + "\n");
