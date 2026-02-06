// src/maplibre/MapLayers.jsx
// ✅ 한글 파일명 유지 + CSV만 사용
// ✅ Node는 표시하지 않음
// ✅ Link는 CSV의 geometry (LINESTRING Z ...)를 그대로 따라가되,
//    좌표가 UTM(투영좌표)라서 EPSG:32652 -> WGS84(lon/lat)로 변환 후 표시

import proj4 from "proj4";

/* ---------------------------
 * CSV utils
 * --------------------------- */
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
  return out.map((s) => (s ?? "").trim());
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCSVLine(line);
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] ?? ""));
    return obj;
  });
}

function toNum(v) {
  const n = Number(String(v ?? "").replace(/"/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pickKey(obj, candidates) {
  const keys = Object.keys(obj || {});
  const lower = keys.map((k) => k.toLowerCase());

  // exact
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx >= 0) return keys[idx];
  }
  // contains
  for (const c of candidates) {
    const idx = lower.findIndex((k) => k.includes(c));
    if (idx >= 0) return keys[idx];
  }
  return null;
}

async function fetchCsvFromODD(filename) {
  // ✅ 한글 파일명 유지: URL-encoding 필수
  const url = `/ODD/${encodeURIComponent(filename)}`;
  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) throw new Error(`CSV fetch failed ${res.status}: ${url}`);

  const text = await res.text();
  const t = text.trim();

  // 서버가 404면 index.html(HTML) 주는 경우 방지
  if (!t || t.startsWith("<")) throw new Error(`CSV returned HTML/non-csv: ${url}`);

  return text;
}

/* ---------------------------
 * WKT LINESTRING (Z) parser
 * --------------------------- */
function parseLineStringZ(wkt) {
  // Accept:
  // LINESTRING Z (x y z, x y z, ...)
  // LINESTRING (x y, x y, ...)
  const s = String(wkt ?? "").trim();
  if (!s) return null;

  const m = s.match(/linestring\s*(z)?\s*\((.*)\)\s*$/i);
  if (!m) return null;

  const body = m[2].trim();
  if (!body) return null;

  const pts = body
    .split(",")
    .map((chunk) => {
      const nums = chunk
        .trim()
        .split(/\s+/)
        .map((x) => Number(x));
      if (nums.length < 2 || !Number.isFinite(nums[0]) || !Number.isFinite(nums[1])) return null;
      return [nums[0], nums[1]]; // ignore z
    })
    .filter(Boolean);

  return pts.length >= 2 ? pts : null;
}

function looksLikeLonLat(coords) {
  const [x, y] = coords?.[0] ?? [];
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90;
}

/* ---------------------------
 * CSV -> GeoJSON converters
 * --------------------------- */
