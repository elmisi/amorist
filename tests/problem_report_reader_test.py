import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from read_problem_reports import read_reports


class ReportReaderTests(unittest.TestCase):
    def test_old_and_new_records_survive_a_truncated_record_between_them(self):
        old={'schemaVersion':1,'note':'old','markdown':'original'}
        new={'schemaVersion':2,'note':'new','buildId':'measured','markdown':'unsaved'}
        content=(json.dumps(old)+'\n'+ '{"schemaVersion":2,"note":"truncated\n'+json.dumps(new)+'\n').encode()
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'reports.jsonl';path.write_bytes(content)
            result=read_reports(path)
            self.assertEqual(result['records'],[{'line':1,'report':old},{'line':3,'report':new}])
            self.assertEqual(result['issues'][0]['line'],2)
            self.assertEqual(path.read_bytes(),content)

    def test_unterminated_tail_and_unknown_schema_are_explicit(self):
        content=b'{"schemaVersion":99}\n{"schemaVersion":1}'
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'reports.jsonl';path.write_bytes(content)
            result=read_reports(path);self.assertEqual(result['records'],[])
            self.assertEqual([issue['line'] for issue in result['issues']],[1,2])
            self.assertIn('Incomplete',result['issues'][1]['error'])
            self.assertEqual(path.read_bytes(),content)


if __name__ == '__main__':
    unittest.main()
