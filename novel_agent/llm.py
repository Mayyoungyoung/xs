from __future__ import annotations

import json
import os
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
        payload = {
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
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LLM HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc
        return data["choices"][0]["message"]["content"].strip()

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
            "请在闸口输入 approve 确认，或输入 revision: 修改意见 触发重写。"
        )
