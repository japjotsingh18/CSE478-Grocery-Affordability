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

  let lastWidth = chartDiv.clientWidth;

  window.addEventListener("resize", () => {
    if (chartDiv.clientWidth !== lastWidth) { lastWidth = chartDiv.clientWidth; draw(); }
  });
}
