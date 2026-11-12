// Serves the iPhone-subscribable calendar (.ics) for the projects board.
// GET /api/cal?id=<secret feed id>  →  text/calendar
// The app writes the feed to Firestore at feeds/<id> (public read by unguessable id, owner-only write).
const PROJECT = "projack-manger";
const API_KEY = "AIzaSyCwkG2cVsCfHJPs7hp_FGGHS-oqL_2QwuQ";

const pad = (n) => String(n).padStart(2, "0");
const esc = (x) => String(x || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines longer than 75 octets must be folded (RFC 5545).
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 74) return line;
  const out = []; let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 73 : 74)) { out.push(cur); cur = ""; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function stamp(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"; }

function buildIcs(items, updatedAt) {
  const now = stamp(new Date());
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//projects-board//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:לוח הפרויקטים", "X-WR-TIMEZONE:Asia/Jerusalem", "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const t of items) {
    if (!t || !t.id || !t.due) continue;
    const d = t.due.replace(/-/g, "");
    const [h, m] = (t.time || "09:00").split(":").map(Number);
    const startDt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), h, m));
    const endDt = new Date(startDt.getTime() + (t.time ? 30 : 15) * 60000);
    const local = (x) => x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()) + "T" + pad(x.getUTCHours()) + pad(x.getUTCMinutes()) + "00";
    const desc = [t.project ? "פרויקט: " + t.project : "", ...(t.notes || []).map((n) => "• " + n), (t.subtasks || []).length ? "\n" + t.subtasks.map((s) => (s.done ? "☑ " : "☐ ") + s.text).join("\n") : "", "https://dadi55550-commits.github.io/projects-board/"].filter(Boolean).join("\n");
    L.push("BEGIN:VEVENT", "UID:" + t.id + "@projects-board", "DTSTAMP:" + now, "LAST-MODIFIED:" + stamp(new Date(updatedAt || Date.now())),
      "DTSTART;TZID=Asia/Jerusalem:" + local(startDt), "DTEND;TZID=Asia/Jerusalem:" + local(endDt),
      "SUMMARY:" + esc((t.priority === "high" ? "❗ " : "") + t.title), "DESCRIPTION:" + esc(desc));
    if (t.recur) L.push("RRULE:FREQ=" + ({ daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" }[t.recur] || "DAILY"));
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(t.title), "TRIGGER:" + (t.time ? "-PT15M" : "PT0M"), "END:VALARM", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

const VTZ = ["BEGIN:VTIMEZONE", "TZID:Asia/Jerusalem", "BEGIN:STANDARD", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0200", "TZNAME:IST", "END:STANDARD",
  "BEGIN:DAYLIGHT", "DTSTART:19700327T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0300", "TZNAME:IDT", "END:DAYLIGHT", "END:VTIMEZONE"];

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
  if (id.length < 16) { res.status(404).send("not found"); return; }
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/feeds/${id}?key=${API_KEY}`);
    if (!r.ok) { res.status(404).send("not found"); return; }
    const doc = await r.json();
    const f = doc.fields || {};
    const items = JSON.parse((f.json && f.json.stringValue) || "[]");
    let ics = buildIcs(items, f.updatedAt && f.updatedAt.stringValue);
    ics = ics.replace("METHOD:PUBLISH\r\n", "METHOD:PUBLISH\r\n" + VTZ.join("\r\n") + "\r\n");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, max-age=0");
    res.setHeader("Content-Disposition", 'inline; filename="projects-board.ics"');
    res.status(200).send(ics);
  } catch (e) {
    res.status(500).send("error");
  }
};
module.exports.buildIcs = buildIcs;
