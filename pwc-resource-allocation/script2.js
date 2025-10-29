function openLoadingModal(text = "Working…", percent = 10) {
  const container = document.getElementById("modalContent");
  container.innerHTML = `
    <div class="loading-wrap">
      <div class="progress-ring" id="progressRing" style="--p:${percent};">
        <div class="progress-ring__label" id="progressLabel">${percent}%</div>
      </div>
      <p id="loadingText" style="margin:0;color:#5b6472;">${text}</p>
    </div>
  `;
  document.getElementById("sharedModal").style.display = "block";
}

function setLoadingProgress(percent, text) {
  const ring = document.getElementById("progressRing");
  const label = document.getElementById("progressLabel");
  const msg = document.getElementById("loadingText");
  if (ring) ring.style.setProperty("--p", Math.max(0, Math.min(100, percent)));
  if (label) label.textContent = `${Math.round(percent)}%`;
  if (text && msg) msg.textContent = text;
}

function closeLoadingModal() {
  const modal = document.getElementById("sharedModal");
  if (modal) modal.style.display = "none";
}

async function sendInput() {
  const inputValue = document.getElementById("myInput").value;

  // OPEN loading modal
  openLoadingModal("Understanding your requirement…", 10);

  let data;
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: inputValue }),
    });

    data = await response.json();

    if (response.status !== 200) {
      setLoadingProgress(100, "Error from server.");
      throw new Error(data.error || "Request failed");
    }

    setLoadingProgress(40, "Parsing requirements…");

    const jsonResult = JSON.parse(data.output);
    document.getElementById("tool").value = jsonResult.Tool;
    document.getElementById("module").value = jsonResult.Module;
    document.getElementById("task").value = jsonResult.Task;
    document.getElementById("time_frame").value = jsonResult["Time Frame"];
    document.getElementById("quality").value = jsonResult["Quality Rating"];

    setLoadingProgress(55, "Finding best candidates…");
    await getAIPredictions(data.output);   // or jsonResult, depending on your backend
    // getAIPredictions closes the modal when it finishes successfully
  } catch (err) {
    console.error("sendInput error:", err);
    closeLoadingModal();
    // Optionally show an error modal
    const container = document.getElementById("modalContent");
    container.innerHTML = `<h3>Error</h3><p>${(err && err.message) || "Something went wrong."}</p>`;
    document.getElementById("sharedModal").style.display = "block";
  }
}

async function getAIPredictions(filterFromGemini) {
  try {
    setLoadingProgress(65, "Calling AI service…");

    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filterFromGemini)
    });

    const data = await response.json();

    if (!response.ok) {
      setLoadingProgress(100, "AI service error.");
      throw new Error(data.error || "Prediction request failed");
    }

    setLoadingProgress(85, "Scoring candidates…");

    // Render cards on the page (NOT in the modal)
    const candidates = data.candidates || [];
    const cardContainer = document.getElementById("myCard");
    cardContainer.innerHTML = "";
    cardContainer.appendChild(createCardsFromData(candidates));

    setLoadingProgress(100, "Done!");
    // Close with a tiny grace so user sees 100%
    setTimeout(closeLoadingModal, 250);
  } catch (err) {
    console.error("Error fetching AI predictions:", err);
    closeLoadingModal();
    // Optional: show error in modal
    const container = document.getElementById("modalContent");
    container.innerHTML = `<h3>AI Error</h3><p>${(err && err.message) || "Something went wrong."}</p>`;
    document.getElementById("sharedModal").style.display = "block";
  }
}

function showAICandidatesModal(candidates) {
  
  if (!candidates || candidates.length === 0) {
    const container = document.getElementById("modalContent");
    container.innerHTML = "<h3>Recommended Candidates</h3>";
    container.innerHTML += "<p>No suitable candidates found.</p>";
    document.getElementById("sharedModal").style.display = "block";
  } else {
    const cardContainer = document.getElementById("myCard");

    // ✅ Clear previous cards before adding new ones
    cardContainer.innerHTML = "";

    // ✅ Append fresh card set
    cardContainer.appendChild(createCardsFromData(candidates));
    // const tableWrapper = document.createElement("div");
    // tableWrapper.style.maxHeight = "300px"; // scrollable height
    // tableWrapper.style.overflowY = "auto";
    // tableWrapper.appendChild(createTableFromData(candidates));
    // container.appendChild(tableWrapper);
  }
}

