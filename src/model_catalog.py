"""Model catalogue, name validation and installed-model discovery.

Three jobs, all read-only and local-first:

* A data-driven catalogue (``src/data/model_catalog.json``) of recommended and candidate models,
  validated against a strict schema because the app trusts it to build download commands.
* Validation of model names typed by the user (an Ollama name or ``hf.co/<org>/<repo>[:quant]``).
  Cloud references and anything that implies a remote model are refused.
* Discovery of what is installed on this machine, straight from Ollama ``/api/tags``, plus
  an optional size lookup in the public registry manifest and a disk-space check.

Nothing here downloads a model or starts a service.
"""
import json
import os
import re
import shutil
import sys
from pathlib import Path

CATALOG_SCHEMA_VERSION = 1
MAX_NAME_CHARS = 200
MAX_METADATA_BYTES = 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
FUNCTIONS = ('summary', 'summary_fold', 'checklist', 'agenda')
STATUSES = ('aanbevolen', 'kandidaat')
DEVICE_CLASSES = ('klein', 'mac')
TAG_KINDS = ('gguf', 'nvfp4')
LOCAL_FORMATS = frozenset({'gguf', 'safetensors'})
DEFAULT_ENDPOINT = 'http://127.0.0.1:11434'
DEFAULT_BASES = {'registry': 'https://registry.ollama.ai', 'hf': 'https://hf.co'}
MANIFEST_ACCEPT = 'application/vnd.docker.distribution.manifest.v2+json'
GIB = 1024 ** 3
MIN_FREE_UNKNOWN_SIZE = 2 * GIB

_SEGMENT = r'[A-Za-z0-9][A-Za-z0-9._-]*'
_OLLAMA = re.compile(rf'(?:{_SEGMENT}/)?{_SEGMENT}(?::{_SEGMENT})?')
_HF = re.compile(r'hf\.co/([A-Za-z0-9][A-Za-z0-9._-]{0,95})/([A-Za-z0-9][A-Za-z0-9._-]{0,95})'
                 r'(?::([A-Za-z0-9][A-Za-z0-9._-]{0,63}))?')
_CLOUD_TOKEN = re.compile(r'[:/_.\-]')


class ModelNameError(ValueError):
    """A refused model name; ``reason`` is a content-free code the interface maps to copy."""

    def __init__(self, reason='invalid'):
        super().__init__(reason)
        self.reason = reason


class CatalogError(ValueError):
    """The catalogue file is missing, unreadable or breaks the schema."""


def is_cloud_name(name):
    """True when any dash/colon/slash separated token of the name is exactly ``cloud``."""
    return isinstance(name, str) and 'cloud' in _CLOUD_TOKEN.split(name.lower())


def validate_model_name(name):
    """Return ``{'name', 'kind'}`` for an acceptable Ollama or Hugging Face reference, else raise."""
    if not isinstance(name, str):
        raise ModelNameError('invalid')
    name = name.strip()
    if not name:
        raise ModelNameError('empty')
    if len(name) > MAX_NAME_CHARS:
        raise ModelNameError('too_long')
    if is_cloud_name(name):
        raise ModelNameError('cloud')
    if name.startswith('hf.co/'):
        if not _HF.fullmatch(name):
            raise ModelNameError('invalid')
        return {'name': name, 'kind': 'hf'}
    if not _OLLAMA.fullmatch(name):
        raise ModelNameError('invalid')
    return {'name': name, 'kind': 'ollama'}


def normalise_tag(name):
    """Ollama stores an untagged name as ``:latest``; compare names on that basis."""
    if isinstance(name, str) and ':' not in name.rsplit('/', 1)[-1]:
        return name + ':latest'
    return name


# --- Catalogue -------------------------------------------------------------------------------

_ENTRY_KEYS = {'id', 'name', 'publisher', 'size_bytes', 'license', 'source_url', 'ollama_tags',
               'hf_repo', 'functions', 'device_class', 'status', 'note'}
_OPTIONAL_ENTRY_KEYS = {'nvfp4_size_bytes'}
_ID = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
_HF_REPO = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}')


def _fail(message):
    raise CatalogError(message)


def _text(value, label, maximum=500, *, empty=False):
    if not isinstance(value, str) or len(value) > maximum or (not empty and not value.strip()):
        _fail(f'{label}: ongeldige tekst')
    return value


def _size(value, label, *, nullable=False):
    if value is None and nullable:
        return
    if type(value) is not int or value <= 0:
        _fail(f'{label}: ongeldige grootte')


