"""Build macOS icon sizes from the approved 1024px Veneta master PNG."""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'app' / 'veneta-assets'
MASTER = ASSETS / 'app-icon-1024.png'
if not MASTER.is_file():
    raise FileNotFoundError(MASTER)
with tempfile.TemporaryDirectory(prefix='veneta-icon-', dir=os.environ['TMPDIR']) as directory:
    iconset = Path(directory) / 'veneta.iconset'
    iconset.mkdir()
    for points in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            pixels = points * scale
            suffix = '@2x' if scale == 2 else ''
            target = iconset / f'icon_{points}x{points}{suffix}.png'
            subprocess.run(['/usr/bin/sips', '-z', str(pixels), str(pixels), str(MASTER),
                            '--out', str(target)], check=True, capture_output=True)
    output = ASSETS / 'app-icon.icns'
    subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(output)], check=True)
    print(output)
