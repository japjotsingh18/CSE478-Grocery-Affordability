import csv
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
url = "http://localhost:8000/index.html"

with open(project / "data/grocery_prices.csv") as file:
    rows = list(csv.DictReader(file))

prices = {}
units = {}
for row in rows:
    prices[(row["date"], row["product"])] = row["price"]
    units[row["product"]] = row["unit"]

results = []

def check(name, passed):
    results.append({"check": name, "pass": bool(passed)})
    print("PASS" if passed else "FAIL", "-", name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_selector("svg path.line")

    check("Dataset contains 387 records", len(rows) == 387)
    check("Page title is correct",
          page.inner_text("h1") == "Can Students Still Afford the Basics?")
    check("All three grocery lines are displayed",
          page.locator("path.line").count() == 3)
    check("Legend displays all products",
          all(item in page.inner_text("#legend")
              for item in ["Eggs", "Milk", "Bread"]))

    for line in page.locator("path.line").all():
        product = line.get_attribute("data-product")
        path = line.get_attribute("d")
        check(product + " has a gap for missing data", path.count("M") == 2)

    chart = page.locator("svg rect[fill='transparent']")
    box = chart.bounding_box()
    checked_prices = 0
    correct_prices = True
    missing_month = False

    for i in range(131):
        x = box["x"] + box["width"] * i / 130
        y = box["y"] + box["height"] / 2
        page.mouse.move(x, y)
        tooltip = page.locator("#tooltip")
        if not tooltip.is_visible():
            continue
        month = tooltip.get_attribute("data-month")
        tooltip_rows = tooltip.locator(".tt-row").all()
        if month == "2025-10" and not tooltip_rows:
            missing_month = True
        for row in tooltip_rows:
            product = row.locator(".tt-name").inner_text()
            displayed = row.locator(".tt-price").inner_text().strip()
            price = prices.get((month, product))
            expected = f"${price} / {units[product]}"
            checked_prices += 1
            if displayed != expected:
                correct_prices = False

    check("Tooltip displays correct prices and units",
          checked_prices > 300 and correct_prices)
    check("Missing October 2025 data is handled", missing_month)

    page.uncheck("input[value='Eggs']")
    check("Unchecking Eggs removes its line", page.locator("path.line").count() == 2)
    page.uncheck("input[value='Milk']")
    check("Selecting only Bread displays one line", page.locator("path.line").count() == 1)
    page.uncheck("input[value='Bread']")
    check("Unchecking all products removes all lines", page.locator("path.line").count() == 0)
    for product in ["Eggs", "Milk", "Bread"]:
        page.check(f"input[value='{product}']")
    check("Selecting all products restores three lines", page.locator("path.line").count() == 3)
    check("No JavaScript errors", len(errors) == 0)

    mobile = browser.new_page(viewport={"width": 390, "height": 800})
    mobile.goto(url)
    mobile.wait_for_selector("svg path.line")
    check("Chart works on mobile", mobile.locator("path.line").count() == 3)
    overflow = mobile.evaluate(
        "document.documentElement.scrollWidth > "
        "document.documentElement.clientWidth"
    )
    check("No horizontal overflow on mobile", not overflow)
    browser.close()

passed = sum(result["pass"] for result in results)
print(f"\n{passed}/{len(results)} tests passed")
with open(project / "test_results.json", "w") as file:
    json.dump(results, file, indent=2)

if passed != len(results):
    raise SystemExit(1)
