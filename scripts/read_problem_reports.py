#!/usr/bin/env python3
"""Read append-only Bug records without repairing or rewriting the log."""
import argparse
import json
from pathlib import Path
import sys

from review_identity import release_reference_path


def read_reports(path):
    records, issues = [], []
    with path.open('rb') as stream:
        for number, raw in enumerate(stream, 1):
            if not raw.endswith(b'\n'):
                issues.append({'line': number, 'error': 'Incomplete record at end of log'})
                continue
            try:
                value = json.loads(raw.decode('utf-8'))
            except (UnicodeError, ValueError) as error:
                issues.append({'line': number, 'error': f'Malformed or incomplete record: {error}'})
                continue
            if not isinstance(value, dict) or type(value.get('schemaVersion')) is not int or value['schemaVersion'] not in (1, 2):
                issues.append({'line': number, 'error': 'Unsupported report schema; original bytes preserved'})
                continue
            records.append({'line': number, 'report': value})
    return {'records': records, 'issues': issues}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path', nargs='?', type=Path, default=release_reference_path().parent / 'problem-reports.jsonl')
    parser.add_argument('--json', action='store_true', help='Print complete records and reader issues as JSON')
    args = parser.parse_args()
    try:
        result = read_reports(args.path)
    except OSError as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f'{len(result["records"])} valid reports; {len(result["issues"])} reader issues: {args.path}')
        for issue in result['issues']:
            print(f'Line {issue["line"]}: {issue["error"]}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
