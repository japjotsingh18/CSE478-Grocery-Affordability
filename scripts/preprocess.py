"""
preprocess.py - cleans and combines the raw FRED/BLS grocery price files.
Input : raw/fred_<SERIES>_raw.csv   (DATE, VALUE as FRED published them)
Output: data/grocery_prices.csv     (date, product, category, price, unit)
        data/missing_observations.csv
Run   : python3 scripts/preprocess.py
"""
import pandas as pd

SERIES = {
    "APU0000708111": {"product": "Eggs",  "category": "Dairy and Eggs", "unit": "dozen"},
    "APU0000709112": {"product": "Milk",  "category": "Dairy and Eggs", "unit": "gallon"},
    "APU0000702111": {"product": "Bread", "category": "Grains",         "unit": "pound"},
}
START = "2016-01"

frames, missing_log, log = [], [], []
for sid, meta in SERIES.items():
    raw = pd.read_csv(f"raw/fred_{sid}_raw.csv", dtype=str)       # read everything as text first
    log.append(f"{sid} ({meta['product']}): {len(raw)} raw rows read")

    raw["date"] = pd.to_datetime(raw["DATE"], errors="coerce").dt.strftime("%Y-%m")   # -> YYYY-MM
    raw["price_num"] = pd.to_numeric(raw["VALUE"], errors="coerce")                    # "." becomes NaN

    bad = raw[raw["price_num"].isna() | raw["date"].isna()]
    for _, r in bad.iterrows():
        missing_log.append({"series_id": sid, "product": meta["product"], "date": r["date"],
                            "raw_value": r["VALUE"], "action": "removed (not replaced)"})
    clean = raw.dropna(subset=["price_num", "date"]).copy()
    clean = clean[clean["date"] >= START]

    out = pd.DataFrame({
        "date": clean["date"],
        "product": meta["product"],
        "category": meta["category"],
        "price": clean["VALUE"].astype(float).map(lambda x: f"{x:.3f}"),  # same 3-decimal values FRED published
        "unit": meta["unit"],
    })
    frames.append(out)

df = pd.concat(frames, ignore_index=True)
before = len(df)
df = df.drop_duplicates(subset=["date", "product"], keep="first")
log.append(f"Duplicate product-month rows removed: {before - len(df)}")
df = df.sort_values(["date", "product"]).reset_index(drop=True)

df.to_csv("data/grocery_prices.csv", index=False)
pd.DataFrame(missing_log, columns=["series_id","product","date","raw_value","action"]).to_csv(
    "data/missing_observations.csv", index=False)

log.append(f"Final records written: {len(df)}")
print("\n".join(log))
