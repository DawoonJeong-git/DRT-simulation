// src/deck/VehicleLayer.jsx
import { PathLayer, IconLayer, ScatterplotLayer } from "@deck.gl/layers";

// ---------- helpers ----------
function isPt(p) {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}
function findBackwardValid(arr, i) {
  for (let k = Math.min(i, arr.length - 1); k >= 0; k--) {
    if (isPt(arr[k])) return arr[k];
  }
  return null;
}
/** 출발 전에는 미래 좌표를 끌어오지 않는 안전 보간 */
function interpolatePositionSafe(coords, time) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const idx = Math.floor(time);
  const frac = Math.min(1, Math.max(0, time - idx));

  // 끝 이후: 마지막 유효점만
  if (idx >= coords.length - 1) return findBackwardValid(coords, coords.length - 1);

  const cur = coords[idx];
  const nxt = coords[idx + 1];
  const curOK = isPt(cur);
  const nxtOK = isPt(nxt);

  if (!curOK && !nxtOK) return null; // 출발 전

  const p1 = curOK ? cur : findBackwardValid(coords, idx);
  if (!p1) return null; // 과거에도 없음 → 표출 금지
  const p2 = nxtOK ? nxt : p1; // 미래로 당겨오지 않음

  const [x1, y1] = p1;
  const [x2, y2] = p2;
  return [x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac];
}
function compactPath(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const p of arr) {
    if (isPt(p)) out.push(p);
  }
  return out;
}

// ---------- zoom scaling helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function pxForZoom({ basePx, refZoom, alpha, minPx, maxPx }, z) {
  const zz = Number.isFinite(z) ? z : refZoom;
  const scaled = basePx * Math.pow(2, (zz - refZoom) * alpha);
  return clamp(scaled, minPx, maxPx);
}

// ---------- main ----------
/**
 * routeData[i] 필수 필드:
 *  - coords: [ [lng,lat], ... ] (자정~자정 절대초 인덱스)
 *  - onboardTotal: number[] (초 단위 총 탑승자)
 *  - onboardWheel: number[] (초 단위 휠체어 0/1)
 *  - stops: [{station: "ID"}, ...]  (중간 정류장만)
 *  - vehicle_id, vehicle_type
 *
 * ✅ polling/주행(drive) 대응:
 *  - v.runKey 또는 v.driveKey가 있으면 PathLayer id에 사용 (vehicle_id로만 하면 충돌)
 */
