from __future__ import annotations

from .agents import AgentRuntime
from .models import Artifact, Book
from .storage import BookStore


class Workflow:
    def __init__(self, store: BookStore, runtime: AgentRuntime):
        self.store = store
        self.runtime = runtime

    def research(self, book: Book, topic: str) -> Artifact:
        task = (
            "生成一份题材创作调研建议。当前没有联网检索，不得声称实时榜单或真实市场趋势，必须标注推断。包含：候选标签、常见元素、核心爽点、读者避雷点、"
            "差异化切入建议。不要抓取或复刻任何小说正文。\n"
            f"检索主题：{topic}"
        )
        content = self.runtime.run_agent(book, "architect", task)
        return self.store.save_artifact(book.id, "research_report", "风向报告", content)

    def add_reference(self, book: Book, title: str, scope: str, content: str, source: str = "local") -> Artifact:
        """保存用户主动提供的借鉴资料；生成时只将同 scope 的资料加入上下文。"""
        return self.store.save_artifact(
            book.id,
            "reference_material",
            title,
            content,
            metadata={"scope": scope, "source": source},
        )

    def style_guide(self, book: Book, sample: str) -> Artifact:
        references = self._reference_context(book.id, "style")
        task = (
            "根据用户提供的样本文本，提取文风指导方案。只分析句式、节奏、修辞、视角、用词倾向、禁忌，"
            "不要输出可替代原文的长段仿写。参考具体作家或作品时，只提取可描述的高层风格特征。\n\n"
            f"借鉴资料：\n{references or '暂无'}\n\n"
            f"样本文本：\n{sample}"
        )
        content = self.runtime.run_agent(book, "architect", task)
        return self.store.save_artifact(book.id, "style_guide", "Style Prompt", content)

    def world(self, book: Book) -> Artifact:
        context = self._latest_context(book.id, ["research_report", "style_guide"]) + self._reference_context(book.id, "world")
        task = (
            "生成世界观白皮书。必须包含：底层逻辑、能力体系/战力等级、社会背景、主要矛盾、"
            "资源约束、禁忌与代价、可持续连载的冲突引擎。"
        )
        content = self.runtime.run_agent(book, "architect", task, context)
        return self.store.save_artifact(book.id, "world_bible", "世界观白皮书", content)

    def characters(self, book: Book) -> Artifact:
        context = self._latest_context(book.id, ["world_bible", "style_guide"]) + self._reference_context(book.id, "character")
        task = (
            "生成主角和关键配角的深度人物卡。每张卡必须包含：外貌、核心动机、内在恐惧、误信念、"
            "人物弧光、关系、口癖/行为习惯、价值观底线、当前状态。"
        )
        content = self.runtime.run_agent(book, "architect", task, context)
        return self.store.save_artifact(book.id, "character_cards", "深度人物卡", content)

    def outline(self, book: Book) -> Artifact:
        context = self._latest_context(book.id, ["world_bible", "character_cards", "style_guide"]) + self._reference_context(book.id, "plot")
        task = (
            "生成分卷大纲和前 10 章章节大纲。每章必须包含：核心冲突、出场人物、主线推进目的、"
            "支线推进目的、情绪转折、章尾悬念/钩子、连续性约束。"
        )
        content = self.runtime.run_agent(book, "architect", task, context)
        return self.store.save_artifact(book.id, "chapter_outline", "分卷与章节大纲", content)

    def revise(self, book: Book, artifact_id: str, note: str = "") -> Artifact:
        source = next((a for a in self.store.list_artifacts(book.id) if a.id == artifact_id), None)
        if source is None:
            raise ValueError("当前书籍中没有此产物")
        if source.kind in {"reference_material", "chapter_snapshot"}:
            raise ValueError("借鉴资料与剧情快照不能直接重写，请修改原始资料或重新生成章节")
        instruction = note.strip() or source.metadata.get("revision_request", "")
        if not instruction:
            raise ValueError("请使用 --note 提供修改要求，或先在闸口记录意见")
        role = "writer" if source.kind == "chapter_draft" else "continuity" if source.kind == "continuity_review" else "architect"
        content = self.runtime.run_agent(book, role, f"根据修改要求重写当前产物，只输出新版本。\n修改要求：{instruction}\n原版本：\n{source.content}", self._latest_context(book.id, ["world_bible", "character_cards", "chapter_outline", "style_guide"]))
        return self.store.save_artifact(book.id, source.kind, source.title + "（修订）", content, metadata={**source.metadata, "revised_from": source.id, "revision_request": instruction})

    def draft_chapter(self, book: Book, chapter_no: int) -> list[Artifact]:
        if chapter_no < 1:
            raise ValueError("章节编号必须大于 0")
        required = [kind for kind in ["world_bible", "character_cards", "chapter_outline"] if not self.store.latest_artifact(book.id, kind)]
        if required:
            raise ValueError("请先生成并 approve 确认世界观、人物与章节大纲。尚缺：" + ", ".join(required))
        context = self._chapter_context(book.id, chapter_no)
        draft_task = (
            f"根据上下文写第 {chapter_no} 章正文初稿。要求有对话、环境描写、心理活动和章尾钩子，"
            "不得突破连续性约束。"
        )
        draft = self.runtime.run_agent(book, "writer", draft_task, context)
        draft_artifact = self.store.save_artifact(
            book.id,
            "chapter_draft",
            f"第 {chapter_no} 章初稿",
            draft,
            metadata={"chapter_no": chapter_no, "stage": "draft"},
        )

        review_task = f"审查第 {chapter_no} 章初稿，输出 blocker、major、minor 问题和修改建议。\n\n初稿：\n{draft}"
        review = self.runtime.run_agent(book, "continuity", review_task, context)
        review_artifact = self.store.save_artifact(
            book.id,
            "continuity_review",
            f"第 {chapter_no} 章逻辑审查",
            review,
            metadata={"chapter_no": chapter_no},
        )

        polish_task = f"在不改变剧情事实的前提下润色第 {chapter_no} 章。\n\n初稿：\n{draft}\n\n审查意见：\n{review}"
        polished = self.runtime.run_agent(book, "stylist", polish_task, context)
        polished_artifact = self.store.save_artifact(
            book.id,
            "chapter_draft",
            f"第 {chapter_no} 章润色稿",
            polished,
            metadata={"chapter_no": chapter_no, "stage": "polished"},
        )

        snapshot_task = (
            f"为第 {chapter_no} 章生成动态剧情快照，包含 summary、plot_changes、character_state_changes、"
            "new_facts、open_threads。\n\n终稿：\n"
            f"{polished}"
        )
        snapshot = self.runtime.run_agent(book, "architect", snapshot_task, context)
        snapshot_artifact = self.store.save_artifact(
            book.id,
            "chapter_snapshot",
            f"第 {chapter_no} 章剧情快照",
            snapshot,
            metadata={"chapter_no": chapter_no},
        )
        return [draft_artifact, review_artifact, polished_artifact, snapshot_artifact]

    def _latest_context(self, book_id: str, kinds: list[str]) -> str:
        blocks: list[str] = []
        for kind in kinds:
            artifact = self.store.latest_artifact(book_id, kind)
            if artifact:
                blocks.append(f"## {artifact.title}\n{artifact.content}")
        return "\n\n".join(blocks)

    def _reference_context(self, book_id: str, scope: str) -> str:
        references = [
            item for item in self.store.list_artifacts(book_id, "reference_material")
            if item.metadata.get("scope") == scope and item.status != "revision_requested"
        ][-6:]
        if not references:
            return ""
        blocks = [
            "## 借鉴资料（只提取结构与特征，不复刻原文）",
            *[f"### {item.title}\n{item.content}" for item in references],
        ]
        return "\n\n".join(blocks)

    def _chapter_context(self, book_id: str, chapter_no: int) -> str:
        kinds = ["world_bible", "character_cards", "chapter_outline", "style_guide"]
        blocks = [self._latest_context(book_id, kinds)]
        latest_snapshots = {}
        for item in self.store.list_artifacts(book_id, "chapter_snapshot"):
            number = item.metadata.get("chapter_no", 0)
            if 0 < number < chapter_no and item.status == "approved":
                latest_snapshots[number] = item
        snapshots = [latest_snapshots[number] for number in sorted(latest_snapshots)[-5:]]
        if snapshots:
            blocks.append("## 最近章节快照\n" + "\n\n".join(item.content for item in snapshots))
        return "\n\n".join(block for block in blocks if block)
