import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

RUNNER = Path(__file__).resolve().parents[1] / 'scripts' / 'review-markdown-files.py'


class ReviewRunnerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='amorist review ')
        self.root = Path(self.temporary.name)
        self.info = {'schemaVersion': 1, 'version': '1.0.0', 'buildId': 'one', 'fingerprint': '1' * 40, 'target': 'test', 'commit': 'a' * 40, 'dirty': False}
        self.identity = self.root / 'identity.json'
        self.opens = self.root / 'opens.jsonl'
        self.delay = self.root / 'delay'
        fixture = self.root / 'editor.py'
        fixture.write_text('import sys,json,pathlib,time\n'
                           f'root=pathlib.Path({str(self.root)!r})\n'
                           'if sys.argv[1]=="--build-info":\n'
                           ' (pathlib.Path(sys.argv[2])).write_bytes((root/"identity.json").read_bytes());sys.exit(0)\n'
                           'with (root/"opens.jsonl").open("a") as stream:stream.write(json.dumps(sys.argv[1:])+"\\n")\n'
                           'time.sleep(float((root/"delay").read_text(encoding="utf-8")) if (root/"delay").exists() else 0)\n'
                           'if (root/"change-build").exists():\n'
                           ' info=json.loads((root/"identity.json").read_text(encoding="utf-8"));info["fingerprint"]="f"*40;(root/"identity.json").write_text(json.dumps(info))\n', encoding='utf-8')
        self.executable = self.root / ('fake editor.cmd' if os.name == 'nt' else 'fake editor')
        if os.name == 'nt':
            self.executable.write_text(f'@"{sys.executable}" "{fixture}" %*\n', encoding='utf-8')
        else:
            self.executable.write_text(f'#!{sys.executable}\n'+fixture.read_text(encoding='utf-8'), encoding='utf-8')
            self.executable.chmod(0o700)
        self.reference = self.root / 'release.json'
        self.files = [self.root / 'first note.md', self.root / 'second λ.md']
        for file in self.files:
            file.write_text('# Test', encoding='utf-8')
        self.listing = self.root / 'files.txt'
        self.listing.write_text('\n'.join(map(str, self.files))+'\n', encoding='utf-8')
        self.state = self.root / 'state.json'
        self.publish_fixture()

    def tearDown(self):
        self.temporary.cleanup()

    def publish_fixture(self):
        self.identity.write_text(json.dumps(self.info), encoding='utf-8')
        self.reference.write_text(json.dumps({**self.info, 'executable': str(self.executable)}), encoding='utf-8')

    def command(self):
        return [sys.executable, str(RUNNER), '--release-reference', str(self.reference), '--list', str(self.listing), '--state', str(self.state)]

    def run_loop(self):
        return subprocess.run(self.command(), capture_output=True, text=True, timeout=10)

    def opened(self):
        return [json.loads(line) for line in self.opens.read_text(encoding='utf-8').splitlines()] if self.opens.exists() else []

    def test_resume_new_build_and_removed_file_keep_history(self):
        self.listing.write_text(self.listing.read_text(encoding='utf-8')+str(self.root/'removed.md')+'\n',encoding='utf-8')
        first = self.run_loop();self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(self.opened(), [['--', str(file)] for file in self.files])
        second = self.run_loop();self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(len(self.opened()), 2)
        self.info.update(version='2.0.0', buildId='two', fingerprint='2'*40);self.publish_fixture()
        third = self.run_loop();self.assertEqual(third.returncode, 0, third.stderr)
        self.assertEqual(len(self.opened()), 2)
        state = json.loads(self.state.read_text(encoding='utf-8'));self.assertEqual(state['runs']['one']['completed'], list(map(str,self.files)))
        self.assertEqual(state['runs']['two']['completed'], [])
        self.assertTrue(any(event['event']=='skipped' for event in state['events']))
        self.assertEqual({event['version'] for event in state['events']}, {'1.0.0','2.0.0'})
        for file in self.files:self.assertEqual(file.read_text(encoding='utf-8'), '# Test')

    def test_legacy_and_all_builds_resume_at_first_unreviewed_file(self):
        self.state.write_text(json.dumps({'events': [], 'completed': [str(self.files[0])]}))
        self.assertEqual(self.run_loop().returncode, 0)
        self.assertEqual(self.opened(), [['--', str(self.files[1])]])
        additional = self.root / 'third.md'
        additional.write_text('# Third')
        self.listing.write_text(self.listing.read_text(encoding='utf-8') + str(additional) + '\n', encoding='utf-8')
        self.info.update(version='2.0.0', buildId='two', fingerprint='2'*40)
        self.publish_fixture()
        result = self.run_loop()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('[3/3]', result.stdout)
        self.assertEqual(self.opened(), [['--', str(self.files[1])], ['--', str(additional)]])
        state = json.loads(self.state.read_text(encoding='utf-8'))
        self.assertEqual(state['legacyCompleted'], [str(self.files[0])])
        self.assertEqual(state['runs']['one']['completed'], [str(self.files[1])])
        self.assertEqual(state['runs']['two']['completed'], [str(additional)])

    def test_updated_list_opens_only_new_paths_on_same_build(self):
        first=self.run_loop();self.assertEqual(first.returncode,0,first.stderr)
        additional=self.root/'new note.md';additional.write_text('# New')
        self.listing.write_text(self.listing.read_text(encoding='utf-8')+str(additional)+'\n'+str(self.files[0])+'\n',encoding='utf-8')
        second=self.run_loop();self.assertEqual(second.returncode,0,second.stderr)
        self.assertEqual(self.opened(),[['--',str(file)] for file in [*self.files,additional]])
        self.assertEqual(additional.read_text(encoding='utf-8'),'# New')

    def test_changed_binary_is_rejected_before_next_file(self):
        (self.root/'change-build').write_text('change after first file')
        result=self.run_loop();self.assertEqual(result.returncode,1,result.stderr)
        self.assertIn('differs',result.stderr)
        self.assertEqual(self.opened(),[['--',str(self.files[0])]])
        events=json.loads(self.state.read_text(encoding='utf-8'))['events']
        self.assertEqual(events[-1]['event'],'failed')
        self.assertEqual(events[-1]['path'],str(self.files[1]))

    def test_unicode_paths_survive_ascii_console_configuration(self):
        result=subprocess.run(self.command(),capture_output=True,encoding='utf-8',timeout=10,
                              env={**os.environ,'PYTHONIOENCODING':'ascii'})
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn(str(self.files[1]),result.stdout)
        self.assertEqual(self.opened(),[['--',str(file)] for file in self.files])

    def test_identity_mismatch_opens_nothing(self):
        self.identity.write_text(json.dumps({**self.info,'fingerprint':'f'*40}))
        result=self.run_loop();self.assertNotEqual(result.returncode,0);self.assertIn('differs',result.stderr)
        self.assertFalse(self.opens.exists());self.assertFalse(self.state.exists())

    def test_malformed_state_is_preserved(self):
        self.state.write_bytes(b'{broken state')
        result=self.run_loop();self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.state.read_bytes(),b'{broken state');self.assertFalse(self.opens.exists())

    def test_second_runner_cannot_use_same_state(self):
        self.delay.write_text('0.5')
        first=subprocess.Popen(self.command(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            started=time.monotonic()
            while not self.opens.exists() and time.monotonic()-started<5:time.sleep(.02)
            self.assertTrue(self.opens.exists())
            second=self.run_loop();self.assertNotEqual(second.returncode,0);self.assertIn('Another review runner',second.stderr)
            _,stderr=first.communicate(timeout=10);self.assertEqual(first.returncode,0,stderr)
            self.assertEqual(len(self.opened()),2)
        finally:
            if first.poll() is None:first.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
