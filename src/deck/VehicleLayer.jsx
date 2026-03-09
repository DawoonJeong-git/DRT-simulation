// src/deck/VehicleLayer.jsx
import { PathLayer, IconLayer, ScatterplotLayer } from "@deck.gl/layers";

// ---------- helpers ----------
function isPt(p) {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}
function findBackwardValid(arr, i) {
  for (let k = Math.min(i, arr.length - 1); k >= 0; k--) if (isPt(arr[k])) return arr[k];
  return null;
}
/** 출발 전에는 미래 좌표를 끌어오지 않는 안전 보간 */
function interpolatePositionSafe(coords, time) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const idx = Math.floor(time);
  const frac = Math.min(1, Math.max(0, time - idx));

  // 끝 이후: 마지막 유효점만
  if (idx >= coords.length - 1) return findBackwardValid(coords, coords.length - 1);

  const cur = coords[idx],
    nxt = coords[idx + 1];
  const curOK = isPt(cur),
    nxtOK = isPt(nxt);

  if (!curOK && !nxtOK) return null; // 출발 전

  const p1 = curOK ? cur : findBackwardValid(coords, idx);
  if (!p1) return null; // 과거에도 없음 → 표출 금지
  const p2 = nxtOK ? nxt : p1; // 미래로 당겨오지 않음

  const [x1, y1] = p1,
    [x2, y2] = p2;
  return [x1 + (x2 - x1) * frac, y1 + (y2 - y1) * frac];
}
function compactPath(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const p of arr) if (isPt(p)) out.push(p);
  return out;
}

// ---------- optional (garage marker) ----------
let cachedGarageId = null;
async function getGarageId() {
  if (cachedGarageId) return cachedGarageId;
  try {
    const res = await fetch("/garage.json");
    const json = await res.json();
    cachedGarageId = json.garageStationId;
  } catch (_) {
    cachedGarageId = null;
  }
  return cachedGarageId;
}

