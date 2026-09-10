from __future__ import annotations

import json
import os
import tempfile
import re
import uuid
from pathlib import Path
from typing import Any

from .models import Artifact, Book, utc_now


ROOT = Path("workspace")


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    slug = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", lowered).strip("-")
    return slug or "book"


def ensure_workspace() -> Path:
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "books").mkdir(exist_ok=True)
    return ROOT


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


class BookStore:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root).resolve()
        (self.root / "books").mkdir(parents=True, exist_ok=True)

    @property
    def index_path(self) -> Path:
        return self.root / "books" / "index.json"

    def list_books(self) -> list[Book]:
        data = read_json(self.index_path, [])
        return [Book.from_dict(item) for item in data]

    def save_index(self, books: list[Book]) -> None:
        write_json(self.index_path, [book.to_dict() for book in books])

    def create_book(self, title: str, genre: str = "", premise: str = "") -> Book:
        title = title.strip()
        if not title:
            raise ValueError("书名不能为空")
        book_id = f"{slugify(title)[:80]}-{uuid.uuid4().hex[:8]}"
        book = Book(id=book_id, title=title, genre=genre, premise=premise)
        books = self.list_books()
        books.append(book)
        self.save_index(books)
        self.book_dir(book.id).mkdir(parents=True, exist_ok=True)
        for child in ["artifacts", "chapters", "snapshots", "agent_logs", "research"]:
            (self.book_dir(book.id) / child).mkdir(exist_ok=True)
        write_json(self.book_dir(book.id) / "book.json", book.to_dict())
        return book

    def get_book(self, book_id: str) -> Book:
        for book in self.list_books():
            if book.id == book_id:
                return book
        raise KeyError(f"Book not found: {book_id}")

    def book_dir(self, book_id: str) -> Path:
        if not book_id or Path(book_id).name != book_id or book_id in {".", ".."} or any(char in book_id for char in "/\\:"):
            raise ValueError("无效的书籍编号")
        base = (self.root / "books").resolve()
        target = (base / book_id).resolve()
        if target.parent != base:
            raise ValueError("书籍路径超出工作区")
        return target

    def artifact_dir(self, book_id: str, kind: str) -> Path:
        if kind == "chapter_draft":
            return self.book_dir(book_id) / "chapters"
        if kind == "chapter_snapshot":
            return self.book_dir(book_id) / "snapshots"
        if kind == "research_report":
            return self.book_dir(book_id) / "research"
        return self.book_dir(book_id) / "artifacts"

    def save_artifact(
        self,
        book_id: str,
        kind: str,
        title: str,
        content: str,
        status: str = "pending_review",
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        self.get_book(book_id)
        if not re.fullmatch(r"[a-z_]+", kind):
            raise ValueError("无效的产物类型")
        artifact = Artifact(
            id=f"{kind}-{uuid.uuid4().hex[:8]}",
            book_id=book_id,
            kind=kind,
            title=title,
            status=status,
            content=content,
            metadata=metadata or {},
        )
        path = self.artifact_path(artifact)
        write_json(path, artifact.to_dict())
        return artifact

    def update_artifact_status(self, artifact: Artifact, status: str) -> Artifact:
        artifact.status = status
        artifact.updated_at = utc_now()
        write_json(self.artifact_path(artifact), artifact.to_dict())
        return artifact

    def artifact_path(self, artifact: Artifact) -> Path:
        name = f"{artifact.id}.json"
        return self.artifact_dir(artifact.book_id, artifact.kind) / name

    def list_artifacts(self, book_id: str, kind: str | None = None) -> list[Artifact]:
        base_dirs = [
            self.book_dir(book_id) / "artifacts",
            self.book_dir(book_id) / "chapters",
            self.book_dir(book_id) / "snapshots",
            self.book_dir(book_id) / "research",
        ]
        artifacts: list[Artifact] = []
        for base_dir in base_dirs:
            for path in sorted(base_dir.glob("*.json")):
                artifact = Artifact.from_dict(read_json(path, {}))
                if kind is None or artifact.kind == kind:
                    artifacts.append(artifact)
        return sorted(artifacts, key=lambda item: item.created_at)

    def latest_artifact(self, book_id: str, kind: str) -> Artifact | None:
        artifacts = self.list_artifacts(book_id, kind)
        usable = [item for item in artifacts if item.status == "approved"]
        return usable[-1] if usable else None

    def append_agent_log(self, book_id: str, role: str, content: str, metadata: dict[str, Any] | None = None) -> None:
        entry = {
            "id": uuid.uuid4().hex,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "created_at": utc_now(),
        }
        path = self.book_dir(book_id) / "agent_logs" / "messages.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

