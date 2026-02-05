/* app.jsx — MSCONS Translator (CSV → MSCONS)
   GitHub Pages + Babel Standalone compatible (NO imports/exports)

   Requires in index.html:
   - React UMD
   - ReactDOM UMD
   - Babel Standalone
   - JSZip UMD (window.JSZip)
   - FileSaver UMD (window.saveAs)
*/

const { useState } = React;

// ============================
// Config / Constants
// ============================
const APP_VERSION = "2026-02-02";

// Matches the working TL format
const APP_CODE = "TL";
const SENDER_ID = "9979383000006";
const RECIPIENT_ID = "9906629000002";

const SLOT_MS = 15 * 60 * 1000;
const SLOTS_PER_DAY = 96;
const LIMIT_MB = 50;

// ============================
// Helpers
// ============================
function pad(n, w = 2) {
  return n.toString().padStart(w, "0");
}

// UTC EDIFACT date-time with ?+00 + :303 qualifier.
function formatEdifactDateTime(dt) {
  const y = dt.getUTCFullYear();
  const m = pad(dt.getUTCMonth() + 1);
  const d = pad(dt.getUTCDate());
  const hh = pad(dt.getUTCHours());
  const mm = pad(dt.getUTCMinutes());
  return `${y}${m}${d}${hh}${mm}?+00`;
}

function seg() {
  return Array.from(arguments).join("+") + "'";
}

// ============================
// CSV helper: parse "DD.MM.YYYY HH:MM;15,024" (kWh per 15 min)
// output: [{dayKey,start,end,values(96)}]
// ============================
function parseQuarterHourCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // IMPORTANT:
  // We intentionally avoid using JS Date parsing (and even avoid constructing local Dates)
  // for slot assignment, because DST / timezone conversions can silently reorder or
  // mis-map values. The generator's reliable behaviour is: "one CSV line = one 15-min slot"
  // based purely on the wall-clock HH:MM in the file.
  //
  // Supported datetime formats:
  //  - DD.MM.YYYY HH:MM[:SS]
  //  - YYYY-MM-DD H:MM[:SS]
  //
  // Output is grouped by dayKey (YYYY-MM-DD) with exactly 96 quarter-hour values.
  const byDay = new Map(); // dayKey -> Array(96)

  function ensureDay(dayKey) {
    if (!byDay.has(dayKey)) byDay.set(dayKey, new Array(SLOTS_PER_DAY).fill(0));
    return byDay.get(dayKey);
  }

  function parseDateAndSlot(datetimeStr) {
    // 1) DD.MM.YYYY HH:MM[:SS]
    let m = datetimeStr.match(
      /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    );
    if (m) {
      const dd = Number(m[1]);
      const mo = Number(m[2]);
      const yy = Number(m[3]);
      const HH = Number(m[4]);
      const MM = Number(m[5]);
      const dayKey = `${yy}-${pad(mo)}-${pad(dd)}`;
      const minutes = HH * 60 + MM;
      const slot = minutes / 15;
      return { dayKey, slot: Number.isInteger(slot) ? slot : null };
    }

    // 2) YYYY-MM-DD H:MM[:SS]
    m = datetimeStr.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
    );
    if (m) {
      const yy = Number(m[1]);
      const mo = Number(m[2]);
      const dd = Number(m[3]);
      const HH = Number(m[4]);
      const MM = Number(m[5]);
      const dayKey = `${yy}-${pad(mo)}-${pad(dd)}`;
      const minutes = HH * 60 + MM;
      const slot = minutes / 15;
      return { dayKey, slot: Number.isInteger(slot) ? slot : null };
    }

    return null;
  }

  for (const line of lines) {
    const low = line.toLowerCase();

    // skip obvious headers / meta lines
    if (
      low.includes("datum") ||
      low.includes("date") ||
      low.includes("timestamp") ||
      low.includes("zeit") ||
      low.startsWith("#")
    ) {
      continue;
    }

    // Accept common separators between datetime and value.
    // IMPORTANT: Do not rely on naive splitting because decimal comma can confuse delimiter detection.
    const m = line.match(/^(.+?)[;\t,]\s*([-+]?\d+(?:[\.,]\d+)?)\s*$/);
    if (!m) continue;

    const left = m[1].trim(); // datetime
    const valStr = m[2].trim().replace(",", "."); // decimal comma -> dot

    const v = Number(valStr);
    const parsed = parseDateAndSlot(left);
    if (!parsed) continue;
    if (parsed.slot === null) continue;
    if (parsed.slot < 0 || parsed.slot >= SLOTS_PER_DAY) continue;

    const arr = ensureDay(parsed.dayKey);
    arr[parsed.slot] = Number.isFinite(v) ? v : 0;
  }

  // build output objects (deterministic day order)
  const days = Array.from(byDay.keys()).sort();
  const result = [];

  for (const dayKey of days) {
    const values = byDay.get(dayKey);

    result.push({
      dayKey,
      values,
    });
  }

  return result;
}

