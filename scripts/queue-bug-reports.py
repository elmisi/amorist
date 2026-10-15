#!/usr/bin/env python3
"""Append complete Bug reports to a processing queue without changing originals."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from review_state import exclusive


def enqueue(source, queue):
    if source.resolve() == queue.resolve():
        raise ValueError('Source and queue must be different files')
    with exclusive(queue):
        existing = [json.loads(line) for line in queue.read_bytes().splitlines()] if queue.exists() else []
        seen = {entry['recordSha256'] for entry in existing}
        pending = []
        # Snapshot only: a concurrent or truncated final record is left for next time.
        for number, line in enumerate(source.read_bytes().splitlines(keepends=True), 1):
            if not line.endswith(b'\n'):
                break
            report = json.loads(line)
            digest = hashlib.sha256(line.rstrip(b'\r\n')).hexdigest()
            if digest in seen:
                continue
            pending.append({'schemaVersion': 1, 'recordSha256': digest,
                            'source': str(source.resolve()), 'sourceRecord': number,
                            'queuedAt': datetime.now(timezone.utc).isoformat(),
                            'status': 'pending', 'report': report})
            seen.add(digest)
        queue.parent.mkdir(parents=True, exist_ok=True)
        with queue.open('ab') as stream:
            for entry in pending:
                stream.write(json.dumps(entry, ensure_ascii=False).encode('utf-8') + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        return len(pending), len(existing) + len(pending)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path.home() / '.local/share/dev.elmisi.amorist'
    parser.add_argument('--source', type=Path, default=root / 'problem-reports.jsonl')
    parser.add_argument('--queue', type=Path, default=root / 'pending-bug-reports.jsonl')
    args = parser.parse_args()
    added, total = enqueue(args.source, args.queue)
    print(f'Accodate: {added}; totale: {total}; registro: {args.queue}')
