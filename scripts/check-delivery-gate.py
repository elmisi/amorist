#!/usr/bin/env python3
"""Refuse publication while the approved development delivery is incomplete."""
import json
from pathlib import Path
import sys


def main():
    root=Path(__file__).resolve().parent.parent
    try:
        progress=json.loads((root/'.qa/reports/editor-development-progress.json').read_text(encoding='utf-8'))
        version=(root/'VERSION').read_text(encoding='utf-8').strip()
    except (OSError, ValueError) as error:
        print(f'Delivery gate cannot read completion evidence: {error}',file=sys.stderr)
        return 1
    errors=[]
    if not isinstance(progress,dict):
        print('Invalid delivery progress record',file=sys.stderr)
        return 1
    if progress.get('deliveryBlocked') is not False:errors.append('delivery remains blocked')
    if progress.get('goalStatus')!='complete':errors.append('approved plan is not complete')
    if progress.get('candidateVersion')!=version:errors.append('candidate version differs from VERSION')
    tasks=progress.get('tasks')
    if not isinstance(tasks,list) or not tasks:errors.append('required task inventory is missing')
    else:
        for task in tasks:
            if not isinstance(task,dict) or task.get('status')!='complete':
                errors.append('unfinished task: '+str(task.get('name','unknown') if isinstance(task,dict) else task))
    if errors:
        print('Publication refused: '+'; '.join(errors),file=sys.stderr)
        return 1
    print(f'Delivery completion evidence permits publication of {version}; explicit manual publication is still required.')
    return 0


if __name__=='__main__':
    sys.exit(main())