// ============================
// Core MSCONS builder
// IMPORTANT: This is intentionally aligned with the generator project's
// buildMSCONS() implementation (segment order & content).
// ============================
function buildMSCONS(options) {
  const { locId, obis, start, end, values } = options;
  const ts = new Date();
  const rand = Math.floor(Math.random() * 9_000_000) + 1_000_000;
  const docId = `D${rand}`;
  const msgRef = `MS${rand}${pad(ts.getUTCSeconds(), 2)}`;

  const segments = [];
  segments.push("UNA:+.? '");
  segments.push(
    seg(
      "UNB",
      "UNOC:3",
      `${SENDER_ID}:500`,
      `${RECIPIENT_ID}:500`,
      `${pad(ts.getUTCFullYear() % 100)}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}:${pad(
        ts.getUTCHours()
      )}${pad(ts.getUTCMinutes())}`,
      docId,
      "",
      APP_CODE
    )
  );

  const msg = [];
  msg.push(seg("UNH", msgRef, "MSCONS:D:04B:UN:2.4c"));
  msg.push(seg("BGM", "Z48", msgRef, "9"));
  msg.push(seg("DTM", `137:${formatEdifactDateTime(ts)}:303`));
  msg.push(seg("RFF", "Z13:13025"));
  msg.push(seg("NAD", "MS", `${SENDER_ID}::293`));
  msg.push(seg("NAD", "MR", `${RECIPIENT_ID}::293`));
  msg.push(seg("UNS", "D"));
  msg.push(seg("NAD", "DP"));
  msg.push(seg("LOC", "172", locId));
  msg.push(seg("DTM", `163:${formatEdifactDateTime(start)}:303`));
  msg.push(seg("DTM", `164:${formatEdifactDateTime(end)}:303`));
  msg.push(seg("LIN", "1"));
  msg.push(seg("PIA", "5", `1-0?:${obis}:SRW`));

  let t = new Date(start.getTime());
  for (const v of values) {
    const tNext = new Date(t.getTime() + SLOT_MS);
    msg.push(seg("QTY", `220:${Number(v.toFixed(3))}`));
    msg.push(seg("DTM", `163:${formatEdifactDateTime(t)}:303`));
    msg.push(seg("DTM", `164:${formatEdifactDateTime(tNext)}:303`));
    t = tNext;
  }

  msg.push(seg("UNT", String(msg.length + 1), msgRef));
  segments.push.apply(segments, msg);
  segments.push(seg("UNZ", "1", docId));
  return segments.join("");
}

