"use client";
import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { validApiKey, type ModelChoice } from "@/lib/model-credentials";
import { CUSTOM_PROVIDER_ID, PROVIDERS, defaultModelOf, normalizeBaseUrl, providerById, validModelName } from "@/lib/model-providers";
import { desktopBridge } from "@/lib/desktop-bridge";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  choice: ModelChoice;
  onChoiceChange: (choice: ModelChoice) => void;
  hasSessionKey: boolean;
  connection: string;
  onSaveKey: (key: string, choice: ModelChoice) => void | Promise<void>;
  onTest: (key: string | undefined, choice: ModelChoice) => Promise<void>;
  bookTitle?: string;
  onRename?: () => void;
};

const CUSTOM_MODEL_VALUE = "__custom_model__";

function sanitizeDraft(value: ModelChoice): ModelChoice {
  const provider = providerById(value.provider) ? value.provider : PROVIDERS[0].id;
  const listed = providerById(provider)?.models.some((model) => model.id === value.model);
  const model = listed || validModelName(value.model) ? value.model : defaultModelOf(provider);
  const baseUrl = provider === CUSTOM_PROVIDER_ID ? normalizeBaseUrl(value.baseUrl ?? "") ?? "" : "";
  return { provider, model, ...(baseUrl ? { baseUrl } : {}) };
}
function modelListedFor(value: ModelChoice): boolean {
  return Boolean(providerById(value.provider)?.models.some((model) => model.id === value.model));
}

