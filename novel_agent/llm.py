from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class ModelRoute:
    provider: str = "deepseek"
    model: str = "deepseek-v4-flash"
    base_url: str = "https://api.deepseek.com/chat/completions"
    temperature: float = 0.7
    max_tokens: int = 4096


class LLMClient:
    def __init__(self, route: ModelRoute | None = None, api_key: str | None = None, mock: bool | None = None):
        self.route = route or ModelRoute()
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY", "")
        self.mock = mock if mock is not None else not bool(self.api_key)

    def complete(self, system: str, user: str, temperature: float | None = None) -> str:
        if self.mock:
            return self._mock_complete(system, user)
        if not self.api_key:
            raise RuntimeError("未配置 DEEPSEEK_API_KEY；可使用 --mock 测试流程。")
        payload = {
            "thinking": {"type": "disabled"},
            "model": self.route.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.route.temperature if temperature is None else temperature,
            "max_tokens": self.route.max_tokens,
        }
        request = urllib.request.Request(
            self.route.base_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            errors = {401: "密钥无效", 402: "账户余额不足", 429: "请求频率过高"}
            raise RuntimeError(f"模型服务错误 {exc.code}：{errors.get(exc.code, '请稍后重试')}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise RuntimeError("模型请求超时，请缩短要求后重试") from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise RuntimeError("模型返回了无效响应") from exc
        try:
            choice = data["choices"][0]
            content = choice["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("empty content")
            if choice.get("finish_reason") == "length":
                raise RuntimeError("生成达到长度上限，请按更小的段落重试，未保存截断稿件")
            return content.strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RuntimeError("模型未返回有效正文") from exc

    def _mock_complete(self, system: str, user: str) -> str:
        role = "Agent"
        if "总策划" in system:
            role = "Architect"
        elif "主笔" in system:
            role = "Writer"
        elif "逻辑判官" in system:
            role = "Continuity Editor"
        elif "润色剪辑" in system:
            role = "Stylist"
        return (
            f"[MOCK:{role}]\n\n"
            "当前未检测到 DEEPSEEK_API_KEY，因此生成的是占位内容，用于验证 CLI 流程、沙盒隔离与闸口机制。\n\n"
            "## 产物草案\n"
            f"- 任务摘要：{user[:180].replace(chr(10), ' ')}\n"
            "- 核心冲突：主角目标与外部阻力发生正面碰撞。\n"
            "- 人物推进：主角获得一个新线索，同时暴露一个弱点。\n"
            "- 章尾钩子：一个已确认事实出现反常回声，提示更深层阴谋。\n\n"
            "## 下一步\n"
            "请在闸口输入 approve 确认，或 reject 记录修改意见，再用 revise 命令重写。"
        )