// ============================
// UI
// ============================
function MSCONSTranslator() {
  const JSZip = window.JSZip;
  const saveAs = window.saveAs;

  const [csvName, setCsvName] = useState("");
  const [csvDays, setCsvDays] = useState([]);
  const [csvError, setCsvError] = useState("");
  const [locId, setLocId] = useState("DE913000000000000000000000000000X");
  const [direction, setDirection] = useState("consumption"); // consumption|generation
  const [csvUnit, setCsvUnit] = useState("kwh"); // kwh|kw
  const [fallbackLinks, setFallbackLinks] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleCsvFile(file) {
    setCsvError("");
    setCsvName(file ? file.name : "");
    setCsvDays([]);
    setFallbackLinks((prev) => {
      prev.forEach((l) => URL.revokeObjectURL(l.href));
      return [];
    });
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseQuarterHourCSV(text);

      if (!parsed.length) {
        throw new Error(
          "CSV enthält keine lesbaren Zeilen. Erwartet: DD.MM.YYYY HH:MM;15,024"
        );
      }

      // Hard validation: every day must have 96 values and no NaNs
      for (const d of parsed) {
        if (!d.values || d.values.length !== SLOTS_PER_DAY) {
          throw new Error(
            `Tag ${d.dayKey} hat nicht exakt ${SLOTS_PER_DAY} Werte (hat ${d.values ? d.values.length : 0}).`
          );
        }
        if (d.values.some((v) => !Number.isFinite(v))) {
          throw new Error(`Tag ${d.dayKey} enthält ungültige Werte (NaN).`);
        }
      }

      setCsvDays(parsed);
    } catch (e) {
      setCsvError(String(e && e.message ? e.message : e));
    }
  }

  async function handleGenerateZip() {
    if (!JSZip) {
      alert("JSZip fehlt. Prüfe, ob jszip.min.js in index.html geladen wird.");
      return;
    }
    if (!saveAs) {
      alert("FileSaver (saveAs) fehlt. Prüfe, ob FileSaver.min.js in index.html geladen wird.");
      return;
    }
    if (!csvDays.length) {
      alert("Bitte zuerst eine CSV hochladen.\n\nFormat: DD.MM.YYYY HH:MM;15,024");
      return;
    }

    const loc = (locId || "").trim();
    if (!loc) {
      alert("Bitte eine Location-ID (MeLo) für LOC+172 angeben.");
      return;
    }

    setIsGenerating(true);
    try {
      const obis = direction === "generation" ? "2.8.0" : "1.8.0";
      const kind = direction === "generation" ? "ERZEUGUNG" : "VERBRAUCH";

      const allFiles = [];
      for (const d of csvDays) {
        const ymd = d.dayKey.replace(/-/g, "");
        const name =
          "MSCONS_" +
          APP_CODE +
          "_" +
          SENDER_ID +
          "_" +
          RECIPIENT_ID +
          "_" +
          ymd +
          "_" +
          loc +
          "_" +
          kind +
          ".txt";

        // Interval day convention: CSV day runs 00:00–24:00 (UTC) in 15-min slots.
        // We intentionally align DTM slots to the CSV timestamps (no DE settlement-day shift).
        const startBase = new Date(`${d.dayKey}T00:00:00Z`);
        const endBase = new Date(startBase.getTime() + 24 * 3600 * 1000);

        const content = buildMSCONS({
          locId: loc,
          obis,
          start: startBase,
          end: endBase,
          values: csvUnit === "kw" ? d.values.map((v) => v * 0.25) : d.values,
        });

        allFiles.push({ name, content, month: ymd.slice(0, 6) });
      }

      // size check (rough)
      const approxBytes = allFiles.reduce((sum, f) => sum + f.content.length, 0);
      const limitBytes = LIMIT_MB * 1024 * 1024;
      if (approxBytes > limitBytes) {
        const proceed = window.confirm(
          `Du erzeugst ca. ${(approxBytes / (1024 * 1024)).toFixed(1)} MB (> ${LIMIT_MB} MB). Fortfahren?`
        );
        if (!proceed) return;
      }

      // Monthly ZIPs (optional convenience)
      const months = Array.from(new Set(allFiles.map((f) => f.month))).sort();
      const monthZips = [];
      for (const m of months) {
        const z = new JSZip();
        allFiles
          .filter((f) => f.month === m)
          .forEach((f) => z.file(f.name, f.content));
        const blob = await z.generateAsync({ type: "blob" });
        const zipName =
          "MSCONS_" +
          APP_CODE +
          "_" +
          SENDER_ID +
          "_" +
          RECIPIENT_ID +
          "_" +
          m +
          "_" +
          loc +
          "_" +
          kind +
          "_CSV.zip";
        monthZips.push({ name: zipName, blob });
      }

      // Master ZIP
      const masterZip = new JSZip();
      allFiles.forEach((f) => masterZip.file(f.name, f.content));
      const masterBlob = await masterZip.generateAsync({ type: "blob" });
      const masterName =
        "MSCONS_" +
        APP_CODE +
        "_" +
        SENDER_ID +
        "_" +
        RECIPIENT_ID +
        "_" +
        months[0] +
        "-" +
        months[months.length - 1] +
        "_" +
        loc +
        "_" +
        kind +
        "_CSV_master.zip";

      saveAs(masterBlob, masterName);

      const links = [
        { name: masterName, href: URL.createObjectURL(masterBlob) },
        ...monthZips.map((z) => ({ name: z.name, href: URL.createObjectURL(z.blob) })),
      ];
      setFallbackLinks(links);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>MSCONS Translator</div>
            <div style={{ opacity: 0.8, fontSize: 13 }}>Version: {APP_VERSION}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="primary" onClick={handleGenerateZip} disabled={isGenerating}>
              {isGenerating ? "Generating..." : "Generate ZIP"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleCsvFile(e.target.files && e.target.files[0])}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>CSV unit</span>
            <select value={csvUnit} onChange={(e) => setCsvUnit(e.target.value)}>
              <option value="kwh">kWh (per 15 min)</option>
              <option value="kw">kW (avg power, 15 min)</option>
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 420 }}>
            <span>Location ID for LOC+172 (MeLo)</span>
            <input
              value={locId}
              onChange={(e) => setLocId(e.target.value)}
              placeholder="DE913000000000000000000000000000X"
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Direction</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="consumption">Verbrauch (1.8.0)</option>
              <option value="generation">Erzeugung (2.8.0)</option>
            </select>
          </label>
        </div>

        <div className="help" style={{ marginTop: 10 }}>
          {csvName ? (
            <span>
              Loaded: <strong>{csvName}</strong> — Days: <strong>{csvDays.length}</strong>
            </span>
          ) : (
            <span>
              Upload one CSV. The translator will create one TXT per day and a master ZIP (plus optional monthly ZIPs).
            </span>
          )}
        </div>

        {csvError && (
          <div className="error" style={{ marginTop: 8 }}>
            {csvError}
          </div>
        )}
      </div>

      {fallbackLinks.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Downloads</div>
          <ul>
            {fallbackLinks.map((l) => (
              <li key={l.name}>
                <a href={l.href} download={l.name}>
                  {l.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================
// Mount to DOM (NO export)
// ============================
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<MSCONSTranslator />);
