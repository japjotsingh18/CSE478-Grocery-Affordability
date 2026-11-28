import csv
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
url = "http://localhost:8000/index.html"
products = ["Eggs", "Milk", "Bread"]
rows_by_product_year = defaultdict(list)

with (project / "data/grocery_prices.csv").open() as file:
    for row in csv.DictReader(file):
        row["date_value"] = datetime.strptime(row["date"], "%Y-%m")
        row["price_value"] = float(row["price"])
        rows_by_product_year[(row["product"], row["date_value"].year)].append(row)


def quantile(values, probability):
    position = (len(values) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return values[lower]
    return values[lower] * (upper - position) + values[upper] * (position - lower)


def expected_statistics(product, year):
    observations = sorted(rows_by_product_year[(product, year)], key=lambda row: row["price_value"])
    prices = [row["price_value"] for row in observations]
    q1 = quantile(prices, 0.25)
    median = quantile(prices, 0.5)
    q3 = quantile(prices, 0.75)
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr
    within_fences = [price for price in prices if lower_fence <= price <= upper_fence]
    outliers = [row for row in observations
                if row["price_value"] < lower_fence or row["price_value"] > upper_fence]
    return {
        "count": len(prices), "minimum": prices[0], "q1": q1, "median": median,
        "q3": q3, "maximum": prices[-1], "lower_whisker": within_fences[0],
        "upper_whisker": within_fences[-1], "outliers": outliers,
    }


def close(actual, expected):
    return math.isclose(float(actual), expected, rel_tol=0, abs_tol=1e-12)


def tooltip_inside_chart(page):
    chart = page.locator("#boxplot").bounding_box()
    tooltip = page.locator("#boxplot-tooltip").bounding_box()
    return (chart["x"] <= tooltip["x"] and chart["y"] <= tooltip["y"]
            and tooltip["x"] + tooltip["width"] <= chart["x"] + chart["width"] + 1
            and tooltip["y"] + tooltip["height"] <= chart["y"] + chart["height"] + 1)


with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_selector("#boxplot .boxplot-hit")

    assert page.locator("#boxplot-product").input_value() == "Eggs"
    assert page.locator("#boxplot .boxplot-year").count() == 11
    assert page.locator("#boxplot .boxplot-hit").count() == 11
    print("PASS — Box plot loads with Eggs selected and all 11 years")

    for product in products:
        page.select_option("#boxplot-product", product)
        assert page.locator("#boxplot .boxplot-hit").count() == 11
        assert f"per {rows_by_product_year[(product, 2016)][0]['unit']}" in page.locator("#boxplot").inner_text()
        expected_color = page.locator(f"#chart .line[data-product='{product}']").get_attribute("stroke")
        assert all(box.get_attribute("stroke") == expected_color
                   for box in page.locator("#boxplot .boxplot-box").all())

        for year in range(2016, 2027):
            expected = expected_statistics(product, year)
            mark = page.locator(f"#boxplot .boxplot-hit[data-year='{year}']")
            assert int(mark.get_attribute("data-count")) == expected["count"]
            for attribute, key in [
                ("data-min", "minimum"), ("data-q1", "q1"),
                ("data-median", "median"), ("data-q3", "q3"),
                ("data-max", "maximum"), ("data-lower-whisker", "lower_whisker"),
                ("data-upper-whisker", "upper_whisker"),
            ]:
                assert close(mark.get_attribute(attribute), expected[key]), (product, year, attribute)
            assert int(mark.get_attribute("data-outlier-count")) == len(expected["outliers"])
            displayed_outliers = page.locator(
                f"#boxplot .boxplot-outlier[data-product='{product}'][data-month^='{year}-']")
            assert displayed_outliers.count() == len(expected["outliers"])
            for row in expected["outliers"]:
                outlier = page.locator(f"#boxplot .boxplot-outlier[data-month='{row['date']}']")
                assert close(outlier.get_attribute("data-price"), row["price_value"])
    print("PASS — All 33 product-year quartiles, medians, whiskers, outliers, counts, units, and colors are correct")

    assert page.locator("#boxplot .boxplot-hit[data-year='2025']").get_attribute("data-count") == "11"
    assert page.locator("#boxplot .boxplot-hit[data-year='2026']").get_attribute("data-count") == "10"
    assert "2025 has 11 months" in page.locator(".boxplot-coverage").first.inner_text()
    assert "2026 has 10 months" in page.locator(".boxplot-coverage").first.inner_text()
    print("PASS — Incomplete years use and identify only their available observations")

    page.select_option("#boxplot-product", "Eggs")
    eggs_axis = page.locator("#boxplot .boxplot-y-axis .tick text").all_text_contents()
    eggs_2020 = expected_statistics("Eggs", 2020)
    year_mark = page.locator("#boxplot .boxplot-hit[data-year='2020']")
    year_mark.hover()
    tooltip = page.locator("#boxplot-tooltip")
    expected_lines = [
        "Eggs · 2020", "Observations: 12", f"Minimum: ${eggs_2020['minimum']:.3f}",
        f"Q1: ${eggs_2020['q1']:.3f}", f"Median: ${eggs_2020['median']:.3f}",
        f"Q3: ${eggs_2020['q3']:.3f}", f"Maximum: ${eggs_2020['maximum']:.3f}",
        f"Whiskers: ${eggs_2020['lower_whisker']:.3f} – ${eggs_2020['upper_whisker']:.3f}",
        f"Outliers: {len(eggs_2020['outliers'])}",
    ]
    assert tooltip.locator("p").all_text_contents() == expected_lines
    assert tooltip_inside_chart(page)
    print("PASS — Annual tooltip shows accurate statistics and stays inside the chart")

    page.select_option("#boxplot-product", "Milk")
    milk_axis = page.locator("#boxplot .boxplot-y-axis .tick text").all_text_contents()
    assert eggs_axis != milk_axis
    assert "per gallon" in page.locator("#boxplot").inner_text()
    outlier = page.locator("#boxplot .boxplot-outlier[data-month='2023-01']")
    outlier.hover()
    assert tooltip.locator("p").all_text_contents() == [
        "Milk", "Month: Jan 2023", "Price: $4.204 / gallon"
    ]
    assert tooltip_inside_chart(page)
    print("PASS — Product changes update the Y-axis and outlier tooltip accurately")

    page.mouse.move(0, 0)
    outlier.focus()
    assert tooltip.is_visible() and tooltip.get_attribute("data-type") == "outlier"
    page.keyboard.press("Escape")
    assert tooltip.is_hidden()
    year_mark = page.locator("#boxplot .boxplot-hit[data-year='2023']")
    year_mark.hover()
    assert tooltip.is_visible() and tooltip.get_attribute("data-type") == "year"
    page.mouse.move(0, 0)
    assert tooltip.is_visible() and tooltip.get_attribute("data-type") == "outlier"
    outlier.blur()
    assert tooltip.is_hidden()
    print("PASS — Hover, keyboard focus, Escape, and simultaneous interaction behave correctly")

    mobile = browser.new_page(viewport={"width": 390, "height": 800})
    mobile.goto(url)
    mobile.wait_for_selector("#boxplot .boxplot-hit")
    initial_viewbox = mobile.locator("#boxplot svg").get_attribute("viewBox")
    mobile.set_viewport_size({"width": 500, "height": 800})
    mobile.wait_for_function("document.querySelector('#boxplot svg').viewBox.baseVal.width > 400")
    resized_viewbox = mobile.locator("#boxplot svg").get_attribute("viewBox")
    assert initial_viewbox != resized_viewbox
    mobile.set_viewport_size({"width": 390, "height": 800})
    mobile.wait_for_function("document.querySelector('#boxplot svg').viewBox.baseVal.width < 400")
    tick_boxes = mobile.locator("#boxplot .boxplot-x-axis .tick text").evaluate_all(
        "nodes => nodes.map(node => node.getBoundingClientRect())")
    assert all(a["right"] <= b["left"] for a, b in zip(tick_boxes, tick_boxes[1:]))
    y_title = mobile.locator("#boxplot .axis-title").nth(1).bounding_box()
    y_ticks = mobile.locator("#boxplot .boxplot-y-axis .tick text").evaluate_all(
        "nodes => nodes.map(node => node.getBoundingClientRect())")
    assert y_title["x"] + y_title["width"] < min(tick["x"] for tick in y_ticks)
    assert not mobile.evaluate(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert mobile.locator("#boxplot .boxplot-hit").count() == 11
    print("PASS — Box plot resizes without overlapping year labels or mobile overflow")

    assert not errors, errors
    for current in [page, mobile]:
        current.select_option("#boxplot-product", "Bread")
        current.locator("#boxplot-product").focus()
        current.locator(".boxplot-hit[data-year='2020']").hover()
        current.keyboard.press("Escape")
        assert current.locator("#boxplot-tooltip").is_hidden()
        near = current.locator(".boxplot-outlier[data-month^='2019-']")
        assert near.count() == 2
        assert abs(float(near.nth(0).get_attribute('cx')) - float(near.nth(1).get_attribute('cx'))) >= 12
        for point in near.all():
            point.hover()
            assert current.locator('#boxplot-tooltip').get_attribute('data-month') == point.get_attribute('data-month')
            point.focus()
            assert point.evaluate('e => e === document.activeElement')
        for product in products:
            current.select_option('#boxplot-product', product)
            assert current.locator('.boxplot-hit').count() == 11
            for mark in current.locator('.boxplot-hit').all():
                label = mark.get_attribute('aria-label')
                assert all(word in label for word in ['Lower whisker', 'upper whisker', 'outliers', 'Prices per'])
                mark.focus()
                assert tooltip_inside_chart(current)
                tip_box = current.locator('#boxplot-tooltip').bounding_box()
                axis = current.locator('.boxplot-x-axis').bounding_box()
                assert tip_box['y'] + tip_box['height'] <= axis['y'] + 1
        assert '1.5 × IQR' in current.locator('.boxplot-rule').inner_text()
    print('PASS — Hover-only Escape, separate outlier access, accessible statistics, legend rule, and plot-area tooltip bounds')
    print("PASS — No JavaScript errors")
    browser.close()
