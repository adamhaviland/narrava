/* Utility: parse SRT into [{ startMs, text }] */
function parseSrtToBlocks(srtString) {
  const lines = srtString.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const timecodeRegex = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

  while (i < lines.length) {
    // Skip index line if present
    if (/^\d+$/.test(lines[i].trim())) {
      i++;
    }

    // Timecode line
    const timeMatch = timecodeRegex.exec(lines[i] || "");
    if (!timeMatch) { i++; continue; }
    const startMs = hhmmssToMs(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    i++;

    // Collect text lines until blank line
    const textLines = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i]);
      i++;
    }
    // Skip the blank separator
    while (i < lines.length && lines[i].trim() === "") i++;

    const text = cleanSrtText(textLines.join("\n"));
    if (text.trim()) {
      blocks.push({ startMs, text });
    }
  }
  return blocks;
}

function hhmmssToMs(h, m, s, ms) {
  const hh = parseInt(h, 10);
  const mm = parseInt(m, 10);
  const ss = parseInt(s, 10);
  const mss = parseInt(ms, 10);
  return ((hh * 60 + mm) * 60 + ss) * 1000 + mss;
}

/* Strip styling/HTML and SRT artifacts */
function cleanSrtText(s) {
  let out = s;
  // Remove HTML tags
  out = out.replace(/<[^>]+>/g, "");
  // Remove SRT formatting like {\an8} or {b} etc
  out = out.replace(/\{[^}]*\}/g, "");
  // Replace multiple spaces/newlines
  out = out.replace(/\u200B/g, ""); // zero-width
  out = out.replace(/\s+$/gm, "");
  out = out.replace(/[\t\f\v]+/g, " ");
  // Normalize newlines
  out = out.replace(/\n{2,}/g, "\n");
  return out.trim();
}

/* Tag descriptive blocks (Description vs On-screen text) */
function tagDescriptiveBlocks(blocks) {
  return blocks.map(b => {
    const lines = b.text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const first = lines[0] || "";
    const onScreenRegex = /^\s*on[-\s]?screen\s*text\s*:\s*/i;
    if (onScreenRegex.test(first)) {
      // Remove prefix from first line only
      lines[0] = first.replace(onScreenRegex, "").trim();
      return { startMs: b.startMs, role: "On-screen text", text: lines.join(" ") };
    }
    return { startMs: b.startMs, role: "Description", text: lines.join(" ") };
  });
}

/* Tag spoken blocks */
function tagSpokenBlocks(blocks) {
  return blocks.map(b => ({ startMs: b.startMs, role: "Speaker", text: joinLinesPreservingSentence(b.text) }));
}

function joinLinesPreservingSentence(s) {
  // Join with spaces unless hyphenated dialogues create duplication; keep simple
  return s.split(/\n+/).map(x => x.trim()).filter(Boolean).join(" ");
}

/* Normalize text for dedupe (case and punctuation agnostic) */
function normalizeForCompare(s) {
  return s
    .toLowerCase()
    .replace(/on[-\s]?screen\s*text\s*:\s*/gi, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/* De-duplicate near-duplicates within windowMs at the same time neighborhood */
function dedupeNearDuplicates(items, windowMs = 750) {
  // items: [{ startMs, role, text }], sorted by startMs
  const result = [];
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    const norm = normalizeForCompare(current.text);
    let isDuplicate = false;

    for (let j = result.length - 1; j >= 0; j--) {
      const prev = result[j];
      if (current.startMs - prev.startMs > windowMs) break;
      if (normalizeForCompare(prev.text) === norm) {
        // Prefer Speaker over others
        if (prev.role !== "Speaker" && current.role === "Speaker") {
          result[j] = current;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) result.push(current);
  }
  return result;
}

/* Order within same moment: Description → On-screen text → Speaker */
function momentOrderValue(role) {
  switch (role) {
    case "Description": return 0;
    case "On-screen text": return 1;
    case "Speaker": return 2;
    default: return 3;
  }
}

/* Merge adjacent Speaker entries (no timecodes) */
function mergeAdjacentSpeakers(items) {
  const merged = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (last && last.role === "Speaker" && item.role === "Speaker") {
      last.text = `${last.text} ${item.text}`.replace(/\s+/g, " ").trim();
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

/* Combine two SRT strings into the final plain text */
function combineTranscripts(spokenSrt, descriptiveSrt) {
  const spoken = tagSpokenBlocks(parseSrtToBlocks(spokenSrt));
  const desc = tagDescriptiveBlocks(parseSrtToBlocks(descriptiveSrt));

  // Merge and sort by startMs, then by moment order
  const combined = [...spoken, ...desc].sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return momentOrderValue(a.role) - momentOrderValue(b.role);
  });

  const deduped = dedupeNearDuplicates(combined, 750);
  const mergedSpeakers = mergeAdjacentSpeakers(deduped);

  // Render as plain text paragraphs
  const paragraphs = mergedSpeakers.map(item => `${item.role}: ${item.text}`);
  return paragraphs.join("\n\n");
}

/* UI wiring */
const spokenInput = document.getElementById("spokenInput");
const descInput = document.getElementById("descInput");
const combineBtn = document.getElementById("combineBtn");
const clearBtn = document.getElementById("clearBtn");
const output = document.getElementById("output");
const statusText = document.getElementById("statusText");
const downloadBtn = document.getElementById("downloadBtn");
const downloadLink = document.getElementById("downloadLink");
const copyBtn = document.getElementById("copyBtn");

function updateButtonState() {
  combineBtn.disabled = !(spokenInput.files && spokenInput.files[0] && descInput.files && descInput.files[0]);
}

spokenInput.addEventListener("change", updateButtonState);
descInput.addEventListener("change", updateButtonState);

clearBtn.addEventListener("click", () => {
  spokenInput.value = "";
  descInput.value = "";
  output.value = "";
  statusText.textContent = "";
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  updateButtonState();
});

combineBtn.addEventListener("click", async () => {
  statusText.textContent = "Combining...";
  try {
    const [spokenText, descText] = await Promise.all([
      spokenInput.files[0].text(),
      descInput.files[0].text(),
    ]);

    const result = combineTranscripts(spokenText, descText);
    output.value = result;
    statusText.textContent = `Done (${new Blob([result]).size} bytes)`;

    // Prepare download link
    const blob = new Blob([result], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    const suggestedName = buildOutputFilename(spokenInput.files[0].name || "", spokenText);
    downloadLink.download = suggestedName;
    downloadBtn.textContent = `Download ${suggestedName}`;
    downloadBtn.disabled = !result;
    copyBtn.disabled = !result;
  } catch (e) {
    console.error(e);
    statusText.textContent = "Failed to combine.";
  }
});

copyBtn.addEventListener("click", async () => {
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value);
    statusText.textContent = "Copied to clipboard.";
  } catch (e) {
    statusText.textContent = "Copy failed.";
  }
});

/* Build dynamic output filename from the standard captions SRT */
function buildOutputFilename(spokenFilename, spokenContent) {
  const id = extractYtpId(spokenFilename) || extractYtpId(spokenContent);
  if (id) return `${id}_Descriptive_Transcript.txt`;
  return "combined_transcript.txt";
}

function extractYtpId(s) {
  if (!s) return null;
  const match = s.match(/YTP26-(\d{3})([a-zA-Z])?/i);
  if (!match) return null;
  const digits = match[1];
  const letter = match[2] ? match[2].toLowerCase() : "";
  return `YTP26-${digits}${letter}`;
}


