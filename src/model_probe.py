"""'Test dit model': one function, one model, one fixed synthetic conversation.

Runs only on explicit request and only against the local Ollama, through the same code paths
the real function uses (summary prompt, detail-level preparation, checklist evaluation). The
conversation below is invented and ships with the app; no user data is read. The result is
content-free: whether the answer was valid, how long it took and a reason code on failure.
Nothing is downloaded and the saved configuration is never changed.
"""
import hashlib
import re
import threading
import time

from .function_models import effective_model
from .model_catalog import FUNCTIONS, ModelNameError, is_cloud_name, validate_model_name

# Invented dialogue (seller = the advisor, other = the customer). It says so itself.
SEGMENTS = [
    ('seller', 'Dit is een synthetisch proefgesprek zonder echte klanten.'),
    ('seller', 'Het Lenteplan kost twaalf euro per maand, inclusief onderhoud.'),
    ('other', 'Dat is duidelijk, en hoe lang loopt zo een abonnement?'),
    ('seller', 'Het abonnement loopt een jaar en verlengt daarna maandelijks.'),
    ('other', 'Prima. Kan ik tussentijds stoppen?'),
    ('seller', 'Opzeggen kan na het eerste jaar met een maand opzegtermijn.'),
    ('other', 'Oké, dan nemen we het Lenteplan. Stuur maar een offerte.'),
    ('seller', 'Ik stuur morgen de offerte en bel volgende week om te horen of alles klopt.'),
]
CRITERIA = [
    {'id': 'c1', 'label': 'De prijs is toegelicht', 'required': True},
    {'id': 'c2', 'label': 'De looptijd is toegelicht', 'required': True},
    {'id': 'c3', 'label': 'De opzegtermijn is toegelicht', 'required': True},
]
SUMMARY_SECTIONS = [
    {'id': 'overview', 'title': 'Samenvatting', 'full': (
        'Dit synthetische proefgesprek gaat over het Lenteplan. '
        'De prijs is twaalf euro per maand inclusief onderhoud. '
        'Het abonnement loopt een jaar en verlengt daarna maandelijks. '
        'De klant kiest het Lenteplan en vraagt om een offerte.')},
    {'id': 'afspraken', 'title': 'Afspraken', 'full': (
        'De adviseur stuurt morgen de offerte. '
        'Volgende week belt de adviseur om te controleren of alles klopt.')},
]

ALLOWED_REASONS = frozenset({
    'server_unreachable', 'server_start_failed', 'model_missing', 'model_not_local', 'timeout',
    'invalid_answer', 'invalid_structure', 'empty_answer', 'not_json', 'wrong_shape', 'truncated', 'provider_not_local', 'invalid_request', 'too_long',
    'provider_unavailable', 'failed'})


def _checklist_request():
    segments = [{'id': f's{i}', 'text': text, 'speaker': speaker, 'start': i * 5, 'end': i * 5 + 4}
                for i, (speaker, text) in enumerate(SEGMENTS, 1)]
    return {'sessionId': 'synthetisch-proefgesprek', 'revision': 'proef-1', 'mappingConfirmed': True,
            'criteria': [dict(c) for c in CRITERIA], 'segments': segments}


def _fold_request():
    digest = hashlib.sha256('|'.join(s['full'] for s in SUMMARY_SECTIONS).encode()).hexdigest()
    return {'schemaVersion': 2, 'sourceHash': digest, 'sections': [dict(s) for s in SUMMARY_SECTIONS]}


def _transcript():
    names = {'seller': 'Adviseur', 'other': 'Klant'}
    return '\n'.join(f'{names[speaker]}: {text}' for speaker, text in SEGMENTS)


def _make_summarizer(model, endpoint, config):
    """The real summarizer class, wired to the local endpoint, that can never pull a model."""
    import ollama
    from .summarizer import OllamaSummarizer
    from .veneta_checklist import CHAT_TIMEOUT_SECONDS

    class ProbeSummarizer(OllamaSummarizer):
        def __init__(self):  # no super().__init__: that one starts services and may download
            self._summary_config = config
            self.ai_provider = 'local'
            self.client = ollama.Client(host=endpoint, timeout=CHAT_TIMEOUT_SECONDS,
                                        follow_redirects=False, trust_env=False)
            self.cloud_client = self.anthropic_client = self.cloud_provider = self.ollama_process = None
            self.remote_url = None
            self.model_name = model

        def _ensure_ollama_ready(self):
            return True

        def cleanup(self):
            try:
                self.client._client.close()
            except Exception:
                pass

        def __del__(self):
            pass

    return ProbeSummarizer()


def _probe_checklist(config, port):
    from .veneta_checklist import evaluate
    result = evaluate(_checklist_request(), config=config, model_port=port)
    return None if 'error' not in result else result.get('reason', 'failed')


def _probe_fold(model, config, port):
    from .config import resolve_runtime_tag
    from .summary_folding import FoldError, prepare_folding
    tag = resolve_runtime_tag(model)
    port._ensure_server(tag)
    summarizer = _make_summarizer(tag, port.endpoint, config)
    try:
        prepare_folding(_fold_request(), summarizer)
    except FoldError as error:
        return error.reason
    finally:
        summarizer.cleanup()
    return None


def _probe_summary(model, config, port):
    from .config import resolve_runtime_tag
    tag = resolve_runtime_tag(model)
    port._ensure_server(tag)
    summarizer = _make_summarizer(tag, port.endpoint, config)
    try:
        prompt = summarizer._create_markdown_prompt(_transcript(), 'auto')
        text = ''.join(summarizer._stream_direct(prompt))
    finally:
        summarizer.cleanup()
    if re.search(r'^## Summary[ \t]*\n+[ \t]*\S', text, re.M) is None:
        return 'invalid_answer'
    return None


def _reason_of(error):
    from .summary_folding import FoldError
    from .veneta_checklist import _classify
    reason = error.reason if isinstance(error, FoldError) else _classify(error)
    return reason if reason in ALLOWED_REASONS else 'failed'


def _attempt(function, model, endpoint, config):
    from .veneta_checklist import OllamaModelPort
    port = OllamaModelPort(endpoint)
    if function == 'checklist':
        return _probe_checklist(config, port)
    if function == 'summary_fold':
        return _probe_fold(model, config, port)
    return _probe_summary(model, config, port)


def run_probe(function, config, endpoint=None, timeout_s=300):
    """Run the fixture through ``function`` on its effective model. Always returns a result dict."""
    started = time.monotonic()
    model = ''

    def result(reason):
        return {'function': function if isinstance(function, str) else '', 'model': model,
                'valid': reason is None, 'ms': int((time.monotonic() - started) * 1000),
                'reason': reason}

    if function not in FUNCTIONS:
        return result('invalid_request')
    try:
        if config.get_ai_provider() != 'local':
            return result('provider_not_local')
        model = effective_model(config, function)
        validate_model_name(model)
        if is_cloud_name(model):
            raise ModelNameError('cloud')
    except Exception:
        return result('failed')
    outcome = {}

    def work():
        try:
            outcome['reason'] = _attempt(function, model, endpoint, config)
        except Exception as error:
            outcome['reason'] = _reason_of(error)

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(timeout_s)
    if thread.is_alive():
        return result('timeout')
    reason = outcome.get('reason', 'failed')
    return result(reason if reason is None or reason in ALLOWED_REASONS else 'failed')
