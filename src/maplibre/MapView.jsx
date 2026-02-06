import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addMapLibreLayers, setMapLayerMode } from "./MapLayers";

// ✅ coverageVisible 추가
function MapView({ viewState, setViewState, areaMode, coverageVisible }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);

  // ✅ 최신 viewState 참조(키보드 핸들러 stale closure 방지)
  const viewStateRef = useRef(viewState);
  useEffect(() => {
    viewStateRef.current = viewState;
  }, [viewState]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style:
        "https://api.maptiler.com/maps/0199c98a-b82b-79cb-9574-a3fa794bea0f/style.json?key=hxJKhwGnL2MZxHh5fCcz",
      center: [viewStateRef.current.longitude, viewStateRef.current.latitude],
      zoom: viewStateRef.current.zoom,
      pitch: viewStateRef.current.pitch,
      bearing: viewStateRef.current.bearing,
      minZoom: 10,
      maxZoom: 18,
      keyboard: false,
    });

    mapRef.current = map;

    // ✅ MapLibre는 "배경"만. 인터랙션은 DeckGL이 담당
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.touchZoomRotate.disable();

    // =========================
    // ✅ 키보드 단축키: viewState만 갱신 (Map을 직접 조작하지 않음)
    // =========================
    const movePx = 50; // 화면 픽셀 느낌 이동량(대략)
    const rotateDeg = 2.5;
    const pitchDeg = 2;
    const zoomStep = 0.05;

    const heldKeys = new Set();
    let rafId = null;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const wrapBearing = (b) => (((b + 180) % 360 + 360) % 360) - 180;

    // WebMercator 근사: meters per pixel
    const metersPerPixelAtLat = (lat, zoom) =>
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);

    const metersToDegLat = (m) => m / 111320;
    const metersToDegLng = (m, lat) =>
      m / (111320 * Math.cos((lat * Math.PI) / 180));

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (heldKeys.size === 0) return;

      setViewState((prev) => {
        const cur = prev ?? viewStateRef.current;

        let { longitude, latitude, zoom, bearing, pitch } = cur;

        // 이동량을 zoom/lat에 맞춰 degree로 변환
        const mpp = metersPerPixelAtLat(latitude, zoom);
        const moveMeters = movePx * mpp;

        // WASD: bearing 기준 전후좌우
        let forward = 0;
        let right = 0;

        heldKeys.forEach((k) => {
          switch (k) {
            case "w":
              forward += 1;
              break;
            case "s":
              forward -= 1;
              break;
            case "d":
              right += 1;
              break;
            case "a":
              right -= 1;
              break;

            case "q":
              bearing = wrapBearing(bearing + rotateDeg);
              break;
            case "e":
              bearing = wrapBearing(bearing - rotateDeg);
              break;

            case "[":
              zoom = clamp(zoom + zoomStep, 10, 18);
              break;
            case "]":
              zoom = clamp(zoom - zoomStep, 10, 18);
              break;

            case "z":
              pitch = clamp(pitch + pitchDeg, 0, 85);
              break;
            case "c":
              pitch = clamp(pitch - pitchDeg, 0, 85);
              break;
            default:
              break;
          }
        });

        if (forward !== 0 || right !== 0) {
          const br = (bearing * Math.PI) / 180;

          // bearing 회전 적용: north/east 성분
          const north = forward * Math.cos(br) - right * Math.sin(br);
          const east = forward * Math.sin(br) + right * Math.cos(br);

          const dLat = metersToDegLat(north * moveMeters);
          const dLng = metersToDegLng(east * moveMeters, latitude);

          latitude = clamp(latitude + dLat, -85, 85);
          longitude = longitude + dLng;

          // 경도 wrap
          if (longitude > 180) longitude -= 360;
          if (longitude < -180) longitude += 360;
        }

        return { ...cur, longitude, latitude, zoom, bearing, pitch };
      });
    };

    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();

      if (key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright") {
        return;
      }

      // ✅ R: "각도만" 리셋 (원하면 초기 카메라로 바꿀 수 있음)
      if (key === "r") {
        setViewState((prev) => ({ ...prev, pitch: 0, bearing: 0 }));
        return;
      }

      heldKeys.add(key);
      if (!rafId) rafId = requestAnimationFrame(tick);
    };

    const handleKeyUp = (e) => {
      const key = e.key.toLowerCase();

      if (key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright") {
        return;
      }
      heldKeys.delete(key);
      if (heldKeys.size === 0 && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    map.on("load", () => {
      console.log("🗺️ MapLibre loaded");
      addMapLibreLayers(map);

      // ✅ 초기 적용: mode + coverageVisible
      setMapLayerMode(map, areaMode, coverageVisible);
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (rafId) cancelAnimationFrame(rafId);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ DeckGL → MapLibre 카메라 상태 반영 (MapLibre는 따라가기만)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const c = map.getCenter();
    const z = map.getZoom();
    const p = map.getPitch();
    const b = map.getBearing();

    const changed =
      c.lng !== viewState.longitude ||
      c.lat !== viewState.latitude ||
      z !== viewState.zoom ||
      p !== viewState.pitch ||
      b !== viewState.bearing;

    if (changed) {
      map.jumpTo({
        center: [viewState.longitude, viewState.latitude],
        zoom: viewState.zoom,
        pitch: viewState.pitch,
        bearing: viewState.bearing,
      });
    }
  }, [viewState]);

  // ✅ 버튼(모드) 또는 "서비스 범위 표출" 토글 변경 시 반영
  useEffect(() => {
    if (!mapRef.current) return;
    setMapLayerMode(mapRef.current, areaMode, coverageVisible);
  }, [areaMode, coverageVisible]);

  return (
    <div
      ref={mapContainer}
      style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        top: 0,
        left: 0,
        zIndex: 0,
        pointerEvents: "auto",
      }}
    />
  );
}

export default MapView;
