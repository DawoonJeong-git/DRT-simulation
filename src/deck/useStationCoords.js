import { useEffect, useState } from "react";

function normStationId(x) {
  if (x == null) return null;
  const s = String(x).trim();
  return { original: s.toUpperCase(), nos: s.replace(/^S/i, "").toUpperCase() };
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.map((s) => s?.trim());
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCSVLine(line);
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = cols[i];
    });
    return obj;
  });
}

async function loadStationCSV(url, serviceType) {
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    throw new Error(`[loadStationCSV] fetch failed ${res.status} ${url}`);
  }

  const text = await res.text();
  const t = text.trim();

  if (!t || t.startsWith("<")) {
    throw new Error(`[loadStationCSV] got HTML/non-CSV from ${url}: ${t.slice(0, 80)}`);
  }

  const rows = parseCSV(text);
  const out = {};

  for (const r of rows) {
    const rawId = r.StationID ?? r.stationId ?? r.id;
    const lon = Number(r.StationLon);
    const lat = Number(r.StationLat);
    if (!rawId || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;

    const { original, nos } = normStationId(rawId);
    const coords = [lon, lat];

    out[original] = coords;
    out[nos] = coords;

    if (!window.__stationCoordsByServiceType) window.__stationCoordsByServiceType = {};
    if (!window.__stationCoordsByServiceType[serviceType]) {
      window.__stationCoordsByServiceType[serviceType] = {};
    }
    window.__stationCoordsByServiceType[serviceType][original] = coords;
    window.__stationCoordsByServiceType[serviceType][nos] = coords;
  }

  return out;
}

export function useStationCoords() {
  const [map, setMap] = useState({});

  useEffect(() => {
    let abort = false;

    const load = async () => {
      try {
        window.__stationCoordsByServiceType = {};

        const [accessible, underserved] = await Promise.all([
          loadStationCSV("/ODD/Station_교통약자구간.csv", 1),
          loadStationCSV("/ODD/Station_소외구간.csv", 2),
        ]);

        if (abort) return;

        const merged = { ...accessible, ...underserved };
        window.__stationCoords = merged;
        setMap(merged);
        console.log("[useStationCoords] stations:", Object.keys(merged).length);
      } catch (e) {
        console.warn("useStationCoords load failed:", e);
      }
    };

    load();

    return () => {
      abort = true;
    };
  }, []);

  return map;
}
