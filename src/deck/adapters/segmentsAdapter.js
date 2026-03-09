// /SRC/deck/adapters/segmentsAdapter.js
import { cumulativeDistances, interpolateAlong } from "../utils/interp.js";

// 정류장 ID 정규화: 대문자 + 선행 'S' 제거
function normStopId(x) {
  if (x == null) return null;
  return String(x).trim().replace(/^S/i, "").toUpperCase();
}
function to01(x) {
  return (x === 1 || x === true || x === "1") ? 1 : 0;
}

const FIVE_MIN = 5 * 60 * 1000; // 5분(ms)

function pickRouteIdFromTrip(trip, operation_id) {
  // trip 내 모든 segment에서 route 후보를 긁어오고,
  // operation_id와 동일한 값(오염값)은 버린다.
  for (const seg of (trip || [])) {
    const c =
      seg?.routeID ??
      seg?.routeId ??
      seg?.route_id ??
      seg?.routeCode ??
      seg?.route ??
      null;

    if (c == null) continue;
    if (operation_id != null && String(c) === String(operation_id)) continue; // ✅ 오염값 제거
    return c;
  }
  return null;
}

export function segmentsToRouteData(segments, baseMs, windowMs = 24 * 3600 * 1000) {
  const startMs = baseMs;
  const endMs   = baseMs + windowMs;
  const SEC     = 1000;
  const totalSec = Math.round(windowMs / SEC);

  // -----------------------------
  // Polling-aware grouping:
  //  1) group by vehicleID
  //  2) within vehicle: group by operationID, compute operation span (s/e)
  //  3) connected-components by span-overlap => drive (주행)
  //  4) build ONE routeData row per (vehicleID, drive)
  // -----------------------------

  function intervalsOverlap(aS, aE, bS, bE) {
    return (aS < bE) && (bS < aE);
  }

  function connectedComponentsOverlaps(items) {
    const n = items.length;
    if (n === 0) return [];
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (intervalsOverlap(items[i].s, items[i].e, items[j].s, items[j].e)) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }
    const comps = [];
    const seen = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const stack = [i];
      seen[i] = true;
      const comp = [];
      while (stack.length) {
        const u = stack.pop();
        comp.push(u);
        for (const v of adj[u]) {
          if (!seen[v]) {
            seen[v] = true;
            stack.push(v);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  // (1) vehicleID로 먼저 그룹
  const byVehicle = new Map();
  for (const s of (Array.isArray(segments) ? segments : [])) {
    const oid = s?.operationID;
    const vid = s?.vehicleID;

    if (!oid || !vid) continue;
    if (s.originMs == null || s.destMs == null) continue;
    if (!Array.isArray(s.polyline) || s.polyline.length < 2) continue;

    // 창과 겹치지 않으면 제외(성능/일관성)
    if (s.originMs > endMs || s.destMs < startMs) continue;

    if (!byVehicle.has(vid)) byVehicle.set(vid, []);
    byVehicle.get(vid).push(s);
  }

  const vehiclesOut = [];

  // (2) vehicle 단위 처리
  for (const [vehicleID, segsAll0] of byVehicle) {
    const segsAll = segsAll0.slice();

    // operationID별 그룹
    const byOp = new Map();
    for (const s of segsAll) {
      const opid = s.operationID;
      if (!byOp.has(opid)) byOp.set(opid, []);
      byOp.get(opid).push(s);
    }

    // operation span 계산 (scheduling의 total_s/total_e 역할)
    const opItems = [];
    for (const [opid, arr] of byOp) {
      let sMin = Infinity, eMax = -Infinity;
      for (const r of arr) {
        sMin = Math.min(sMin, r.originMs);
        eMax = Math.max(eMax, r.destMs);
      }
      const sC = Math.max(startMs, sMin);
      const eC = Math.min(endMs, eMax);
      if (eC <= sC) continue;
      opItems.push({ s: sC, e: eC, opid });
    }
    if (opItems.length === 0) continue;

    // (3) overlap 기반 drive(cluster) 생성
    const comps = connectedComponentsOverlaps(opItems);

    // 각 comp = drive 1개
    comps.forEach((comp, driveIndex) => {
      const opids = comp.map(i => opItems[i].opid);

      // drive에 속한 모든 segment 수집
      const driveSegs0 = [];
      for (const opid of opids) {
        const arr = byOp.get(opid) || [];
        for (const s of arr) driveSegs0.push(s);
      }

      // 시간 우선 정렬 + routeInfo 보조
      const driveSegs = driveSegs0
        .filter(s => s.originMs <= endMs && s.destMs >= startMs)
        .sort((a, b) => {
          if (a.originMs !== b.originMs) return (a.originMs || 0) - (b.originMs || 0);
          const ra = Number.isFinite(a.routeInfo) ? a.routeInfo : 0;
          const rb = Number.isFinite(b.routeInfo) ? b.routeInfo : 0;
          if (ra !== rb) return ra - rb;
          return (a.destMs || 0) - (b.destMs || 0);
        });

      if (driveSegs.length === 0) return;

      // ✅ drive 식별키: layer id 충돌 방지
      const driveKey = `${vehicleID}|||drive-${driveIndex}`;

      // (4) drive를 절대초 타임라인에 매핑 (기존 trip 로직을 drive 전체에 적용)
      const coords  = new Array(totalSec + 1).fill(null);
      const covered = new Array(totalSec + 1).fill(false);

      for (let i = 0; i < driveSegs.length; i++) {
        const seg = driveSegs[i];
        const poly = seg.polyline;
        const cum  = cumulativeDistances(poly);
        const tot  = cum[cum.length - 1] || 1;

        const segS = seg.originMs;
        const segE = Math.min(seg.destMs, endMs);
        if (segE <= startMs || segE <= segS) continue;

        const i0 = Math.ceil((segS - startMs) / SEC);
        const i1 = Math.floor((segE - startMs) / SEC);
        if (i1 < i0) continue;

        for (let t = i0; t <= i1; t++) covered[t] = true;

        // (중요) 같은 초가 중복 기록되면 '첫 값 유지'
        for (let t = i0; t <= i1; t++) {
          if (coords[t] != null) continue;
          const ms = startMs + t * SEC;
          const p  = Math.min(1, Math.max(0, (ms - seg.originMs) / Math.max(1, seg.destMs - seg.originMs)));
          const pt = interpolateAlong(poly, cum, tot * p);
          if (pt) coords[t] = pt;
        }

        // 연속(같은 정류장) + ≤5분이면 대기 좌표 유지
        const next = driveSegs[i + 1];
        if (next &&
            (next.routeInfo === (seg.routeInfo + 1)) &&
            (seg.destStationID === next.originStationID)) {
          const gapMs = next.originMs - seg.destMs;
          if (gapMs > 0 && gapMs <= FIVE_MIN) {
            const endIdx  = Math.floor((Math.min(seg.destMs, endMs) - startMs) / SEC);
            const nextIdx = Math.ceil((Math.max(next.originMs, startMs) - startMs) / SEC);
            const endPt   = interpolateAlong(poly, cum, tot * 1.0);
            for (let t = endIdx + 1; t < nextIdx; t++) {
              covered[t] = true;
              if (coords[t] == null && endPt) coords[t] = endPt;
            }
          }
        }
      }

      // drive 내부/대기만 ffill — drive 밖은 null 유지
      let last = null;
      for (let i = 0; i < coords.length; i++) {
        if (!covered[i]) { last = null; continue; }
        if (coords[i] == null && last) coords[i] = last;
        else if (coords[i] != null) last = coords[i];
      }

      // stops: 중간 정류장(첫 origin / 마지막 dest 제외)
      const firstOrigin = normStopId(driveSegs[0]?.originStationID);
      const lastDest    = normStopId(driveSegs[driveSegs.length - 1]?.destStationID);
      const stationSet = new Set();
      for (const seg of driveSegs) {
        const o = normStopId(seg.originStationID);
        const d = normStopId(seg.destStationID);
        if (o && o !== firstOrigin) stationSet.add(o);
        if (d && d !== lastDest)    stationSet.add(d);
      }
      const stops = Array.from(stationSet).map(id => ({ station: id }));

      // 이벤트 타임라인(절대 ms)
      const eventsTimeline = [];
      for (const seg of driveSegs) {
        const oId = normStopId(seg.originStationID);
        const dId = normStopId(seg.destStationID);

        const e = seg.events || {};
        const o = e.origin || {};
        const d = e.dest   || {};

        let p_up   = Number(o.pickup_total ?? 0);
        let w_up   = to01(o.pickup_wheelchair ?? 0);
        let p_down = Number(d.dropoff_total ?? 0);
        let w_down = to01(d.dropoff_wheelchair ?? 0);

        const hasSchemaB =
          (o.board !== undefined) || (d.alight !== undefined) ||
          (o.alight !== undefined) || (d.board !== undefined);
        if (hasSchemaB) {
          p_up   = Number(o.board?.passenger  ?? 0);
          w_up   = to01(o.board?.wheelchair   ?? 0);
          p_down = Number(d.alight?.passenger ?? 0);
          w_down = to01(d.alight?.wheelchair  ?? 0);
        }

        eventsTimeline.push({
          ms: seg.originMs,
          station: oId,
          phase: "depart",
          pickup_total: p_up,
          pickup_wheelchair: w_up,
          dropoff_total: 0,
          dropoff_wheelchair: 0
        });
        eventsTimeline.push({
          ms: seg.destMs,
          station: dId,
          phase: "arrive",
          pickup_total: 0,
          pickup_wheelchair: 0,
          dropoff_total: p_down,
          dropoff_wheelchair: w_down
        });
      }
      eventsTimeline.sort((a,b)=>a.ms-b.ms);

      // 온보드 배열(초 단위) — covered 밖은 0
      const onboardTotal = new Array(totalSec + 1).fill(0);
      const onboardWheel = new Array(totalSec + 1).fill(0);

      const deltas = {};
      for (const ev of eventsTimeline) {
        const idx = Math.floor((ev.ms - startMs) / SEC);
        if (idx < 0 || idx > totalSec) continue;
        const whlDelta = to01(ev.pickup_wheelchair) - to01(ev.dropoff_wheelchair);
        const totDelta = (ev.pickup_total || 0)      - (ev.dropoff_total || 0);
        if (!deltas[idx]) deltas[idx] = { tot: 0, whl: 0 };
        deltas[idx].tot += totDelta;
        deltas[idx].whl += whlDelta;
      }

      let curTot = 0, curWhl = 0;
      for (let i = 0; i <= totalSec; i++) {
        if (deltas[i]) {
          curTot += deltas[i].tot;
          curWhl  = Math.max(0, Math.min(1, curWhl + deltas[i].whl));
          curTot  = Math.max(0, curTot);
        }
        onboardTotal[i] = covered[i] ? curTot : 0;
        onboardWheel[i] = covered[i] ? curWhl : 0;
      }

      // 출력 (대표 segment 1개로 기존 UI 호환 유지)
      const firstSeg = driveSegs[0];
      const operation_id = firstSeg.operationID ?? null;
      const vehicle_id   = firstSeg.vehicleID ?? null;
      const route_id     = pickRouteIdFromTrip(driveSegs, operation_id);
      const vehicle_type = firstSeg.vehicleType || "car";

      vehiclesOut.push({
        // ✅ drive 단위 key (VehicleLayer에서 path id 충돌 방지)
        runKey: driveKey,
        driveKey,

        // 호환/표시용
        operation_id,
        operation_ids: opids,
        vehicle_id,
        route_id,
        vehicle_type,

        start_time: "00:00:00",
        baseMs: startMs,
        coords,
        stops,
        eventsTimeline,
        onboardTotal,
        onboardWheel,
      });
    });
  }

  return vehiclesOut;
}