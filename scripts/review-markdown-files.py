#!/usr/bin/env python3
"""Open Markdown files sequentially, keeping a resumable review journal."""

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys

from review_identity import release_reference_path, verify
from review_state import load as load_state, save as save_state


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', type=Path, default=root / 'markdown-file-paths.txt')
    parser.add_argument('--state', type=Path, default=root / 'markdown-review-state.json')
    parser.add_argument('--amorist', help='Executable override; must match the delivery identity')
    parser.add_argument('--release-reference', type=Path, default=release_reference_path())
    parser.add_argument('--debug', action='store_true', help='Enable problem reporting in Amorist')
    args = parser.parse_args()
    try:
        executable, release, identity = verify(args.release_reference, args.amorist)
    except ValueError as error:
        parser.error(str(error))
    paths = list(dict.fromkeys(line for line in args.list.read_text(encoding='utf-8').splitlines() if line))
    try:
        state, run = load_state(args.state, release)
    except ValueError as error:
        parser.error(str(error))
    completed = set(run['completed'])

    def record(path, event, **details):
        state['events'].append({'time': datetime.now(timezone.utc).isoformat(), 'path': path, 'event': event, 'version': release['version'], 'buildId': release['buildId'], **details})
        save_state(args.state, state)

    print(f'Amorist: {executable}\nRegistro: {args.state}\nCtrl+C per interrompere e riprendere in seguito.', flush=True)
    for index, path in enumerate(paths, 1):
        if path in completed:
            continue
        if not Path(path).is_absolute() or not Path(path).is_file():
            print(f'File assente o percorso non assoluto, saltato: {path}', flush=True)
            record(path, 'skipped')
            continue
        try:
            executable, _, identity = verify(args.release_reference, args.amorist, expected=release)
        except ValueError as error:
            record(path, 'failed', error=str(error), version=release['version'], buildId=release['buildId'])
            print(str(error), file=sys.stderr)
            return 1
        print(f'\n[{index}/{len(paths)}] {path}', flush=True)
        record(path, 'opened', executable=executable)
        process = None
        try:
            options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
            process = subprocess.Popen([executable, *(['--debug'] if args.debug else []), '--', path], **options)
            code = process.wait()
        except KeyboardInterrupt:
            print('\nSequenza interrotta. Chiudi normalmente Amorist dopo aver gestito il lavoro corrente.', flush=True)
            if process is not None:
                while process.poll() is None:
                    try:
                        process.wait()
                    except KeyboardInterrupt:
                        print('In attesa della chiusura normale di Amorist; nessuna finestra viene terminata.', flush=True)
            record(path, 'interrupted', exit_code=process.returncode if process else None)
            print('Al prossimo avvio ripartirò da questo file.')
            return 130
        except OSError as error:
            record(path, 'failed', error=str(error))
            print(f'Avvio fallito: {error}', file=sys.stderr)
            return 1
        if code != 0:
            record(path, 'failed', exit_code=code)
            print(f'Amorist è uscito con codice {code}; arresto la sequenza.', file=sys.stderr)
            return 1
        run['completed'].append(path)
        completed.add(path)
        record(path, 'closed')
    print('\nSequenza completata.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
