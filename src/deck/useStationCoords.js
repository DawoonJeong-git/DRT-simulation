// src/deck/useStationCoords.js
import { useEffect, useState } from "react";

function normStationId(x) {
  if (x == null) return null;
  const s = String(x).trim();
  return { original: s.toUpperCase(), nos: s.replace(/^S/i, "").toUpperCase() };
}

// 아주 단순 CSV 파서 (현재 데이터는 쉼표+큰따옴표 정도라 이걸로 충분)
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCSVLine(line);
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i]));
    return obj;
  });
}
function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' ) {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s?.trim());
}
async function loadStationCSV(url, serviceType) {
  const res = await fetch(url, { cache: "no-store" });

  // ✅ 여기 추가: 404면 HTML(index.html) 받아서 파싱해버리는 걸 원천 차단
  if (!res.ok) {
    throw new Error(`[loadStationCSV] fetch failed ${res.status} ${url}`);
  }

  const text = await res.text();

  // ✅ 혹시 HTML이면 바로 확인 가능하게
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
    if (!window.__stationCoordsByServiceType[serviceType]) window.__stationCoordsByServiceType[serviceType] = {};
    window.__stationCoordsByServiceType[serviceType][original] = coords;
    window.__stationCoordsByServiceType[serviceType][nos] = coords;
  }

  return out;
}


export function useStationCoords() {
  const [map, setMap] = useState({});


  useEffect(() => {
    let abort = false;
    let timer = null;

    const load = async () => {
      try {
        const [a, b] = await Promise.all([
          loadStationCSV("/ODD/Station_교통약자구간.csv", 1),
          loadStationCSV("/ODD/Station_소외구간.csv", 2),
        ]);

        const merged = { ...a, ...b };
        if (!abort) {
          setMap(merged);                 // ✅ 값 바뀌면 CombinedView effect가 다시 돈다
          window.__stationCoords = merged;
          console.log("[useStationCoords] stations:", Object.keys(merged).length);
        }
      } catch (e) {
        console.warn("useStationCoords load failed:", e);
      }
      
    const [a, b] = await Promise.all([
      loadStationCSV("/ODD/Station_교통약자구간.csv", 1),
      loadStationCSV("/ODD/Station_소외구간.csv", 2),
    ]);

    console.log("[useStationCoords] type1:", Object.keys(a).length, "type2:", Object.keys(b).length);

    };

    load();
    timer = setInterval(load, 5000); // ✅ 5초마다 갱신 (원하면 2000~10000)

    return () => {
      abort = true;
      if (timer) clearInterval(timer);
    };
  }, []);


  return map;
}
