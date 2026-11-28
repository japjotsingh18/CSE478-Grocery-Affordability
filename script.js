const CSV_PATH = "data/grocery_prices.csv";
const PRODUCT_ORDER = ["Eggs", "Milk", "Bread"];
const PRODUCT_COLORS = { Eggs: "#d98a00", Milk: "#1f6fb2", Bread: "#7a4a2b" };
const parseMonth = d3.timeParse("%Y-%m");
const formatMonth = d3.timeFormat("%b %Y");
const formatMonthKey = d3.timeFormat("%Y-%m");
const formatPrice = d3.format("$.3f");
const formatAxisPrice = d3.format("$.2f");

const chartDiv = document.getElementById("chart");
const tooltip = document.getElementById("tooltip");
const legendEl = document.getElementById("legend");

d3.csv(CSV_PATH, d => ({
  date: parseMonth(d.date),
  product: d.product,
  category: d.category,
  price: +d.price,
  unit: d.unit
}))
  .then(init)
  .catch(err => showError(err));

function showError(err) {
  console.error(err);
  
  chartDiv.innerHTML =
    '<div class="error-box"><strong>The chart could not load the data.</strong> ' +
    "Browsers block local files opened by double-clicking index.html. " +
    "Run <code>python3 -m http.server</code> in this folder and open " +
    "<code>http://localhost:8000</code> instead.</div>";
}

function init(rows) {
  rows = rows.filter(d => d.date && Number.isFinite(d.price));
  if (rows.length === 0) { showError(new Error("CSV had no usable rows")); return; }

  const found = Array.from(new Set(rows.map(d => d.product)));
  const products = [
    ...PRODUCT_ORDER.filter(p => found.includes(p)),
    ...found.filter(p => !PRODUCT_ORDER.includes(p))
  ];
  const fallback = d3.scaleOrdinal(d3.schemeTableau10);
  const color = p => PRODUCT_COLORS[p] || fallback(p);
  const unitOf = new Map(rows.map(d => [d.product, d.unit]));

  const [firstDate, lastDate] = d3.extent(rows, d => d.date);
  const allMonths = d3.timeMonth.range(firstDate, d3.timeMonth.offset(lastDate, 1));
  const lookup = new Map(products.map(p => [p, new Map()]));
  rows.forEach(d => lookup.get(d.product).set(formatMonthKey(d.date), d.price));

  const series = new Map(products.map(p => [
    p,
    allMonths.map(m => ({ date: m, price: lookup.get(p).get(formatMonthKey(m)) ?? null }))
  ]));

  const selected = new Set(products);
  products.forEach(p => {
    const label = document.createElement("label");
    label.className = "legend-item";
    label.style.color = color(p);
    label.innerHTML =
      `<input type="checkbox" value="${p}" checked>` +
      `<span class="swatch" aria-hidden="true"></span>` +
      `<span style="color: var(--ink)"><strong>${p}</strong> <span class="unit">per ${unitOf.get(p)}</span></span>`;
    legendEl.appendChild(label);
  });

  legendEl.addEventListener("change", e => {
    if (e.target.checked) selected.add(e.target.value); else selected.delete(e.target.value);
    draw();
  });

  function draw() {
    tooltip.hidden = true;
    d3.select(chartDiv).select("svg").remove();

    const width = chartDiv.clientWidth || 800;
    const height = Math.max(320, Math.min(500, Math.round(width * 0.55)));
    const margin = { top: 24, right: 20, bottom: 54, left: 62 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const visible = products.filter(p => selected.has(p));

    const svg = d3.select(chartDiv).insert("svg", ":first-child")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Line chart of monthly U.S. average prices for " + (visible.join(", ") || "no products selected"));

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const x = d3.scaleTime().domain([firstDate, lastDate]).range([0, innerW]);
    const maxPrice = visible.length ? d3.max(visible, p => d3.max(series.get(p), d => d.price)) : 5;
    const y = d3.scaleLinear().domain([0, maxPrice * 1.06]).nice().range([innerH, 0]);

    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat(""));

    const yearStep = width < 560 ? 2 : 1;

    g.append("g").attr("class", "axis")
      .attr("transform", `translate(0,${innerH})`)
      .call(d3.axisBottom(x).ticks(d3.timeYear.every(yearStep)).tickFormat(d3.timeFormat("%Y")));

    g.append("g").attr("class", "axis")
      .call(d3.axisLeft(y).ticks(6).tickFormat(formatAxisPrice));

    g.append("text").attr("class", "axis-title")
      .attr("x", innerW / 2).attr("y", innerH + 44).attr("text-anchor", "middle")
      .text("Month (January 2016 to October 2026)");

    g.append("text").attr("class", "axis-title")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerH / 2).attr("y", -margin.left + 16).attr("text-anchor", "middle")
      .text("Average price (US dollars)");

    const line = d3.line()
      .defined(d => d.price !== null)
      .x(d => x(d.date))
      .y(d => y(d.price));

    visible.forEach(p => {
      g.append("path")
        .attr("class", "line")
        .attr("data-product", p)
        .attr("stroke", color(p))
        .attr("d", line(series.get(p)));
    });

    if (visible.length === 0) {
      g.append("text").attr("class", "empty-msg")
        .attr("x", innerW / 2).attr("y", innerH / 2).attr("text-anchor", "middle")
        .text("Select at least one product in the legend above.");
      return;
    }

    const hoverLine = g.append("line").attr("class", "hover-line")
      .attr("y1", 0).attr("y2", innerH).style("display", "none");

    const dots = g.append("g");

    const overlay = g.append("rect")
      .attr("width", innerW).attr("height", innerH)
      .attr("fill", "transparent")
      .style("touch-action", "pan-y");

    overlay
      .on("pointermove", event => {
        const [mx] = d3.pointer(event);
        const idx = d3.bisector(m => m).center(allMonths, x.invert(mx));
        const month = allMonths[idx];
        const key = formatMonthKey(month);
        const cx = x(month);

        hoverLine.style("display", null).attr("x1", cx).attr("x2", cx);

        const present = visible.filter(p => lookup.get(p).has(key));
        dots.selectAll("circle").remove();

        present.forEach(p => {
          dots.append("circle")
            .attr("cx", cx).attr("cy", y(lookup.get(p).get(key)))
            .attr("r", 5).attr("fill", color(p)).attr("stroke", "#fff").attr("stroke-width", 2);
        });

        let html = `<p class="tt-month">${formatMonth(month)}</p>`;

        if (present.length === 0) {
          html += `<div class="tt-none">No data for this month</div>`;
        } 
        else {
          present.forEach(p => {
            html += `<div class="tt-row"><span class="tt-dot" style="background:${color(p)}"></span>` +
              `<span class="tt-name">${p}</span>` +
              `<span class="tt-price">${formatPrice(lookup.get(p).get(key))} <span class="tt-unit">/ ${unitOf.get(p)}</span></span></div>`;
          });
        }

        tooltip.innerHTML = html;
        tooltip.hidden = false;

        const tipW = tooltip.offsetWidth, tipH = tooltip.offsetHeight;
        const px = margin.left + cx;
        let left = px + 14;

        if (left + tipW > width) left = px - tipW - 14;

        tooltip.style.left = Math.max(0, left) + "px";
        tooltip.style.top = Math.max(0, margin.top + 8) + "px";
        tooltip.dataset.month = key;
      })
      .on("pointerleave", () => {
        tooltip.hidden = true;
        hoverLine.style("display", "none");
        dots.selectAll("circle").remove();
      });
  }

  draw();

  initHeatmap(rows, products, unitOf, lastDate);
  initScatterplot(rows, products, unitOf, color);
  initTreemap(allMonths, lookup, unitOf, color);
  initBoxplot(rows, products, unitOf, color);

  let lastWidth = chartDiv.clientWidth;

  window.addEventListener("resize", () => {
    if (chartDiv.clientWidth !== lastWidth) { lastWidth = chartDiv.clientWidth; draw(); }
  });
}

