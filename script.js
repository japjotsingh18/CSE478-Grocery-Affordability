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

  let lastWidth = chartDiv.clientWidth;

  window.addEventListener("resize", () => {
    if (chartDiv.clientWidth !== lastWidth) { lastWidth = chartDiv.clientWidth; draw(); }
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
