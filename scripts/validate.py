"""validate.py - independent checks on data/grocery_prices.csv. Run: python3 scripts/validate.py"""
import pandas as pd, re, sys

df = pd.read_csv("data/grocery_prices.csv", dtype={"date": str, "price": str})
miss = pd.read_csv("data/missing_observations.csv")
out, ok = [], True
def check(name, passed, detail=""):
    global ok
    ok &= bool(passed)
    out.append(f"[{'PASS' if passed else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

check("Columns are date,product,category,price,unit", list(df.columns) == ["date","product","category","price","unit"])
check("No empty cells", not df.isna().any().any())
check("All dates match YYYY-MM", df["date"].str.fullmatch(r"\d{4}-(0[1-9]|1[0-2])").all())
p = pd.to_numeric(df["price"], errors="coerce")
check("All prices numeric", p.notna().all())
check("All prices positive", (p > 0).all(), f"min {p.min():.3f}, max {p.max():.3f}")
check("No duplicate product-month rows", not df.duplicated(["date","product"]).any())
check("Sorted by date then product", df.equals(df.sort_values(["date","product"]).reset_index(drop=True)))
units = df.groupby("product")["unit"].nunique()
check("One unit per product", (units == 1).all(), str(df.groupby("product")["unit"].first().to_dict()))
check("Products are Bread, Eggs, Milk", sorted(df["product"].unique()) == ["Bread","Eggs","Milk"])

# expected months: every month from first to last date
months = pd.period_range(df["date"].min(), df["date"].max(), freq="M").strftime("%Y-%m")
gaps = {}
for prod, g in df.groupby("product"):
    gaps[prod] = sorted(set(months) - set(g["date"]))
check("Only documented months are missing", all(
    set(gaps[prod]) == set(miss[miss["product"]==prod]["date"]) for prod in gaps), str(gaps))

# cross-check last 5 months against values printed on each FRED series page (read separately by hand)
page_panel = {
 "Eggs":  {"2026-10":"2.320","2026-09":"2.272","2026-08":"2.272","2026-07":"2.189","2026-06":"2.141"},
 "Milk":  {"2026-10":"4.101","2026-09":"4.106","2026-08":"4.229","2026-07":"4.313","2026-06":"4.317"},
 "Bread": {"2026-10":"1.861","2026-09":"1.830","2026-08":"1.823","2026-07":"1.820","2026-06":"1.814"},
}
cross = all(df[(df["product"]==pr)&(df["date"]==d)]["price"].iloc[0] == v
            for pr, dd in page_panel.items() for d, v in dd.items())
check("Latest 5 months match FRED series-page panels (15 values)", cross)

out.append("")
out.append(f"Total records     : {len(df)}")
out.append(f"Date range        : {df['date'].min()} to {df['date'].max()} ({len(months)} calendar months)")
out.append("Records / product : " + str(df['product'].value_counts().sort_index().to_dict()))
out.append("Missing (removed) : " + "; ".join(f"{r.product} {r.date} (FRED value '{r.raw_value}')" for r in miss.itertuples()))
out.append("")
out.append("OVERALL: " + ("ALL CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
text = "\n".join(out); print(text); open("validation_report.txt","w").write(text+"\n")
sys.exit(0 if ok else 1)
