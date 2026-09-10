from __future__ import annotations

import json
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
    ROOT.mkdir(exist_ok=True)
    (ROOT / "books").mkdir(exist_ok=True)
    return ROOT


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class BookStore:
    def __init__(self, root: Path = ROOT):
        self.root = root
        ensure_workspace()

    @property
    def index_path(self) -> Path:
        return self.root / "books" / "index.json"

    def list_books(self) -> list[Book]:
        data = read_json(self.index_path, [])
        return [Book.from_dict(item) for item in data]

    def save_index(self, books: list[Book]) -> None:
        write_json(self.index_path, [book.to_dict() for book in books])

    def create_book(self, title: str, genre: str = "", premise: str = "") -> Book:
        book_id = f"{slugify(title)}-{uuid.uuid4().hex[:8]}"
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
        return self.root / "books" / book_id

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
        return artifacts[-1] if artifacts else None

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

