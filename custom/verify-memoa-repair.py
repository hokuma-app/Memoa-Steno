"""Run the focused Memoa repair suites without using the live app's data."""
import contextlib
import io
import json
import logging
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.local' / 'memoa-repair-checks'
OUT.mkdir(parents=True, exist_ok=True)
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
DATA = tempfile.TemporaryDirectory(prefix='memoa-repair-', dir=os.environ['TMPDIR'])
os.environ['STENOAI_USER_DATA_DIR'] = DATA.name
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
patterns = [
    'test_reprocess_*.py', 'test_full_reprocess_cli.py', 'test_retranscribe*.py',
    'test_obsidian_sync*.py', 'test_meeting_context.py', 'test_openai_asr_jobs.py',
    'test_memoa_model_isolation.py', 'test_whisper_models.py',
    'test_parakeet*.py', 'test_ollama*.py', 'test_live*.py',
]
loader = unittest.TestLoader()
suite = unittest.TestSuite()
for pattern in patterns:
    suite.addTests(loader.discover(str(ROOT / 'tests'), pattern=pattern))
log = io.StringIO()
with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
    logging.basicConfig(stream=log, level=logging.WARNING, force=True)
    result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
(OUT / 'python.log').write_text(log.getvalue())
summary = {'python': {'run': result.testsRun, 'failures': len(result.failures),
    'errors': len(result.errors), 'skipped': len(result.skipped), 'ok': result.wasSuccessful()}}
if not result.wasSuccessful():
    print(log.getvalue()[-16000:])
args = shlex.split(json.loads((ROOT / 'app/package.json').read_text())['scripts']['test:unit:main'])
args.insert(2, '--test-reporter=tap')
node = subprocess.run(args, cwd=ROOT / 'app', capture_output=True, text=True,
    env={**os.environ, 'STENOAI_TEST_PYTHON': sys.executable})
(OUT / 'node.tap').write_text(node.stdout + node.stderr)
summary['node'] = {'exit': node.returncode,
    'stats': dict((k, int(v)) for k, v in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', node.stdout, re.M)),
    'failures': re.findall(r'^not ok \d+ - (.+)$', node.stdout, re.M)}
for name, command in [
    ('lint_main', ['npm', 'run', 'lint:main']),
    ('typecheck', ['npm', 'run', 'typecheck:renderer']),
    ('renderer', ['npm', 'run', 'test:unit:renderer', '--', '--reporter=json', '--outputFile=' + str(OUT / 'renderer.json')]),
]:
    check = subprocess.run(command, cwd=ROOT / 'app', capture_output=True, text=True)
    (OUT / (name + '.log')).write_text(check.stdout + check.stderr)
    summary[name] = {'exit': check.returncode}
check = subprocess.run(['git', 'diff', '--check'], capture_output=True, text=True)
summary['diff_check'] = {'exit': check.returncode, 'output': check.stdout + check.stderr}
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))
sys.exit(not (result.wasSuccessful() and node.returncode == 0 and check.returncode == 0
    and all(summary[name]['exit'] == 0 for name in ('lint_main', 'typecheck', 'renderer'))))