// ---------- zoom scaling helpers (핵심) ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * zoom 기반 px 크기 계산.
 * - WebMercator 줌은 스케일이 2^zoom 이라서 기본은 2^(z-ref)
 * - ALPHA(0~1)를 곱하면 변화가 완만해짐: 2^((z-ref)*ALPHA)
 * - MIN/MAX로 과도한 크기 폭주 방지
 */
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
export async function getVehicleLayers(routeData, elapsedTime, stationCoords = {}, viewport) {
  const pathLayers = [];
  const overlayLayers = [];

  // 자정 기준 절대초(float)
  const t = Math.max(0, Number(elapsedTime) || 0);

  // --------- optional: garage icon ---------
  let garagePosition = null;
  const garageId = await getGarageId();
  if (garageId && stationCoords[garageId]) garagePosition = stationCoords[garageId];

  const vehicles = [];
  const stationIcons = [];
  const statusDots = [];

  // ====== (A) 아이콘 스케일 파라미터: 3개 분리 유지 ======
  // ✅ 너는 보통 여기 basePx 값만 만지면 됨
  const VEHICLE_ICON = {
    basePx: 30, // ✅ 차량 기준값
    refZoom: 13,
    alpha: 0.85, // 1.0=줌비율 그대로(2배씩), 0.75~0.9 추천
    minPx: 12,
    maxPx: 160,
  };

  const STATION_ICON = {
    basePx: 22, // ✅ 정류장 기준값
    refZoom: 13,
    alpha: 0.85,
    minPx: 10,
    maxPx: 140,
  };

  const GARAGE_ICON = {
    basePx: 26, // ✅ 차고지 기준값
    refZoom: 13,
    alpha: 0.85,
    minPx: 12,
    maxPx: 180,
  };

  // 현재 프레임 zoom
  const zNow = viewport?.zoom ?? 13;

  // 현재 프레임에서의 차량 아이콘 픽셀 크기(상태점 오프셋 계산에 사용)
  const vehicleIconPxNow = pxForZoom(VEHICLE_ICON, zNow);

  for (const v of routeData || []) {
    const { coords, vehicle_id, vehicle_type, stops = [], onboardTotal, onboardWheel } = v || {};
    if (!Array.isArray(coords) || coords.length < 2) continue;

    // ✅ polling/주행(drive)용 고유 키: path layer id 충돌 방지
    const layerKey = v?.runKey || v?.driveKey || `${vehicle_id}|||${v?.operation_id ?? "na"}`;

    const rel = t;
    if (rel < 0 || rel >= coords.length) continue;

    const pos = interpolatePositionSafe(coords, rel);
    if (!pos) continue;

    // 경로: 현재 프레임 위치를 봉합하여 끊김 없이 보이게
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
          id: `path-past-${layerKey}`, // ✅ 기존 vehicle_id → layerKey
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
          id: `path-future-${layerKey}`, // ✅ 기존 vehicle_id → layerKey
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

    // ---- 승객 수(하차 즉시 반영) ----
    const maxIdx = (Array.isArray(onboardTotal) ? onboardTotal.length : 1) - 1;
    const idx = Math.max(0, Math.min(Math.floor(rel), maxIdx));
    const onTot = Array.isArray(onboardTotal) ? Number(onboardTotal[idx] || 0) : 0;
    const onWhl = Array.isArray(onboardWheel) ? Number(onboardWheel[idx] || 0) : 0;
    const passengerWheel = Math.max(0, Math.min(1, onWhl));
    const passengerGeneral = Math.max(0, onTot - passengerWheel);

    // ✅ 차량 아이콘 데이터 (프로젝트 규칙: car_{VehicleType}.png)
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

    // ====== (B) 상태 점: "아이콘 우측상단"을 따라오도록 픽셀 오프셋을 아이콘 크기에 비례 ======
    if (pos && viewport?.project && viewport?.unproject) {
      const now = performance.now();
      const blink = Math.floor((now / 500) % 2) === 0 ? 255 : 50;

      const sp = viewport.project(pos);

      // 아이콘 크기에 비례한 오프셋 (너무 멀거나 가깝다면 0.32~0.45 범위로 조절)
      const dx = Math.round(vehicleIconPxNow * 0.38);
      const dy = Math.round(vehicleIconPxNow * 0.38);

      const gp = viewport.unproject([sp[0] + dx, sp[1] - dy]);
      statusDots.push({ position: gp, color: [0, 100, 255, blink] });
    }

    // 정류장 아이콘(중간 정류장만) — ✅ 지나간 정류장 자동 제거(미래 이벤트가 있는 정류장만 남김)
    const nowMs = (typeof v.baseMs === "number" ? v.baseMs : 0) + Math.floor(rel) * 1000;
    const evs = Array.isArray(v.eventsTimeline) ? v.eventsTimeline : [];

    const normStation = (x) => String(x ?? "").trim().replace(/^S/i, "").toUpperCase();

    for (const s of stops || []) {
      const id = s?.station;
      if (!id) continue;

      const want = normStation(id);

      // ✅ 이 정류장에서 “미래 이벤트(>= nowMs)”가 남아있을 때만 아이콘 표시
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

  // ---- 차량 아이콘 layer ----
  overlayLayers.push(
    new IconLayer({
      id: "vehicle-icons",
      data: vehicles,
      getIcon: (d) => ({ url: d.icon, width: 128, height: 128, anchorY: 128 }),
      getPosition: (d) => [...d.position, 5],
      getSize: () => pxForZoom(VEHICLE_ICON, viewport?.zoom ?? VEHICLE_ICON.refZoom),
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

  // ---- 정류장 아이콘 layer ----
  overlayLayers.push(
    new IconLayer({
      id: "station-icons",
      data: stationIcons,
      getIcon: (d) => ({ url: d.icon, width: 80, height: 80, anchorY: 80 }),
      getPosition: (d) => [...d.position, 1],
      getSize: () => pxForZoom(STATION_ICON, viewport?.zoom ?? STATION_ICON.refZoom),
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

  // ---- 차고지 아이콘(있을 때만) ----
  const garageCoord = garagePosition;
  if (garageCoord && isPt(garageCoord)) {
    overlayLayers.push(
      new IconLayer({
        id: "garage-icon",
        data: [{ position: garageCoord, icon: "/garage.png" }],
        getIcon: (d) => ({ url: d.icon, width: 128, height: 128, anchorY: 128 }),
        getPosition: (d) => [...d.position, 5],
        getSize: () => pxForZoom(GARAGE_ICON, viewport?.zoom ?? GARAGE_ICON.refZoom),
        sizeScale: 0.5,
        pickable: true,
        parameters: { depthTest: false },
      })
    );
  }

  // ---- 상태 점 layer ----
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