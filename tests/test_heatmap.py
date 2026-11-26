import csv
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
url = "http://localhost:8000/index.html"

with open(project / "data/grocery_prices.csv") as file:
    rows = list(csv.DictReader(file))

prices = {(row["date"], row["product"]): row["price"] for row in rows}
units = {row["product"]: row["unit"] for row in rows}
product_prices = {
    product: [float(row["price"]) for row in rows if row["product"] == product]
    for product in ["Eggs", "Milk", "Bread"]
}
results = []


def check(name, passed):
    results.append(bool(passed))
    print("PASS" if passed else "FAIL", "-", name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    page.goto(url)
    page.wait_for_selector("#heatmap rect.heatmap-cell")

    check("Heatmap renders all 132 year-month cells",
          page.locator("#heatmap rect.heatmap-cell").count() == 132)
    check("Heatmap displays all 12 months",
          all(month in page.locator("#heatmap").inner_text()
              for month in ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]))
    check("Heatmap displays years 2016 through 2026",
          all(str(year) in page.locator("#heatmap").inner_text()
              for year in range(2016, 2027)))

    eggs_cell = page.locator("#heatmap rect[data-month='2025-03']")
    eggs_fill = eggs_cell.get_attribute("fill")
    eggs_cell.hover()
    tooltip = page.locator("#heatmap-tooltip")
    check("Eggs tooltip uses the authentic price and unit",
          tooltip.get_attribute("data-product") == "Eggs" and
          f"${prices[('2025-03', 'Eggs')]} / {units['Eggs']}" in tooltip.inner_text())

    page.select_option("#heatmap-product", "Milk")
    milk_cell = page.locator("#heatmap rect[data-month='2025-03']")
    milk_fill = milk_cell.get_attribute("fill")
    milk_cell.hover()
    check("Product selection updates cells and tooltip",
          eggs_fill != milk_fill and
          tooltip.get_attribute("data-product") == "Milk" and
          f"${prices[('2025-03', 'Milk')]} / {units['Milk']}" in tooltip.inner_text())
    check("Product selection updates color legend",
          "Milk price per gallon" in page.locator("#heatmap").inner_text())

    page.select_option("#heatmap-product", "Bread")
    bread_cell = page.locator("#heatmap rect[data-month='2025-03']")
    bread_cell.hover()
    check("Bread tooltip uses the authentic price and unit",
          tooltip.get_attribute("data-product") == "Bread" and
          f"${prices[('2025-03', 'Bread')]} / {units['Bread']}" in tooltip.inner_text())

    for product in ["Eggs", "Milk", "Bread"]:
        page.select_option("#heatmap-product", product)
        legend_values = page.locator(
            "#heatmap .heatmap-legend .tick text"
        ).all_text_contents()
        expected_values = [
            f"${min(product_prices[product]):.3f}",
            f"${max(product_prices[product]):.3f}",
        ]
        check(f"{product} legend shows its historical minimum and maximum",
              legend_values == expected_values)

    missing = page.locator("#heatmap rect[data-month='2025-10']")
    outside = page.locator("#heatmap rect[data-month='2026-11']")
    check("October 2025 is marked as a missing observation",
          missing.get_attribute("data-status") == "missing" and
          missing.get_attribute("fill") == "#b8bec9")
    check("November and December 2026 are outside the dataset range",
          page.locator("#heatmap rect[data-status='outside']").count() == 2 and
          outside.get_attribute("data-status") == "outside")

    mobile = browser.new_page(viewport={"width": 390, "height": 800})
    mobile.goto(url)
    mobile.wait_for_selector("#heatmap rect.heatmap-cell")
    overflow = mobile.evaluate(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth"
    )
    check("Heatmap works without horizontal overflow on mobile", not overflow)
    browser.close()

passed = sum(results)
print(f"\n{passed}/{len(results)} heatmap tests passed")
if passed != len(results):
    raise SystemExit(1)