function showEmployeesForSlice(attribute, clickedLabel) {
  activeFilters[attribute] = clickedLabel;
  if (!filterOrder.includes(attribute)) filterOrder.push(attribute);
  updateFilterTree();

  let filteredEmployees = csvData.filter((row) => {
    return Object.entries(activeFilters).every(([key, value]) => {
      if (columnTypes[key] || key === "Time Frame") {
        const [start, end] = value.split("-").map((v) => parseFloat(v));
        const val =
          key === "Time Frame" ? parseTimeToHours(row[key]) : Number(row[key]);
        return !isNaN(val) && val >= start && val <= end;
      } else {
        return row[key] === value;
      }
    });
  });

  const container = document.getElementById("modalContent");
  container.innerHTML = `<h3>Filtered Employees</h3>`;

  // Show active filters
  if (Object.keys(activeFilters).length > 0) {
    const filterDiv = document.createElement("div");
    filterDiv.className = "modal-filters";
    filterDiv.innerHTML = `<strong>Active Filters:</strong> ${Object.entries(activeFilters)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")}`;
    container.appendChild(filterDiv);
  }

  if (filteredEmployees.length === 0) {
    container.innerHTML += "<p>No matching employees found.</p>";
  } else {
    const tableWrapper = document.createElement("div");
    tableWrapper.style.maxHeight = "300px"; // scrollable height
    tableWrapper.style.overflowY = "auto";
    tableWrapper.appendChild(createTableFromData(filteredEmployees));
    container.appendChild(tableWrapper);
  }

  document.getElementById("sharedModal").style.display = "block";
}

function createCardsFromData(dataArray) {
  const article = document.createElement("article");
  article.className = "card";

  // Header
  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `
    <h2 class="card-title">Resources</h2>
    <p class="card-desc">Details of every employee</p>
  `;
  article.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "card-body";
  body.style.display = "grid";
  body.style.gap = "12px";

  body.style.maxHeight = "300px"; // adjust height as needed
  body.style.overflowY = "auto";
  body.style.paddingRight = "8px"; // optional: space for scrollbar

  dataArray.forEach((item) => {
    const candidate = document.createElement("div");
    candidate.className = "candidate";

    const initials = item["Employee Name"]
      ? item["Employee Name"]
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
      : "NA";

    candidate.innerHTML = `
      <div class="meta">
        <div class="avatar">${initials}</div>
        <div>
          <div class="name">
            ${item["Employee Name"]} <span class="pill">${item["Tool"]}</span>
          </div>
          <div style="color:#5b6472;font-size:13px;">${item["Module"]}, ${item["Task"]}</div>
        </div>
      </div>
      <div class="metric">
      <small>Time Frame</small><strong>${item["Time Frame"]}</strong>
        <small>Quality rating</small><strong>${item["Quality Rating"]}</strong>
      </div>
    `;

    body.appendChild(candidate);
  });

  article.appendChild(body);
  return article;
}

