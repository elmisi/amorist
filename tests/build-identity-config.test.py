"""Prove CLI build identity measures configuration and external payload changes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

repo = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo / 'scripts'))
from review_identity import probe

application = repo / 'src-tauri/target/debug' / ('amorist.exe' if os.name == 'nt' else 'amorist')
environment = dict(os.environ)
environment.pop('TAURI_CONFIG', None)


def build(config=None):
    env = dict(environment)
    if config is not None:
        env['TAURI_CONFIG'] = json.dumps(config)
    subprocess.run(['cargo', 'build', '--manifest-path', str(repo / 'src-tauri/Cargo.toml'), '--bin', 'amorist'],
                   cwd=repo, env=env, check=True)
    return probe([str(application)])


with tempfile.TemporaryDirectory(prefix='amorist-build-identity-') as directory:
    payload = Path(directory) / 'decoder.so'
    payload.write_bytes(b'original decoder bytes')
    config = {'bundle': {'linux': {'appimage': {'files': {'usr/lib/decoder.so': str(payload)}}}}}
    try:
        baseline = build()
        configured = build(config)
        payload.write_bytes(b'changed decoder bytes')
        changed = build(config)
        assert len({identity['buildId'] for identity in [baseline, configured, changed]}) == 3, \
            'Missing configuration or changed external runtime bytes reused a build identity'
        assert len({identity['commit'] for identity in [baseline, configured, changed]}) == 1
        assert len({identity['version'] for identity in [baseline, configured, changed]}) == 1
    finally:
        restored = build()
    assert baseline['buildId'] == restored['buildId'], 'Original build identity did not restore'
    print(json.dumps({'result': 'pass', 'baseline': baseline, 'configured': configured,
                      'changedPayload': changed, 'restored': restored}))