function initBoxplot(rows, products, unitOf, color) {
  const chartDiv = document.getElementById("boxplot");
  const productSelect = document.getElementById("boxplot-product");
  const boxplotTooltip = document.getElementById("boxplot-tooltip");
  const years = d3.range(2016, 2027);

  products.forEach(product => productSelect.add(new Option(product, product)));
  productSelect.value = "Eggs";
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") boxplotTooltip.hidden = true;
  });

  function calculateYear(product, year) {
    const observations = rows
      .filter(row => row.product === product && row.date.getFullYear() === year)
      .sort((a, b) => a.price - b.price);
    const prices = observations.map(row => row.price);
    const q1 = d3.quantileSorted(prices, 0.25);
    const median = d3.quantileSorted(prices, 0.5);
    const q3 = d3.quantileSorted(prices, 0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const withinFences = observations.filter(row => row.price >= lowerFence && row.price <= upperFence);
    const outliers = observations.filter(row => row.price < lowerFence || row.price > upperFence);
    return {
      product, year, observations, q1, median, q3,
      minimum: prices[0], maximum: prices[prices.length - 1],
      lowerWhisker: withinFences[0].price,
      upperWhisker: withinFences[withinFences.length - 1].price,
      outliers
    };
  }

  function drawBoxplot() {
    boxplotTooltip.hidden = true;
    d3.select(chartDiv).select("svg").remove();
    const product = productSelect.value;
    const statistics = years.map(year => calculateYear(product, year));
    const allPrices = statistics.flatMap(item => item.observations.map(row => row.price));
    const width = chartDiv.clientWidth || 800;
    const height = width < 560 ? 370 : 460;
    const margin = { top: 20, right: 18, bottom: 58, left: width < 560 ? 78 : 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const priceExtent = d3.extent(allPrices);
    const pricePadding = Math.max(0.08, (priceExtent[1] - priceExtent[0]) * 0.1);
    const xScale = d3.scaleBand().domain(years).range([0, innerWidth]).padding(0.32);
    const yScale = d3.scaleLinear()
      .domain([Math.max(0, priceExtent[0] - pricePadding), priceExtent[1] + pricePadding])
      .nice().range([innerHeight, 0]);

    const svg = d3.select(chartDiv).insert("svg", ":first-child")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "group")
      .attr("aria-labelledby", "boxplot-title");
    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    chart.append("g").attr("class", "grid")
      .call(d3.axisLeft(yScale).ticks(6).tickSize(-innerWidth).tickFormat(""));
    chart.append("g").attr("class", "axis boxplot-x-axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues(width < 560 ? years.filter(year => year % 2 === 0) : years));
    chart.append("g").attr("class", "axis boxplot-y-axis")
      .call(d3.axisLeft(yScale).ticks(6).tickFormat(formatAxisPrice));
    chart.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("x", innerWidth / 2).attr("y", innerHeight + 46).text("Year");
    chart.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)").attr("x", -innerHeight / 2).attr("y", -margin.left + 17)
      .text(`Monthly price (US dollars per ${unitOf.get(product)})`);

    const groups = chart.selectAll("g.boxplot-year")
      .data(statistics).join("g")
      .attr("class", "boxplot-year")
      .attr("data-year", item => item.year)
      .attr("transform", item => `translate(${xScale(item.year)},0)`);
    const boxWidth = xScale.bandwidth();
    const center = boxWidth / 2;
    const capWidth = Math.max(8, boxWidth * 0.65);

    groups.append("line").attr("class", "boxplot-whisker")
      .attr("x1", center).attr("x2", center)
      .attr("y1", item => yScale(item.lowerWhisker)).attr("y2", item => yScale(item.upperWhisker))
      .attr("stroke", color(product));
    groups.append("line").attr("class", "boxplot-cap lower-cap")
      .attr("x1", center - capWidth / 2).attr("x2", center + capWidth / 2)
      .attr("y1", item => yScale(item.lowerWhisker)).attr("y2", item => yScale(item.lowerWhisker))
      .attr("stroke", color(product));
    groups.append("line").attr("class", "boxplot-cap upper-cap")
      .attr("x1", center - capWidth / 2).attr("x2", center + capWidth / 2)
      .attr("y1", item => yScale(item.upperWhisker)).attr("y2", item => yScale(item.upperWhisker))
      .attr("stroke", color(product));
    groups.append("rect").attr("class", "boxplot-box")
      .attr("x", 0).attr("width", boxWidth)
      .attr("y", item => yScale(item.q3))
      .attr("height", item => Math.max(1, yScale(item.q1) - yScale(item.q3)))
      .attr("fill", color(product)).attr("fill-opacity", 0.28)
      .attr("stroke", color(product)).attr("stroke-width", 2);
    groups.append("line").attr("class", "boxplot-median")
      .attr("x1", 0).attr("x2", boxWidth)
      .attr("y1", item => yScale(item.median)).attr("y2", item => yScale(item.median))
      .attr("stroke", color(product));

    let hoveredItem = null;
    let focusedItem = null;
    const hitAreas = groups.append("rect")
      .attr("class", "boxplot-mark boxplot-hit")
      .attr("data-year", item => item.year)
      .attr("data-count", item => item.observations.length)
      .attr("data-min", item => item.minimum).attr("data-q1", item => item.q1)
      .attr("data-median", item => item.median).attr("data-q3", item => item.q3)
      .attr("data-max", item => item.maximum)
      .attr("data-lower-whisker", item => item.lowerWhisker)
      .attr("data-upper-whisker", item => item.upperWhisker)
      .attr("data-outlier-count", item => item.outliers.length)
      .attr("x", -3).attr("width", boxWidth + 6)
      .attr("y", item => yScale(item.maximum) - 7)
      .attr("height", item => Math.max(14, yScale(item.minimum) - yScale(item.maximum) + 14))
      .attr("fill", "#fff").attr("fill-opacity", 0).attr("stroke", "transparent")
      .attr("tabindex", 0).attr("role", "img")
      .attr("aria-label", item => `${product}, ${item.year}. ${item.observations.length} observations. ` +
        `Minimum ${formatPrice(item.minimum)}, Q1 ${formatPrice(item.q1)}, median ${formatPrice(item.median)}, ` +
        `Q3 ${formatPrice(item.q3)}, maximum ${formatPrice(item.maximum)}. ` +
        `Lower whisker ${formatPrice(item.lowerWhisker)}, upper whisker ${formatPrice(item.upperWhisker)}. ` +
        `${item.outliers.length} outliers. Prices per ${unitOf.get(product)}.`)
      .on("pointerenter", function(event, item) { hoveredItem = { type: "year", item, target: this }; showYearTooltip(item, this); })
      .on("focus", function(event, item) { focusedItem = { type: "year", item, target: this }; showYearTooltip(item, this); })
      .on("pointerleave", () => { hoveredItem = null; keepTooltipFor(focusedItem); })
      .on("blur", () => { focusedItem = null; keepTooltipFor(hoveredItem); })
      .on("keydown", event => { if (event.key === "Escape") boxplotTooltip.hidden = true; });

    const outlierData = statistics.flatMap(item => item.outliers.map(row => ({ row, statistics: item })));
    outlierData.forEach(item => {
      const nearby = outlierData.filter(other => other.statistics.year === item.statistics.year
        && Math.abs(yScale(other.row.price) - yScale(item.row.price)) < 12);
      item.offset = (nearby.indexOf(item) - (nearby.length - 1) / 2) * 12;
    });
    chart.selectAll("circle.boxplot-outlier")
      .data(outlierData).join("circle")
      .attr("class", "boxplot-mark boxplot-outlier")
      .attr("data-product", product).attr("data-month", item => formatMonthKey(item.row.date))
      .attr("data-price", item => item.row.price)
      .attr("cx", item => xScale(item.statistics.year) + center + item.offset)
      .attr("cy", item => yScale(item.row.price)).attr("r", width < 560 ? 4 : 5)
      .attr("fill", "#fff").attr("stroke", color(product))
      .attr("tabindex", 0).attr("role", "img")
      .attr("aria-label", item => `${product}, ${formatMonth(item.row.date)}, outlier price ${formatPrice(item.row.price)} per ${item.row.unit}`)
      .on("pointerenter", function(event, item) { hoveredItem = { type: "outlier", item, target: this }; showOutlierTooltip(item, this); })
      .on("focus", function(event, item) { focusedItem = { type: "outlier", item, target: this }; showOutlierTooltip(item, this); })
      .on("pointerleave", () => { hoveredItem = null; keepTooltipFor(focusedItem); })
      .on("blur", () => { focusedItem = null; keepTooltipFor(hoveredItem); })
      .on("keydown", event => { if (event.key === "Escape") boxplotTooltip.hidden = true; });

    function keepTooltipFor(active) {
      if (boxplotTooltip.hidden) return;
      if (!active) { boxplotTooltip.hidden = true; return; }
      if (active.type === "year") showYearTooltip(active.item, active.target);
      else showOutlierTooltip(active.item, active.target);
    }

    function showYearTooltip(item, target) {
      boxplotTooltip.innerHTML = `<p class="tt-title">${product} · ${item.year}</p>` +
        `<p><strong>Observations:</strong> ${item.observations.length}</p>` +
        `<p><strong>Minimum:</strong> ${formatPrice(item.minimum)}</p>` +
        `<p><strong>Q1:</strong> ${formatPrice(item.q1)}</p>` +
        `<p><strong>Median:</strong> ${formatPrice(item.median)}</p>` +
        `<p><strong>Q3:</strong> ${formatPrice(item.q3)}</p>` +
        `<p><strong>Maximum:</strong> ${formatPrice(item.maximum)}</p>` +
        `<p><strong>Whiskers:</strong> ${formatPrice(item.lowerWhisker)} – ${formatPrice(item.upperWhisker)}</p>` +
        `<p><strong>Outliers:</strong> ${item.outliers.length}</p>`;
      boxplotTooltip.dataset.type = "year";
      boxplotTooltip.dataset.year = item.year;
      showTooltipAt(target);
    }

    function showOutlierTooltip(item, target) {
      boxplotTooltip.innerHTML = `<p class="tt-title">${product}</p>` +
        `<p><strong>Month:</strong> ${formatMonth(item.row.date)}</p>` +
        `<p><strong>Price:</strong> ${formatPrice(item.row.price)} / ${item.row.unit}</p>`;
      boxplotTooltip.dataset.type = "outlier";
      boxplotTooltip.dataset.month = formatMonthKey(item.row.date);
      showTooltipAt(target);
    }

    function showTooltipAt(target) {
      boxplotTooltip.hidden = false;
      const chartBox = chartDiv.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const targetX = targetBox.left + targetBox.width / 2 - chartBox.left;
      const targetY = targetBox.top + targetBox.height / 2 - chartBox.top;
      let left = targetX + 12;
      if (left + boxplotTooltip.offsetWidth > chartDiv.clientWidth) {
        left = targetX - boxplotTooltip.offsetWidth - 12;
      }
      const above = targetBox.top - chartBox.top - boxplotTooltip.offsetHeight - 12;
      const top = Math.max(margin.top, Math.min(above,
        margin.top + innerHeight - boxplotTooltip.offsetHeight));
      boxplotTooltip.style.left = Math.max(0, left) + "px";
      boxplotTooltip.style.top = top + "px";
    }
  }

  productSelect.addEventListener("change", drawBoxplot);
  drawBoxplot();
  let lastWidth = chartDiv.clientWidth;
  new ResizeObserver(() => {
    if (chartDiv.clientWidth !== lastWidth) {
      lastWidth = chartDiv.clientWidth;
      drawBoxplot();
    }
  }).observe(chartDiv);
}

