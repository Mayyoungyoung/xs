"use client";
import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { validApiKey } from "@/lib/model-credentials";
import { desktopBridge } from "@/lib/desktop-bridge";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; model: string; onModelChange: (model: string) => void; hasSessionKey: boolean; connection: string; onSaveKey: (key: string) => void | Promise<void>; onTest: (key?: string) => Promise<void>; bookTitle?: string; onRename?: () => void };
export function ModelSettings({ open, onOpenChange, model, onModelChange, hasSessionKey, connection, onSaveKey, onTest, bookTitle, onRename }: Props) {
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [dataPath, setDataPath] = useState("");
  const [migrating, setMigrating] = useState(false);
  const desktop = desktopBridge();
  useEffect(() => { if (open && desktop) void desktop.info().then((info) => setDataPath(info.dataPath)).catch(() => setMessage("无法读取数据目录")); }, [open, desktop]);
  async function save() {
    const key = draft.trim();
    if (!validApiKey(key)) { setMessage("请输入有效的 API Key，不要包含空格或中文。"); return; }
    setTesting(true);
    try { await onSaveKey(key); setDraft(""); setVisible(false); setMessage("密钥已保存，立即生效。可点击测试连接。"); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "保存失败，请检查存储权限后重试。"); }
    finally { setTesting(false); }
  }
  async function clear() { setTesting(true); try { await onSaveKey(""); setDraft(""); setMessage("保存的密钥已清除。"); } catch { setMessage("清除失败，请检查存储权限。"); } finally { setTesting(false); } }
  async function changeStorage() {
    if (!desktop) return;
    setTesting(true); setMigrating(true); setMessage("");
    try {
      const result = await desktop.changeDataFolder();
      if (result) { setDataPath(result.dataPath); setMessage(`资料已迁移，后续自动保存到新位置。原目录暂时保留，可核对后自行清理：${result.previousPath}`); }
    } catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "迁移失败，仍使用原目录。"); }
    finally { setTesting(false); setMigrating(false); }
  }
  async function test() {
    const key = draft.trim();
    if (key && !validApiKey(key)) { setMessage("请输入有效的 API Key 后再测试。"); return; }
    setTesting(true); setMessage("");
    try { await onTest(key || undefined); setMessage(key ? "连接成功。点击保存密钥后用于创作。" : "连接成功，可以开始创作。"); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "连接失败，请检查密钥或稍后重试。"); }
    finally { setTesting(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!testing) { setDraft(""); setVisible(false); setMessage(""); onOpenChange(next); } }}><DialogContent className="workspace-dialog model-settings-dialog sm:max-w-[580px]"><DialogHeader><DialogTitle><KeyRound />模型与连接设置</DialogTitle><DialogDescription>填写 DeepSeek API Key 后立即使用，所有小说共用此连接设置。</DialogDescription></DialogHeader>
    <div className="connection-status"><ShieldCheck /><div><strong>{hasSessionKey ? desktop ? "使用本机加密保存的密钥" : "使用本页保存的密钥" : desktop ? "尚未保存创作密钥" : "使用服务端配置（如有）"}</strong><span>{connection}</span></div></div>
    <label className="form-field"><span>DeepSeek API Key</span><div className="secret-input"><input type={visible ? "text" : "password"} aria-label="DeepSeek API Key" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={hasSessionKey ? "已保存，输入新密钥可替换" : "粘贴你的 API Key"} autoComplete="off" spellCheck={false} maxLength={256} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "隐藏密钥" : "显示密钥"}>{visible ? <EyeOff /> : <Eye />}</button></div></label>
    <p className="settings-help">{desktop ? "密钥使用 Windows 本机加密保存，重启软件后仍可使用；与小说数据和导出备份分开存放。" : "密钥仅保存在当前标签页会话中，刷新后可继续使用，关闭标签页后清除；不会进入小说数据或导出备份。"}</p>
    <label className="form-field"><span>创作模型</span><NativeSelect aria-label="设置中的模型" value={model} onChange={(event) => onModelChange(event.target.value)}><NativeSelectOption value="deepseek-v4-flash">DeepSeek V4 Flash · 日常创作</NativeSelectOption><NativeSelectOption value="deepseek-v4-pro">DeepSeek V4 Pro · 深度构思</NativeSelectOption></NativeSelect></label>
    {message && <p className="settings-feedback" role="status">{message}</p>}
    <div className="settings-key-actions"><Button disabled={testing || !draft.trim()} onClick={() => void save()}><Check />保存密钥</Button><Button variant="outline" disabled={testing} onClick={() => void test()}>{testing ? <LoaderCircle className="spin" /> : <ShieldCheck />}{testing ? "正在处理…" : "测试连接"}</Button>{hasSessionKey && <Button variant="ghost" disabled={testing} onClick={() => void clear()}><Trash2 />清除密钥</Button>}</div>
    <p className="settings-help">连接测试只发送一句测试消息，会使用少量模型额度，不发送小说内容。</p>
    {desktop && <div className="settings-storage"><strong>小说存储位置</strong><p>{dataPath || "正在读取数据目录…"}</p><span>可选择 D 盘等位置的空文件夹，所有小说、章节、自动备份与加密密钥会一起迁移。校验成功后立即使用新位置，原目录暂时保留。</span><div className="settings-storage-actions"><Button variant="outline" disabled={testing} onClick={() => void desktop.openDataFolder().catch(() => setMessage("无法打开数据文件夹"))}>打开数据文件夹</Button><Button variant="outline" disabled={testing} onClick={() => void changeStorage()}>{migrating && <LoaderCircle className="spin" />}{migrating ? "正在选择或迁移…" : "更改位置并迁移"}</Button></div><p>仅启动定位配置和界面缓存仍在系统用户目录。网页版小说可通过完整备份导入。</p></div>}
    {bookTitle && <div className="settings-book"><span>当前小说：{bookTitle}</span><Button variant="outline" size="sm" onClick={onRename}>修改书名</Button></div>}
    <div className="dialog-actions"><Button variant="outline" disabled={testing} onClick={() => { setDraft(""); onOpenChange(false); }}>完成</Button></div>
  </DialogContent></Dialog>;
}
