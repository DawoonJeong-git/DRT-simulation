from dotenv import load_dotenv
import os
import pymysql
from contextlib import contextmanager

# --------------------------------------------------
# ENV LOAD
# --------------------------------------------------
load_dotenv()

# --------------------------------------------------
# DB CONFIG (.env only)
# --------------------------------------------------
DB_HOST = os.getenv("DB_HOST")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASSWORD")
DB_DATABASE = os.getenv("DB_NAME")

print(f"[DB INIT] host={DB_HOST}:{DB_PORT} db={DB_DATABASE}")

required_env = {
    "DB_HOST": DB_HOST,
    "DB_USER": DB_USER,
    "DB_PASSWORD": DB_PASS,
    "DB_NAME": DB_DATABASE,
}
missing = [k for k, v in required_env.items() if not v]
if missing:
    raise RuntimeError(f"Missing required DB env vars: {', '.join(missing)}")


# --------------------------------------------------
# SQL helpers
# --------------------------------------------------
def _placeholder():
    return "%s"


def _placeholders(n):
    return ",".join([_placeholder()] * n)


def _cast_bigint(expr):
    return f"CAST({expr} AS UNSIGNED)"


def _qualify(table, alias=None):
    alias_sql = f" {alias}" if alias else ""
    return f"{DB_DATABASE}.{table}{alias_sql}"


# --------------------------------------------------
# Connection
# --------------------------------------------------
def get_connection():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_DATABASE,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


@contextmanager
def get_cursor():
    conn = get_connection()
    try:
        cursor = conn.cursor()
        yield cursor
    finally:
        cursor.close()
        conn.close()


@contextmanager
def connect():
    print(f"[DB CONNECT] host={DB_HOST}:{DB_PORT} db={DB_DATABASE}")
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


# --------------------------------------------------
# Query execution
# --------------------------------------------------
def query(sql, params=None):
    print("[DB QUERY]", sql.strip().split()[0] if sql.strip() else "EMPTY")
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        return cur.fetchall()


def execute(sql, params=None):
    with get_cursor() as cur:
        cur.execute(sql, params or ())
        return cur.rowcount


def fetchall(sql, args=None):
    first_line = sql.strip().splitlines()[0] if sql.strip() else ""
    print(f"[DB QUERY] {first_line[:120]}")
    with connect() as con:
        cur = con.cursor()
        try:
            cur.execute(sql, args or ())
            return cur.fetchall()
        finally:
            cur.close()


def test_connection():
    with connect() as con:
        cur = con.cursor()
        try:
            cur.execute("SELECT 1 AS ok")
            row = cur.fetchone()
            return bool(row and row.get("ok") == 1)
        finally:
            cur.close()


# --------------------------------------------------
# Project queries
# --------------------------------------------------
def get_operation_map():
    operation_tbl = _qualify("operation")

    rows = fetchall(f"""
        SELECT operationID, vehicleID, VehicleType
        FROM {operation_tbl}
    """)

    return {
        str(r["operationID"]).strip(): {
            "vehicleID": r["vehicleID"],
            "VehicleType": r["VehicleType"],
        }
        for r in rows
    }


def get_reservations_by_dispatch(dispatch_ids):
    if not dispatch_ids:
        return {}

    cleaned = []
    seen = set()

    for x in dispatch_ids:
        s = str(x).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        cleaned.append(s)

    if not cleaned:
        return {}

    reservation_tbl = _qualify("reservation_request")
    ph = _placeholders(len(cleaned))

    rows = fetchall(
        f"""
        SELECT
            dispatchID,
            passengerCount,
            wheelchairCount,
            pickupStationID,
            dropoffStationID
        FROM {reservation_tbl}
        WHERE dispatchID IN ({ph})
    """,
        cleaned,
    )

    return {r["dispatchID"]: r for r in rows}


def get_routes_for_day(date_yyyymmdd: int):
    start = int(f"{date_yyyymmdd}0000")
    end = int(f"{date_yyyymmdd}2359")

    route_tbl = _qualify("route", "r")
    operation_tbl = _qualify("operation", "o")

    cast_origin = _cast_bigint("r.originDeptTime")
    cast_dest = _cast_bigint("r.destArrivalTime")
    ph = _placeholder()

    sql = f"""
    SELECT
        r.routeID,
        r.routeSeq,
        r.operationID,
        r.vehicleID,
        r.routeInfo,
        r.linkIDs,
        r.NodeIDs,
        r.originStationID,
        {cast_origin} AS originDeptTime,
        r.destStationID,
        {cast_dest} AS destDeptTime,
        r.onboardingNum,
        r.dispatchIDs,
        r.lon,
        r.lat,
        r.originBoardingPxIDs,
        r.originGetoffPxIDs,
        r.destBoardingPxIDs,
        r.destGetoffPxIDs,
        r.routeCode,
        o.VehicleType AS vehicleType,
        o.vehicleID AS op_vehicleID
    FROM {route_tbl}
    JOIN {operation_tbl}
      ON o.operationID = r.operationID
     AND o.vehicleID = r.vehicleID
    WHERE {cast_origin} BETWEEN {ph} AND {ph}
    ORDER BY r.operationID, r.routeInfo, r.routeSeq
    """
    return fetchall(sql, (start, end))


def get_routes_since(ts_cursor: int):
    route_tbl = _qualify("route", "r")
    operation_tbl = _qualify("operation", "o")

    cast_origin = _cast_bigint("r.originDeptTime")
    cast_dest = _cast_bigint("r.destArrivalTime")
    ph = _placeholder()

    sql = f"""
    SELECT
        r.routeID,
        r.routeSeq,
        r.operationID,
        r.vehicleID,
        r.routeInfo,
        r.linkIDs,
        r.NodeIDs,
        r.originStationID,
        {cast_origin} AS originDeptTime,
        r.destStationID,
        {cast_dest} AS destDeptTime,
        r.onboardingNum,
        r.dispatchIDs,
        r.lon,
        r.lat,
        r.originBoardingPxIDs,
        r.originGetoffPxIDs,
        r.destBoardingPxIDs,
        r.destGetoffPxIDs,
        r.routeCode,
        o.VehicleType AS vehicleType,
        o.vehicleID AS op_vehicleID
    FROM {route_tbl}
    JOIN {operation_tbl}
      ON o.operationID = r.operationID
     AND o.vehicleID = r.vehicleID
    WHERE {cast_origin} > {ph}
       OR {cast_dest} > {ph}
    ORDER BY r.operationID, r.routeInfo, r.routeSeq
    """
    return fetchall(sql, (ts_cursor, ts_cursor))