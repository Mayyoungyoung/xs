import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from novel_agent.agents import AgentRuntime
from novel_agent.cli import review_gate
from novel_agent.llm import LLMClient
from novel_agent.storage import BookStore, write_json
from novel_agent.workflow import Workflow


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = BookStore(Path(self.temp.name) / "isolated")
        self.book = self.store.create_book("雾城", "悬疑", "所有人忘记同一天")
        self.workflow = Workflow(self.store, AgentRuntime(self.store, LLMClient(mock=True)))

    def approve_requirements(self):
        for kind in ["world_bible", "character_cards", "chapter_outline"]:
            self.store.save_artifact(self.book.id, kind, kind, f"已确认的{kind}", status="approved")

    def test_custom_root_and_path_traversal(self):
        self.assertTrue(self.store.index_path.exists())
        for value in ["../outside", "..", "a/b", "a\\b", "C:", ""]:
            with self.assertRaises(ValueError):
                self.store.book_dir(value)

    def test_only_approved_settings_enter_context(self):
        self.store.save_artifact(self.book.id, "world_bible", "世界观", "原始世界", status="approved")
        self.store.save_artifact(self.book.id, "world_bible", "未确认世界", "不应进入上下文")
        result = self.store.latest_artifact(self.book.id, "world_bible")
        self.assertEqual(result.content, "原始世界")

    def test_draft_requires_confirmed_settings_and_positive_number(self):
        with self.assertRaisesRegex(ValueError, "approve"):
            self.workflow.draft_chapter(self.book, 1)
        with self.assertRaises(ValueError):
            self.workflow.draft_chapter(self.book, 0)

    def test_full_pipeline_and_book_isolation(self):
        self.approve_requirements()
        result = self.workflow.draft_chapter(self.book, 1)
        self.assertEqual([item.kind for item in result], ["chapter_draft", "continuity_review", "chapter_draft", "chapter_snapshot"])
        other = self.store.create_book("其他书籍")
        self.assertEqual(self.store.list_artifacts(other.id), [])
        self.assertTrue(all("MOCK" in item.content for item in result))

    def test_revision_creates_new_artifact_and_preserves_original(self):
        source = self.store.save_artifact(self.book.id, "world_bible", "世界观", "原稿", metadata={"revision_request": "增加代价"})
        revised = self.workflow.revise(self.book, source.id)
        self.assertNotEqual(revised.id, source.id)
        self.assertEqual(revised.metadata["revised_from"], source.id)
        self.assertEqual(self.store.list_artifacts(self.book.id)[0].content, "原稿")

    def test_eof_keeps_pending_work(self):
        source = self.store.save_artifact(self.book.id, "world_bible", "世界观", "原稿")
        with patch("builtins.input", side_effect=EOFError), patch("sys.stdout", new=io.StringIO()):
            review_gate(self.store, source)
        self.assertEqual(source.status, "pending_review")

    def test_atomic_write_failure_preserves_file(self):
        target = Path(self.temp.name) / "data.json"
        write_json(target, {"text": "原稿"})
        with patch("novel_agent.storage.os.replace", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                write_json(target, {"text": "不完整新稿"})
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"text": "原稿"})
        self.assertEqual(list(target.parent.glob("*.tmp")), [])

    def test_empty_model_content_is_a_clear_error(self):
        client = LLMClient(api_key="test-only", mock=False)
        response = io.BytesIO(b'{"choices":[{"message":{"content":""}}]}')
        with patch("novel_agent.llm.urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "有效正文"):
                client.complete("system", "user")


if __name__ == "__main__":
    unittest.main()
