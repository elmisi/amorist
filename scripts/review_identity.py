"""Resolve delivered Amorist builds using the headless machine interface."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


def release_reference_path():
    if sys.platform == 'win32':
        base = Path(os.environ['LOCALAPPDATA'])
    elif sys.platform == 'darwin':
        base = Path.home() / 'Library' / 'Application Support'
    else:
        base = Path(os.environ.get('XDG_DATA_HOME', str(Path.home() / '.local' / 'share')))
    return base / 'dev.elmisi.amorist' / 'review-release.json'


def read_reference(path):
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise ValueError(f'Cannot read delivery reference {path}: {error}. Install the validated delivery before starting the loop.') from error
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError(f'Invalid delivery reference schema: {path}')
    for key in ('version', 'buildId', 'fingerprint', 'executable'):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError(f'Delivery reference requires {key}: {path}')
    return value


def probe(command):
    with tempfile.TemporaryDirectory(prefix='amorist-review-identity-') as temporary:
        output = Path(temporary) / 'build-info.json'
        try:
            result = subprocess.run([*command, '--build-info', str(output)], stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ValueError(f'Cannot identify Amorist within 10 seconds: {error}') from error
        if result.returncode != 0:
            raise ValueError(f'Amorist build-info failed with exit {result.returncode}: {result.stderr.decode(errors="replace").strip()}')
        try:
            info = json.loads(output.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise ValueError(f'Amorist did not produce valid build-info: {error}') from error
        if not isinstance(info, dict) or info.get('schemaVersion') != 1:
            raise ValueError('Invalid Amorist build-info schema')
        if not isinstance(info.get('fingerprint'), str) or not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', info['fingerprint']):
            raise ValueError('Invalid Amorist content fingerprint')
        for key in ('version', 'buildId', 'target', 'commit'):
            if not isinstance(info.get(key), str) or not info[key]:
                raise ValueError(f'Amorist build-info requires {key}')
        if not isinstance(info.get('dirty'), bool):
            raise ValueError('Invalid Amorist build-info dirty flag')
        return info


def verify(path, override=None, expected=None):
    reference = read_reference(path)
    if expected and any(reference[key] != expected[key] for key in ('version', 'buildId', 'fingerprint')):
        raise ValueError('The delivery changed during this loop. Restart the runner to begin the new version.')
    executable = shutil.which(override or reference['executable'])
    if not executable:
        raise ValueError(f'Delivered executable not found: {override or reference["executable"]}. Install the validated delivery.')
    info = probe([executable])
    if any(info[key] != reference[key] for key in ('version', 'buildId', 'fingerprint')):
        raise ValueError(f'Installed Amorist differs from delivery {reference["version"]} ({reference["buildId"]}). Install the validated delivery; no document was opened.')
    return executable, reference, info