function initTreemap(allMonths, lookup, unitOf, color) {
  const chart = document.getElementById("treemap");
  const yearSelect = document.getElementById("treemap-year");
  const monthSelect = document.getElementById("treemap-month");
  const dateLabel = document.getElementById("treemap-date");
  const totalLabel = document.getElementById("treemap-total");
  const tip = document.getElementById("treemap-tooltip");
  const formatDate = d3.timeFormat("%B %Y");
  const formatPercent = d3.format(".2%");
  const years = [...new Set(allMonths.map(date => date.getFullYear()))];
  const months = d3.range(12).map(month => d3.timeFormat("%B")(new Date(2000, month)));
  const baskets = new Map();

  allMonths.forEach(date => {
    const key = formatMonthKey(date);
    const items = PRODUCT_ORDER.map(product => ({
      product, cost: lookup.get(product)?.get(key), unit: unitOf.get(product)
    }));
    if (items.every(item => Number.isFinite(item.cost) && item.cost > 0)) {
      baskets.set(key, items);
    }
  });
  if (!baskets.size) return;

  years.forEach(year => yearSelect.add(new Option(year, year)));
  months.forEach((name, month) => {
    monthSelect.add(new Option(name, String(month + 1).padStart(2, "0")));
  });

  const svg = d3.select(chart).insert("svg", ":first-child")
    .attr("role", "group").attr("aria-labelledby", "treemap-title");
  const [latestYear, latestMonth] = Array.from(baskets.keys()).pop().split("-");
  yearSelect.value = latestYear;
  monthSelect.value = latestMonth;

  function updateMonths() {
    const available = Array.from(monthSelect.options).filter(option => {
      option.disabled = !baskets.has(yearSelect.value + "-" + option.value);
      return !option.disabled;
    });
    if (monthSelect.selectedOptions[0]?.disabled) {
      monthSelect.value = available[available.length - 1]?.value ?? "";
    }
    draw();
  }

  function draw() {
    tip.hidden = true;
    const key = yearSelect.value + "-" + monthSelect.value;
    const items = baskets.get(key);
    const date = formatDate(parseMonth(key));
    const width = chart.clientWidth;
    const compact = width < 500;
    const height = compact ? 280 : 320;
    const root = d3.hierarchy({ children: items }).sum(item => item.cost);
    d3.treemap().tile(compact ? d3.treemapSlice : d3.treemapSquarify).size([width, height])(root);
    const total = root.value;

    dateLabel.dateTime = key;
    dateLabel.textContent = date;
    totalLabel.textContent = formatPrice(total);
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const tiles = svg.selectAll("g").data(root.leaves(), leaf => leaf.data.product).join("g")
      .attr("transform", leaf => `translate(${leaf.x0},${leaf.y0})`)
      .attr("color", leaf => leaf.data.product === "Eggs" ? "#17213a" : "#fff");
    let hoveredTile = null;
    let focusedTile = null;

    tiles.selectAll("rect").data(leaf => [leaf]).join("rect")
      .attr("class", "treemap-tile")
      .attr("data-product", leaf => leaf.data.product)
      .attr("width", leaf => leaf.x1 - leaf.x0)
      .attr("height", leaf => leaf.y1 - leaf.y0)
      .attr("fill", leaf => color(leaf.data.product))
      .attr("tabindex", 0)
      .attr("role", "img")
      .attr("aria-label", ({ data: item }) =>
        `${item.product}, ${date}. ${quantity(item)}. Price ${formatPrice(item.cost)} per ${item.unit}. ` +
        `Basket contribution ${formatPrice(item.cost)}, ${formatPercent(item.cost / total)} of total.`)
      .on("pointerenter", (_, leaf) => { hoveredTile = leaf; showTip(leaf); })
      .on("focus", (_, leaf) => { focusedTile = leaf; showTip(leaf); })
      .on("pointerleave", () => { hoveredTile = null; keepTipFor(focusedTile); })
      .on("blur", () => { focusedTile = null; keepTipFor(hoveredTile); })
      .on("keydown", event => { if (event.key === "Escape") tip.hidden = true; });

    tiles.selectAll("text").data(leaf => [leaf]).join("text")
      .attr("class", "treemap-label")
      .attr("aria-hidden", "true")
      .attr("fill", "currentColor")
      .attr("y", leaf => compact ? (leaf.y1 - leaf.y0) / 2 + 5 : 26)
      .each(function (leaf) {
        const lines = [leaf.data.product, formatPrice(leaf.value), formatPercent(leaf.value / total)];
        const columns = [10, width * 0.38, width * 0.7];
        d3.select(this).selectAll("tspan").data(lines).join("tspan")
          .attr("x", (_, index) => compact ? columns[index] : 10)
          .attr("dy", (_, index) => !compact && index ? 19 : 0)
          .text(line => line)
          .each(function () {
            const box = this.getBBox();
            this.setAttribute("visibility",
              box.x + box.width + 4 <= leaf.x1 - leaf.x0 && box.y >= 0 &&
                box.y + box.height + 4 <= leaf.y1 - leaf.y0
                ? "visible" : "hidden");
          });
      });

    function keepTipFor(leaf) {
      if (tip.hidden) return;
      if (leaf) showTip(leaf);
      else tip.hidden = true;
    }

    function showTip(leaf) {
      const item = leaf.data;
      tip.innerHTML = `<p><strong>${item.product}</strong> · ${date}</p>` +
        `<p>Basket quantity: ${quantity(item)}</p>` +
        `<p>Price: ${formatPrice(item.cost)} per ${item.unit}</p>` +
        `<p>Basket contribution: ${formatPrice(item.cost)}</p>` +
        `<p>Share of total: ${formatPercent(item.cost / total)}</p>`;
      tip.hidden = false;
      const left = leaf.x1 + 8 + tip.offsetWidth <= width ? leaf.x1 + 8 : leaf.x0 - tip.offsetWidth - 8;
      const top = (leaf.y0 + leaf.y1 - tip.offsetHeight) / 2;
      tip.style.left = Math.max(0, Math.min(left, width - tip.offsetWidth)) + "px";
      tip.style.top = Math.max(0, Math.min(top, height - tip.offsetHeight)) + "px";
    }
  }

  function quantity(item) {
    return `1 ${item.unit}`;
  }

  yearSelect.addEventListener("change", updateMonths);
  monthSelect.addEventListener("change", draw);
  updateMonths();
  let lastWidth = chart.clientWidth;
  new ResizeObserver(() => {
    if (chart.clientWidth !== lastWidth) {
      lastWidth = chart.clientWidth;
      draw();
    }
  }).observe(chart);
}

