// Trace de voile synthétique à 1 Hz : bords de près et de portant, virements et empannages, vent du nord.
// Usage : node make-gpx.mjs <sortie> [décalage en heures]. Le décalage donne une autre session (autre instant
// de départ, donc autre identité dans la mémoire) avec la même trace.
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const offsetH = Number(process.argv[3] ?? 0);
const t0 = Date.UTC(2026, 8, 20, 13, 0, 0) + offsetH * 3_600_000;
let lat = 43.5, lon = 3.95, t = 0;
const pts = [];
const R = 6371000;
const step = (heading, speed) => {
  const d = speed;
  lat += (d * Math.cos(heading * Math.PI / 180)) / R * 180 / Math.PI;
  lon += (d * Math.sin(heading * Math.PI / 180)) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
  pts.push({ lat, lon, time: new Date(t0 + t * 1000).toISOString(), speed });
  t++;
};
const leg = (h, s, n) => { for (let i = 0; i < n; i++) step(h + Math.sin(i / 7) * 3, s + Math.sin(i / 5) * 0.5); };
const turn = (from, to, sMin, sMax, n) => {
  const diff = ((to - from + 540) % 360) - 180;
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    step((from + diff * f + 360) % 360, sMax - (sMax - sMin) * Math.sin(Math.PI * f));
  }
};
for (let k = 0; k < 6; k++) {
  leg(45, 7, 150); turn(45, 315, 3, 7, 6); leg(315, 7, 150); turn(315, 45, 3, 7, 6);
}
turn(45, 135, 6, 9, 5);
for (let k = 0; k < 6; k++) {
  leg(135, 9, 150); turn(135, 225, 6, 9, 6); leg(225, 9, 150); turn(225, 135, 6, 9, 6);
}
const body = pts.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${p.time}</time><extensions><speed>${p.speed.toFixed(2)}</speed></extensions></trkpt>`).join('\n');
writeFileSync(out, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="synth" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Synthétique</name><trkseg>\n${body}\n</trkseg></trk></gpx>\n`);
console.log(pts.length, 'points');
