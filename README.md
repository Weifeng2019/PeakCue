# PeakCue

PeakCue is a browser-based audio peak locator for long recordings.

It helps you:

1. Upload one or more audio files
2. Analyze loud moments across each recording
3. View a combined overview of all uploaded audio
4. Jump to the loudest timestamps quickly

## Features

- Multi-audio upload and batch analysis
- Per-file loudness timeline
- Combined overview across all uploaded recordings
- Loudness threshold filtering
- dB threshold filtering
- Peak timestamp list with quick jump
- Browser-side decoding and analysis
- No third-party dependencies

## Project Structure

```text
.
├── public
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── server.js
├── package.json
└── README.md
```

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:3000
```

## Scripts

```bash
npm run dev
npm test
```

## Notes

- Audio files are analyzed in the browser and are not uploaded to a server.
- The combined overview mode calculates loud peaks across all uploaded files, not just the loudest peak from each individual file.