def _validate_entry(entry, index):
    where = f'models[{index}]'
    if not isinstance(entry, dict):
        _fail(f'{where}: geen object')
    keys = set(entry)
    if not _ENTRY_KEYS <= keys or not keys <= _ENTRY_KEYS | _OPTIONAL_ENTRY_KEYS:
        _fail(f'{where}: ongeldige velden')
    if not isinstance(entry['id'], str) or not _ID.fullmatch(entry['id']):
        _fail(f'{where}: ongeldig id')
    for key, maximum in (('name', 100), ('publisher', 100), ('license', 100), ('note', 500)):
        _text(entry[key], f'{where}.{key}', maximum, empty=key == 'note')
    _size(entry['size_bytes'], f'{where}.size_bytes', nullable=True)
    if 'nvfp4_size_bytes' in entry:
        _size(entry['nvfp4_size_bytes'], f'{where}.nvfp4_size_bytes')
    source = _text(entry['source_url'], f'{where}.source_url', 300)
    if not source.startswith('https://') or any(c.isspace() for c in source):
        _fail(f'{where}.source_url: alleen https')
    repo = entry['hf_repo']
    if not isinstance(repo, str) or (repo and not _HF_REPO.fullmatch(repo)):
        _fail(f'{where}.hf_repo: ongeldig')
    functions = entry['functions']
    if (not isinstance(functions, list) or not functions or len(set(functions)) != len(functions)
            or any(f not in FUNCTIONS for f in functions)):
        _fail(f'{where}.functions: ongeldig')
    if entry['device_class'] not in DEVICE_CLASSES:
        _fail(f'{where}.device_class: ongeldig')
    if entry['status'] not in STATUSES:
        _fail(f'{where}.status: ongeldig')
    tags = entry['ollama_tags']
    if not isinstance(tags, dict) or not set(tags) <= set(TAG_KINDS):
        _fail(f'{where}.ollama_tags: ongeldig')
    for kind, tag in tags.items():
        try:
            validate_model_name(tag)
        except ModelNameError:
            _fail(f'{where}.ollama_tags.{kind}: ongeldige of cloud-naam')
    if 'nvfp4_size_bytes' in entry and 'nvfp4' not in tags:
        _fail(f'{where}: nvfp4-grootte zonder nvfp4-tag')


def validate_catalog(data):
    """Strict schema check; returns the data unchanged or raises ``CatalogError``."""
    if not isinstance(data, dict) or not {'schema_version', 'models'} <= set(data) \
            or not set(data) <= {'schema_version', 'updated', 'note', 'models'}:
        _fail('catalogus: ongeldige velden')
    if type(data['schema_version']) is not int or data['schema_version'] != CATALOG_SCHEMA_VERSION:
        _fail('catalogus: onbekende schemaversie')
    models = data['models']
    if not isinstance(models, list) or not models or len(models) > 200:
        _fail('catalogus: geen modellen')
    seen = set()
    for index, entry in enumerate(models):
        _validate_entry(entry, index)
        if entry['id'] in seen:
            _fail(f'models[{index}]: dubbel id')
        seen.add(entry['id'])
    return data


def _default_catalog_path():
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / 'src' / 'data' / 'model_catalog.json'
    return Path(__file__).resolve().parent / 'data' / 'model_catalog.json'


def load_catalog(path=None):
    """Read and validate the catalogue file (the shipped one by default)."""
    target = Path(path) if path is not None else _default_catalog_path()
    try:
        raw = target.read_bytes()
        if len(raw) > MAX_METADATA_BYTES:
            _fail('catalogus te groot')
        data = json.loads(raw.decode('utf-8'))
    except CatalogError:
        raise
    except (OSError, ValueError):
        raise CatalogError('catalogus kon niet worden gelezen') from None
    return validate_catalog(data)


# --- Installed models ------------------------------------------------------------------------

def parse_tags(payload):
    """Normalise an Ollama ``/api/tags`` payload; ``local`` is True only for a provably local row."""
    if not isinstance(payload, dict) or not isinstance(payload.get('models'), list):
        return []
    rows = []
    for raw in payload['models']:
        if not isinstance(raw, dict) or not isinstance(raw.get('name'), str) or not raw['name']:
            continue
        details = raw.get('details') if isinstance(raw.get('details'), dict) else {}
        size = raw.get('size')
        size = size if type(size) is int and size > 0 else 0
        digest = raw.get('digest')
        remote = any(key in raw for key in ('remote_host', 'remote_model'))
        local = (not remote and not is_cloud_name(raw['name']) and size > 0
                 and isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest) is not None
                 and details.get('format') in LOCAL_FORMATS)
        rows.append({
            'name': raw['name'], 'size_bytes': size,
            'format': details.get('format') if isinstance(details.get('format'), str) else '',
            'quantization': details.get('quantization_level')
            if isinstance(details.get('quantization_level'), str) else '',
            'parameter_size': details.get('parameter_size')
            if isinstance(details.get('parameter_size'), str) else '',
            'remote': remote, 'local': bool(local),
        })
    return rows


