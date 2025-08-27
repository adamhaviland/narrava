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
const statusText = document.getElementById("statusText");
const downloadBtn = document.getElementById("downloadBtn");
const downloadLink = document.getElementById("downloadLink");

function updateButtonState() {
  combineBtn.disabled = !(spokenInput.files && spokenInput.files.length > 0 && descInput.files && descInput.files.length > 0);
}

spokenInput.addEventListener("change", updateButtonState);
descInput.addEventListener("change", updateButtonState);

clearBtn.addEventListener("click", () => {
  spokenInput.value = "";
  descInput.value = "";
  statusText.textContent = "";
  downloadBtn.disabled = true;
  downloadLink.removeAttribute("href");
  downloadLink.setAttribute("download", "combined_transcript.txt");
  downloadBtn.textContent = "Download";
  updateButtonState();
});

combineBtn.addEventListener("click", async () => {
  statusText.textContent = "Combining...";
  try {
    // Build maps by YTP id from spoken and descriptive uploads
    const spokenFiles = Array.from(spokenInput.files);
    const descFiles = Array.from(descInput.files);

    const spokenEntries = await Promise.all(spokenFiles.map(async f => {
      const content = await f.text();
      const id = extractYtpId(f.name) || extractYtpId(content);
      return { id, file: f, content };
    }));

    const descEntries = await Promise.all(descFiles.map(async f => {
      const content = await f.text();
      const id = extractYtpId(f.name) || extractYtpId(content);
      return { id, file: f, content };
    }));

    // Index descriptive by id for quick lookup
    const idToDesc = new Map();
    for (const d of descEntries) {
      if (!d.id) continue;
      if (!idToDesc.has(d.id)) idToDesc.set(d.id, []);
      idToDesc.get(d.id).push(d);
    }

    // For each spoken entry with an id, find matching descriptive entry(s)
    const outputs = [];
    for (const s of spokenEntries) {
      if (!s.id) continue; // skip if cannot determine id
      const matches = idToDesc.get(s.id) || [];
      if (matches.length === 0) continue;
      // Combine with the first match (or all if multiple?)
      for (const m of matches) {
        const result = combineTranscripts(s.content, m.content);
        const name = `${s.id}_Descriptive_Transcript.txt`;
        outputs.push({ name, content: result });
      }
    }

    if (outputs.length === 0) {
      statusText.textContent = "No matching pairs by YTP ID.";
      downloadBtn.disabled = true;
      downloadLink.removeAttribute("href");
      return;
    }

    if (outputs.length === 1) {
      // Single file: provide direct download
      const { name, content } = outputs[0];
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = name;
      downloadBtn.textContent = `Download ${name}`;
      downloadBtn.disabled = false;
      statusText.textContent = `Ready: 1 file`;
    } else {
      // Multiple files: build a zip on the fly
      const zipBlob = await buildZip(outputs);
      const url = URL.createObjectURL(zipBlob);
      downloadLink.href = url;
      downloadLink.download = `Narrava_Combined_${outputs.length}_files.zip`;
      downloadBtn.textContent = `Download ${outputs.length} files (ZIP)`;
      downloadBtn.disabled = false;
      statusText.textContent = `Ready: ${outputs.length} files`;
    }
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

/* Minimal ZIP builder (no deps) */
async function buildZip(files) {
  // files: [{ name, content }]
  // Implement a simple ZIP using the ZIP file format.
  // This is a small, dependency-free implementation suitable for plain text files.

  const encoder = new TextEncoder();
  const writer = new ZipWriter();
  for (const f of files) {
    const data = encoder.encode(f.content);
    writer.addFile(f.name, data);
  }
  return new Blob([writer.toUint8Array()], { type: "application/zip" });
}

class ZipWriter {
  constructor() {
    this.files = [];
    this.centralDirectory = [];
    this.offset = 0;
    this.chunks = [];
  }

  /* CRC32 */
  static crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
    }
    return ~c >>> 0;
  }

  addFile(name, data) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = ZipWriter.crc32(data);
    const size = data.length;
    const modTime = this._dosTime(new Date());
    const modDate = this._dosDate(new Date());

    // Local file header
    const localHeader = new DataView(new ArrayBuffer(30));
    let p = 0;
    localHeader.setUint32(p, 0x04034b50, true); p += 4; // signature
    localHeader.setUint16(p, 20, true); p += 2;         // version needed
    localHeader.setUint16(p, 0, true); p += 2;          // flags
    localHeader.setUint16(p, 0, true); p += 2;          // compression (0 = store)
    localHeader.setUint16(p, modTime, true); p += 2;    // file mod time
    localHeader.setUint16(p, modDate, true); p += 2;    // file mod date
    localHeader.setUint32(p, crc, true); p += 4;        // crc32
    localHeader.setUint32(p, size, true); p += 4;       // compressed size
    localHeader.setUint32(p, size, true); p += 4;       // uncompressed size
    localHeader.setUint16(p, nameBytes.length, true); p += 2; // file name length
    localHeader.setUint16(p, 0, true); p += 2;                // extra length

    this._push(new Uint8Array(localHeader.buffer));
    this._push(nameBytes);
    this._push(data);

    const localHeaderOffset = this.offset;
    this.offset += localHeader.byteLength + nameBytes.length + size;

    // Central directory header
    const central = new DataView(new ArrayBuffer(46));
    p = 0;
    central.setUint32(p, 0x02014b50, true); p += 4; // signature
    central.setUint16(p, 20, true); p += 2;         // version made by
    central.setUint16(p, 20, true); p += 2;         // version needed
    central.setUint16(p, 0, true); p += 2;          // flags
    central.setUint16(p, 0, true); p += 2;          // compression
    central.setUint16(p, modTime, true); p += 2;    // mod time
    central.setUint16(p, modDate, true); p += 2;    // mod date
    central.setUint32(p, crc, true); p += 4;
    central.setUint32(p, size, true); p += 4;
    central.setUint32(p, size, true); p += 4;
    central.setUint16(p, nameBytes.length, true); p += 2;
    central.setUint16(p, 0, true); p += 2; // extra len
    central.setUint16(p, 0, true); p += 2; // comment len
    central.setUint16(p, 0, true); p += 2; // disk number
    central.setUint16(p, 0, true); p += 2; // internal attrs
    central.setUint32(p, 0, true); p += 4; // external attrs
    central.setUint32(p, localHeaderOffset, true); p += 4; // local header offset

    this.centralDirectory.push({ header: new Uint8Array(central.buffer), nameBytes });
  }

  toUint8Array() {
    const centralStart = this.offset;
    for (const entry of this.centralDirectory) {
      this._push(entry.header);
      this._push(entry.nameBytes);
      this.offset += entry.header.byteLength + entry.nameBytes.length;
    }
    const centralSize = this.offset - centralStart;

    // End of central directory
    const end = new DataView(new ArrayBuffer(22));
    let p = 0;
    end.setUint32(p, 0x06054b50, true); p += 4; // signature
    end.setUint16(p, 0, true); p += 2; // disk number
    end.setUint16(p, 0, true); p += 2; // start disk
    end.setUint16(p, this.centralDirectory.length, true); p += 2;
    end.setUint16(p, this.centralDirectory.length, true); p += 2;
    end.setUint32(p, centralSize, true); p += 4;
    end.setUint32(p, centralStart, true); p += 4;
    end.setUint16(p, 0, true); p += 2; // comment length

    this._push(new Uint8Array(end.buffer));

    // Concatenate all chunks
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const result = new Uint8Array(total);
    let pos = 0;
    for (const c of this.chunks) { result.set(c, pos); pos += c.length; }
    return result;
  }

  _push(u8) {
    this.chunks.push(u8);
  }

  _dosTime(d) {
    return (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2) & 0x1f;
  }
  _dosDate(d) {
    return (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }
}


