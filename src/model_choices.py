"""Backend of Settings > AI > "Model per functie": the data behind the pickers and the guards.

* ``build_choices``: what each function runs, what is installed (live from Ollama) and the
  catalogue entries, with their install state and the exact tag a download would fetch.
* ``choose_model``: store the choice of one function.
* ``preview_addition``: validate a typed name and show its size before anything is downloaded.
* ``guard_pull`` and ``guard_delete``: refuse what must never reach Ollama.

Everything here is read-only apart from the config write in ``choose_model``. The module
looks up ``model_catalog`` members at call time so tests can substitute the network edges.
"""
from . import model_catalog as mc

PULL_LOOKUP_TIMEOUT = 4
ERRORS = {
    'cloud': 'Cloudmodellen zijn niet toegestaan: alleen lokale modellen.',
    'invalid': 'Dit is geen geldige modelnaam.',
    'empty': 'Vul een modelnaam in.',
    'too_long': 'De modelnaam is te lang.',
    'disk_full': 'Er is niet genoeg schijfruimte voor deze download.',
    'in_use': 'Dit model is nog gekozen voor een functie.',
    'not_installed': 'Dit model staat niet lokaal op deze Mac.',
}


def _runtime_tag(name):
    from .config import resolve_runtime_tag
    return resolve_runtime_tag(name)


def _effective_map(config):
    return {function: config.get_function_model(function) for function in mc.FUNCTIONS}


def build_choices(config, endpoint=None):
    """Everything the pickers need, in one read."""
    effective = _effective_map(config)
    functions = {function: {'choice': config.get_function_model_choice(function),
                            'effective': effective[function]} for function in mc.FUNCTIONS}
    live = mc.read_installed(endpoint)
    installed = []
    for row in live['models']:
        if not row['local']:
            continue
        installed.append({
            'name': row['name'], 'size_bytes': row['size_bytes'], 'format': row['format'],
            'quantization': row['quantization'], 'parameter_size': row['parameter_size'],
            'functions': mc.functions_in_use(row['name'], effective)})
    names = {mc.normalise_tag(row['name']) for row in installed}
    catalog, catalog_error = [], None
    try:
        for entry in mc.load_catalog()['models']:
            tags = entry['ollama_tags']
            choice_name = tags.get('gguf') or tags.get('nvfp4') or ''
            pull_tag = _runtime_tag(choice_name) if choice_name else ''
            size = entry['size_bytes']
            if pull_tag and pull_tag == tags.get('nvfp4') and entry.get('nvfp4_size_bytes'):
                size = entry['nvfp4_size_bytes']
            catalog.append({
                'id': entry['id'], 'name': entry['name'], 'publisher': entry['publisher'],
                'size_bytes': entry['size_bytes'], 'license': entry['license'],
                'source_url': entry['source_url'], 'hf_repo': entry['hf_repo'],
                'functions': entry['functions'], 'device_class': entry['device_class'],
                'status': entry['status'], 'note': entry['note'],
                'choice_name': choice_name, 'pull_tag': pull_tag, 'pull_size_bytes': size,
                'installed': bool(pull_tag) and mc.normalise_tag(pull_tag) in names})
    except mc.CatalogError:
        catalog, catalog_error = [], 'catalog_invalid'
    return {'success': True, 'provider': config.get_ai_provider(), 'functions': functions,
            'server_running': live['running'], 'installed': installed, 'catalog': catalog,
            'catalog_error': catalog_error}


def choose_model(config, function, name):
    """Store one function's choice. Returns the success payload or a refusal with a reason."""
    if function not in mc.FUNCTIONS:
        return {'success': False, 'reason': 'invalid_function'}
    if name == '' and function == 'summary':
        return {'success': False, 'reason': 'empty'}
    if name != '':
        try:
            name = mc.validate_model_name(name)['name']
        except mc.ModelNameError as error:
            return {'success': False, 'reason': error.reason}
    if not config.set_function_model(function, name):
        return {'success': False, 'reason': 'save_failed'}
    return {'success': True, 'function': function,
            'choice': config.get_function_model_choice(function),
            'effective': config.get_function_model(function)}


def _refusal(reason, **extra):
    return dict({'success': False, 'reason': reason, 'error': ERRORS.get(reason, reason)}, **extra)


def preview_addition(name, endpoint=None):
    """Validate a typed name and report its size and the disk situation. Never downloads."""
    try:
        info = mc.validate_model_name(name)
    except mc.ModelNameError as error:
        return _refusal(error.reason)
    name = info['name']
    installed = {mc.normalise_tag(row['name']) for row in mc.read_installed(endpoint)['models']}
    size = mc.registry_size(name)
    return {'success': True, 'name': name, 'kind': info['kind'], 'size_bytes': size,
            'installed': mc.normalise_tag(name) in installed, 'disk': mc.check_disk_space(size)}


def guard_pull(name):
    """None when a download may start, else the refusal to print instead of pulling."""
    try:
        name = mc.validate_model_name(name)['name']
    except mc.ModelNameError as error:
        return _refusal(error.reason)
    size = mc.registry_size(name, timeout=PULL_LOOKUP_TIMEOUT)
    disk = mc.check_disk_space(size)
    if not disk['ok']:
        return _refusal('disk_full', free_bytes=disk['free_bytes'], needed_bytes=disk['needed_bytes'])
    return None


def guard_delete(name, config, endpoint=None):
    """None when a deletion may go ahead, else the refusal. Only local, unused models qualify."""
    from .config import Config
    try:
        name = mc.validate_model_name(name)['name']
    except mc.ModelNameError as error:
        return _refusal(error.reason)
    known = set(config.list_supported_models()) | set(Config._MLX_EQUIVALENTS.values())
    if name not in known:
        local = {row['name'] for row in mc.read_installed(endpoint)['models'] if row['local']}
        if name not in local:
            return {'success': False, 'reason': 'not_installed',
                    'error': f'Refusing to delete unsupported model: {name}'}
    users = mc.functions_in_use(name, _effective_map(config))
    if users:
        return _refusal('in_use', functions=users)
    return None