def _local_endpoint(endpoint):
    from .veneta_checklist import validate_endpoint
    value = endpoint if endpoint is not None else os.environ.get('OLLAMA_HOST', DEFAULT_ENDPOINT)
    if isinstance(value, str) and value.strip() and '://' not in value:
        value = 'http://' + value.strip()
    return validate_endpoint(value)


def read_installed(endpoint=None, timeout=5):
    """One GET of ``/api/tags`` on the local server. Never starts Ollama, never writes."""
    empty = {'running': False, 'models': []}
    try:
        import httpx
        base = _local_endpoint(endpoint)
        with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False,
                          headers={'accept-encoding': 'identity'}) as client:
            with client.stream('GET', base + '/api/tags') as response:
                if response.status_code != 200:
                    return empty
                content = bytearray()
                for chunk in response.iter_raw():
                    content.extend(chunk)
                    if len(content) > MAX_METADATA_BYTES:
                        return empty
        payload = json.loads(content.decode('utf-8'))
    except Exception:
        return empty
    if not isinstance(payload, dict) or not isinstance(payload.get('models'), list):
        return empty
    return {'running': True, 'models': parse_tags(payload)}


# --- Size before download --------------------------------------------------------------------

def manifest_url(name, bases=None):
    """Registry manifest URL for a validated name (Ollama registry or the hf.co registry front)."""
    bases = {**DEFAULT_BASES, **(bases or {})}
    info = validate_model_name(name)
    if info['kind'] == 'hf':
        match = _HF.fullmatch(info['name'])
        org, repo, quant = match.group(1), match.group(2), match.group(3) or 'latest'
        return f"{bases['hf']}/v2/{org}/{repo}/manifests/{quant}"
    repo, _, tag = info['name'].partition(':')
    if '/' not in repo:
        repo = 'library/' + repo
    return f"{bases['registry']}/v2/{repo}/manifests/{tag or 'latest'}"


def registry_size(name, bases=None, timeout=5):
    """Download size in bytes from the public manifest, or None when it cannot be determined.

    One read-only GET. A failure of any kind (network, status, shape) is "unknown", never a guess.
    """
    try:
        url = manifest_url(name, bases)
        import httpx
        with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=True, max_redirects=3,
                          headers={'Accept': MANIFEST_ACCEPT, 'accept-encoding': 'identity'}) as client:
            with client.stream('GET', url) as response:
                if response.status_code != 200 or response.url.scheme != httpx.URL(url).scheme:
                    return None
                content = bytearray()
                for chunk in response.iter_raw():
                    content.extend(chunk)
                    if len(content) > MAX_MANIFEST_BYTES:
                        return None
        manifest = json.loads(content.decode('utf-8'))
    except Exception:
        return None
    if not isinstance(manifest, dict) or not isinstance(manifest.get('layers'), list) \
            or not manifest['layers']:
        return None
    sizes = [layer.get('size') if isinstance(layer, dict) else None for layer in manifest['layers']]
    config = manifest.get('config')
    sizes.append(config.get('size', 0) if isinstance(config, dict) else 0)
    if any(type(size) is not int or size < 0 for size in sizes):
        return None
    return sum(sizes)


# --- Disk space ------------------------------------------------------------------------------

def _models_dir():
    configured = os.environ.get('OLLAMA_MODELS')
    path = Path(configured) if configured else Path.home() / '.ollama'
    while not path.exists() and path != path.parent:
        path = path.parent
    return path


def check_disk_space(size_bytes, path=None, free_bytes=None):
    """Is there room for a download of ``size_bytes`` (None = unknown) plus a safety margin?"""
    if free_bytes is None:
        free_bytes = shutil.disk_usage(path if path is not None else _models_dir()).free
    needed = MIN_FREE_UNKNOWN_SIZE if size_bytes is None else size_bytes + max(size_bytes // 10, GIB)
    return {'ok': free_bytes >= needed and free_bytes > (size_bytes or 0),
            'free_bytes': int(free_bytes), 'needed_bytes': int(needed)}


# --- Usage by functions ----------------------------------------------------------------------

def functions_in_use(model, choices, apple_silicon=None):
    """Functions whose chosen model runs as ``model`` (after the Apple Silicon runtime-tag mapping)."""
    from .config import Config, is_apple_silicon
    if apple_silicon is None:
        apple_silicon = is_apple_silicon()
    target = normalise_tag(model)

    def runtime(choice):
        return Config._MLX_EQUIVALENTS.get(choice, choice) if apple_silicon else choice

    return [function for function, choice in choices.items()
            if isinstance(choice, str) and normalise_tag(runtime(choice)) == target]
