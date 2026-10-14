"""Version-scoped review progress with preserved history and atomic writes."""
import json
import os
from pathlib import Path
import tempfile


def load(path, release):
    try:
        state = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'schemaVersion': 2, 'runs': {}, 'events': []}
    except (OSError, ValueError) as error:
        raise ValueError(f'Cannot read review state {path}: {error}; original state was preserved.') from error
    if not isinstance(state, dict) or not isinstance(state.get('events'), list) or not all(isinstance(event, dict) for event in state['events']):
        raise ValueError(f'Invalid review history: {path}; original state was preserved.')
    if state.get('schemaVersion') is None and isinstance(state.get('completed'), list) and all(isinstance(value, str) for value in state['completed']):
        state['legacyCompleted'] = state.pop('completed')
        state['schemaVersion'] = 2
        state['runs'] = {}
    if state.get('schemaVersion') != 2 or not isinstance(state.get('runs'), dict):
        raise ValueError(f'Invalid review state schema: {path}; original state was preserved.')
    for key, run in state['runs'].items():
        if not isinstance(key, str) or not isinstance(run, dict) or not isinstance(run.get('version'), str) or not isinstance(run.get('completed'), list) or not all(isinstance(value, str) for value in run['completed']):
            raise ValueError(f'Invalid review round: {path}; original state was preserved.')
    run = state['runs'].setdefault(release['buildId'], {'version': release['version'], 'completed': []})
    if run['version'] != release['version']:
        raise ValueError('Review build identity has inconsistent version; state preserved.')
    return state, run


def save(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            json.dump(state, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()
