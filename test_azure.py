import pyodbc

conn_str = (
    "DRIVER={ODBC Driver 18 for SQL Server};"
    "SERVER=drt-kaist-2.database.windows.net,1433;"
    "DATABASE=HDL;"
    "UID=drt-kaist;"
    "PWD=hdl3644@;"
    "Encrypt=yes;"
    "TrustServerCertificate=no;"
)

con = pyodbc.connect(conn_str, timeout=10)
cur = con.cursor()

cur.execute("SELECT TOP 5 name FROM sys.tables ORDER BY name")
rows = cur.fetchall()

for r in rows:
    print(r)

cur.close()
con.close()
print("AZURE OK")