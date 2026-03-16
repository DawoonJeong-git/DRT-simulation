# db_client.py
# FINAL VERSION — MariaDB (local db_config + Render env fallback)

import os
import pymysql
from contextlib import contextmanager

# --------------------------------------------------
# DB profile selection
# --------------------------------------------------

PROFILE_NAME = "hdl"      # "nzero" or "hdl"

# --------------------------------------------------
# Load config: local(db_config.py) first, then Render env fallback
# --------------------------------------------------

DB = None

try:
    from .db_config import DB_CONFIGS  # local only

    if PROFILE_NAME in DB_CONFIGS:
        DB = DB_CONFIGS[PROFILE_NAME]
        print(f"[DB INIT] Using local db_config.py | PROFILE={PROFILE_NAME}")
    else:
        raise KeyError(f"PROFILE_NAME '{PROFILE_NAME}' not found in DB_CONFIGS")

except Exception as e:
    print(f"[DB INIT] Local db_config.py unavailable or invalid: {e}")
    print(f"[DB INIT] Falling back to environment variables | PROFILE={PROFILE_NAME}")

    if PROFILE_NAME == "nzero":
        DB = {
            "host": os.getenv("NZERO_DB_HOST"),
            "port": int(os.getenv("NZERO_DB_PORT", "3306")),
            "user": os.getenv("NZERO_DB_USER"),
            "password": os.getenv("NZERO_DB_PASSWORD"),
            "database": os.getenv("NZERO_DB_NAME"),
            "charset": "utf8mb4",
            "use_unicode": True,
        }

    elif PROFILE_NAME == "hdl":
        DB = {
            "host": os.getenv("HDL_DB_HOST"),
            "port": int(os.getenv("HDL_DB_PORT", "3306")),
            "user": os.getenv("HDL_DB_USER"),
            "password": os.getenv("HDL_DB_PASSWORD"),
            "database": os.getenv("HDL_DB_NAME"),
            "charset": "utf8mb4",
            "use_unicode": True,
        }

    else:
        raise ValueError(f"Unsupported PROFILE_NAME: {PROFILE_NAME}")

# --------------------------------------------------
# Final DB vars
# --------------------------------------------------

DB_HOST = DB["host"]
DB_PORT = DB["port"]
DB_USER = DB["user"]
DB_PASS = DB["password"]
DB_DATABASE = DB["database"]

if not all([DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_DATABASE]):
    raise ValueError(
        f"[DB INIT ERROR] Missing DB config values for PROFILE={PROFILE_NAME}. "
        f"Check db_config.py or Render environment variables."
    )

print(f"[DB INIT] PROFILE={PROFILE_NAME} | host={DB_HOST}:{DB_PORT} | db={DB_DATABASE}")

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

@contextmanager
def connect():
    print(f"[DB CONNECT] PROFILE={PROFILE_NAME} | host={DB_HOST}:{DB_PORT} | db={DB_DATABASE}")

    con = pymysql.connect(
        user=DB_USER,
        passwd=DB_PASS,
        host=DB_HOST,
        port=DB_PORT,
        db=DB_DATABASE,
        charset=DB["charset"],
        use_unicode=DB["use_unicode"],
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )

    try:
        yield con
    finally:
        con.close()


# --------------------------------------------------
# Query execution
# --------------------------------------------------

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


# --------------------------------------------------
# Queries
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
        } for r in rows
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

    rows = fetchall(f"""
        SELECT
            dispatchID,
            passengerCount,
            wheelchairCount,
            pickupStationID,
            dropoffStationID
        FROM {reservation_tbl}
        WHERE dispatchID IN ({ph})
    """, cleaned)

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
        o.vehicleID   AS op_vehicleID
    FROM {route_tbl}
    JOIN {operation_tbl}
      ON o.operationID = r.operationID
     AND o.vehicleID   = r.vehicleID
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
        o.vehicleID   AS op_vehicleID
    FROM {route_tbl}
    JOIN {operation_tbl}
      ON o.operationID = r.operationID
     AND o.vehicleID   = r.vehicleID
    WHERE {cast_origin} > {ph}
       OR {cast_dest} > {ph}
    ORDER BY r.operationID, r.routeInfo, r.routeSeq
    """
    return fetchall(sql, (ts_cursor, ts_cursor))