"""Which model a function runs, and the local-only guard shared by the functions that need it.

Summary, detail levels (``summary_fold``), the conversation checklist and the agenda chair each
have an optional model choice; the default is "same as the summary", for the agenda "same as the
checklist" (see ``Config.get_function_model``).
"""


def effective_model(config, function):
    """The model ``function`` runs.

    Tolerates a config object that only offers ``get_model`` (older callers and test doubles):
    anything that is not a non-empty string falls back to the summary model.
    """
    getter = getattr(config, 'get_function_model', None)
    value = None
    if callable(getter):
        try:
            value = getter(function)
        except Exception:
            value = None
    if isinstance(value, str) and value:
        return value
    if function == 'agenda':
        return effective_model(config, 'checklist')
    return config.get_model()


def fold_override(config):
    """The detail-level model choice, only when it applies: a local provider and an explicit choice.

    Remote, cloud and adapter providers keep their own model handling, so a local model name
    never leaks into them.
    """
    try:
        if config.get_ai_provider() != 'local':
            return None
        choice = config.get_function_model_choice('summary_fold')
    except Exception:
        return None
    return choice if isinstance(choice, str) and choice else None


def verify_local_model(model, endpoint=None):
    """Prove from Ollama's own metadata that ``model`` is installed locally; never pulls or starts.

    Returns the runtime tag (Apple Silicon maps curated ids to their MLX tag) or raises
    ``ChecklistError`` with a content-free reason (``model_missing``, ``model_not_local``, ...).
    """
    from .config import resolve_runtime_tag
    from .veneta_checklist import OllamaModelPort
    tag = resolve_runtime_tag(model)
    OllamaModelPort(endpoint)._verify_local_model(tag)
    return tag