function initScatterplot(rows, products, unitOf, color) {
  const scatterplotDiv = document.getElementById("scatterplot");
  const startSelect = document.getElementById("scatterplot-start-year");
  const endSelect = document.getElementById("scatterplot-end-year");
  const scatterplotTooltip = document.getElementById("scatterplot-tooltip");
  const scatterplotLegend = document.getElementById("scatterplot-legend");
  const years = d3.range(2016, 2027);

  years.forEach(year => {
    startSelect.add(new Option(year, year));
    endSelect.add(new Option(year, year));
  });
  startSelect.value = "2016";
  endSelect.value = "2026";

  products.forEach(product => {
    const item = document.createElement("span");
    item.className = "scatterplot-legend-item";
    item.innerHTML = `<span class="scatterplot-legend-dot" style="background:${color(product)}"></span><strong>${product}</strong>`;
    scatterplotLegend.appendChild(item);
  });

  function updateYearOptions() {
    const startYear = +startSelect.value;
    const endYear = +endSelect.value;
    Array.from(startSelect.options).forEach(option => { option.disabled = +option.value > endYear; });
    Array.from(endSelect.options).forEach(option => { option.disabled = +option.value < startYear; });
  }

  function calculateStatistics(product, startYear, endYear) {
    const productRows = rows
      .filter(row => row.product === product && row.date.getFullYear() >= startYear && row.date.getFullYear() <= endYear)
      .sort((a, b) => a.date - b.date);
    if (productRows.length < 2) return null;

    const first = productRows[0];
    const last = productRows[productRows.length - 1];
    const growth = ((last.price - first.price) / first.price) * 100;
    const monthlyChanges = [];

    for (let index = 1; index < productRows.length; index += 1) {
      const previous = productRows[index - 1];
      const current = productRows[index];
      const monthDifference = (current.date.getFullYear() - previous.date.getFullYear()) * 12
        + current.date.getMonth() - previous.date.getMonth();
      if (monthDifference === 1) {
        monthlyChanges.push(((current.price - previous.price) / previous.price) * 100);
      }
    }
    if (monthlyChanges.length === 0) return null;
    const mean = d3.mean(monthlyChanges);
    const volatility = Math.sqrt(d3.mean(monthlyChanges, change => (change - mean) ** 2));
    return { product, first, last, growth, volatility, changeCount: monthlyChanges.length };
  }

  function drawScatterplot() {
    scatterplotTooltip.hidden = true;
    d3.select(scatterplotDiv).select("svg").remove();
    const startYear = +startSelect.value;
    const endYear = +endSelect.value;
    const statistics = products.map(product => calculateStatistics(product, startYear, endYear)).filter(Boolean);
    const width = scatterplotDiv.clientWidth || 800;
    const height = Math.max(350, Math.min(500, Math.round(width * 0.58)));
    const margin = { top: 28, right: width < 560 ? 26 : 50, bottom: 64, left: width < 560 ? 58 : 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(scatterplotDiv).insert("svg", ":first-child")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `Scatterplot of grocery price growth and volatility from ${startYear} through ${endYear}`);
    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const growthExtent = d3.extent(statistics, item => item.growth);
    const growthPadding = Math.max(5, (growthExtent[1] - growthExtent[0]) * 0.25);
    const xMinimum = Math.min(0, growthExtent[0] - growthPadding);
    const xMaximum = Math.max(0, growthExtent[1] + growthPadding);
    const maxVolatility = d3.max(statistics, item => item.volatility) || 1;
    const xScale = d3.scaleLinear().domain([xMinimum, xMaximum]).nice().range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain([0, maxVolatility * 1.22]).nice().range([innerHeight, 0]);

    chart.append("g").attr("class", "grid")
      .call(d3.axisLeft(yScale).ticks(6).tickSize(-innerWidth).tickFormat(""));
    chart.append("line").attr("class", "zero-line")
      .attr("x1", xScale(0)).attr("x2", xScale(0)).attr("y1", 0).attr("y2", innerHeight);
    chart.append("text").attr("class", "zero-label")
      .attr("x", xScale(0) + 5).attr("y", 11).text("Zero growth");
    chart.append("g").attr("class", "axis").attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(width < 560 ? 5 : 7).tickFormat(value => `${value}%`));
    chart.append("g").attr("class", "axis")
      .call(d3.axisLeft(yScale).ticks(6).tickFormat(value => `${value}%`));
    chart.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("x", innerWidth / 2).attr("y", innerHeight + 50).text("Price growth (%)");
    chart.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
      .attr("transform", "rotate(-90)").attr("x", -innerHeight / 2).attr("y", -margin.left + 17)
      .text("Monthly price volatility (%)");

    const pointGroups = chart.selectAll("g.scatter-point-group")
      .data(statistics).join("g").attr("class", "scatter-point-group")
      .attr("transform", item => `translate(${xScale(item.growth)},${yScale(item.volatility)})`);
    pointGroups.append("circle")
      .attr("class", "scatter-point").attr("data-product", item => item.product)
      .attr("data-growth", item => item.growth).attr("data-volatility", item => item.volatility)
      .attr("data-change-count", item => item.changeCount).attr("r", width < 560 ? 7 : 8)
      .attr("fill", item => color(item.product)).attr("tabindex", 0)
      .attr("aria-label", item => `${item.product}: ${item.growth.toFixed(2)} percent growth and ${item.volatility.toFixed(2)} percent volatility`)
      .on("pointermove focus", function(event, item) { showScatterplotTooltip(event, item); })
      .on("pointerleave blur", () => { scatterplotTooltip.hidden = true; });
    const labels = pointGroups.append("text")
      .attr("class", "scatter-label")
      .text(item => item.product);

    const placedLabels = [];
    labels.each(function(item) {
      const label = d3.select(this);
      const pointX = xScale(item.growth);
      const pointY = yScale(item.volatility);
      const rightPositions = [
        { x: 12, y: -10, anchor: "start" },
        { x: 12, y: 18, anchor: "start" },
        { x: 12, y: -26, anchor: "start" },
        { x: 12, y: 34, anchor: "start" }
      ];
      const leftPositions = [
        { x: -12, y: -10, anchor: "end" },
        { x: -12, y: 18, anchor: "end" },
        { x: -12, y: -26, anchor: "end" },
        { x: -12, y: 34, anchor: "end" }
      ];
      const positions = item.product === "Milk"
        ? [...leftPositions, ...rightPositions]
        : [...rightPositions, ...leftPositions];

      for (const position of positions) {
        label.attr("x", position.x).attr("y", position.y).attr("text-anchor", position.anchor);
        const box = this.getBBox();
        const labelBox = {
          left: pointX + box.x,
          right: pointX + box.x + box.width,
          top: pointY + box.y,
          bottom: pointY + box.y + box.height
        };
        const insideChart = labelBox.left >= 0 && labelBox.right <= innerWidth
          && labelBox.top >= 0 && labelBox.bottom <= innerHeight;
        const overlaps = placedLabels.some(other =>
          labelBox.left < other.right + 3 && labelBox.right + 3 > other.left
          && labelBox.top < other.bottom + 3 && labelBox.bottom + 3 > other.top
        );
        if (insideChart && !overlaps) {
          placedLabels.push(labelBox);
          break;
        }
      }
    });

    function showScatterplotTooltip(event, item) {
      scatterplotTooltip.innerHTML =
        `<p class="tt-title">${item.product}</p>` +
        `<p><strong>Date range:</strong> ${formatMonth(item.first.date)} – ${formatMonth(item.last.date)}</p>` +
        `<p><strong>Starting price:</strong> ${formatPrice(item.first.price)} / ${unitOf.get(item.product)}</p>` +
        `<p><strong>Ending price:</strong> ${formatPrice(item.last.price)} / ${unitOf.get(item.product)}</p>` +
        `<p><strong>Price growth:</strong> ${item.growth.toFixed(2)}%</p>` +
        `<p><strong>Volatility:</strong> ${item.volatility.toFixed(2)}%</p>`;
      scatterplotTooltip.dataset.product = item.product;
      scatterplotTooltip.dataset.start = formatMonthKey(item.first.date);
      scatterplotTooltip.dataset.end = formatMonthKey(item.last.date);
      scatterplotTooltip.hidden = false;
      const containerBox = scatterplotDiv.getBoundingClientRect();
      const pointBox = event.currentTarget.getBoundingClientRect();
      const pointX = pointBox.left + pointBox.width / 2 - containerBox.left;
      const pointY = pointBox.top + pointBox.height / 2 - containerBox.top;
      let left = pointX + 14;
      if (left + scatterplotTooltip.offsetWidth > scatterplotDiv.clientWidth) left = pointX - scatterplotTooltip.offsetWidth - 14;
      let top = pointY - scatterplotTooltip.offsetHeight / 2;
      top = Math.max(0, Math.min(top, height - scatterplotTooltip.offsetHeight));
      scatterplotTooltip.style.left = Math.max(0, left) + "px";
      scatterplotTooltip.style.top = top + "px";
    }
  }

  startSelect.addEventListener("change", () => { updateYearOptions(); drawScatterplot(); });
  endSelect.addEventListener("change", () => { updateYearOptions(); drawScatterplot(); });
  updateYearOptions();
  drawScatterplot();

  let lastScatterplotWidth = scatterplotDiv.clientWidth;
  window.addEventListener("resize", () => {
    if (scatterplotDiv.clientWidth !== lastScatterplotWidth) {
      lastScatterplotWidth = scatterplotDiv.clientWidth;
      drawScatterplot();
    }
  });
}

