from __future__ import annotations

from dataclasses import dataclass

from .llm import LLMClient
from .models import Book
from .storage import BookStore


@dataclass(frozen=True)
class AgentSpec:
    role: str
    system_prompt: str


AGENTS = {
    "architect": AgentSpec(
        role="Architect",
        system_prompt=(
            "你是小说创作系统的总策划。你负责宏观结构、世界观、人物弧光、分卷和章节大纲。"
            "输出必须结构化、可执行，并主动标注连续性约束。"
        ),
    ),
    "writer": AgentSpec(
        role="Writer",
        system_prompt=(
            "你是小说创作系统的主笔。你负责把章节大纲扩写为具体正文。"
            "严格遵守世界观、人物卡、章节约束和文风指导。"
        ),
    ),
    "continuity": AgentSpec(
        role="Continuity Editor",
        system_prompt=(
            "你是小说创作系统的逻辑判官。你专门审查战力崩坏、人物OOC、时间线错误、设定冲突。"
            "输出 blocker、major、minor 分级问题，并给出修改建议。"
        ),
    ),
    "stylist": AgentSpec(
        role="Stylist",
        system_prompt=(
            "你是小说创作系统的润色剪辑。你负责纠错、精简冗余、强化节奏和章尾钩子。"
            "不得改变已确认的剧情事实。"
        ),
    ),
}


class AgentRuntime:
    def __init__(self, store: BookStore, llm: LLMClient):
        self.store = store
        self.llm = llm

    def run_agent(self, book: Book, agent_key: str, task: str, context: str = "") -> str:
        agent = AGENTS[agent_key]
        user = (
            f"书名：{book.title}\n"
            f"类型：{book.genre or '未指定'}\n"
            f"核心设想：{book.premise or '未指定'}\n\n"
            f"上下文：\n{context or '暂无'}\n\n"
            f"任务：\n{task}"
        )
        output = self.llm.complete(agent.system_prompt, user)
        self.store.append_agent_log(book.id, agent.role, output, {"task": task})
        return output