function createTableFromData(dataArray) {
  const table = document.createElement("table");
  table.style.width = "100%";
  table.border = "1";

  const headerRow = document.createElement("tr");
  Object.keys(dataArray[0]).forEach((h) => {
    const th = document.createElement("th");
    th.innerText = h;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  dataArray.forEach((item) => {
    const row = document.createElement("tr");
    Object.values(item).forEach((v) => {
      const td = document.createElement("td");
      td.innerText = v;
      row.appendChild(td);
    });
    table.appendChild(row);
  });

  return table;
}

let csvData = [];
let columnTypes = {}; // store type of each column
let pieChart;

// Load CSV
function loadEmployeeData() {
  fetch("employee_resource_dataset_realistic.csv")
    .then((response) => response.text())
    .then((text) => {
      const rows = text
        .trim()
        .split("\n")
        .map((r) => r.split(","));
      const headers = rows[0].map((h) => h.trim());
      const dataRows = rows.slice(1).filter((r) => r.length === headers.length);

      // Convert CSV rows to objects
      csvData = dataRows.map((row) => {
        let obj = {};
        headers.forEach((h, i) => {
          obj[h] = row[i]?.trim();
        });
        return obj;
      });

      // Detect column types (numeric or categorical)
      headers.forEach((h) => {
        const values = csvData.map((r) => r[h]);
        const numericValues = values
          .map((v) => Number(v))
          .filter((v) => !isNaN(v));
        columnTypes[h] = numericValues.length === values.length; // all numeric → numeric column
      });

      const container = document.getElementById("myCard");
      container.innerHTML = ""; // clear if anything existed
      container.appendChild(createCardsFromData(csvData));

      // Draw initial chart
      updateChart();
      updateFilterTree();

    });
}

// Helper: convert time strings like "30 mins", "2 hours", "1 day" into hours
function parseTimeToHours(value) {
  if (!value) return NaN;
  value = value.toLowerCase().trim();
  const num = parseFloat(value);

  if (value.includes("min")) return num / 60;
  if (value.includes("hour")) return num;
  if (value.includes("day")) return num * 24;
  if (value.includes("week")) return num * 24 * 7;

  return NaN;
}

// Update Pie Chart
function updateChart() {
  const attribute = document.getElementById("attributeSelect").value;
  if (!attribute) return;

  // Step 1: Apply current filters first
  let filteredData = csvData.filter((row) => {
    return Object.entries(activeFilters).every(([key, value]) => {
      if (columnTypes[key] || key === "Time Frame") {
        const [start, end] = value.split("-").map((v) => parseFloat(v));
        const val =
          key === "Time Frame" ? parseTimeToHours(row[key]) : Number(row[key]);
        return !isNaN(val) && val >= start && val <= end;
      } else {
        return row[key] === value;
      }
    });
  });

  // Step 2: Use the filtered data for this chart
  const values = filteredData.map((row) => row[attribute]);

  let labels = [];
  let data = [];

  if (attribute === "Time Frame") {
    // Numeric or Time Frame column → create range-based pie chart
    const numericValues =
      attribute === "Time Frame"
        ? values.map((v) => parseTimeToHours(v)).filter((v) => !isNaN(v))
        : values.map((v) => Number(v)).filter((v) => !isNaN(v));

    if (numericValues.length === 0) return;

    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const binCount = 5;
    const binSize = (max - min) / binCount;
    const bins = Array(binCount).fill(0);

    numericValues.forEach((v) => {
      let index = Math.floor((v - min) / binSize);
      if (index >= binCount) index = binCount - 1;
      bins[index]++;
    });

    for (let i = 0; i < binCount; i++) {
      const start = (min + i * binSize).toFixed(1);
      const end =
        i === binCount - 1
          ? max.toFixed(1)
          : (min + (i + 1) * binSize).toFixed(1);
      labels.push(`${start}-${end} hours`);
    }

    data = bins;
  } else if (columnTypes[attribute]) {
    // Numeric column → create range-based pie chart
    const numericValues = values.map((v) => Number(v)).filter((v) => !isNaN(v));
    if (numericValues.length === 0) return;

    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const binCount = 5;
    const binSize = (max - min) / binCount;
    const bins = Array(binCount).fill(0);

    numericValues.forEach((v) => {
      let index = Math.floor((v - min) / binSize);
      if (index >= binCount) index = binCount - 1; // edge case for max
      bins[index]++;
    });

    for (let i = 0; i < binCount; i++) {
      const start = (min + i * binSize).toFixed(1);
      const end =
        i === binCount - 1
          ? max.toFixed(1)
          : (min + (i + 1) * binSize).toFixed(1);
      labels.push(`${start}-${end}`);
    }

    data = bins;
  } else {
    // Categorical column
    const counts = {};
    values.forEach((v) => {
      if (!v) return;
      counts[v] = (counts[v] || 0) + 1;
    });
    labels = Object.keys(counts);
    data = Object.values(counts);
  }

  // Destroy previous chart if exists
  if (pieChart) pieChart.destroy();

  const backgroundColors = generateGradientColors(
    "#EB8C00",
    "#D04A02",
    labels.length
  );

  const ctx = document.getElementById("pieChart").getContext("2d");
  pieChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: backgroundColors,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
      },
      onClick: (evt, activeEls) => {
        if (activeEls.length > 0) {
          const index = activeEls[0].index;
          const clickedLabel = labels[index];
          showEmployeesForSlice(attribute, clickedLabel);
        }
      },
    },
  });
  // Populate the table
  const tbody = document.querySelector("#pieDataTable tbody");
  tbody.innerHTML = ""; // clear previous rows
  for (let i = 0; i < labels.length; i++) {
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    const countCell = document.createElement("td");
    labelCell.innerText = labels[i];
    labelCell.style.backgroundColor = backgroundColors[i]; // match color
    countCell.innerText = data[i];
    row.appendChild(labelCell);
    row.appendChild(countCell);
    tbody.appendChild(row);
  }
}

// Global filter store (for future multiple filters)
let activeFilters = {};
let filterOrder = [];

function generateGradientColors(startColor, endColor, steps) {
  const start = hexToRgb(startColor);
  const end = hexToRgb(endColor);
  const colors = [];

  for (let i = 0; i < steps; i++) {
    const r = Math.round(start.r + ((end.r - start.r) * i) / (steps - 1));
    const g = Math.round(start.g + ((end.g - start.g) * i) / (steps - 1));
    const b = Math.round(start.b + ((end.b - start.b) * i) / (steps - 1));
    colors.push(`rgb(${r}, ${g}, ${b})`);
  }
  return colors;
}

// Helper: convert hex to RGB
function hexToRgb(hex) {
  hex = hex.replace("#", "");
  const bigint = parseInt(hex, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

function updateFilterTree() {
  const container = document.getElementById("filterTree");
  container.innerHTML = "<h3>Active Filters:</h3>";

  if (filterOrder.length === 0) {
    container.innerHTML += "<p>No filters applied.</p>";
    return;
  }

  const ul = document.createElement("ul");
  ul.classList.add("filter-tree-list");

  filterOrder.forEach((attr, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${attr}</strong>: ${activeFilters[attr]} 
      <button class="remove-btn" data-index="${index}">❌</button>
    `;
    ul.appendChild(li);
  });

  container.appendChild(ul);

  // Add event listeners to remove buttons
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt(e.target.getAttribute("data-index"));
      removeFilterAndChildren(index);
    });
  });
}

function removeFilterAndChildren(index) {
  // Remove all filters from this index onward
  const removed = filterOrder.splice(index);
  removed.forEach((attr) => delete activeFilters[attr]);

  updateChart();
  updateFilterTree();
}

window.onload = () => {
  loadEmployeeData(); // CSV loading

  const modal = document.getElementById("sharedModal");
  const closeBtn = document.querySelector(".close-btn");

  // Close on X
  closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

  // Close if clicking outside modal content
  window.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });


};

