'use strict';

// Visible main-process copy: tray, application menu, native notifications,
// dialogs, updater messages and the user-facing IPC errors listed below.
//
// English is the default build's wording and must stay byte-identical to what
// main.js showed before this catalogue existed (notification-copy.test.js and
// update-error-copy.test.js pin it). The Veneta build (package metadata
// `venetaMemoAi: true`, set by electron-builder.veneta*.cjs) shows the Dutch
// catalogue instead; main-copy.test.js requires a Dutch value with the same
// parameters for every English key.
//
// Never route identifiers through here: the bundle ID, the internal app name
// 'Memoa Test', the data root, file names, log lines and IPC error codes that
// other code compares stay untouched.

const EN = {
  'tray.tooltip': 'StenoAI',
  'tray.tooltipRecording': 'StenoAI - Recording',
  'tray.open': 'Open StenoAI',
  'tray.startRecording': 'Start Recording',
  'tray.stopRecording': 'Stop Recording',
  'tray.settings': 'Settings',
  'tray.hide': 'Hide StenoAI',
  'tray.version': 'StenoAI v{{version}}',
  'tray.reportBug': 'Report a Bug',
  'tray.quit': 'Quit StenoAI',

  'menu.settings': 'Settings…',
  'menu.learnMore': 'Learn More',
  'menu.reportBug': 'Report a Bug',
  'menu.file': '&File',

  'dialog.audioFiles': 'Audio Files',
  'dialog.markdown': 'Markdown',
  'dialog.text': 'Text',
  'dialog.pdf': 'PDF',

  'notify.shortcutsTitle': 'Steno Shortcuts',
  'notify.shortcutInvalid': 'Invalid shortcut URL',
  'notify.shortcutAlreadyRecording': 'Recording already in progress',
  'notify.shortcutStartRequested': 'Start recording requested',
  'notify.shortcutAlreadyStopped': 'Recording already stopped',
  'notify.shortcutStopRequested': 'Stop recording requested',
  'notify.sleepPausedTitle': 'Recording paused',
  'notify.sleepPausedBody': 'Paused while your computer was asleep. Resume to keep capturing.',
  'notify.resume': 'Resume',
  'notify.meetingDetectedTitle': 'Meeting detected',
  'notify.takeNotes': 'Take Notes',
  'notify.callEndedTitle': 'Call ended',
  'notify.callEndedBody': '{{appName}} closed the call. Finishing your note in {{seconds}} seconds.',
  'notify.keepRecording': 'Keep recording',
  'notify.silenceStoppedTitle': 'Recording stopped',
  'notify.silenceStoppedNamed': '{{sessionName}} — {{minutes}} minutes of silence',
  'notify.silenceStopped': '{{minutes}} minutes of silence — your note is being processed.',
  'notify.micOnlyTitle': 'Recording mic-only',
  'notify.micOnlyMac': 'System audio could not be captured. Check Steno’s Screen & System Audio Recording access in System Settings.',
  'notify.micOnly': 'System audio could not be captured. Continuing with the microphone only.',
  'notify.transcriptReadyTitle': 'Transcript ready',
  'notify.summarise': 'Summarise',
  'notify.summariseNamed': 'Summarise "{{title}}"?',
  'notify.summariseUnnamed': 'Summarise?',
  'notify.recordingFailedTitle': 'StenoAI',
  'notify.recordingFailedFallback': "Recording couldn't start.",
  'notify.meetingStarting': 'Meeting starting',
  'notify.processingFailedTitle': 'Processing failed',
  'notify.transcriptionFailedTitle': 'Transcription failed',
  'notify.noteReadyTitle': 'Note ready',
  'notify.processingFailedNamed': 'Steno couldn\'t process "{{title}}".',
  'notify.processingFailedUnnamed': "Steno couldn't process your note.",
  'notify.transcriptionFailedBody': 'Your recording was preserved — open the note for details.',
  'notify.noteReadyFallback': 'Your note has finished processing',

  'capture.ongoing': 'Steno hit a problem while saving this recording, so the note may be incomplete.',
  'capture.stop': "Steno couldn't finish the recording. Try stopping it again from the toolbar.",
  'capture.notFound': "Steno couldn't find a microphone, so the recording didn't start. Connect one and try again.",
  'capture.notAllowed': "Steno doesn't have permission to use the microphone, so the recording didn't start.{{hint}}",
  'capture.notAllowedHintMac': ' Grant access in System Settings > Privacy & Security > Microphone.',
  'capture.notAllowedHintWindows': ' Grant access in Settings > Privacy & security > Microphone.',
  'capture.notReadable': "Steno couldn't open the microphone — another app may be using it. Close it and try again.",
  'capture.generic': "Steno couldn't start the recording. Try again in a moment.",

  'update.permissionCheck': "Steno doesn't have permission to check for updates.{{hint}}",
  'update.permissionDownload': "Steno doesn't have permission to save the update.{{hint}}",
  'update.permissionInstall': "Steno doesn't have permission to install the update.{{hint}}",
  'update.permissionHintMac': ' Try moving Steno to your Applications folder.',
  'update.integrity': "The update couldn't be verified, so it wasn't installed. Steno will try again later.",
  'update.disk': 'There is not enough disk space to download the update.',
  'update.notConfigured': 'This build is not set up for automatic updates.',
  'update.httpStatus': "The update server didn't respond as expected. Steno will try again later.",
  'update.installFailed': "The update couldn't be installed. Restart Steno to try again.",
  'update.networkCheck': "Steno couldn't reach the update server. Check your connection — it will try again later.",
  'update.networkDownload': 'The update download was interrupted. Steno will try again later.',
  'update.downloadIncomplete': "The update didn't finish downloading. Steno will try again later.",
  'update.checkFailed': "Steno couldn't check for updates. It will try again later.",

  // IPC errors the renderer shows verbatim and no code compares.
  'error.noTranscriptToExport': 'No transcript content to export.',
  'error.noNotesToExport': 'No notes content to export.',
  'error.noDiagnosticsToSave': 'No diagnostics content to save.',
  'error.waitForAnswer': 'Wait for another answer to finish.',
  'error.recordingInProgress': 'Recording already in progress',
  'error.noRecordingInProgress': 'No recording in progress',
  'error.nothingProcessing': 'Nothing is processing for this note',
  'error.macosTooOldForLocalAi': 'Steno requires macOS 14 (Sonoma) or later for local AI summarization. Please update your macOS or use a remote Ollama server in Settings.',
  'error.bundledOllamaMissing': 'Bundled Ollama not found. Please reinstall Steno.',
  'error.ollamaIncompatibleMacos': 'Ollama crashed due to incompatible macOS version. Steno requires macOS 14 (Sonoma) or later for local AI. Please update macOS or use a remote Ollama server in Settings.',
  'error.ollamaFailedToStart': 'Ollama failed to start (exit code: {{code}}). Check debug logs for details.',
  'error.modelDownloadFailed': 'Failed to download AI model',
  'error.modelDownloadTimedOut': 'Model download timed out',
  'error.downloadTimedOut30': 'Download timed out after 30 minutes',
  'error.aiProviderManagedByOrg': 'AI provider is managed by your organisation while you are signed in.',
  'error.emptyRecording': 'Empty recording (no audio captured)',
  'error.pullInProgress': 'A pull for {{model}} is already in progress.',
  'error.noActivePull': 'No active pull for this model.',
};

