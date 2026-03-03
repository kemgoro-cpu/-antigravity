// ==========================================
// CSV Chart Viewer Logic
// ==========================================

// Global State
const appState = {
    files: {},          // { fileId: { name, data: [...], columns: [...] } }
    activeSeries: {},   // { fileId_colName: boolean }
    chartInstance: null,
    xAxisCol: 'time'    // Default X-Axis column name (adjust if needed or make dynamic later)
};

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const columnSearch = document.getElementById('column-search');
const columnList = document.getElementById('column-list');
const chartDom = document.getElementById('chart');
const chartOverlay = document.getElementById('chart-overlay');
const clearAllBtn = document.getElementById('clear-all-btn');

// Color Palette for ECharts (Vibrant HSL)
const colors = [
    '#6366f1', // Indigo
    '#ec4899', // Pink
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#8b5cf6', // Violet
    '#06b6d4', // Cyan
    '#f43f5e', // Rose
    '#84cc16'  // Lime
];
let colorIndex = 0;

// Initialize ECharts
function initChart() {
    appState.chartInstance = echarts.init(chartDom, 'dark', { backgroundColor: 'transparent' });

    // Resize chart on window resize
    window.addEventListener('resize', () => {
        appState.chartInstance.resize();
    });
}

// ==========================================
// File Upload & Drag-Drop Handling
// ==========================================

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFiles(e.target.files);
    }
});

function handleFiles(files) {
    Array.from(files).forEach(file => {
        if (file.name.endsWith('.csv')) {
            parseCSV(file);
        } else {
            alert(`Unsupported file type: ${file.name}. Please upload CSV files only.`);
        }
    });
    // Reset input for same file re-upload
    fileInput.value = '';
}

// ==========================================
// CSV Parsing Logic (PapaParse)
// ==========================================

function parseCSV(file) {
    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    // UI selection (1-indexed based on standard user intuition)
    const uiNameRowIdx = parseInt(document.getElementById('name-row-idx').value, 10) - 1;
    const uiUnitRowIdx = parseInt(document.getElementById('unit-row-idx').value, 10) - 1;

    Papa.parse(file, {
        header: false,
        dynamicTyping: false,
        skipEmptyLines: true,
        complete: function (results) {
            processParsedData(fileId, file.name, results.data, uiNameRowIdx, uiUnitRowIdx);
        },
        error: function (error) {
            console.error('Error parsing CSV:', error);
            alert(`Error parsing ${file.name}`);
        }
    });
}

function autoDetectRows(rawData) {
    let nameRowIdx = -1;
    let unitRowIdx = -1;

    // Simple heuristic: Look for a row that has a 'time', 's', or similar keyword which often signals the generic header structure.
    for (let r = 0; r < Math.min(10, rawData.length); r++) {
        const row = rawData[r];
        // Ensure row isn't mostly empty logic
        if (row.length < 2) continue;

        const hasTime = row.some(c => typeof c === 'string' && c.trim().toLowerCase() === 'time');

        if (hasTime) {
            nameRowIdx = r;
            // Unit row usually directly follows Name row
            if (r + 1 < rawData.length) {
                const nextRow = rawData[r + 1];
                const hasS = nextRow.some(c => typeof c === 'string' && c.trim().toLowerCase() === 's');
                if (hasS) {
                    unitRowIdx = r + 1;
                }
            }
            break;
        }
    }

    return { nameRowIdx, unitRowIdx };
}

