from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Book:
    id: str
    title: str
    genre: str = ""
    premise: str = ""
    status: str = "active"
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Book":
        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "genre": self.genre,
            "premise": self.premise,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass
class Artifact:
    id: str
    book_id: str
    kind: str
    title: str
    status: str
    content: str
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Artifact":
        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "book_id": self.book_id,
            "kind": self.kind,
            "title": self.title,
            "status": self.status,
            "content": self.content,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
        }

