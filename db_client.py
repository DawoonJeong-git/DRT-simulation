# db_client.py — FINAL (JOIN vehicleType into routes; no ambiguous columns)
import os
import pymysql
from contextlib import contextmanager

DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "3644")
DB_HOST = os.getenv("DB_HOST", "143.248.121.90")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "hdl")


@contextmanager
def connect():
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


def fetchall(sql, args=None):
    with connect() as con:
        with con.cursor() as cur:
            cur.execute(sql, args or ())
            return cur.fetchall()


# --------------------------------------------------
# Queries
# --------------------------------------------------

def get_operation_map():
    """
    (선택) 운영/디버깅용.
    routes 쿼리에서 JOIN으로 vehicleType을 가져오면,
    poller/replay에서 op_map이 꼭 필요하지는 않습니다.
    """
    rows = fetchall("""
        SELECT operationID, vehicleID, VehicleType
        FROM hdl.operation
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
    ph = ",".join(["%s"] * len(dispatch_ids))
    rows = fetchall(f"""
        SELECT
            dispatchID,
            passengerCount,
            wheelchairCount,
            pickupStationID,
            dropoffStationID
        FROM hdl.reservation_request
        WHERE dispatchID IN ({ph})
    """, dispatch_ids)
    return {r["dispatchID"]: r for r in rows}


def get_routes_for_day(date_yyyymmdd: int):
    """
    date_yyyymmdd: 20260205 같은 8자리 정수
    날짜 필터: 출발시간(originDeptTime) 기준
    ✅ JOIN으로 operation.VehicleType을 같이 가져옴 (vehicleType)
    ✅ destArrivalTime은 팀 변수명 destDeptTime으로 alias 유지
    """
    start = int(f"{date_yyyymmdd}0000")
    end   = int(f"{date_yyyymmdd}2359")

    sql = """
    SELECT
        r.routeID,
        r.routeSeq,
        r.operationID,
        r.vehicleID,
        r.routeInfo,
        r.linkIDs,
        r.NodeIDs,
        r.originStationID,
        CAST(r.originDeptTime AS UNSIGNED) AS originDeptTime,
        r.destStationID,
        CAST(r.destArrivalTime AS UNSIGNED) AS destDeptTime,
        r.onboardingNum,
        r.dispatchIDs,
        r.lon,
        r.lat,
        r.originBoardingPxIDs,
        r.originGetoffPxIDs,
        r.destBoardingPxIDs,
        r.destGetoffPxIDs,
        r.routeCode,

        -- ✅ operation join fields
        o.VehicleType AS vehicleType,
        o.vehicleID   AS op_vehicleID

    FROM hdl.route r
    JOIN hdl.operation o 
      ON o.operationID = r.operationID
     AND o.vehicleID   = r.vehicleID
    WHERE CAST(r.originDeptTime AS UNSIGNED) BETWEEN %s AND %s
    ORDER BY r.operationID, r.routeInfo, r.routeSeq
    LIMIT 200000
    """
    return fetchall(sql, (start, end))


def get_routes_since(ts_cursor: int):
    """
    (선택) incremental 용.
    필요하면 여기도 JOIN으로 vehicleType을 같이 가져올 수 있음.
    """
    sql = """
    SELECT
        r.routeID,
        r.routeSeq,
        r.operationID,
        r.vehicleID,
        r.routeInfo,
        r.linkIDs,
        r.NodeIDs,
        r.originStationID,
        CAST(r.originDeptTime AS UNSIGNED) AS originDeptTime,
        r.destStationID,
        CAST(r.destArrivalTime AS UNSIGNED) AS destDeptTime,
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

    FROM hdl.route r
    JOIN hdl.operation o 
      ON o.operationID = r.operationID
     AND o.vehicleID   = r.vehicleID
    WHERE CAST(r.originDeptTime AS UNSIGNED) > %s
       OR CAST(r.destArrivalTime AS UNSIGNED) > %s
    ORDER BY r.operationID, r.routeInfo, r.routeSeq
    LIMIT 20000
    """
    return fetchall(sql, (ts_cursor, ts_cursor))


if __name__ == "__main__":
    # Smoke test
    print("[db] whoami:", fetchall("SELECT DATABASE() AS db, @@hostname AS host, @@port AS port")[0])

    # Today quick check (optional)
    from datetime import datetime
    today = int(datetime.now().strftime("%Y%m%d"))
    routes = get_routes_for_day(today)
    print("[db] routes(today):", len(routes))
    if routes:
        # show unique vehicleType sample
        vset = sorted({r.get("vehicleType") for r in routes})
        print("[db] vehicleType set:", vset)
