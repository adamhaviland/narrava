## Narrava: The Transcript Combiner

### Overview
Narrava combines two SRT files into a single plain-text transcript:
- **Standard captions**: spoken dialog only
- **Descriptive captions**: stage directions, actions, SFX, and any lines explicitly labeled “On-screen text:”

All processing happens in the browser. No uploads to a server.

### Quick start
1. Open `index.html` in a modern browser (Chrome, Edge, Safari, Firefox).
2. Under “Standard Captions (SRT File)”, upload the dialog SRT.
3. Under “Descriptive Captions (SRT)”, upload the descriptive SRT.
4. Click “Combine” to generate the merged transcript.
5. Click “Download” to save the result or “Copy” to clipboard.

### Output
- Plain text (no timecodes or sequence numbers)
- Entries sorted by SRT start times
- One blank line between entries
- Labels used:
  - **Description:** visual/action/SFX notes (default for descriptive lines)
  - **On-screen text:** used only when the line explicitly begins with “On-screen text:” (case-insensitive, optional hyphen in source)
  - **Speaker:** spoken dialog
- Ordering within the same moment (~1s window): **Description → On-screen text → Speaker**
- Adjacent `Speaker:` lines are merged into one line
- Styling/HTML/SRT artifacts are stripped
- Near-duplicate removal within ~750ms (case/punctuation agnostic). If duplicates collide, `Speaker:` is preferred.

### Download filename
- Derived from the standard captions SRT name (or contents) using pattern `YTP26-XXX` or `YTP26-XXXa`.
- Final filename: `YTP26-XXX_Descriptive_Transcript.txt` or `YTP26-XXXa_Descriptive_Transcript.txt`.
- If no match is found, falls back to `combined_transcript.txt`.

### Input rules and parsing
1. Each SRT is parsed into blocks `{ start_time, text }`.
2. Descriptive SRT:
   - If a line begins with `On-screen text:` (case-insensitive, optional hyphen), it’s tagged as **On-screen text:** and the prefix is removed from the content.
   - Otherwise tagged as **Description:**.
3. Standard SRT is tagged as **Speaker:**.

### Troubleshooting
- **Text looks too wide or overflows**: The UI constrains controls to their white containers; reloading after resizing your window can help if you previously zoomed in/out.
- **Filename not detected**: Ensure the standard captions filename (or content) contains `YTP26-XXX` or `YTP26-XXXa`.
- **On-screen text not recognized**: Confirm the line begins with `On-screen text:` (case-insensitive; `On-screen-text:` is also accepted in the source SRT and normalized).

### Development notes
- Main files: `index.html` (UI) and `script.js` (logic).
- Key functions in `script.js`:
  - `parseSrtToBlocks` — parse SRT into `{ startMs, text }`
  - `tagDescriptiveBlocks` / `tagSpokenBlocks` — apply labels
  - `dedupeNearDuplicates` — near-duplicate removal window (~750ms)
  - `mergeAdjacentSpeakers` — merges consecutive Speaker entries
  - `combineTranscripts` — orchestrates parsing, ordering, dedupe, and merging
  - `buildOutputFilename` — derives dynamic filename from YTP ID

No build step required. Open `index.html` directly.


