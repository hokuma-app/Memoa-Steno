"""Build macOS icon sizes from the approved 1024px Veneta master PNG."""
from pathlib import Path
import os
import subprocess
import tempfile
import argparse
import struct
import zlib


def read_rgba(file):
    """Read sips' non-interlaced 8-bit RGBA PNG using only the standard library."""
    data = file.read_bytes()
    width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', data[16:29])
    if (depth, color, interlace) != (8, 6, 0):
        raise ValueError('Expected non-interlaced RGBA8 PNG from sips')
    chunks = []
    offset = 8
    while offset < len(data):
        size = struct.unpack('>I', data[offset:offset + 4])[0]
        if data[offset + 4:offset + 8] == b'IDAT':
            chunks.append(data[offset + 8:offset + 8 + size])
        offset += size + 12
    raw = zlib.decompress(b''.join(chunks))
    stride = width * 4
    pixels = bytearray(height * stride)
    for y in range(height):
        kind = raw[y * (stride + 1)]
        for x in range(stride):
            i = y * stride + x
            a = pixels[i - 4] if x >= 4 else 0
            b = pixels[i - stride] if y else 0
            c = pixels[i - stride - 4] if x >= 4 and y else 0
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            paeth = a if pa <= pb and pa <= pc else b if pb <= pc else c
            predictor = (0, a, b, (a + b) // 2, paeth)[kind]
            pixels[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 255
    return width, height, pixels


def write_rgba(file, width, height, pixels):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    rows = b''.join(b'\x00' + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    file.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def build_tray(directory):
    # Keep trayIcon prefix: the existing extraResources filter is trayIcon*.png.
    for scale in (1, 2):
        size = 18 * scale
        temporary = Path(directory) / f'tray-{size}.png'
        subprocess.run(['/usr/bin/sips', '-z', str(size), str(size), str(MASTER),
                        '--out', str(temporary)], check=True, capture_output=True)
        width, height, pixels = read_rgba(temporary)
        suffix = '@2x' if scale == 2 else ''
        target = ROOT / 'app' / 'assets' / f'trayIconVeneta{suffix}.png'
        write_rgba(target, width, height, pixels)
        print(target)
        # Lower-right badge with a black rim. Supersample just the badge edge,
        # leaving the approved V and the rest of the yellow tile untouched.
        for y in range(height):
            for x in range(width):
                samples = []
                for sy in range(4):
                    for sx in range(4):
                        dx = (x + (sx + .5) / 4) / scale - 14.5
                        dy = (y + (sy + .5) / 4) / scale - 14.5
                        radius2 = dx * dx + dy * dy
                        samples.append((229, 40, 40, 255) if radius2 <= 2.15 ** 2
                                       else (0, 0, 0, 255) if radius2 <= 2.8 ** 2 else None)
                i = (y * width + x) * 4
                original = pixels[i:i + 4]
                if any(sample is not None for sample in samples):
                    pixels[i:i + 4] = bytes(round(sum((sample or original)[c] for sample in samples) / 16) for c in range(4))
        target = ROOT / 'app' / 'assets' / f'trayIconVenetaRecording{suffix}.png'
        write_rgba(target, width, height, pixels)
        print(target)


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'app' / 'veneta-assets'
MASTER = ASSETS / 'app-icon-1024.png'
if not MASTER.is_file():
    raise FileNotFoundError(MASTER)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--tray-only', action='store_true', help='Generate tray PNGs without rebuilding the app ICNS')
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='veneta-icon-', dir=os.environ['TMPDIR']) as directory:
    build_tray(directory)
    if args.tray_only:
        raise SystemExit(0)
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