function initHeatmap(rows, products, unitOf, lastDate) {
  const heatmapDiv = document.getElementById("heatmap");
  const productSelect = document.getElementById("heatmap-product");
  const heatmapTooltip = document.getElementById("heatmap-tooltip");
  const years = d3.range(2016, 2027);
  const months = d3.range(1, 13);
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const heatmapLookup = new Map();

  rows.forEach(row => {
    heatmapLookup.set(`${row.product}-${formatMonthKey(row.date)}`, row.price);
  });

  productSelect.innerHTML = "";
  products.forEach(product => {
    const option = document.createElement("option");
    option.value = product;
    option.textContent = product;
    productSelect.appendChild(option);
  });

  function drawHeatmap() {
    const selectedProduct = productSelect.value;
    const productRows = rows.filter(row => row.product === selectedProduct);
    const [minimumPrice, maximumPrice] = d3.extent(productRows, row => row.price);
    const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
      .domain([minimumPrice, maximumPrice]);

    heatmapTooltip.hidden = true;
    d3.select(heatmapDiv).select("svg").remove();

    const width = heatmapDiv.clientWidth || 800;
    const margin = { top: width < 560 ? 58 : 42, right: 20, bottom: 86, left: 54 };
    const innerWidth = width - margin.left - margin.right;
    const cellHeight = width < 560 ? 25 : 31;
    const innerHeight = years.length * cellHeight;
    const height = margin.top + innerHeight + margin.bottom;

    const svg = d3.select(heatmapDiv).insert("svg", ":first-child")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `${selectedProduct} monthly price heatmap from 2016 through 2026`);

    const definitions = svg.append("defs");
    const outsidePattern = definitions.append("pattern")
      .attr("id", "outside-data-pattern")
      .attr("width", 8)
      .attr("height", 8)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(45)");

    outsidePattern.append("rect").attr("width", 8).attr("height", 8).attr("fill", "#f4f6f9");
    outsidePattern.append("line")
      .attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 8)
      .attr("stroke", "#c8ced8").attr("stroke-width", 3);

    const legendGradient = definitions.append("linearGradient")
      .attr("id", "heatmap-color-gradient");

    d3.range(0, 1.01, 0.1).forEach(value => {
      legendGradient.append("stop")
        .attr("offset", `${value * 100}%`)
        .attr("stop-color", colorScale(minimumPrice + value * (maximumPrice - minimumPrice)));
    });

    const chart = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const xScale = d3.scaleBand().domain(months).range([0, innerWidth]).padding(0.04);
    const yScale = d3.scaleBand().domain(years).range([0, innerHeight]).padding(0.04);

    chart.append("g")
      .attr("class", "heatmap-axis")
      .call(d3.axisTop(xScale).tickFormat(month => monthNames[month - 1]).tickSize(0))
      .selectAll("text")
      .attr("transform", width < 560 ? "rotate(-60)" : null)
      .attr("text-anchor", width < 560 ? "start" : "middle")
      .attr("dx", width < 560 ? "0.4em" : null)
      .attr("dy", width < 560 ? "-0.2em" : null);

    chart.append("g")
      .attr("class", "heatmap-axis")
      .call(d3.axisLeft(yScale).tickFormat(year => year).tickSize(0));

    const cells = [];
    years.forEach(year => {
      months.forEach(month => {
        const monthKey = `${year}-${String(month).padStart(2, "0")}`;
        const date = parseMonth(monthKey);
        const price = heatmapLookup.get(`${selectedProduct}-${monthKey}`);
        let status = "price";
        if (date > lastDate) status = "outside";
        else if (price === undefined) status = "missing";
        cells.push({ year, month, monthKey, price, status });
      });
    });

    chart.selectAll("rect.heatmap-cell")
      .data(cells)
      .join("rect")
      .attr("class", cell => `heatmap-cell ${cell.status}-cell`)
      .attr("data-month", cell => cell.monthKey)
      .attr("data-status", cell => cell.status)
      .attr("data-price", cell => cell.price === undefined ? "" : cell.price)
      .attr("x", cell => xScale(cell.month))
      .attr("y", cell => yScale(cell.year))
      .attr("width", xScale.bandwidth())
      .attr("height", yScale.bandwidth())
      .attr("fill", cell => {
        if (cell.status === "outside") return "url(#outside-data-pattern)";
        if (cell.status === "missing") return "#b8bec9";
        return colorScale(cell.price);
      })
      .attr("tabindex", 0)
      .attr("aria-label", cell => heatmapCellLabel(cell, selectedProduct, unitOf.get(selectedProduct), monthNames))
      .on("pointermove focus", function(event, cell) {
        showHeatmapTooltip(event, cell, selectedProduct, unitOf.get(selectedProduct), monthNames, heatmapDiv, heatmapTooltip);
      })
      .on("pointerleave blur", () => { heatmapTooltip.hidden = true; });

    const legendWidth = Math.min(250, innerWidth * 0.55);
    const legendX = margin.left;
    const legendY = margin.top + innerHeight + 35;
    const legend = svg.append("g")
      .attr("class", "heatmap-legend")
      .attr("transform", `translate(${legendX},${legendY})`);

    legend.append("text")
      .attr("class", "heatmap-legend-title")
      .attr("y", -8)
      .text(`${selectedProduct} price per ${unitOf.get(selectedProduct)}`);

    legend.append("rect")
      .attr("width", legendWidth)
      .attr("height", 14)
      .attr("fill", "url(#heatmap-color-gradient)");

    const legendScale = d3.scaleLinear()
      .domain([minimumPrice, maximumPrice])
      .range([0, legendWidth]);

    legend.append("g")
      .attr("transform", "translate(0,14)")
      .call(d3.axisBottom(legendScale).tickValues([minimumPrice, maximumPrice]).tickFormat(formatPrice).tickSize(4));
  }

  productSelect.addEventListener("change", drawHeatmap);
  drawHeatmap();

  let lastHeatmapWidth = heatmapDiv.clientWidth;
  window.addEventListener("resize", () => {
    if (heatmapDiv.clientWidth !== lastHeatmapWidth) {
      lastHeatmapWidth = heatmapDiv.clientWidth;
      drawHeatmap();
    }
  });
}

