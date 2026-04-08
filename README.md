# PeakCue

PeakCue is a lightweight browser-based tool for finding the loudest moments in long audio recordings.

It is built for cases like meetings, interviews, surveillance audio, call recordings, podcasts, and field recordings where you want to quickly answer:

- Where are the loudest moments?
- Which file has the highest peak?
- What are the peak timestamps across all uploaded audio?

PeakCue runs analysis directly in the browser with the Web Audio API. Audio files are not uploaded to a remote server.

## Highlights

- Upload one or many audio files at once
- Analyze each recording independently
- Switch between per-file view and combined overview
- See a loudness timeline as an interactive bar chart
- Filter peaks by relative loudness threshold
- Filter peaks by minimum dB threshold
- Jump directly to detected loud moments
- Stop playback, restart playback, and clear all loaded files
- View the global loudest moments across all uploaded audio

## How It Works

PeakCue splits audio into short analysis windows, calculates RMS loudness for each window, converts that into an approximate dBFS value, and detects loud segments based on:

1. Relative loudness threshold
2. Minimum dB threshold
3. Analysis window size

In multi-file mode, PeakCue supports two levels of inspection:

- Per-file view
  Shows the loudness timeline and detected peaks for one selected recording
- Combined overview
  Treats all completed recordings as one continuous timeline and computes global peaks across the entire uploaded set

## Features

### Multi-file workflow

- Upload multiple audio files in one batch
- Drag and drop audio files into the page
- See analysis status for each file
- Switch between uploaded recordings from the sidebar list

### Peak detection

- Relative threshold slider for high-loudness filtering
- dB threshold slider for minimum loudness filtering
- Configurable analysis granularity
- Configurable max result count for per-file views

### Combined overview

- Adds an `All Recordings` view automatically when multiple files are ready
- Displays a merged loudness chart for all finished recordings
- Marks file boundaries in the overview chart
- Shows file labels above overview sections
- Computes the real global peak set across all uploaded audio

### Playback controls

- Play and pause current recording
- Restart from the beginning
- Stop playback immediately
- Scrub playback position
- Adjust playback volume
- Click chart bars or peak cards to jump to exact moments

### Privacy

- Audio decoding and analysis happen in the browser
- Files are not uploaded to a backend API
- No external runtime dependencies are required

## Interface Overview

### 1. Upload area

- Select multiple recordings
- Drag recordings into the drop zone

### 2. Filters

- High loudness threshold
- Minimum dB threshold
- Analysis window size
- Max displayed peak count for single-file mode

### 3. Recording list

- `All Recordings` combined overview
- Individual file cards
- Status indicators: analyzing, ready, failed

### 4. Timeline chart

- Interactive loudness bars
- Threshold line
- Peak markers
- File separators in combined overview mode

### 5. Peak panel

- Lists detected loud timestamps
- Shows both global and local timestamps in combined mode
- Lets you jump to the matching file and timestamp

## Peak Detection Rules

PeakCue currently uses RMS-based loudness analysis with windowed segmentation.

Detected peaks depend on the following controls:

- `High loudness threshold`
  A relative threshold based on normalized loudness within the analyzed scope
- `Minimum dB threshold`
  A minimum approximate dBFS floor that a segment must exceed
- `Analysis granularity`
  A smaller window catches sharper peaks; a larger window smooths the result

Combined overview mode does not simply merge the top peak from each file. It recalculates peaks across the entire merged timeline so that the global highest moments are ranked correctly.

## Project Structure

```text
.
├── public
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── package.json
├── README.md
└── server.js
```

## Local Development

### Requirements

- Node.js 18+ recommended

### Start the app

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

### Available scripts

```bash
npm run dev
npm run start
npm test
```

`npm test` currently runs a syntax check for the frontend script.

## Technical Notes

- The frontend is plain HTML, CSS, and JavaScript
- Playback and decoding use the Web Audio API
- The local server is a minimal static file server built with Node.js native modules
- No bundler is required
- No npm dependencies are required

## Browser Compatibility

PeakCue is designed for modern browsers with Web Audio API support, including:

- Chrome
- Edge
- Safari

If an audio file fails to decode, PeakCue will mark that recording as failed and continue processing the rest.

## Limitations

- dB values are approximate dBFS values derived from RMS windows, not calibrated real-world SPL measurements
- Very large batches of long recordings may use significant browser memory
- Unsupported or uncommon codecs may fail to decode depending on browser support
- Combined overview playback jumps into the matching original file rather than playing the merged timeline as one continuous rendered track

## Suggested Use Cases

- Long meeting review
- Interview cleanup
- Surveillance and monitoring review
- Podcast and voice recording scanning
- Field recording inspection
- Fast quality control for spoken-word audio

## Roadmap Ideas

- Export detected peak timestamps
- Hover tooltips on the combined overview chart
- CSV / JSON export for all peaks
- Spectrogram mode
- Silence detection and speech burst detection
- Peak labeling and bookmarking

## License

No license file has been added yet. Add one before public redistribution if needed.