export function getVehicleLayers(routeData, elapsedTime, stationCoords = {}, viewState, garageId = null) {
  const pathLayers = [];
  const overlayLayers = [];

  // 자정 기준 절대초(float)
  const t = Math.max(0, Number(elapsedTime) || 0);

  // garage icon
  let garagePosition = null;
  if (garageId && stationCoords[garageId]) {
    garagePosition = stationCoords[garageId];
  }

  const vehicles = [];
  const stationIcons = [];
  const statusDots = [];

  const VEHICLE_ICON = {
    basePx: 30,
    refZoom: 13,
    alpha: 0.85,
    minPx: 12,
    maxPx: 160,
  };

  const STATION_ICON = {
    basePx: 22,
    refZoom: 13,
    alpha: 0.85,
    minPx: 10,
    maxPx: 140,
  };

  const GARAGE_ICON = {
    basePx: 26,
    refZoom: 13,
    alpha: 0.85,
    minPx: 12,
    maxPx: 180,
  };

  const zNow = viewState?.zoom ?? 13;
  const vehicleIconPxNow = pxForZoom(VEHICLE_ICON, zNow);

  for (const v of routeData || []) {
    const { coords, vehicle_id, vehicle_type, stops = [], onboardTotal, onboardWheel } = v || {};
    if (!Array.isArray(coords) || coords.length < 2) continue;

    const layerKey = v?.runKey || v?.driveKey || `${vehicle_id}|||${v?.operation_id ?? "na"}`;

    const rel = t;
    if (rel < 0 || rel >= coords.length) continue;

    const pos = interpolatePositionSafe(coords, rel);
    if (!pos) continue;

    const pi = Math.floor(rel);
    const pastCoords = compactPath(coords.slice(0, pi + 1));
    const futureCoords = compactPath(coords.slice(pi));

    if (pastCoords.length === 0 || pastCoords.at(-1)[0] !== pos[0] || pastCoords.at(-1)[1] !== pos[1]) {
      pastCoords.push(pos);
    }
    if (futureCoords.length === 0 || futureCoords[0][0] !== pos[0] || futureCoords[0][1] !== pos[1]) {
      futureCoords.unshift(pos);
    }

    if (pastCoords.length >= 2) {
      pathLayers.push(
        new PathLayer({
          id: `path-past-${layerKey}`,
          data: [{ path: pastCoords }],
          getPath: (d) => d.path,
          getColor: [251, 201, 108],
          getWidth: 2,
          widthScale: 4,
          opacity: 1,
          pickable: false,
        })
      );
    }

    if (futureCoords.length >= 2) {
      pathLayers.push(
        new PathLayer({
          id: `path-future-${layerKey}`,
          data: [{ path: futureCoords }],
          getPath: (d) => d.path,
          getColor: [239, 122, 98],
          getWidth: 2,
          widthScale: 4,
          opacity: 1,
          pickable: false,
        })
      );
    }

    const maxIdx = (Array.isArray(onboardTotal) ? onboardTotal.length : 1) - 1;
    const idx = Math.max(0, Math.min(Math.floor(rel), maxIdx));
    const onTot = Array.isArray(onboardTotal) ? Number(onboardTotal[idx] || 0) : 0;
    const onWhl = Array.isArray(onboardWheel) ? Number(onboardWheel[idx] || 0) : 0;
    const passengerWheel = Math.max(0, Math.min(1, onWhl));
    const passengerGeneral = Math.max(0, onTot - passengerWheel);

    const ALLOWED_VEHICLE_TYPES = new Set(["IONIQ5", "carnivalWheel", "carnivalReg"]);
    const vtRaw = vehicle_type ?? "";
    const vt = String(vtRaw).trim();
    const vtSafe = ALLOWED_VEHICLE_TYPES.has(vt) ? vt : "IONIQ5";
    const iconName = `/car_${vtSafe}.png`;

    if (!ALLOWED_VEHICLE_TYPES.has(vt)) {
      console.log("[VehicleType INVALID]", { vehicle_id, vehicle_type: vtRaw, trimmed: vt, fallback: vtSafe });
    }

    vehicles.push({
      vehicle_id,
      vehicle_type,
      position: pos,
      icon: iconName,
      passengerGeneral,
      passengerWheel,
      passengerCount: passengerGeneral + passengerWheel,
      startTime: "00:00:00",
    });

    // ✅ 상태점 위치 계산:
    // viewport.project/unproject 대신 줌 기반 간단 오프셋 사용
    // 장점: 줌 변경 시 바로 다시 계산되고, 비동기 꼬임 없음
    if (pos) {
      const now = performance.now();
      const blink = Math.floor((now / 500) % 2) === 0 ? 255 : 50;

      const lonOffset = 0.00001 * (vehicleIconPxNow / 20) / Math.pow(2, (zNow - 13) * 0.6);
      const latOffset = 0.00001 * (vehicleIconPxNow / 20) / Math.pow(2, (zNow - 13) * 0.6);

      statusDots.push({
        position: [pos[0] + lonOffset, pos[1] + latOffset],
        color: [0, 100, 255, blink],
      });
    }

    const nowMs = (typeof v.baseMs === "number" ? v.baseMs : 0) + Math.floor(rel) * 1000;
    const evs = Array.isArray(v.eventsTimeline) ? v.eventsTimeline : [];

    const normStation = (x) => String(x ?? "").trim().replace(/^S/i, "").toUpperCase();

    for (const s of stops || []) {
      const id = s?.station;
      if (!id) continue;

      const want = normStation(id);

      const hasFutureEvent = evs.some((ev) => {
        if (!ev) return false;
        if (normStation(ev.station) !== want) return false;
        return typeof ev.ms === "number" && ev.ms >= nowMs;
      });

      if (!hasFutureEvent) continue;

      const coord =
        stationCoords[id] ||
        stationCoords["S" + id] ||
        stationCoords[id?.toUpperCase?.()] ||
        stationCoords[("S" + id)?.toUpperCase?.()];

      if (coord) stationIcons.push({ stationId: id, position: coord, icon: "/station.png" });
    }
  }

  overlayLayers.push(
    new IconLayer({
      id: "vehicle-icons",
      data: vehicles,
      getIcon: (d) => ({ url: d.icon, width: 128, height: 128, anchorY: 128 }),
      getPosition: (d) => [...d.position, 5],
      getSize: () => pxForZoom(VEHICLE_ICON, zNow),
      sizeScale: 0.4,
      pickable: true,
      onHover: ({ object, x, y }) => {
        if (object) {
          window.setHoverInfo?.({
            type: "vehicle",
            vehicleId: object.vehicle_id,
            vehicleType: object.vehicle_type,
            passengerTotal: object.passengerCount,
            hasWheelchair: (object.passengerWheel || 0) > 0,
            passengerGeneral: object.passengerGeneral,
            passengerWheel: object.passengerWheel,
            startTime: object.startTime,
            x,
            y,
          });
        } else {
          window.setHoverInfo?.(null);
        }
      },
      parameters: { depthTest: false },
    })
  );

  overlayLayers.push(
    new IconLayer({
      id: "station-icons",
      data: stationIcons,
      getIcon: (d) => ({ url: d.icon, width: 80, height: 80, anchorY: 80 }),
      getPosition: (d) => [...d.position, 1],
      getSize: () => pxForZoom(STATION_ICON, zNow),
      sizeScale: 0.5,
      pickable: true,
      onHover: ({ object, x, y }) => {
        if (object) {
          window.setHoverInfo?.({ type: "station", stationId: object.stationId, x, y });
        } else {
          window.setHoverInfo?.(null);
        }
      },
      parameters: { depthTest: false },
    })
  );

  const garageCoord = garagePosition;
  if (garageCoord && isPt(garageCoord)) {
    overlayLayers.push(
      new IconLayer({
        id: "garage-icon",
        data: [{ position: garageCoord, icon: "/garage.png" }],
        getIcon: (d) => ({ url: d.icon, width: 128, height: 128, anchorY: 128 }),
        getPosition: (d) => [...d.position, 5],
        getSize: () => pxForZoom(GARAGE_ICON, zNow),
        sizeScale: 0.5,
        pickable: true,
        parameters: { depthTest: false },
      })
    );
  }

  overlayLayers.push(
    new ScatterplotLayer({
      id: "status-dots",
      data: statusDots,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getRadius: 3,
      radiusMinPixels: 3,
      pickable: false,
      parameters: { depthTest: false },
    })
  );

  return [...pathLayers, ...overlayLayers];
}