function csvToStationsFC(csvText, serviceType) {
  const rows = parseCSV(csvText);
  if (!rows.length) return { type: "FeatureCollection", features: [] };

  const sample = rows[0];
  const idK = pickKey(sample, ["stationid", "id", "station_id"]);
  const lonK = pickKey(sample, ["stationlon", "lon", "lng", "longitude", "x"]);
  const latK = pickKey(sample, ["stationlat", "lat", "latitude", "y"]);

  const feats = [];
  for (const r of rows) {
    const id = (r[idK] ?? "").trim();
    const lon = toNum(r[lonK]);
    const lat = toNum(r[latK]);
    if (!id || lon == null || lat == null) continue;

    feats.push({
      type: "Feature",
      properties: { ...r, id, serviceType },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }
  return { type: "FeatureCollection", features: feats };
}

function csvToLinksFC_fromGeometry(csvText, serviceType, projectToLonLat) {
  const rows = parseCSV(csvText);
  if (!rows.length) return { type: "FeatureCollection", features: [] };

  const sample = rows[0];
  const idK = pickKey(sample, ["linkid", "id", "link_id"]);
  const geomK = pickKey(sample, ["geometry", "geom", "wkt"]);

  const feats = [];
  for (const r of rows) {
    const id = (r[idK] ?? "").trim();
    const wkt = r[geomK];
    if (!id || !wkt) continue;

    const coordsXY = parseLineStringZ(wkt);
    if (!coordsXY) continue;

    let coords = coordsXY;

    // ✅ 투영좌표면 변환
    if (!looksLikeLonLat(coordsXY)) {
      coords = coordsXY
        .map(([x, y]) => projectToLonLat(x, y))
        .filter((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
      if (coords.length < 2) continue;
    }

    feats.push({
      type: "Feature",
      properties: { ...r, id, serviceType },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  return { type: "FeatureCollection", features: feats };
}

/* ---------------------------
 * MapLibre wiring
 * --------------------------- */
export function addMapLibreLayers(map) {
  // Sources (empty first)
  if (!map.getSource("stations-1")) {
    map.addSource("stations-1", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getSource("stations-2")) {
    map.addSource("stations-2", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getSource("links-1")) {
    map.addSource("links-1", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getSource("links-2")) {
    map.addSource("links-2", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }

  // Link layers (behind)
  if (!map.getLayer("links-layer-1")) {
    map.addLayer({
      id: "links-layer-1",
      type: "line",
      source: "links-1",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.5,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.6, 18, 5.5],
      },
    });
  }
  if (!map.getLayer("links-layer-2")) {
    map.addLayer({
      id: "links-layer-2",
      type: "line",
      source: "links-2",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.5,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 2.6, 18, 5.5],
      },
    });
  }

  // Station layers (on top)
  if (!map.getLayer("stations-layer-1")) {
    map.addLayer({
      id: "stations-layer-1",
      type: "circle",
      source: "stations-1",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 4, 18, 7],
        "circle-color": "#ffffff",
        "circle-opacity": 0.4,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#000000",
        "circle-stroke-opacity": 0.4,
      },
    });
  }
  if (!map.getLayer("stations-layer-2")) {
    map.addLayer({
      id: "stations-layer-2",
      type: "circle",
      source: "stations-2",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 4, 18, 7],
        "circle-color": "#ffffff",
        "circle-opacity": 0.4,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#000000",
        "circle-stroke-opacity": 0.4,
      },
    });
  }

  // ✅ 좌표 변환: EPSG:32652(UTM zone 52N) -> EPSG:4326(WGS84 lon/lat)
  // Link CSV geometry가 307xxx / 4119xxx 형태였던 케이스에 맞춤
  const projectToLonLat = (x, y) => {
    const [lon, lat] = proj4("EPSG:32652", "EPSG:4326", [x, y]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  };

  // Load CSV once
  (async () => {
    try {
      const [st1Text, st2Text, lk1Text, lk2Text] = await Promise.all([
        fetchCsvFromODD("Station_교통약자구간.csv"),
        fetchCsvFromODD("Station_소외구간.csv"),
        fetchCsvFromODD("Link_교통약자구간.csv"),
        fetchCsvFromODD("Link_소외구간.csv"),
      ]);

      const st1 = csvToStationsFC(st1Text, 1);
      const st2 = csvToStationsFC(st2Text, 2);

      const lk1 = csvToLinksFC_fromGeometry(lk1Text, 1, projectToLonLat);
      const lk2 = csvToLinksFC_fromGeometry(lk2Text, 2, projectToLonLat);

      map.getSource("stations-1")?.setData(st1);
      map.getSource("stations-2")?.setData(st2);
      map.getSource("links-1")?.setData(lk1);
      map.getSource("links-2")?.setData(lk2);

      // quick debug: 첫 좌표가 lon/lat(126~129, 34~38)로 찍혀야 정상
      console.log("[MapLayers] loaded",
        "stations1", st1.features.length,
        "stations2", st2.features.length,
        "links1", lk1.features.length,
        "links2", lk2.features.length,
        "lk1 first", lk1.features?.[0]?.geometry?.coordinates?.[0]
      );
    } catch (e) {
      console.warn("[MapLayers] CSV load failed:", e);
    }
  })();
}

export function setMapLayerMode(map, mode, coverageVisible = true) {
  // coverage OFF면 전부 숨김
  if (!coverageVisible) {
    const v = "none";
    if (map.getLayer("stations-layer-1")) map.setLayoutProperty("stations-layer-1", "visibility", v);
    if (map.getLayer("stations-layer-2")) map.setLayoutProperty("stations-layer-2", "visibility", v);
    if (map.getLayer("links-layer-1")) map.setLayoutProperty("links-layer-1", "visibility", v);
    if (map.getLayer("links-layer-2")) map.setLayoutProperty("links-layer-2", "visibility", v);
    return;
  }

  // coverage ON이면 mode에 따라 1/2 가시성 분기
  const show1 = mode === "both" || mode === "accessible";
  const show2 = mode === "both" || mode === "underserved";

  const v1 = show1 ? "visible" : "none";
  const v2 = show2 ? "visible" : "none";

  if (map.getLayer("stations-layer-1")) map.setLayoutProperty("stations-layer-1", "visibility", v1);
  if (map.getLayer("stations-layer-2")) map.setLayoutProperty("stations-layer-2", "visibility", v2);

  if (map.getLayer("links-layer-1")) map.setLayoutProperty("links-layer-1", "visibility", v1);
  if (map.getLayer("links-layer-2")) map.setLayoutProperty("links-layer-2", "visibility", v2);
}