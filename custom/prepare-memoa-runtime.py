#!/usr/bin/env python3
"""Fetch verified build inputs into .local only; never install or launch an app."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
DOWNLOADS = LOCAL / 'downloads'
RUNTIME = LOCAL / 'runtime'


def release(repo, tag):
    endpoint = f'repos/{repo}/releases/{tag}'
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def fetch(asset):
    digest = asset.get('digest', '')
    if not digest.startswith('sha256:'):
        raise RuntimeError('Release asset has no SHA-256 digest')
    target = DOWNLOADS / asset['name']
    if not target.exists():
        with urllib.request.urlopen(asset['browser_download_url'], timeout=120) as response, target.open('xb') as out:
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
    with target.open('rb') as handle:
        actual = hashlib.file_digest(handle, 'sha256').hexdigest()
    if actual != digest.partition(':')[2]:
        raise RuntimeError(f'Checksum mismatch: {target.name}; retained for inspection')
    print(f'Verified: {target.name}', flush=True)
    return target


def main():
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    python_release = release('astral-sh/python-build-standalone', 'latest')
    candidates = [a for a in python_release['assets'] if a['name'].startswith('cpython-3.11.')
                  and a['name'].endswith('-aarch64-apple-darwin-install_only.tar.gz')]
    if len(candidates) != 1:
        raise RuntimeError('Expected exactly one Python 3.11 Apple Silicon archive')
    python_asset = candidates[0]
    archive = fetch(python_asset)
    executable = RUNTIME / 'python/bin/python3.11'
    if not executable.exists():
        # Python's data filter rejects absolute paths and escaping archive links.
        with tarfile.open(archive) as handle:
            handle.extractall(RUNTIME, filter='data')
    subprocess.run([str(executable), '-c', 'import sys; assert sys.version_info[:2] == (3,11); print(sys.version)'], check=True)
    tag = (ROOT / 'custom/BASE').read_text().strip()
    official = release('stenolabs/stenoai', f'tags/{tag}')
    name = f'stenoAI-macos-{tag.removeprefix("v")}-arm64.dmg'
    assets = [a for a in official['assets'] if a['name'] == name]
    if len(assets) != 1:
        raise RuntimeError('Expected exactly one pinned official DMG')
    dmg = fetch(assets[0])
    provenance = {'python_release': python_release['tag_name'], 'python': python_asset,
                  'official_tag': tag, 'official': assets[0]}
    manifest = LOCAL / 'memoa-build-inputs.json'
    if manifest.exists():
        if json.loads(manifest.read_text()) != provenance:
            raise RuntimeError('Build inputs changed; existing manifest retained')
    else:
        manifest.write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'Python: {executable}\nOfficial DMG: {dmg}', flush=True)


if __name__ == '__main__':
    main()
