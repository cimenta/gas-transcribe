# GAS Transcribe

A Google Apps Script web app that turns audio files from your Google Drive into text transcripts.
You connect one or more Drive folders (subfolders included), then transcribe, read or delete files
from an admin console. Three providers are built in and switchable in Settings:

- **Google Cloud Speech-to-Text** (v1, asynchronous, optional model choice; the app counts the monthly free quota).
- **Groq (Whisper)** (synchronous, API key stored server-side only; the full result with timed segments is
  saved next to the audio as `<name>.transcript.json` and can be viewed formatted or raw).

- **Deepgram** (synchronous, nova-3 / nova-2, API key stored server-side only, `mip_opt_out` sent with every
  request; timed utterances are saved as `<name>.transcript.json`).

Every provider keeps its own result next to the audio (`<audio>.transcript.<provider>.txt`, and `.json` where the
provider returns one), so the outputs can be compared; transcribing again with the same provider asks before it
overwrites that provider's result only. Results written by 0.2.0 and older (`<audio>.transcript.txt`) are listed
as "older transcript".

Other features: refresh button, in-page audio player (files up to 10 MB, larger ones open in Drive), per-file language override, audio length estimates, searchable text/JSON viewers,
persistent error popups with details, and an app version shown in the console.

The interface and the built-in Help (step-by-step setup, including the Cloud project and bucket) are
available in Czech and English.

## Security model

- Only the owner of the Google account can use the app: deployed as *Execute as: Me*,
  *Who has access: Only myself*, and every server function re-checks the caller.
- No secrets live in this repository. Calls to Google Cloud use the script's own OAuth token.
  Your Script ID goes into `.clasp.json`, which is git-ignored (see `.clasp.json.example`).
- Only files under connected folders can be transcribed or deleted; delete moves to the Drive trash.
- Transcript text and file names are rendered as plain text, and transcript text is never logged.
- The Cloud Storage bucket must stay private. The app uploads a temporary copy of the audio for each
  transcription and deletes it afterwards.

## Develop

```bash
npm install -g @google/clasp   # once
clasp login
clasp create --type webapp --title "GAS Transcribe" --rootDir src   # or copy .clasp.json.example
npm test                       # unit tests for the pure logic (Node)
npm run build                  # regenerates src/LogicClient.html from src/Logic.js
clasp push                     # or p.bat (local helper: build + test + push)
```

Then deploy as a web app (*Execute as: Me*, *Only myself*) and follow **Help → Google Cloud
Speech-to-Text** inside the app to create the Cloud project, billing, bucket and link it to the script.

## Layout

- `src/Logic.js`, `I18n.js`, `Settings.js`, `Auth.js`, `Operations.js`, `Drive.js`, `GoogleSpeech.js`, `GroqSpeech.js`, `DeepgramSpeech.js`,
  `Usage.js`, `AudioDuration.js`
  hold logic that is unit tested in Node (`tests/`); the GAS-specific functions sit below them.
- `src/Api.js` is the only surface the browser can call; `src/Client.html` is the single-page UI.
- `src/LogicClient.html` is generated; `tests/build.test.js` fails if it is stale.

- `src/Version.js` holds `APP_VERSION`, the single version shown in the admin console and used for git tags and
  GitHub releases (keep `package.json` equal; `tests/version.test.js` checks it).
- `scripts/build-client.js` generates `LogicClient.html`; `tests/` holds the Node unit tests.

## Privacy note

Audio is sent to the provider you select. For Groq, enable Zero Data Retention in your Groq account; Deepgram requests carry `mip_opt_out=true`.
Transcripts and API keys are never logged.

## Roadmap

Automatic transcription of new files, e-mailing transcripts and further providers, speaker separation (diarization).

## License

[MIT](LICENSE)
