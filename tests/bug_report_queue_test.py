import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bug_queue', ROOT / 'scripts/queue-bug-reports.py')
queue_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue_module)


class BugQueueTests(unittest.TestCase):
    def test_append_preserves_original_and_deduplicates_complete_records(self):
        with tempfile.TemporaryDirectory() as directory:
            source, queue = (Path(directory) / name for name in ('original.jsonl', 'pending.jsonl'))
            first = json.dumps({'note': 'prima λ', 'markdown': '# Originale\r\n'}).encode() + b'\n'
            source.write_bytes(first + b'{"note":')
            self.assertEqual(queue_module.enqueue(source, queue), (1, 1))
            snapshot = queue.read_bytes()
            self.assertEqual(source.read_bytes(), first + b'{"note":')
            self.assertEqual(queue_module.enqueue(source, queue), (0, 1))
            self.assertEqual(queue.read_bytes(), snapshot)
            source.write_bytes(first + b'{"note":"seconda"}\n')
            self.assertEqual(queue_module.enqueue(source, queue), (1, 2))
            self.assertTrue(queue.read_bytes().startswith(snapshot))
            records = [json.loads(line) for line in queue.read_bytes().splitlines()]
            self.assertEqual(records[0]['report']['markdown'], '# Originale\r\n')
            self.assertEqual(records[1]['report']['note'], 'seconda')

    def test_source_cannot_be_used_as_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'original.jsonl'
            source.write_bytes(b'{}\n')
            with self.assertRaises(ValueError):
                queue_module.enqueue(source, source)
            self.assertEqual(source.read_bytes(), b'{}\n')


if __name__ == '__main__':
    unittest.main()