const NL = {
  'tray.tooltip': 'Veneta MemoAi',
  'tray.tooltipRecording': 'Veneta MemoAi - opname loopt',
  'tray.open': 'Veneta MemoAi openen',
  'tray.startRecording': 'Opname starten',
  'tray.stopRecording': 'Opname stoppen',
  'tray.settings': 'Instellingen',
  'tray.hide': 'Veneta MemoAi verbergen',
  'tray.version': 'Veneta MemoAi v{{version}}',
  'tray.reportBug': 'Een fout melden',
  'tray.quit': 'Veneta MemoAi afsluiten',

  'menu.settings': 'Instellingen…',
  'menu.learnMore': 'Meer informatie',
  'menu.reportBug': 'Een fout melden',
  'menu.file': '&Bestand',

  'dialog.audioFiles': 'Audiobestanden',
  'dialog.markdown': 'Markdown',
  'dialog.text': 'Tekst',
  'dialog.pdf': 'PDF',

  'notify.shortcutsTitle': 'Snelkoppelingen van Veneta MemoAi',
  'notify.shortcutInvalid': 'Ongeldige snelkoppeling',
  'notify.shortcutAlreadyRecording': 'Er loopt al een opname',
  'notify.shortcutStartRequested': 'Opname starten aangevraagd',
  'notify.shortcutAlreadyStopped': 'De opname is al gestopt',
  'notify.shortcutStopRequested': 'Opname stoppen aangevraagd',
  'notify.sleepPausedTitle': 'Opname gepauzeerd',
  'notify.sleepPausedBody': 'Gepauzeerd omdat je computer in slaap viel. Hervat om verder op te nemen.',
  'notify.resume': 'Hervatten',
  'notify.meetingDetectedTitle': 'Gesprek herkend',
  'notify.takeNotes': 'Notities maken',
  'notify.callEndedTitle': 'Gesprek beëindigd',
  'notify.callEndedBody': '{{appName}} heeft het gesprek beëindigd. Je notitie wordt over {{seconds}} seconden afgerond.',
  'notify.keepRecording': 'Doorgaan met opnemen',
  'notify.silenceStoppedTitle': 'Opname gestopt',
  'notify.silenceStoppedNamed': '{{sessionName}} — {{minutes}} minuten stilte',
  'notify.silenceStopped': '{{minutes}} minuten stilte — je notitie wordt verwerkt.',
  'notify.micOnlyTitle': 'Alleen microfoon',
  'notify.micOnlyMac': 'Het systeemgeluid kon niet worden opgenomen. Controleer in Systeeminstellingen of Veneta MemoAi toegang heeft tot scherm- en systeemaudio-opname.',
  'notify.micOnly': 'Het systeemgeluid kon niet worden opgenomen. De opname gaat verder met alleen de microfoon.',
  'notify.transcriptReadyTitle': 'Transcript klaar',
  'notify.summarise': 'Samenvatten',
  'notify.summariseNamed': '"{{title}}" samenvatten?',
  'notify.summariseUnnamed': 'Samenvatten?',
  'notify.recordingFailedTitle': 'Veneta MemoAi',
  'notify.recordingFailedFallback': 'De opname kon niet starten.',
  'notify.meetingStarting': 'Gesprek begint',
  'notify.processingFailedTitle': 'Verwerking mislukt',
  'notify.transcriptionFailedTitle': 'Transcriptie mislukt',
  'notify.noteReadyTitle': 'Notitie klaar',
  'notify.processingFailedNamed': 'Veneta MemoAi kon "{{title}}" niet verwerken.',
  'notify.processingFailedUnnamed': 'Veneta MemoAi kon je notitie niet verwerken.',
  'notify.transcriptionFailedBody': 'Je opname is bewaard. Open de notitie voor details.',
  'notify.noteReadyFallback': 'Je notitie is verwerkt',

  'capture.ongoing': 'Er ging iets mis bij het bewaren van deze opname, dus de notitie is mogelijk onvolledig.',
  'capture.stop': 'De opname kon niet worden afgerond. Probeer hem opnieuw te stoppen via de werkbalk.',
  'capture.notFound': 'Er is geen microfoon gevonden, dus de opname is niet gestart. Sluit er een aan en probeer het opnieuw.',
  'capture.notAllowed': 'Veneta MemoAi heeft geen toestemming om de microfoon te gebruiken, dus de opname is niet gestart.{{hint}}',
  'capture.notAllowedHintMac': ' Geef toegang via Systeeminstellingen > Privacy en beveiliging > Microfoon.',
  'capture.notAllowedHintWindows': ' Geef toegang via Instellingen > Privacy en beveiliging > Microfoon.',
  'capture.notReadable': 'De microfoon kon niet worden geopend. Mogelijk gebruikt een andere app hem. Sluit die en probeer het opnieuw.',
  'capture.generic': 'De opname kon niet starten. Probeer het zo opnieuw.',

  'update.permissionCheck': 'Veneta MemoAi heeft geen toestemming om op updates te controleren.{{hint}}',
  'update.permissionDownload': 'Veneta MemoAi heeft geen toestemming om de update te bewaren.{{hint}}',
  'update.permissionInstall': 'Veneta MemoAi heeft geen toestemming om de update te installeren.{{hint}}',
  'update.permissionHintMac': ' Zet Veneta MemoAi in je map Programma\'s.',
  'update.integrity': 'De update kon niet worden gecontroleerd en is daarom niet geïnstalleerd. Er wordt later opnieuw gekeken.',
  'update.disk': 'Er is niet genoeg schijfruimte om de update te downloaden.',
  'update.notConfigured': 'Deze build is niet ingesteld voor automatische updates.',
  'update.httpStatus': 'De updateserver gaf een onverwacht antwoord. Er wordt later opnieuw gekeken.',
  'update.installFailed': 'De update kon niet worden geïnstalleerd. Start Veneta MemoAi opnieuw om het nog eens te proberen.',
  'update.networkCheck': 'De updateserver is niet bereikbaar. Controleer je verbinding; er wordt later opnieuw gekeken.',
  'update.networkDownload': 'Het downloaden van de update is onderbroken. Er wordt later opnieuw gekeken.',
  'update.downloadIncomplete': 'De update is niet helemaal gedownload. Er wordt later opnieuw gekeken.',
  'update.checkFailed': 'Er kon niet op updates worden gecontroleerd. Er wordt later opnieuw gekeken.',

  'error.noTranscriptToExport': 'Er is geen transcript om te exporteren.',
  'error.noNotesToExport': 'Er zijn geen notities om te exporteren.',
  'error.noDiagnosticsToSave': 'Er is geen diagnose om te bewaren.',
  'error.waitForAnswer': 'Wacht tot het andere antwoord klaar is.',
  'error.recordingInProgress': 'Er loopt al een opname',
  'error.noRecordingInProgress': 'Er loopt geen opname',
  'error.nothingProcessing': 'Voor deze notitie wordt niets verwerkt',
  'error.macosTooOldForLocalAi': 'Voor lokale AI-samenvattingen is macOS 14 (Sonoma) of nieuwer nodig. Werk macOS bij of stel in Instellingen een externe Ollama-server in.',
  'error.bundledOllamaMissing': 'De meegeleverde Ollama is niet gevonden. Installeer Veneta MemoAi opnieuw.',
  'error.ollamaIncompatibleMacos': 'Ollama is gecrasht door een niet-ondersteunde macOS-versie. Voor lokale AI is macOS 14 (Sonoma) of nieuwer nodig. Werk macOS bij of stel in Instellingen een externe Ollama-server in.',
  'error.ollamaFailedToStart': 'Ollama kon niet starten (foutcode: {{code}}). Bekijk de foutopsporingslogboeken voor details.',
  'error.modelDownloadFailed': 'Het AI-model kon niet worden gedownload',
  'error.modelDownloadTimedOut': 'Het downloaden van het model duurde te lang',
  'error.downloadTimedOut30': 'Het downloaden is na 30 minuten afgebroken',
  'error.aiProviderManagedByOrg': 'De AI-aanbieder wordt beheerd door je organisatie zolang je bent aangemeld.',
  'error.emptyRecording': 'Lege opname (geen audio vastgelegd)',
  'error.pullInProgress': '{{model}} wordt al gedownload.',
  'error.noActivePull': 'Dit model wordt niet gedownload.',
};

