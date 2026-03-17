# server.py — unified API server (LIVE + REPLAY), API-only
import os
import time
import ast
import threading
from datetime import datetime
from typing import Any, Dict, List, Tuple
from flask import Flask, jsonify, request
import pytz

from .db_client import get_routes_for_day, get_reservations_by_dispatch, test_connection

KST = pytz.timezone("Asia/Seoul")

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "5055"))
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "60"))
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")
REPLAY_CACHE_TTL = int(os.getenv("REPLAY_CACHE_TTL", "0"))

app = Flask(__name__)

LIVE: Dict[str, Any] = {
    "ok": True,
    "mode": "live",
    "day": None,
    "routes": 0,
    "segmentsCount": 0,
    "updatedAtMs": None,
    "segments": [],
}

REPLAY_CACHE: Dict[str, Tuple[Dict[str, Any], float]] = {}

_poller_started = False
_poller_lock = threading.Lock()


def parse_list(x) -> List[Any]:
    try:
        v = ast.literal_eval(str(x))
        if isinstance(v, list):
            return v
        return [v]
    except Exception:
        return []


def to_polyline(lon_list, lat_list) -> List[List[float]]:
    lons = parse_list(lon_list)
    lats = parse_list(lat_list)
    if len(lons) != len(lats) or len(lons) < 2:
        return []
    return [[float(lon), float(lat)] for lon, lat in zip(lons, lats)]


def to_epoch_ms(x) -> int | None:
    if x is None:
        return None
    s = str(x).strip()
    if s == "":
        return None

    s2 = "".join(ch for ch in s if ch.isdigit())

    if len(s2) in (12, 14) and s2.startswith(("19", "20")):
        fmt = "%Y%m%d%H%M%S" if len(s2) == 14 else "%Y%m%d%H%M"
        dt = datetime.strptime(s2, fmt)
        dt = KST.localize(dt)
        return int(dt.timestamp() * 1000)

    try:
        n = int(float(s))
        if 10**9 <= n < 10**11:
            return n * 1000
        if 10**12 <= n < 10**14:
            return n
    except Exception:
        pass

    return None


def safe_int(x, default=0) -> int:
    try:
        return int(float(x))
    except Exception:
        return default


def to01(x) -> int:
    try:
        if str(x).strip().lower() in ("1", "true", "t", "yes", "y"):
            return 1
        return 1 if int(float(x)) == 1 else 0
    except Exception:
        return 0


def kst_today_yyyymmdd() -> int:
    return int(datetime.now(KST).strftime("%Y%m%d"))


def date_to_yyyymmdd(date_str: str) -> int:
    y, m, d = date_str.split("-")
    return int(f"{y}{m}{d}")


