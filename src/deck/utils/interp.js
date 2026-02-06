// /SRC/deck/utils/interp.js
// 거리 기반(하버사인) 누적거리/보간 유틸 — 레이어는 손대지 않고 데이터만 가공.

export function haversine(a, b) {
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function cumulativeDistances(polyline) {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum.push(cum[i - 1] + haversine(polyline[i - 1], polyline[i]));
  }
  return cum;
}

export function interpolateAlong(polyline, cum, target) {
  // target in meters (0 ~ total)
  const n = polyline.length;
  if (!n) return null;
  const total = cum[cum.length - 1] ?? 0;
  if (target <= 0) return polyline[0];
  if (target >= total) return polyline[n - 1];

  // (선형 탐색으로 충분; 필요 시 이분탐색으로 교체 가능)
  let i = 1;
  while (i < cum.length && cum[i] < target) i++;
  const i0 = i - 1;
  const segLen = (cum[i] - cum[i0]) || 1e-9;
  const t = (target - cum[i0]) / segLen;
  const a = polyline[i0], b = polyline[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