function processParsedData(fileId, fileName, rawData, uiNameRowIdx, uiUnitRowIdx) {
    // Attempt Auto-Detect first if applicable, else fallback to UI configuration
    const autoDetected = autoDetectRows(rawData);

    const nameRowIdx = autoDetected.nameRowIdx !== -1 ? autoDetected.nameRowIdx : uiNameRowIdx;
    const unitRowIdx = autoDetected.unitRowIdx !== -1 ? autoDetected.unitRowIdx : uiUnitRowIdx;

    if (rawData.length <= Math.max(nameRowIdx, unitRowIdx)) {
        alert('Could not determine correct Header rows and data rows. Please specify rows manually in Settings.');
        return;
    }

    // Update the UI setting to show what was detected
    document.getElementById('name-row-idx').value = nameRowIdx + 1;
    if (unitRowIdx >= 0) {
        document.getElementById('unit-row-idx').value = unitRowIdx + 1;
    }

    const headers = rawData[nameRowIdx];
    const units = unitRowIdx >= 0 ? rawData[unitRowIdx] : Array(headers.length).fill('');

    // Find x-axis index (time)
    let timeIdx = headers.findIndex(h => typeof h === 'string' && h.trim().toLowerCase() === 'time');
    if (timeIdx === -1) timeIdx = 0; // Default to first column if no time column found

    // Data starts after the highest metadata row
    const dataStartIdx = Math.max(nameRowIdx, unitRowIdx) + 1;

    // Process columns
    const columns = [];
    const parsedData = [];

    // Initialize data array structure
    for (let i = 0; i < headers.length; i++) {
        if (i === timeIdx) continue; // Skip mapping time as a plotable Y-value here
        columns.push({
            id: `${fileId}_col_${i}`,
            name: headers[i] ? headers[i].trim() : `Col_${i}`,
            unit: units[i] ? units[i].trim() : '',
            index: i,
            color: colors[(colorIndex++) % colors.length]
        });
    }

    // Process rows into X/Y pairs or objects, transforming True/False
    for (let r = dataStartIdx; r < rawData.length; r++) {
        const row = rawData[r];
        if (!row || row.length <= Math.max(timeIdx, 0)) continue; // skip bad row

        const timeValRaw = row[timeIdx];
        const timeVal = parseFloat(timeValRaw);
        if (isNaN(timeVal)) continue; // skip row if timestamp is invalid

        const rowData = { time: timeVal };

        for (let i = 0; i < headers.length; i++) {
            if (i === timeIdx) continue;

            let val = row[i];

            // Convert booleans
            if (typeof val === 'string') {
                const upperVal = val.trim().toUpperCase();
                if (upperVal === 'TRUE') val = 1;
                else if (upperVal === 'FALSE') val = 0;
                else {
                    const num = parseFloat(val);
                    val = isNaN(num) ? null : num;
                }
            } else if (typeof val === 'boolean') {
                val = val ? 1 : 0;
            } else if (typeof val !== 'number') {
                val = null;
            }

            rowData[`col_${i}`] = val;
        }
        parsedData.push(rowData);
    }

    // Sort by time just in case
    parsedData.sort((a, b) => a.time - b.time);

    // Save to State
    appState.files[fileId] = {
        name: fileName,
        data: parsedData,
        columns: columns,
        timeColIdx: timeIdx
    };

    updateUI();
}

// ==========================================
// UI Updates
// ==========================================

function updateUI() {
    renderFileList();
    renderColumnList();
    updateChart();

    const hasFiles = Object.keys(appState.files).length > 0;
    clearAllBtn.disabled = !hasFiles;
}

function renderFileList() {
    fileList.innerHTML = '';

    for (const [fileId, file] of Object.entries(appState.files)) {
        const li = document.createElement('li');
        li.className = 'file-item';
        li.innerHTML = `
            <div class="file-name" title="${file.name}">
                <i class='bx bx-file'></i> ${file.name}
            </div>
            <i class='bx bx-x remove-file' data-fileid="${fileId}" title="Remove file"></i>
        `;
        fileList.appendChild(li);
    }

    // Attach remove listeners
    document.querySelectorAll('.remove-file').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-fileid');
            removeFile(id);
        });
    });
}

function removeFile(fileId) {
    // Remove from files
    delete appState.files[fileId];

    // Remove from activeSeries
    for (const key in appState.activeSeries) {
        if (key.startsWith(fileId)) {
            delete appState.activeSeries[key];
        }
    }

    updateUI();
}

clearAllBtn.addEventListener('click', () => {
    appState.files = {};
    appState.activeSeries = {};
    updateUI();
});

function renderColumnList() {
    columnList.innerHTML = '';
    const searchTerm = columnSearch.value.toLowerCase();

    let hasColumns = false;

    for (const [fileId, file] of Object.entries(appState.files)) {

        // Add a small header for the file
        const fileHeader = document.createElement('div');
        fileHeader.style.fontSize = '0.75rem';
        fileHeader.style.color = 'var(--text-secondary)';
        fileHeader.style.padding = '8px 4px 4px';
        fileHeader.style.borderBottom = '1px solid var(--border-color)';
        fileHeader.style.marginBottom = '4px';
        fileHeader.textContent = file.name;

        let fileHasVisibleCols = false;
        const colContainer = document.createElement('div');

        file.columns.forEach(col => {
            if (col.name.toLowerCase().includes(searchTerm)) {
                hasColumns = true;
                fileHasVisibleCols = true;

                const isSelected = appState.activeSeries[col.id];

                const item = document.createElement('div');
                item.className = `col-item ${isSelected ? 'selected' : ''}`;
                item.innerHTML = `
                    <div class="color-badge" style="background-color: ${isSelected ? col.color : 'transparent'}; border: 1px solid ${col.color}"></div>
                    <span class="col-name" title="${col.name}">${col.name}</span>
                    <span class="col-unit">${col.unit}</span>
                `;

                item.addEventListener('click', () => {
                    toggleSeries(col.id);
                });

                colContainer.appendChild(item);
            }
        });

        if (fileHasVisibleCols) {
            columnList.appendChild(fileHeader);
            columnList.appendChild(colContainer);
        }
    }

    if (!hasColumns) {
        columnList.innerHTML = `<div class="placeholder-text">No columns match search</div>`;
    }

    if (Object.keys(appState.files).length === 0) {
        columnList.innerHTML = `<div class="placeholder-text">Upload a file to see columns</div>`;
    }
}