def build_segments(routes: List[Dict[str, Any]], reserv: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    segs: List[Dict[str, Any]] = []

    for r in routes:
        dispatch_ids = parse_list(r.get("dispatchIDs"))
        origin_sid = r.get("originStationID")
        dest_sid = r.get("destStationID")
        poly = to_polyline(r.get("lon"), r.get("lat"))
        res_list = [reserv.get(did) for did in dispatch_ids if reserv.get(did)]

        pickup_total = sum(
            int(rr.get("passengerCount", 0)) for rr in res_list if rr.get("pickupStationID") == origin_sid
        )
        pickup_wc = sum(
            to01(rr.get("wheelchairCount", 0)) for rr in res_list if rr.get("pickupStationID") == origin_sid
        )

        vehicle_id = r.get("vehicleID") or r.get("op_vehicleID")

        segs.append(
            {
                "routeID": r.get("routeID"),
                "segment_id": f'{r.get("routeID")}:{r.get("routeSeq")}',
                "operationID": r.get("operationID"),
                "vehicleID": vehicle_id,
                "vehicleType": r.get("vehicleType"),
                "routeInfo": safe_int(r.get("routeInfo"), 0),
                "originStationID": origin_sid,
                "originDeptTime": r.get("originDeptTime"),
                "destStationID": dest_sid,
                "destDeptTime": r.get("destDeptTime"),
                "originMs": to_epoch_ms(r.get("originDeptTime")),
                "destMs": to_epoch_ms(r.get("destDeptTime")),
                "polyline": poly,
                "dispatchIDs": dispatch_ids,
                "events": {
                    "origin": {
                        "board": {"passenger": int(pickup_total), "wheelchair": int(pickup_wc)},
                        "alight": {"passenger": 0, "wheelchair": 0},
                    },
                    "dest": {
                        "board": {"passenger": 0, "wheelchair": 0},
                        "alight": {"passenger": 0, "wheelchair": 0},
                    },
                },
            }
        )

    from collections import defaultdict

    by_route = defaultdict(list)
    for i, s in enumerate(segs):
        by_route[s.get("routeID")].append((i, s))

    for _, lst in by_route.items():
        lst.sort(key=lambda x: (x[1].get("routeInfo", 0), x[1].get("destMs") or 0))

        dest_index_by_station = defaultdict(list)
        for idx, s in lst:
            dest_index_by_station[s.get("destStationID")].append((idx, s.get("destMs") or 0))

        for idx, s in lst:
            if not s.get("dispatchIDs"):
                continue
            origin_ms = s.get("originMs")
            if origin_ms is None:
                continue

            for did in s["dispatchIDs"]:
                rr = reserv.get(did)
                if not rr:
                    continue

                drop_sid = rr.get("dropoffStationID")
                if not drop_sid:
                    continue

                candidates = dest_index_by_station.get(drop_sid, [])
                tgt_idx = None
                for j_idx, j_ms in candidates:
                    if j_ms >= origin_ms:
                        tgt_idx = j_idx
                        break
                if tgt_idx is None:
                    continue

                d_pass = int(rr.get("passengerCount", 0))
                d_wc = int(to01(rr.get("wheelchairCount", 0)))

                segs[tgt_idx]["events"]["dest"]["alight"]["passenger"] += d_pass
                segs[tgt_idx]["events"]["dest"]["alight"]["wheelchair"] += d_wc

    return segs


def refresh_live_once() -> None:
    day = kst_today_yyyymmdd()
    routes = get_routes_for_day(day)

    dispatch_ids: List[str] = []
    for r in routes:
        dispatch_ids += parse_list(r.get("dispatchIDs"))
    dispatch_ids = list(dict.fromkeys(dispatch_ids))

    reservations = get_reservations_by_dispatch(dispatch_ids) if dispatch_ids else {}
    segs = build_segments(routes, reservations)

    LIVE.update(
        {
            "ok": True,
            "mode": "live",
            "day": day,
            "routes": len(routes),
            "segmentsCount": len(segs),
            "updatedAtMs": int(time.time() * 1000),
            "segments": segs,
        }
    )


def poller_loop() -> None:
    while True:
        try:
            refresh_live_once()
            time.sleep(POLL_INTERVAL)
        except Exception as e:
            print(f"[POLLER ERROR] {e}")
            time.sleep(5.0)


def ensure_poller_started() -> None:
    global _poller_started
    if _poller_started:
        return
    with _poller_lock:
        if _poller_started:
            return
        try:
            refresh_live_once()
        except Exception as e:
            print(f"[WARMUP ERROR] {e}")
        t = threading.Thread(target=poller_loop, daemon=True)
        t.start()
        _poller_started = True


def build_replay(date_str: str) -> Dict[str, Any]:
    if REPLAY_CACHE_TTL > 0:
        cached = REPLAY_CACHE.get(date_str)
        if cached and cached[1] > time.time():
            return cached[0]

    day = date_to_yyyymmdd(date_str)
    routes = get_routes_for_day(day)

    dispatch_ids: List[str] = []
    for r in routes:
        dispatch_ids += parse_list(r.get("dispatchIDs"))
    dispatch_ids = list(dict.fromkeys(dispatch_ids))

    reserv = get_reservations_by_dispatch(dispatch_ids) if dispatch_ids else {}
    segs = build_segments(routes, reserv)

    payload = {
        "ok": True,
        "mode": "replay",
        "date": date_str,
        "day": day,
        "routes": len(routes),
        "segmentsCount": len(segs),
        "updatedAtMs": int(time.time() * 1000),
        "segments": segs,
    }

    if REPLAY_CACHE_TTL > 0:
        REPLAY_CACHE[date_str] = (payload, time.time() + REPLAY_CACHE_TTL)

    return payload


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGINS
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health():
    try:
        db_ok = test_connection()
        return jsonify(
            {
                "ok": True,
                "db": db_ok,
                "pollerStarted": _poller_started,
                "updatedAtMs": LIVE.get("updatedAtMs"),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "db": False, "error": str(e)}), 500


@app.route("/api/segments", methods=["GET"])
def api_segments():
    ensure_poller_started()
    return jsonify(LIVE)


@app.route("/api/replay", methods=["GET"])
def api_replay():
    ensure_poller_started()
    date = request.args.get("date", "").strip()
    if not date:
        return jsonify({"ok": False, "error": "missing_date", "example": "/api/replay?date=2025-07-29"}), 400
    return jsonify(build_replay(date))


if __name__ == "__main__":
    ensure_poller_started()
    port = int(os.environ.get("PORT", str(PORT)))
    app.run(host=HOST, port=port, debug=False)