export function ModelSettings({ open, onOpenChange, choice, onChoiceChange, hasSessionKey, connection, onSaveKey, onTest, bookTitle, onRename }: Props) {
  const [draftChoice, setDraftChoice] = useState<ModelChoice>(choice);
  const [customModel, setCustomModel] = useState("");
  const [customSelected, setCustomSelected] = useState(false);
  const [customBase, setCustomBase] = useState("");
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [dataPath, setDataPath] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const desktop = desktopBridge();
  const spec = providerById(draftChoice.provider) ?? PROVIDERS[0];

  // Draft state resets while the dialog transitions from closed to open.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const next = sanitizeDraft(choice);
      setDraftChoice(next);
      setCustomSelected(!modelListedFor(next));
      setCustomModel(modelListedFor(next) ? "" : next.model);
      setCustomBase(next.baseUrl ?? "");
      setDraft(""); setVisible(false); setMessage("");
    }
  }
  useEffect(() => { if (open && desktop) void desktop.info().then((info) => setDataPath(info.dataPath)).catch(() => setMessage("无法读取数据目录")); }, [open, desktop]);

  async function run(action: () => Promise<void>) { setTesting(true); setMessage(""); try { await action(); } finally { setTesting(false); } }

  function currentDraftChoice(): ModelChoice | null {
    let model = draftChoice.model;
    if (customSelected) {
      model = customModel.trim();
      if (!validModelName(model)) { setMessage("请填写有效的自定义模型名称（字母、数字、- _ . : / ）。"); return null; }
    }
    if (spec.id === CUSTOM_PROVIDER_ID) {
      const base = normalizeBaseUrl(customBase);
      if (!base) { setMessage("接口地址无效：需填写 https 地址（填到 /v1 为止），本机服务可用 http://127.0.0.1:端口/v1。"); return null; }
      return { provider: spec.id, model, baseUrl: base };
    }
    return { provider: spec.id, model };
  }

  async function save() {
    const key = draft.trim();
    if (!validApiKey(key)) { setMessage("请输入有效的 API Key，不要包含空格或中文。"); return; }
    const next = currentDraftChoice();
    if (!next) return;
    await run(async () => {
      try {
        await onTest(key, next);
        await onSaveKey(key, next);
        onChoiceChange(next);
        setDraft(""); setVisible(false);
        setMessage(`验证成功，${spec.label} 密钥已保存并启用。`);
      } catch (reason) {
        setMessage(`验证未通过，密钥未保存：${reason instanceof Error ? reason.message : "请检查密钥、模型与网络后重试。"}`);
        throw reason;
      }
    }).catch(() => undefined);
  }

  async function clear() {
    await run(async () => {
      try { await onSaveKey("", draftChoice); setMessage("保存的密钥已清除。"); }
      catch { setMessage("清除失败，请检查存储权限。"); }
    });
  }

  async function test() {
    const key = draft.trim();
    if (key && !validApiKey(key)) { setMessage("请输入有效的 API Key 后再测试。"); return; }
    const next = currentDraftChoice();
    if (!next) return;
    await run(async () => {
      try { await onTest(key || undefined, next); setMessage(key ? "连接成功。点击保存密钥后用于创作。" : "连接成功，可以开始创作。"); }
      catch (reason) { setMessage(reason instanceof Error ? reason.message : "连接失败，请检查密钥或稍候重试。"); }
    });
  }

  async function changeStorage() {
    if (!desktop) return;
    setTesting(true); setMigrating(true); setMessage("");
    try {
      const result = await desktop.changeDataFolder();
      if (result) { setDataPath(result.dataPath); setMessage(`资料已迁移，后续自动保存到新位置。原目录暂时保留，可核对后自行清理：${result.previousPath}`); }
    } catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "迁移失败，仍使用原目录。"); }
    finally { setTesting(false); setMigrating(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!testing) { setDraft(""); setVisible(false); setMessage(""); onOpenChange(next); } }}><DialogContent className="workspace-dialog model-settings-dialog sm:max-w-[620px]"><DialogHeader><DialogTitle><KeyRound />模型与连接设置</DialogTitle><DialogDescription>选择模型供应商并填写对应 API Key，所有小说共用此连接设置。</DialogDescription></DialogHeader>
    <div className="connection-status"><ShieldCheck /><div><strong>{hasSessionKey ? desktop ? "使用本机加密保存的密钥" : "使用本页保存的密钥" : desktop ? "尚未保存创作密钥" : "使用服务端配置（如有）"}</strong><span>{connection}</span></div></div>
    <label className="form-field"><span>模型供应商</span><NativeSelect aria-label="模型供应商" value={draftChoice.provider} onChange={(event) => { const provider = event.target.value; setDraftChoice({ provider, model: defaultModelOf(provider) }); setCustomSelected(provider === CUSTOM_PROVIDER_ID); setCustomModel(""); }} disabled={testing}>
      {PROVIDERS.map((provider) => <NativeSelectOption key={provider.id} value={provider.id}>{provider.label}</NativeSelectOption>)}
    </NativeSelect></label>
    <label className="form-field"><span>{spec.keyLabel}</span><div className="secret-input"><input type={visible ? "text" : "password"} aria-label={spec.keyLabel} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={hasSessionKey ? "已保存，输入新密钥可替换" : `粘贴你的 API Key（${spec.keyHint}）`} autoComplete="off" spellCheck={false} maxLength={256} /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "隐藏密钥" : "显示密钥"}>{visible ? <EyeOff /> : <Eye />}</button></div></label>
    <label className="form-field"><span>创作模型</span><NativeSelect aria-label="设置中的模型" value={customSelected ? CUSTOM_MODEL_VALUE : draftChoice.model} onChange={(event) => { const value = event.target.value; if (value === CUSTOM_MODEL_VALUE) { setCustomSelected(true); setCustomModel(""); } else { setCustomSelected(false); setDraftChoice((current) => ({ ...current, model: value })); } }} disabled={testing}>
      {spec.models.map((model) => <NativeSelectOption key={model.id} value={model.id}>{model.label}</NativeSelectOption>)}
      <NativeSelectOption value={CUSTOM_MODEL_VALUE}>自定义模型名…</NativeSelectOption>
    </NativeSelect></label>
    {customSelected && <label className="form-field"><span>自定义模型名称</span><input aria-label="自定义模型名称" value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="填写供应商文档中的模型 ID" autoComplete="off" spellCheck={false} maxLength={120} /></label>}
    {spec.id === CUSTOM_PROVIDER_ID && <label className="form-field"><span>接口地址（OpenAI 兼容，填到 /v1 为止）</span><input aria-label="自定义接口地址" value={customBase} onChange={(event) => setCustomBase(event.target.value)} placeholder="https://api.example.com/v1 或 http://127.0.0.1:11434/v1" autoComplete="off" spellCheck={false} maxLength={300} /></label>}
    <p className="settings-help">{desktop ? "密钥使用 Windows 本机加密保存，重启软件后仍可使用；与小说数据和导出备份分开存放。" : "密钥仅保存在当前标签页会话中，刷新后可继续使用，关闭标签页后清除；不会进入小说数据或导出备份。"}{spec.docsUrl && <> 密钥可在 <a href={spec.docsUrl} target="_blank" rel="noreferrer noopener">服务商控制台</a> 获取。</>}</p>
    {message && <p className="settings-feedback" role="status">{message}</p>}
    <div className="settings-key-actions"><Button disabled={testing || !draft.trim()} onClick={() => void save()}><Check />验证并保存</Button><Button variant="outline" disabled={testing} onClick={() => void test()}>{testing ? <LoaderCircle className="spin" /> : <ShieldCheck />}{testing ? "正在处理…" : "测试连接"}</Button>{hasSessionKey && <Button variant="ghost" disabled={testing} onClick={() => void clear()}><Trash2 />清除密钥</Button>}</div>
    <p className="settings-help">保存前会先用一句测试消息验证密钥可用（消耗少量额度，不发送小说内容），验证失败不会保存。</p>
    {desktop && <div className="settings-storage"><strong>小说存储位置</strong><p>{dataPath || "正在读取数据目录…"}</p><span>可选择 D 盘等位置的空文件夹，所有小说、章节、自动备份与加密密钥会一起迁移。校验成功后立即使用新位置，原目录暂时保留。</span><div className="settings-storage-actions"><Button variant="outline" disabled={testing} onClick={() => void desktop.openDataFolder().catch(() => setMessage("无法打开数据文件夹"))}>打开数据文件夹</Button><Button variant="outline" disabled={testing} onClick={() => void changeStorage()}>{migrating && <LoaderCircle className="spin" />}{migrating ? "正在选择或迁移…" : "更改位置并迁移"}</Button></div><p>仅启动定位配置和界面缓存仍在系统用户目录。网页版小说可通过完整备份导入。</p></div>}
    {bookTitle && <div className="settings-book"><span>当前小说：{bookTitle}</span><Button variant="outline" size="sm" onClick={onRename}>修改书名</Button></div>}
    <div className="dialog-actions"><Button variant="outline" disabled={testing} onClick={() => { setDraft(""); onOpenChange(false); }}>完成</Button></div>
  </DialogContent></Dialog>;
}