columnSearch.addEventListener('input', renderColumnList);

function toggleSeries(colId) {
    appState.activeSeries[colId] = !appState.activeSeries[colId];
    renderColumnList(); // update selection visuals
    updateChart();      // update line chart
}

// ==========================================
// ECharts Rendering
// ==========================================

function updateChart() {
    if (!appState.chartInstance) initChart();

    const activeIds = Object.keys(appState.activeSeries).filter(id => appState.activeSeries[id]);

    if (activeIds.length === 0) {
        appState.chartInstance.clear();
        chartOverlay.classList.remove('hidden');
        return;
    }

    chartOverlay.classList.add('hidden');

    const seriesData = [];
    const legendData = [];

    const yAxes = [];

    activeIds.forEach((id, index) => {
        // Parse colId to find exact file and col info
        // ID format: fileId_col_index
        const [, , fileHash, colStr, colIdxStr] = id.split('_');
        const fileId = id.substring(0, id.indexOf('_col_'));

        const file = appState.files[fileId];
        const col = file.columns.find(c => c.id === id);

        if (!file || !col) return;

        const dataPoints = file.data.map(row => [row.time, row[`col_${col.index}`]]);

        const seriesName = `${col.name} (${file.name})`;
        legendData.push(seriesName);

        // Map every selected series to its own private Y-axis so they don't overlap bounds
        const axisPos = index % 2 === 0 ? 'left' : 'right';
        const offsetMultiplier = Math.floor(index / 2);
        const offset = offsetMultiplier * 50;

        yAxes.push({
            type: 'value',
            name: col.unit || col.name,
            position: axisPos,
            offset: offset,
            splitLine: { show: index === 0 }, // Only show grid for the first axis to avoid clutter
            axisLine: { show: true, lineStyle: { color: col.color } },
            axisLabel: { color: 'var(--text-secondary)' },
            nameTextStyle: { color: col.color, fontSize: 10 }
        });

        seriesData.push({
            name: seriesName,
            type: 'line',
            showSymbol: false,
            data: dataPoints,
            yAxisIndex: index,
            lineStyle: { width: 1.5 },
            itemStyle: { color: col.color },
        });
    });

    const option = {
        animation: false, // Turn off animation for large datasets
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'line', // Vertical line only
                lineStyle: { color: '#a0a5b1', type: 'dashed' },
                animation: false
            },
            backgroundColor: 'rgba(26, 29, 36, 0.9)',
            borderColor: 'var(--border-color)',
            textStyle: { color: '#f0f0f0' },
            formatter: function (params) {
                // Custom tooltip to show rich info
                let time = params[0].axisValue.toFixed(3);
                let result = `<div style="font-weight:600;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px;">Time: ${time}s</div>`;

                params.forEach(p => {
                    // Extract exactly what we want
                    let val = p.data[1];
                    let valStr = val !== null && val !== undefined ? Number(val).toFixed(2) : '-';

                    // Add HTML
                    result += `
                        <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                            ${p.marker}
                            <span style="flex:1;font-size:0.85rem">${p.seriesName}</span>
                            <span style="font-family:'Roboto Mono',monospace;font-weight:bold;">${valStr}</span>
                        </div>
                    `;
                });
                return result;
            }
        },
        legend: {
            data: legendData,
            textStyle: { color: 'var(--text-primary)' },
            top: 0
        },
        toolbox: {
            feature: {
                dataZoom: {
                    yAxisIndex: 'none', // Only zoom X axis via mouse brush
                    title: { zoom: 'Zoom', back: 'Reset Zoom' }
                },
                restore: { title: 'Reset' }
            },
            iconStyle: { borderColor: 'var(--text-secondary)' }
        },
        dataZoom: [
            {
                type: 'slider',
                show: true,
                xAxisIndex: [0],
                start: 0,
                end: 100,
                bottom: 10,
                textStyle: { color: 'var(--text-secondary)' }
            },
            {
                type: 'inside', // Mouse wheel / trackpad scroll mapping
                xAxisIndex: [0],
                start: 0,
                end: 100
            }
        ],
        grid: {
            // Accommodate multiple dynamic Y axes offsets
            left: 20 + (Math.ceil(yAxes.length / 2) * 50) + 'px',
            right: 20 + (Math.floor(yAxes.length / 2) * 50) + 'px',
            bottom: 70, // Room for timeline
            top: 80, // Room for toolbox/legend
            containLabel: false // Turn off contain label to strictly respect absolute pixels mapped to `left`/`right` for overlapping bounds avoidance
        },
        xAxis: {
            type: 'value',
            name: 'Time (s)',
            nameLocation: 'middle',
            nameGap: 30,
            axisLabel: { color: 'var(--text-secondary)' },
            splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
        },
        yAxis: yAxes.length > 0 ? yAxes : { type: 'value' },
        series: seriesData
    };

    appState.chartInstance.setOption(option, true);
}

// Initial Call
initChart();