function heatmapCellLabel(cell, product, unit, monthNames) {
  const dateLabel = `${monthNames[cell.month - 1]} ${cell.year}`;
  if (cell.status === "outside") return `${product}, ${dateLabel}, outside dataset range`;
  if (cell.status === "missing") return `${product}, ${dateLabel}, missing observation`;
  return `${product}, ${dateLabel}, ${formatPrice(cell.price)} per ${unit}`;
}

function showHeatmapTooltip(event, cell, product, unit, monthNames, heatmapDiv, heatmapTooltip) {
  let detail;
  if (cell.status === "outside") detail = '<p class="tt-status">Outside dataset range</p>';
  else if (cell.status === "missing") detail = '<p class="tt-status">Missing observation</p>';
  else detail = `<p><strong>Price:</strong> ${formatPrice(cell.price)} / ${unit}</p>`;

  heatmapTooltip.innerHTML =
    `<p class="tt-title">${product}</p>` +
    `<p><strong>Month:</strong> ${monthNames[cell.month - 1]}</p>` +
    `<p><strong>Year:</strong> ${cell.year}</p>` + detail;
  heatmapTooltip.dataset.product = product;
  heatmapTooltip.dataset.month = cell.monthKey;
  heatmapTooltip.dataset.status = cell.status;
  heatmapTooltip.hidden = false;

  const containerBox = heatmapDiv.getBoundingClientRect();
  const pointerX = event.clientX ? event.clientX - containerBox.left : 0;
  const pointerY = event.clientY ? event.clientY - containerBox.top : 0;
  let left = pointerX + 14;
  if (left + heatmapTooltip.offsetWidth > heatmapDiv.clientWidth) {
    left = pointerX - heatmapTooltip.offsetWidth - 14;
  }
  heatmapTooltip.style.left = Math.max(0, left) + "px";
  heatmapTooltip.style.top = Math.max(0, pointerY + 10) + "px";
}
