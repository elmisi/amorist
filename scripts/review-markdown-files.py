#!/usr/bin/env python3
"""Open Markdown files sequentially, keeping a resumable review journal."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', type=Path, default=root / 'markdown-file-paths.txt')
    parser.add_argument('--state', type=Path, default=root / 'markdown-review-state.json')
    parser.add_argument('--amorist', default='amorist', help='Executable name or path')
    parser.add_argument('--debug', action='store_true', help='Enable problem reporting in Amorist')
    args = parser.parse_args()
    executable = shutil.which(args.amorist)
    if not executable:
        parser.error(f'Executable not found: {args.amorist}')
    paths = list(dict.fromkeys(line for line in args.list.read_text(encoding='utf-8').splitlines() if line))
    state = json.loads(args.state.read_text(encoding='utf-8')) if args.state.exists() else {'completed': [], 'events': []}
    completed = set(state['completed'])

    def record(path, event, **details):
        state['events'].append({'time': datetime.now(timezone.utc).isoformat(), 'path': path, 'event': event, **details})
        temporary = args.state.with_name(args.state.name + '.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(args.state)

    print(f'Amorist: {executable}\nRegistro: {args.state}\nCtrl+C per interrompere e riprendere in seguito.', flush=True)
    for index, path in enumerate(paths, 1):
        if path in completed:
            continue
        if not Path(path).is_absolute() or not Path(path).is_file():
            print(f'File assente o percorso non assoluto, saltato: {path}', flush=True)
            record(path, 'skipped')
            continue
        print(f'\n[{index}/{len(paths)}] {path}', flush=True)
        record(path, 'opened', executable=executable)
        process = None
        try:
            process = subprocess.Popen([executable, *(['--debug'] if args.debug else []), path])
            code = process.wait()
        except KeyboardInterrupt:
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            record(path, 'interrupted')
            print('\nInterrotto. Al prossimo avvio ripartirò da questo file.')
            return 130
        except OSError as error:
            record(path, 'failed', error=str(error))
            print(f'Avvio fallito: {error}', file=sys.stderr)
            return 1
        if code != 0:
            record(path, 'failed', exit_code=code)
            print(f'Amorist è uscito con codice {code}; arresto la sequenza.', file=sys.stderr)
            return 1
        state['completed'].append(path)
        completed.add(path)
        record(path, 'closed')
    print('\nSequenza completata.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
