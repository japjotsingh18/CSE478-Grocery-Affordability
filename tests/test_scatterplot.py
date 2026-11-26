import csv
import math
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
url = "http://localhost:8000/index.html"
products = ["Eggs", "Milk", "Bread"]

with open(project / "data/grocery_prices.csv") as file:
    rows = list(csv.DictReader(file))

for row in rows:
    row["parsed_date"] = datetime.strptime(row["date"], "%Y-%m")
    row["numeric_price"] = float(row["price"])


def expected_statistics(product, start_year, end_year):
    selected = [row for row in rows if row["product"] == product
                and start_year <= row["parsed_date"].year <= end_year]
    selected.sort(key=lambda row: row["parsed_date"])
    growth = ((selected[-1]["numeric_price"] - selected[0]["numeric_price"])
              / selected[0]["numeric_price"] * 100)
    changes = []
    for previous, current in zip(selected, selected[1:]):
        month_difference = ((current["parsed_date"].year - previous["parsed_date"].year) * 12
                            + current["parsed_date"].month - previous["parsed_date"].month)
        if month_difference == 1:
            changes.append((current["numeric_price"] - previous["numeric_price"])
                           / previous["numeric_price"] * 100)
    mean = sum(changes) / len(changes)
    volatility = math.sqrt(sum((change - mean) ** 2 for change in changes) / len(changes))
    return selected[0], selected[-1], growth, volatility, len(changes)


results = []


def check(name, passed):
    results.append(bool(passed))
    print("PASS" if passed else "FAIL", "-", name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_selector("#scatterplot circle.scatter-point")

    check("Scatterplot renders one point and label per product",
          page.locator("#scatterplot circle.scatter-point").count() == 3
          and page.locator("#scatterplot text.scatter-label").count() == 3)

    calculations_correct = True
    for product in products:
        _, _, growth, volatility, change_count = expected_statistics(product, 2016, 2026)
        point = page.locator(f"#scatterplot circle[data-product='{product}']")
        calculations_correct &= abs(float(point.get_attribute("data-growth")) - growth) < 1e-10
        calculations_correct &= abs(float(point.get_attribute("data-volatility")) - volatility) < 1e-10
        calculations_correct &= int(point.get_attribute("data-change-count")) == change_count
    check("Growth and population volatility calculations match the CSV", calculations_correct)

    page.select_option("#scatterplot-start-year", "2020")
    page.select_option("#scatterplot-end-year", "2023")
    alternate_correct = True
    for product in products:
        _, _, growth, volatility, _ = expected_statistics(product, 2020, 2023)
        point = page.locator(f"#scatterplot circle[data-product='{product}']")
        alternate_correct &= abs(float(point.get_attribute("data-growth")) - growth) < 1e-10
        alternate_correct &= abs(float(point.get_attribute("data-volatility")) - volatility) < 1e-10
    check("Changing the year range updates all points", alternate_correct)
    check("Invalid year ranges are prevented",
          page.locator("#scatterplot-start-year option[value='2024']").is_disabled()
          and page.locator("#scatterplot-end-year option[value='2019']").is_disabled())

    eggs_first, eggs_last, eggs_growth, eggs_volatility, _ = expected_statistics("Eggs", 2020, 2023)
    page.locator("#scatterplot circle[data-product='Eggs']").hover()
    tooltip = page.locator("#scatterplot-tooltip")
    tooltip_text = tooltip.inner_text()
    check("Tooltip shows authentic dates, prices, growth, and volatility",
          tooltip.get_attribute("data-start") == eggs_first["date"]
          and tooltip.get_attribute("data-end") == eggs_last["date"]
          and f"${eggs_first['numeric_price']:.3f}" in tooltip_text
          and f"${eggs_last['numeric_price']:.3f}" in tooltip_text
          and f"{eggs_growth:.2f}%" in tooltip_text
          and f"{eggs_volatility:.2f}%" in tooltip_text)

    page.select_option("#scatterplot-start-year", "2016")
    page.select_option("#scatterplot-end-year", "2026")
    expected_change_count = expected_statistics("Eggs", 2016, 2026)[4]
    eggs_point = page.locator("#scatterplot circle[data-product='Eggs']")
    check("Missing October 2025 is excluded from consecutive changes",
          expected_change_count == 127
          and int(eggs_point.get_attribute("data-change-count")) == 127)

    page.select_option("#scatterplot-end-year", "2017")
    negative_growth = all(float(page.locator(
        f"#scatterplot circle[data-product='{product}']").get_attribute("data-growth")) < 0
        for product in products)
    check("Negative growth ranges render correctly", negative_growth)

    mobile = browser.new_page(viewport={"width": 390, "height": 800})
    mobile.goto(url)
    mobile.wait_for_selector("#scatterplot circle.scatter-point")
    overflow = mobile.evaluate(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth")
    mobile_labels = mobile.locator("#scatterplot text.scatter-label").count()
    check("Scatterplot is responsive without mobile horizontal overflow",
          not overflow and mobile_labels == 3)
    check("Scatterplot produces no JavaScript errors", len(errors) == 0)
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} scatterplot tests passed")
if passed != len(results):
    raise SystemExit(1)
