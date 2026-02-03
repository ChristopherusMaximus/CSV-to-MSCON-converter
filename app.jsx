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
// Helpers
// ============================
function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDTM(d) {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// ============================
// CSV Parsing
// ============================
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const values = [];

  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 2) continue;

    const value = parseFloat(parts[1].replace(",", "."));
    if (!isNaN(value)) values.push(value);
  }

  return values;
}

// ============================
// MSCONS Builder
// ============================
function buildMSCONS(values, startDateUTC, melo) {
  const lines = [];

  lines.push(
    `UNB+UNOC:3+9979383000006:500+9906629000002:500+${formatDTM(
      new Date()
    )}+D${Math.floor(Math.random() * 1e9)}'`
  );
  lines.push(`UNH+1+MSCONS:D:04B:UN:2.4c'`);
  lines.push(`BGM+Z48+1+9'`);
  lines.push(`DTM+137:${formatDTM(new Date())}?+00:303'`);
  lines.push(`NAD+MS+9979383000006::293'`);
  lines.push(`NAD+MR+9906629000002::293'`);
  lines.push(`UNS+D'`);
  lines.push(`NAD+DP'`);
  lines.push(`LOC+172+${melo}'`);

  const periodStart = new Date(startDateUTC);
  const periodEnd = addMinutes(periodStart, values.length * 15);

  lines.push(`DTM+163:${formatDTM(periodStart)}?+00:303'`);
  lines.push(`DTM+164:${formatDTM(periodEnd)}?+00:303'`);

  lines.push(`LIN+1'`);
  lines.push(`PIA+5+1-0?:1.8.0:SRW'`);

  let cursor = new Date(periodStart);

  for (let i = 0; i < values.length; i++) {
    const slotStart = new Date(cursor);
    const slotEnd = addMinutes(slotStart, 15);

    lines.push(`QTY+220:${values[i]}'`);
    lines.push(`DTM+163:${formatDTM(slotStart)}?+00:303'`);
    lines.push(`DTM+164:${formatDTM(slotEnd)}?+00:303'`);

    cursor = slotEnd;
  }

  lines.push(`UNT+${lines.length + 1}+1'`);
  lines.push(`UNZ+1+D1'`);

  return lines.join("\n");
}

// ============================
// React UI
// ============================
function MSCONSTranslator() {
  const [csvFile, setCsvFile] = useState(null);
  const [melo, setMelo] = useState("");

  function handleConvert() {
    if (!csvFile || !melo) return;

    const reader = new FileReader();
    reader.onload = () => {
      const values = parseCSV(reader.result);

      const startDateUTC = new Date(Date.UTC(2024, 0, 11, 22, 0, 0));
      const content = buildMSCONS(values, startDateUTC, melo);

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      saveAs(blob, "MSCONS.txt");
    };

    reader.readAsText(csvFile);
  }

  return (
    <div>
      <h1>MSCONS Translator</h1>

      <input type="file" accept=".csv" onChange={e => setCsvFile(e.target.files[0])} />
      <input
        placeholder="MELO"
        value={melo}
        onChange={e => setMelo(e.target.value)}
      />

      <button onClick={handleConvert}>Convert</button>
    </div>
  );
}

// ============================
// Mount
// ============================
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<MSCONSTranslator />);
