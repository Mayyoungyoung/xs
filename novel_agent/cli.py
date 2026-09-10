from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .agents import AgentRuntime
from .llm import LLMClient, ModelRoute
from .storage import BookStore, ensure_workspace
from .workflow import Workflow


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="novel-agent", description="Novel-Agent System CLI prototype")
    parser.add_argument(
        "--model",
        choices=["deepseek-v4-flash", "deepseek-v4-pro"],
        default=os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash"),
        help="用于本次创作的 DeepSeek 模型",
    )
    parser.add_argument("--mock", action="store_true", help="明确使用演示模型，不发送 API 请求")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="创建本地 workspace 目录")

    create = sub.add_parser("create-book", help="创建一本新书")
    create.add_argument("title")
    create.add_argument("--genre", default="")
    create.add_argument("--premise", default="")

    sub.add_parser("list-books", help="列出所有书籍")

    artifacts = sub.add_parser("artifacts", help="列出一本书的产物")
    artifacts.add_argument("book_id")

    research = sub.add_parser("research", help="生成风向报告")
    research.add_argument("book_id")
    research.add_argument("topic")

    style = sub.add_parser("style", help="根据样本文本生成 Style Prompt")
    style.add_argument("book_id")
    style.add_argument("--sample", default="")
    style.add_argument("--sample-file", default="")

    world = sub.add_parser("world", help="生成世界观白皮书")
    world.add_argument("book_id")

    chars = sub.add_parser("characters", help="生成深度人物卡")
    chars.add_argument("book_id")

    outline = sub.add_parser("outline", help="生成分卷与章节大纲")
    outline.add_argument("book_id")

    draft = sub.add_parser("draft", help="生成章节初稿、审查、润色与快照")
    draft.add_argument("book_id")
    draft.add_argument("chapter_no", type=int)

    reference = sub.add_parser("reference", help="加入本地借鉴资料")
    reference.add_argument("book_id")
    reference.add_argument("title")
    reference.add_argument("--scope", choices=["plot", "character", "style", "world"], required=True)
    reference.add_argument("--file", default="")
    reference.add_argument("--text", default="")

    demo = sub.add_parser("demo", help="按顺序跑一遍最小闭环")
    demo.add_argument("book_id")

    revise = sub.add_parser("revise", help="按修改意见生成新版本，保留原稿")
    revise.add_argument("book_id")
    revise.add_argument("artifact_id")
    revise.add_argument("--note", default="")
    export = sub.add_parser("export", help="导出已确认章节为 Markdown")
    export.add_argument("book_id")
    export.add_argument("--output", required=True)
    return parser


