import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
const candidates = [process.env.ISCC_PATH, "desktop-runtime/inno/ISCC.exe", process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs/Inno Setup 6/ISCC.exe"), "C:/Program Files (x86)/Inno Setup 6/ISCC.exe", "C:/Program Files/Inno Setup 7/ISCC.exe"].filter(Boolean);
let compiler;
for (const filename of candidates) if (await access(filename).then(() => true, () => false)) { compiler = path.resolve(filename); break; }
if (!compiler) throw new Error("未找到 Inno Setup 编译器。请安装 Inno Setup 6/7，或将 ISCC_PATH 设置为 ISCC.exe 的完整路径。");
const version = JSON.parse(await readFile("desktop-stage/package.json", "utf8")).version;
const result = spawnSync(compiler, [`/DAppVersion=${version}`, path.resolve("desktop/installer.iss")], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  const name = `Momai-Setup-${version}-x64.exe`;
  const hash = createHash("sha256").update(await readFile(`../desktop-release/${name}`)).digest("hex");
  await writeFile(`../desktop-release/${name}.sha256`, `${hash}  ${name}\n`);
  await writeFile("../desktop-release/安装与分享说明.txt", `墨脉小说创作 ${version}\n\n直接发送 ${name} 给对方即可安装，无需附带源代码或其他文件夹。\n\n1. 双击安装包，在“选择安装位置”选择 C、D 或其他盘的可写文件夹。\n2. 安装后通过桌面“墨脉小说创作”图标打开。\n3. 模型设置中填写自己的 DeepSeek API Key。\n4. 需要更换小说存储位置时，点击“模型设置 → 更改位置并迁移”，选择空文件夹。\n\n安装包不包含制作者的小说与密钥。卸载不会删除独立资料目录。\n当前安装包未签名，请从可信来源获取。\n\nSHA-256：${hash}\n`, "utf8");
  process.stdout.write(`可分享的安装包：${path.resolve(`../desktop-release/${name}`)}\n`);
}