// Dutch labels for the native role menus. Electron labels roles in English, so
// the Veneta build names them explicitly; the default build keeps the bare
// roles and therefore its existing menus.
const DUTCH_ROLE_LABELS = {
  about: 'Over Veneta MemoAi',
  services: 'Voorzieningen',
  hide: 'Verberg Veneta MemoAi',
  hideOthers: 'Verberg andere',
  unhide: 'Toon alles',
  quit: 'Stop Veneta MemoAi',
  close: 'Sluit venster',
  undo: 'Herstel',
  redo: 'Opnieuw',
  cut: 'Knip',
  copy: 'Kopieer',
  paste: 'Plak',
  pasteAndMatchStyle: 'Plak en pas stijl aan',
  delete: 'Verwijder',
  selectAll: 'Selecteer alles',
  reload: 'Laad opnieuw',
  forceReload: 'Forceer opnieuw laden',
  toggleDevTools: 'Ontwikkelaarstools',
  resetZoom: 'Werkelijke grootte',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom uit',
  togglefullscreen: 'Schermvullende weergave',
  minimize: 'Minimaliseer',
  zoom: 'Zoom',
  front: 'Breng alles naar voren',
};

function createMenuRoles(veneta) {
  const item = (role) => (veneta ? { role, label: DUTCH_ROLE_LABELS[role] } : { role });
  const separator = { type: 'separator' };
  if (!veneta) {
    return {
      item,
      fileMenu: { role: 'fileMenu' },
      editMenu: { role: 'editMenu' },
      viewMenu: { role: 'viewMenu' },
      windowMenu: { role: 'windowMenu' },
      helpLabel: undefined,
    };
  }
  return {
    item,
    fileMenu: { label: 'Archief', submenu: [item('close')] },
    editMenu: {
      label: 'Wijzig',
      submenu: [item('undo'), item('redo'), separator, item('cut'), item('copy'), item('paste'),
        item('pasteAndMatchStyle'), item('delete'), item('selectAll')],
    },
    viewMenu: {
      label: 'Weergave',
      submenu: [item('reload'), item('forceReload'), item('toggleDevTools'), separator,
        item('resetZoom'), item('zoomIn'), item('zoomOut'), separator, item('togglefullscreen')],
    },
    windowMenu: { role: 'windowMenu', label: 'Venster', submenu: [item('minimize'), item('zoom'), separator, item('front')] },
    helpLabel: 'Help',
  };
}

const INTERPOLATION = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

/** Strict package-metadata check, the same rule main.js uses for the tray and menu. */
function isVenetaBuild(metadata) {
  return Boolean(metadata) && metadata.venetaMemoAi === true;
}

function createMainText(veneta) {
  const catalogue = veneta ? { ...EN, ...NL } : EN;
  return function mainText(key, params = {}) {
    const value = catalogue[key];
    if (typeof value !== 'string') throw new Error(`Unknown main-process copy key: ${key}`);
    return value.replace(INTERPOLATION, (token, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : token,
    );
  };
}

let packageMetadata = {};
try {
  packageMetadata = require('./package.json');
} catch (_) {
  // Copy must never stop the app from starting; English is the safe fallback.
}

const mainText = createMainText(isVenetaBuild(packageMetadata));
const menuRoles = createMenuRoles(isVenetaBuild(packageMetadata));

module.exports = { EN, NL, createMainText, createMenuRoles, isVenetaBuild, mainText, menuRoles };
