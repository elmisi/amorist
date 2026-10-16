#!/usr/bin/env python3
"""Generate native AV1 decoder files for Tauri's AppImage bundle."""
import json
from pathlib import Path
import platform
import re
import subprocess
import sys


def main():
    if sys.platform != 'linux' or len(sys.argv) != 2:
        raise SystemExit('Usage on Linux: prepare-appimage.py <new-config.json>')
    directories = [Path('/usr/lib') / (platform.machine() + '-linux-gnu') / 'libheif/plugins',
                   Path('/usr/lib64/libheif/plugins'), Path('/usr/lib/libheif/plugins')]
    plugin = next((directory / name for directory in directories
                   for name in ['libheif-aomdec.so', 'libheif-dav1d.so']
                   if (directory / name).is_file()), None)
    if plugin is None:
        raise SystemExit('No native libheif AV1 plugin found. Install libheif-plugin-aomdec or libheif-plugin-dav1d before packaging.')
    files = {'usr/lib/amorist/heif/plugins/' + plugin.name: str(plugin)}
    sources = {plugin.resolve()}
    dependencies = subprocess.check_output(['ldd', str(plugin)], text=True)
    if 'not found' in dependencies:
        raise SystemExit('AV1 plugin has missing shared libraries: ' + dependencies)
    system_libraries = ('libc.so', 'libm.so', 'libdl.so', 'libpthread.so', 'librt.so',
                        'libgcc_s.so', 'libstdc++.so', 'ld-linux')
    for line in dependencies.splitlines():
        match = re.match(r'\s*(\S+) => (/\S+) \(', line)
        if match and not match[1].startswith(system_libraries):
            source = Path(match[2])
            files['usr/lib/' + match[1]] = str(source)
            sources.add(source.resolve())
    for source in sorted(sources):
        owner = subprocess.check_output(['dpkg-query', '-S', str(source)], text=True).split(': ', 1)[0].split(':')[0]
        copyright_file = Path('/usr/share/doc') / owner / 'copyright'
        if not copyright_file.is_file():
            raise SystemExit('Missing license notice for ' + owner)
        files['usr/share/doc/' + owner + '/copyright'] = str(copyright_file)
    with Path(sys.argv[1]).open('x', encoding='utf-8') as output:
        json.dump({'bundle': {'linux': {'appimage': {'files': files}}}}, output, indent=2)
        output.write('\n')
    print('Prepared AV1 plugin and dependencies: ' + plugin.name)


if __name__ == '__main__':
    main()
