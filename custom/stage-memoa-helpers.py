#!/usr/bin/env python3
"""Stage verified native build inputs without replacing existing directories."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
OFFICIAL = LOCAL / 'official/StenoAI.app'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def validate(app, version):
    run(['codesign', '--verify', '--deep', '--strict', str(app)])
    result = run(['codesign', '-dv', str(app)], capture_output=True, text=True)
    if 'TeamIdentifier=HSDX294RG4' not in result.stderr:
        raise RuntimeError('Official signature is not from the expected team')
    actual = subprocess.check_output(['/usr/libexec/PlistBuddy', '-c',
        'Print CFBundleShortVersionString', str(app / 'Contents/Info.plist')], text=True).strip()
    if actual != version:
        raise RuntimeError('Official version mismatch')
    run(['spctl', '--assess', '--type', 'execute', str(app)])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--official-only', action='store_true')
    parser.add_argument('--source-built-helper', type=Path)
    args = parser.parse_args()
    inputs = json.loads((LOCAL / 'memoa-build-inputs.json').read_text())
    version = inputs['official_tag'].removeprefix('v')
    archive = LOCAL / 'downloads' / inputs['official']['name']
    with archive.open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    if 'sha256:' + digest != inputs['official']['digest']:
        raise RuntimeError('Official DMG checksum mismatch')
    if not OFFICIAL.exists():
        OFFICIAL.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='memoa-official-', dir=os.environ['TMPDIR']) as directory:
            mount = Path(directory) / 'mount'
            mount.mkdir()
            run(['hdiutil', 'attach', '-nobrowse', '-readonly', '-mountpoint', str(mount), str(archive)])
            try:
                validate(mount / 'StenoAI.app', version)
                run(['ditto', str(mount / 'StenoAI.app'), str(OFFICIAL)])
            finally:
                run(['hdiutil', 'detach', str(mount), '-quiet'])
    validate(OFFICIAL, version)
    if args.official_only:
        print('Official app verified and staged locally; no app installed.')
        return
    internal = OFFICIAL / 'Contents/Resources/stenoai/_internal'
    native = ROOT / 'bin'
    if native.exists():
        raise RuntimeError('bin already exists; refusing to replace native inputs')
    pin = dict(line.split('=', 1) for line in (ROOT / 'custom/DIARIZE_HELPER').read_text().splitlines()
               if line and not line.startswith('#') and '=' in line)
    pinned = args.source_built_helper or LOCAL / 'helpers/steno-diarize'
    if not pinned.exists():
        raise RuntimeError('Pinned Nemotron-capable helper must be fetched first')
    with pinned.open('rb') as handle:
        digest = hashlib.file_digest(handle, 'sha256').hexdigest()
    if args.source_built_helper:
        if not pinned.resolve().is_relative_to((LOCAL / 'swift-diarize').resolve()):
            raise RuntimeError('Source-built helper must come from this project build')
        run(['git', 'diff', '--exit-code', 'HEAD', '--', 'diarize-sidecar'], cwd=ROOT)
        tree = subprocess.check_output(['git', 'rev-parse', 'HEAD:diarize-sidecar'], cwd=ROOT, text=True).strip()
        build_inputs = {'source_tree': tree, 'sha256': digest,
                        'dependency_lock': json.loads((ROOT / 'diarize-sidecar/Package.resolved').read_text())}
        manifest = LOCAL / 'memoa-diarization-build.json'
        if manifest.exists() and json.loads(manifest.read_text()) != build_inputs:
            raise RuntimeError('Source-built helper provenance changed; refusing replacement')
        if not manifest.exists():
            manifest.write_text(json.dumps(build_inputs, indent=2) + '\n')
    elif digest != pin['sha256']:
        raise RuntimeError('Pinned diarization helper checksum mismatch')
    shutil.copytree(internal / 'ollama', native, symlinks=True)
    for name in ['ffmpeg', 'steno-diarize', 'steno-audio-encode']:
        shutil.copy2(internal / name, native / name)
    # Only this freshly staged official helper is replaced by the approved pin.
    shutil.copy2(pinned, native / 'steno-diarize')
    (native / '.official-version').write_text(version + '\n')
    print('Verified official helpers and checked Nemotron helper staged; no app installed.')


if __name__ == '__main__':
    main()
