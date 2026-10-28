'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Call immediately after importing Electron, before any app-ready observers,
// safeStorage access, config reads or child processes. No migration,
// downloads or capture: only the explicit packaged metadata enables this profile.
function initializeMemoaTestProfile({ app, metadata, env = process.env, mkdir = fs.mkdirSync }) {
  if (metadata.memoaTest !== true) return false;

  // Keep Electron's internal name stable: macOS safeStorage derives its
  // Keychain service/account from it. Veneta is presentation metadata only.
  app.setName('Memoa Test');
  env.STENOAI_USER_DATA_DIR = env.STENOAI_USER_DATA_DIR
    || path.join(app.getPath('appData'), 'Memoa Test');
  // Electron setPath requires the directory to exist on a fresh installation.
  mkdir(env.STENOAI_USER_DATA_DIR, { recursive: true, mode: 0o700 });
  app.setPath('userData', env.STENOAI_USER_DATA_DIR);
  // Override inherited production ASR caches before backend imports.
  env.HF_HOME = path.join(env.STENOAI_USER_DATA_DIR, 'models', 'huggingface');
  env.HF_HUB_CACHE = path.join(env.HF_HOME, 'hub');
  env.HUGGINGFACE_HUB_CACHE = env.HF_HUB_CACHE;
  env.MEMOA_WHISPER_MODELS_DIR = path.join(env.STENOAI_USER_DATA_DIR, 'models', 'whisper');
  // These roots apply to servers we spawn. The backend still reuses an
  // already-running server on 11434; its store cannot be changed by our env.
  env.OLLAMA_MODELS = path.join(env.STENOAI_USER_DATA_DIR, 'ollama', 'models');
  env.OLLAMA_TMPDIR = path.join(env.STENOAI_USER_DATA_DIR, 'ollama', 'tmp');
  return true;
}

module.exports = { initializeMemoaTestProfile };
