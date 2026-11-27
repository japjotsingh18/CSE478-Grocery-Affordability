import csv
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
url = "http://localhost:8000/index.html"
baskets = defaultdict(dict)
with (project / "data/grocery_prices.csv").open() as file:
    for row in csv.DictReader(file):
        baskets[row["date"]][row["product"]] = (float(row["price"]), row["unit"])

year = "#treemap-year"
month = "#treemap-month"
tile = "#treemap .treemap-tile"


def open_page(browser, width, height, errors):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.locator(tile).first.wait_for()
    return page


def verify_baskets(page):
    assert len(baskets) == 129
    for key, items in sorted(baskets.items()):
        selected_year, selected_month = key.split("-")
        if page.locator(year).input_value() != selected_year:
            page.select_option(year, selected_year)
        page.select_option(month, selected_month)
        date = page.locator("#treemap-date")
        assert date.get_attribute("datetime") == key
        assert date.inner_text() == datetime.strptime(key, "%Y-%m").strftime("%B %Y")
        total = sum(price for price, _ in items.values())
        assert page.locator("#treemap-total").inner_text() == f"${total:.3f}"

        tiles = page.locator(tile).evaluate_all("""tiles => tiles.map(tile => {
          const bounds = tile.getBoundingClientRect();
          return {
            product: tile.dataset.product,
            area: Number(tile.getAttribute("width")) * Number(tile.getAttribute("height")),
            lines: Array.from(tile.parentNode.querySelectorAll("tspan"), line => {
              const box = line.getBoundingClientRect();
              return {
                text: line.textContent,
                visible: getComputedStyle(line).visibility === "visible",
                inside: box.left >= bounds.left && box.right <= bounds.right &&
                        box.top >= bounds.top && box.bottom <= bounds.bottom,
                top: box.top, bottom: box.bottom, right: box.right, left: box.left
              };
            })
          };
        })""")
        assert len(tiles) == 3 and {item["product"] for item in tiles} == set(items), key
        width, height = page.locator("#treemap svg").get_attribute("viewBox").split()[2:]
        chart_area = float(width) * float(height)
        displayed_shares = []
        for item in tiles:
            product = item["product"]
            price, _ = items[product]
            share = price / total
            assert math.isclose(item["area"] / chart_area, share, abs_tol=1e-10), (key, product)
            lines = item["lines"]
            assert [line["text"] for line in lines] == [product, f"${price:.3f}", f"{share:.2%}"]
            assert all(line["inside"] and line["visible"] for line in lines), (key, product, lines)
            assert all(a["bottom"] <= b["top"] or a["right"] <= b["left"]
                       for a, b in zip(lines, lines[1:])), (key, product)
            displayed_shares.append(float(lines[2]["text"].rstrip("%")))
        assert math.isclose(sum(displayed_shares), 100, abs_tol=0.011), key
        assert page.evaluate("document.documentElement.scrollWidth === document.documentElement.clientWidth"), key


def verify_tooltip(page, key, product):
    tooltip = page.locator("#treemap-tooltip")
    price, unit = baskets[key][product]
    total = sum(price for price, _ in baskets[key].values())
    date = datetime.strptime(key, "%Y-%m").strftime("%B %Y")
    assert tooltip.is_visible()
    assert tooltip.locator("p").all_text_contents() == [
        f"{product} · {date}",
        f"Basket quantity: 1 {unit}",
        f"Price: ${price:.3f} per {unit}",
        f"Basket contribution: ${price:.3f}",
        f"Share of total: {price / total:.2%}",
    ]
    chart = page.locator("#treemap").bounding_box()
    box = tooltip.bounding_box()
    for position, size in [("x", "width"), ("y", "height")]:
        assert chart[position] <= box[position]
        assert box[position] + box[size] <= chart[position] + chart[size] + 1


def run():
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        desktop = open_page(browser, 1100, 900, errors)
        assert desktop.locator(year).input_value() == "2026"
        assert desktop.locator(month).input_value() == "10"
        assert desktop.locator("#treemap-date").inner_text() == "October 2026"
        assert desktop.locator(f"{year} option").count() == 11
        assert desktop.locator(f"{month} option").count() == 12
        assert desktop.locator(f"{month} option[value='11']").is_disabled()
        assert desktop.locator(f"{month} option[value='12']").is_disabled()
        desktop.select_option(year, "2025")
        assert desktop.locator(f"{month} option[value='10']").is_disabled()
        assert desktop.locator(month).input_value() == "12"
        desktop.select_option(year, "2026")
        assert desktop.locator(month).input_value() == "10"
        print("PASS — Default date, unavailable months, and automatic fallback")

        for product in baskets["2026-10"]:
            point = desktop.locator(f"#scatterplot .scatter-point[data-product='{product}']")
            line = desktop.locator(f"#chart .line[data-product='{product}']")
            rect = desktop.locator(f"{tile}[data-product='{product}']")
            assert rect.get_attribute("fill") == point.get_attribute("fill") == line.get_attribute("stroke")
        print("PASS — Product colors match the line chart and scatterplot")

        eggs = desktop.locator(f"{tile}[data-product='Eggs']")
        eggs.hover()
        verify_tooltip(desktop, "2026-10", "Eggs")
        desktop.select_option(year, "2020")
        desktop.select_option(month, "03")
        desktop.locator(month).focus()
        desktop.keyboard.press("Tab")
        assert eggs.evaluate("node => node === document.activeElement")
        verify_tooltip(desktop, "2020-03", "Eggs")
        desktop.keyboard.press("Escape")
        assert desktop.locator("#treemap-tooltip").is_hidden()
        print("PASS — Hover and keyboard tooltips show the selected basket and stay inside the chart")

        milk = desktop.locator(f"{tile}[data-product='Milk']")
        desktop.mouse.move(0, 0)
        eggs.hover()
        verify_tooltip(desktop, "2020-03", "Eggs")
        desktop.mouse.move(0, 0)
        assert eggs.evaluate("node => node === document.activeElement")
        verify_tooltip(desktop, "2020-03", "Eggs")
        milk.hover()
        verify_tooltip(desktop, "2020-03", "Milk")
        desktop.mouse.move(0, 0)
        verify_tooltip(desktop, "2020-03", "Eggs")
        desktop.keyboard.press("Tab")
        assert milk.evaluate("node => node === document.activeElement")
        verify_tooltip(desktop, "2020-03", "Milk")
        milk.hover()
        desktop.keyboard.press("Escape")
        desktop.mouse.move(0, 0)
        assert desktop.locator("#treemap-tooltip").is_hidden()
        milk.hover()
        desktop.locator(month).focus()
        verify_tooltip(desktop, "2020-03", "Milk")
        desktop.mouse.move(0, 0)
        assert desktop.locator("#treemap-tooltip").is_hidden()
        print("PASS — Tooltip stays with the remaining hover or focus and preserves Escape dismissal")

        verify_baskets(desktop)
        print("PASS — All 129 desktop months have correct costs, shares, areas, and readable labels")
        mobile = open_page(browser, 390, 800, errors)
        mobile.locator(f"{tile}[data-product='Bread']").focus()
        verify_tooltip(mobile, "2026-10", "Bread")
        verify_baskets(mobile)
        print("PASS — All 129 mobile months have correct costs, shares, areas, and readable labels")
        assert not errors, errors
        print("PASS — No JavaScript errors")


if __name__ == "__main__":
    run()