def main(argv: list[str] | None = None) -> None:
    try:
        run(argv)
    except (ValueError, KeyError, RuntimeError, OSError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        raise SystemExit(1) from None
    except KeyboardInterrupt:
        print("\n已停止，已保存内容保留。", file=sys.stderr)
        raise SystemExit(130) from None


def run(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    store = BookStore()
    llm = LLMClient(ModelRoute(model=args.model), mock=True if args.mock else None)
    if llm.mock and args.command not in {"init", "list-books", "create-book", "artifacts", "export", "reference"}:
        print("[演示模式] 未调用真实模型，生成内容仅用于验证流程。")
    runtime = AgentRuntime(store, llm)
    workflow = Workflow(store, runtime)

    if args.command == "init":
        root = ensure_workspace()
        print(f"Workspace ready: {root.resolve()}")
        if not os.getenv("DEEPSEEK_API_KEY"):
            print("未检测到 DEEPSEEK_API_KEY，当前会使用 mock 模式。")
        return

    if args.command == "create-book":
        book = store.create_book(args.title, args.genre, args.premise)
        print(f"Created book: {book.id}")
        print(f"Path: {store.book_dir(book.id).resolve()}")
        return

    if args.command == "list-books":
        books = store.list_books()
        if not books:
            print("No books yet. Run: novel-agent create-book <title>")
            return
        for book in books:
            print(f"{book.id}\t{book.title}\t{book.genre}\t{book.status}")
        return

    if args.command == "artifacts":
        for artifact in store.list_artifacts(args.book_id):
            print(f"{artifact.id}\t{artifact.kind}\t{artifact.status}\t{artifact.title}")
        return

    book = store.get_book(args.book_id)

    if args.command == "revise":
        review_gate(store, workflow.revise(book, args.artifact_id, args.note))
        return

    if args.command == "export":
        latest = {}
        for artifact in store.list_artifacts(book.id, "chapter_draft"):
            if artifact.status == "approved":
                latest[artifact.metadata.get("chapter_no", 1)] = artifact
        if not latest:
            raise ValueError("没有已确认的章节，请先 approve 确认稿件")
        output = Path(args.output)
        if output.exists():
            raise ValueError("目标文件已存在，请使用新的导出文件名")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(f"# {book.title}\n\n" + "\n\n".join(f"## 第 {number} 章\n\n{latest[number].content}" for number in sorted(latest)), encoding="utf-8")
        print(f"已导出 {len(latest)} 章：{output.resolve()}")
        return

    if args.command == "reference":
        text = args.text
        if args.file:
            with open(args.file, "r", encoding="utf-8") as reference_file:
                text = reference_file.read()
        if not text:
            text = prompt_multiline("请粘贴借鉴资料，空行结束：")
        artifact = workflow.add_reference(book, args.title, args.scope, text, source=args.file or "manual")
        print(f"已加入借鉴资料：{artifact.id}")
        return

    if args.command == "research":
        artifact = workflow.research(book, args.topic)
        review_gate(store, artifact)
        return

    if args.command == "style":
        sample = args.sample
        if args.sample_file:
            sample = open(args.sample_file, "r", encoding="utf-8").read()
        if not sample:
            sample = prompt_multiline("请粘贴样本文本，空行结束：")
        artifact = workflow.style_guide(book, sample)
        review_gate(store, artifact)
        return

    if args.command == "world":
        artifact = workflow.world(book)
        review_gate(store, artifact)
        return

    if args.command == "characters":
        artifact = workflow.characters(book)
        review_gate(store, artifact)
        return

    if args.command == "outline":
        artifact = workflow.outline(book)
        review_gate(store, artifact)
        return

    if args.command == "draft":
        artifacts = workflow.draft_chapter(book, args.chapter_no)
        for artifact in artifacts:
            review_gate(store, artifact)
        return

    if args.command == "demo":
        steps = [
            lambda: workflow.research(book, book.genre or book.premise or book.title),
            lambda: workflow.style_guide(book, "节奏明快，冲突明确，章尾留下强钩子。"),
            lambda: workflow.world(book),
            lambda: workflow.characters(book),
            lambda: workflow.outline(book),
        ]
        for step in steps:
            artifact = step()
            review_gate(store, artifact)
            if artifact.status != "approved":
                print("当前步骤尚未确认，流程已暂停。可用对应命令或 revise 继续。")
                return
        for artifact in workflow.draft_chapter(book, 1):
            review_gate(store, artifact)
        return


def review_gate(store: BookStore, artifact) -> None:
    print("\n" + "=" * 72)
    print(f"{artifact.title} [{artifact.kind}]")
    print(f"状态：{artifact.status}")
    print("-" * 72)
    print(artifact.content)
    print("-" * 72)
    while True:
        try:
            choice = input("闸口操作 approve / reject / skip：").strip().lower()
        except EOFError:
            print("输入结束，保留待确认产物。")
            return
        if choice in {"approve", "a"}:
            store.update_artifact_status(artifact, "approved")
            print(f"已确认：{artifact.id}")
            return
        if choice in {"reject", "r"}:
            try:
                note = input("请输入修改意见：").strip()
            except EOFError:
                note = ""
            artifact.metadata["revision_request"] = note
            store.update_artifact_status(artifact, "revision_requested")
            print(f"已记录修改意见：{artifact.id}")
            return
        if choice in {"skip", "s", ""}:
            print(f"保留待确认：{artifact.id}")
            return
        print("请输入 approve、reject 或 skip。")


def prompt_multiline(title: str) -> str:
    print(title)
    lines: list[str] = []
    while True:
        line = sys.stdin.readline()
        if not line or not line.strip():
            break
        lines.append(line.rstrip("\n"))
    return "\n".join(lines)


if __name__ == "__main__":
    main()
