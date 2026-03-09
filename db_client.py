# db_client.py
# FINAL VERSION — MariaDB + Azure SQL dual support with visible console debug logs

import os
import pymysql
import pyodbc
from contextlib import contextmanager

# --------------------------------------------------
# Engine switch
# --------------------------------------------------

DB_ENGINE = os.getenv("DB_ENGINE", "azure").lower()
# "azure" | "mysql"


def _is_azure():
    return DB_ENGINE in {"azure", "sqlserver", "mssql"}


# --------------------------------------------------
# MariaDB config
# --------------------------------------------------

DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "3644")
DB_HOST = os.getenv("DB_HOST", "143.248.121.90")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "hdl")

# --------------------------------------------------
# Azure SQL config
# --------------------------------------------------

AZURE_DB_USER = os.getenv("AZURE_DB_USER", "drt-kaist@drt-kaist")
AZURE_DB_PASS = os.getenv("AZURE_DB_PASS", "hdl3644@")
AZURE_DB_SERVER = os.getenv("AZURE_DB_SERVER", "drt-kaist.database.windows.net")
AZURE_DB_PORT = int(os.getenv("AZURE_DB_PORT", "1433"))
AZURE_DB_NAME = os.getenv("AZURE_DB_NAME", "HDL")
AZURE_DB_DRIVER = os.getenv("AZURE_DB_DRIVER", "{ODBC Driver 18 for SQL Server}")
AZURE_DB_ENCRYPT = os.getenv("AZURE_DB_ENCRYPT", "yes")
AZURE_DB_TRUST_SERVER_CERT = os.getenv("AZURE_DB_TRUST_SERVER_CERT", "no")

# --------------------------------------------------
# module-load debug: import만 되어도 바로 보임
# --------------------------------------------------

if _is_azure():
    print(f"[DB INIT] USING AZURE SQL | server={AZURE_DB_SERVER} | db={AZURE_DB_NAME}")
else:
    print(f"[DB INIT] USING MARIADB | host={DB_HOST}:{DB_PORT} | db={DB_NAME}")


# --------------------------------------------------
# SQL helpers
# --------------------------------------------------

def _placeholder():
    return "?" if _is_azure() else "%s"


def _placeholders(n):
    return ",".join([_placeholder()] * n)


def _cast_bigint(expr):
    if _is_azure():
        return f"TRY_CAST({expr} AS BIGINT)"
    return f"CAST({expr} AS UNSIGNED)"


def _qualify(table, alias=None):
    alias_sql = f" {alias}" if alias else ""

    if _is_azure():
        return f"[dbo].[{table}]{alias_sql}"

    return f"{DB_NAME}.{table}{alias_sql}"


# --------------------------------------------------
# Connection
# --------------------------------------------------

@contextmanager
def connect():
    if _is_azure():
        print(f"[DB CONNECT] AZURE SQL | server={AZURE_DB_SERVER} | db={AZURE_DB_NAME}")

        conn_str = (
            f"DRIVER={AZURE_DB_DRIVER};"
            f"SERVER={AZURE_DB_SERVER},{AZURE_DB_PORT};"
            f"DATABASE={AZURE_DB_NAME};"
            f"UID={AZURE_DB_USER};"
            f"PWD={AZURE_DB_PASS};"
            f"Encrypt={AZURE_DB_ENCRYPT};"
            f"TrustServerCertificate={AZURE_DB_TRUST_SERVER_CERT};"
        )
        con = pyodbc.connect(conn_str)
        con.autocommit = True

    else:
        print(f"[DB CONNECT] MARIADB | host={DB_HOST}:{DB_PORT} | db={DB_NAME}")

        con = pymysql.connect(
            user=DB_USER,
            passwd=DB_PASS,
            host=DB_HOST,
            port=DB_PORT,
            db=DB_NAME,
            charset="utf8mb4",
            use_unicode=True,
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

            if _is_azure():
                columns = [c[0] for c in cur.description]
                rows = cur.fetchall()
                return [dict(zip(columns, row)) for row in rows]

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