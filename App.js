// app.js — wires the UI to indicators.js and backtest.js

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let bars = [];                 // parsed OHLC rows
  let indicatorInstances = [];   // [{id, type, name, params}]
  let entryGroup = { logic: 'AND', comparisons: [] };
  let exitGroup = { logic: 'AND', comparisons: [] };
  let equityChart = null;
  let instanceCounter = 0;

  const OPS = [
    { value: 'above', label: 'is above' },
    { value: 'below', label: 'is below' },
    { value: 'crossesAbove', label: 'crosses above' },
    { value: 'crossesBelow', label: 'crosses below' },
    { value: 'equals', label: 'equals' }
  ];

  const PRICE_FIELDS = ['close', 'open', 'high', 'low'];

  // ---------------------------------------------------------------------
  // CSV loading
  // ---------------------------------------------------------------------
  const csvInput = document.getElementById('csvInput');
  const dropzone = document.getElementById('dropzone');
  const dropzoneLabel = document.getElementById('dropzoneLabel');
  const dataSummary = document.getElementById('dataSummary');
  const dataStatus = document.getElementById('dataStatus');
  const runBtn = document.getElementById('runBtn');

  csvInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragover', 'dragenter'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); })
  );
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  function normalizeKey(k) {
    return k.trim().toLowerCase().replace(/[^a-z]/g, '');
  }

  const FIELD_ALIASES = {
    date: ['date', 'datetime', 'timestamp', 'time'],
    open: ['open', 'o'],
    high: ['high', 'h'],
    low: ['low', 'l'],
    close: ['close', 'c', 'closeprice', 'ltp'],
    volume: ['volume', 'vol', 'v']
  };

  function mapRow(row) {
    const keys = Object.keys(row);
    const normalized = {};
    keys.forEach(k => { normalized[normalizeKey(k)] = row[k]; });

    const out = {};
    for (const field of Object.keys(FIELD_ALIASES)) {
      for (const alias of FIELD_ALIASES[field]) {
        if (normalized[alias] !== undefined) { out[field] = normalized[alias]; break; }
      }
    }
    return out;
  }

  function handleFile(file) {
    dropzoneLabel.textContent = `Parsing ${file.name}…`;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const mapped = results.data.map(mapRow).filter(r => r.date && r.close !== undefined);
          const parsed = mapped.map(r => ({
            date: String(r.date),
            open: parseFloat(r.open ?? r.close),
            high: parseFloat(r.high ?? r.close),
            low: parseFloat(r.low ?? r.close),
            close: parseFloat(r.close),
            volume: parseFloat(r.volume ?? 0)
          })).filter(r => !isNaN(r.close));

          parsed.sort((a, b) => new Date(a.date) - new Date(b.date));

          if (parsed.length < 5) {
            throw new Error('Could not find enough valid rows with date/close columns.');
          }

          bars = parsed;
          dropzoneLabel.textContent = 'Drop CSV or click to upload';
          dataSummary.classList.remove('hidden');
          dataSummary.innerHTML = `
            <span><strong>${bars.length}</strong> bars loaded</span>
            <span>${bars[0].date} → ${bars[bars.length - 1].date}</span>
            <span>${file.name}</span>
          `;
          dataStatus.textContent = `${bars.length} bars · ${bars[0].date} → ${bars[bars.length - 1].date}`;
          updateRunButtonState();
        } catch (err) {
          dropzoneLabel.textContent = 'Drop CSV or click to upload';
          alert('Could not parse this CSV: ' + err.message + '\n\nExpected columns: date, open, high, low, close, volume (order/case flexible).');
        }
      },
      error: (err) => {
        alert('Failed to read file: ' + err.message);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Indicators: add / list / remove
  // ---------------------------------------------------------------------
  const indicatorList = document.getElementById('indicatorList');
  const addIndicatorBtn = document.getElementById('addIndicatorBtn');
  const indicatorModal = document.getElementById('indicatorModal');
  const indicatorTypeSelect = document.getElementById('indicatorTypeSelect');
  const indicatorParamsFields = document.getElementById('indicatorParamsFields');
  const indicatorInstanceName = document.getElementById('indicatorInstanceName');
  const saveIndicatorBtn = document.getElementById('saveIndicatorBtn');

  Object.keys(Indicators.REGISTRY).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = Indicators.REGISTRY[key].label;
    indicatorTypeSelect.appendChild(opt);
  });

  function renderIndicatorParamFields() {
    const def = Indicators.REGISTRY[indicatorTypeSelect.value];
    indicatorParamsFields.innerHTML = '';
    def.params.forEach(p => {
      const label = document.createElement('label');
      label.className = 'field';
      label.innerHTML = `<span>${p.label}</span>`;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = p.default;
      input.dataset.paramKey = p.key;
      label.appendChild(input);
      indicatorParamsFields.appendChild(label);
    });
  }

  indicatorTypeSelect.addEventListener('change', renderIndicatorParamFields);

  addIndicatorBtn.addEventListener('click', () => {
    renderIndicatorParamFields();
    indicatorInstanceName.value = suggestInstanceName(indicatorTypeSelect.value);
    openModal(indicatorModal);
  });

  function suggestInstanceName(type) {
    let n = 1;
    let name;
    do { name = `${type}${n}`; n++; } while (indicatorInstances.some(ix => ix.name === name));
    return name;
  }

  saveIndicatorBtn.addEventListener('click', () => {
    const type = indicatorTypeSelect.value;
    const def = Indicators.REGISTRY[type];
    const params = {};
    indicatorParamsFields.querySelectorAll('input').forEach(inp => {
      params[inp.dataset.paramKey] = parseFloat(inp.value);
    });
    let name = indicatorInstanceName.value.trim() || suggestInstanceName(type);
    if (indicatorInstances.some(ix => ix.name === name)) {
      alert('An indicator with that instance name already exists. Choose a unique name.');
      return;
    }
    const id = `ix${instanceCounter++}`;
    indicatorInstances.push({ id, type, name, params, fields: def.fields });
    renderIndicatorList();
    closeModal(indicatorModal);
    refreshOperandSelectsEverywhere();
  });

  function renderIndicatorList() {
    indicatorList.innerHTML = '';
    if (indicatorInstances.length === 0) {
      const p = document.createElement('p');
      p.className = 'dropzone-hint';
      p.textContent = 'No indicators added yet.';
      indicatorList.appendChild(p);
      return;
    }
    indicatorInstances.forEach(ix => {
      const chip = document.createElement('div');
      chip.className = 'indicator-chip';
      const paramStr = Object.entries(ix.params).map(([k, v]) => `${k}=${v}`).join(', ');
      chip.innerHTML = `
        <span><span class="indicator-chip-name">${ix.name}</span><span class="indicator-chip-type">${Indicators.REGISTRY[ix.type].label}${paramStr ? ' · ' + paramStr : ''}</span></span>
        <button class="chip-remove" data-remove-ix="${ix.id}">&times;</button>
      `;
      indicatorList.appendChild(chip);
    });
    indicatorList.querySelectorAll('[data-remove-ix]').forEach(btn => {
      btn.addEventListener('click', () => {
        indicatorInstances = indicatorInstances.filter(ix => ix.id !== btn.dataset.removeIx);
        renderIndicatorList();
        refreshOperandSelectsEverywhere();
      });
    });
  }
  renderIndicatorList();

  // ---------------------------------------------------------------------
  // Condition (entry/exit) builder
  // ---------------------------------------------------------------------
  const entryConditionsEl = document.getElementById('entryConditions');
  const exitConditionsEl = document.getElementById('exitConditions');

  function groupFor(name) { return name === 'entry' ? entryGroup : exitGroup; }
  function elFor(name) { return name === 'entry' ? entryConditionsEl : exitConditionsEl; }

  document.querySelectorAll('.add-condition-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupName = btn.dataset.group;
      const group = groupFor(groupName);
      group.comparisons.push({
        left: { kind: 'price', field: 'close' },
        op: 'above',
        right: { kind: 'price', field: 'close' }
      });
      renderConditionGroup(groupName);
    });
  });

  function operandOptionsHtml(selected) {
    let html = '<optgroup label="Price">';
    PRICE_FIELDS.forEach(f => {
      const sel = selected.kind === 'price' && selected.field === f ? 'selected' : '';
      html += `<option value="price:${f}" ${sel}>Price: ${f}</option>`;
    });
    html += '</optgroup>';
    if (indicatorInstances.length) {
      html += '<optgroup label="Indicators">';
      indicatorInstances.forEach(ix => {
        ix.fields.forEach(f => {
          const val = `indicator:${ix.id}.${f}`;
          const sel = selected.kind === 'indicator' && selected.seriesId === `${ix.id}.${f}` ? 'selected' : '';
          const fLabel = ix.fields.length > 1 ? `${ix.name}.${f}` : ix.name;
          html += `<option value="${val}" ${sel}>${fLabel}</option>`;
        });
      });
      html += '</optgroup>';
    }
    html += '<optgroup label="Constant">';
    const sel = selected.kind === 'constant' ? 'selected' : '';
    html += `<option value="constant" ${sel}>Custom number…</option>`;
    html += '</optgroup>';
    return html;
  }

  function parseOperandValue(value) {
    if (value === 'constant') return { kind: 'constant', value: 0 };
    const [kind, rest] = value.split(':');
    if (kind === 'price') return { kind: 'price', field: rest };
    if (kind === 'indicator') return { kind: 'indicator', seriesId: rest };
    return { kind: 'price', field: 'close' };
  }

  function renderConditionGroup(groupName) {
    const group = groupFor(groupName);
    const container = elFor(groupName);
    container.innerHTML = '';

    if (group.comparisons.length > 1) {
      const toggle = document.createElement('div');
      toggle.className = 'condition-logic-toggle';
      toggle.innerHTML = `
        <div class="logic-btn ${group.logic === 'AND' ? 'active' : ''}" data-logic="AND">AND</div>
        <div class="logic-btn ${group.logic === 'OR' ? 'active' : ''}" data-logic="OR">OR</div>
      `;
      toggle.querySelectorAll('.logic-btn').forEach(b => {
        b.addEventListener('click', () => {
          group.logic = b.dataset.logic;
          renderConditionGroup(groupName);
        });
      });
      container.appendChild(toggle);
    }

    group.comparisons.forEach((cmp, idx) => {
      const row = document.createElement('div');
      row.className = 'condition-row';

      const leftSelect = document.createElement('select');
      leftSelect.innerHTML = operandOptionsHtml(cmp.left);

      const leftConstInput = document.createElement('input');
      leftConstInput.type = 'number';
      leftConstInput.step = 'any';
      leftConstInput.placeholder = 'value';
      leftConstInput.className = cmp.left.kind === 'constant' ? '' : 'hidden';
      if (cmp.left.kind === 'constant') leftConstInput.value = cmp.left.value;

      const opSelect = document.createElement('select');
      opSelect.innerHTML = OPS.map(o => `<option value="${o.value}" ${o.value === cmp.op ? 'selected' : ''}>${o.label}</option>`).join('');

      const rightSelect = document.createElement('select');
      rightSelect.innerHTML = operandOptionsHtml(cmp.right);

      const rightConstInput = document.createElement('input');
      rightConstInput.type = 'number';
      rightConstInput.step = 'any';
      rightConstInput.placeholder = 'value';
      rightConstInput.className = cmp.right.kind === 'constant' ? '' : 'hidden';
      if (cmp.right.kind === 'constant') rightConstInput.value = cmp.right.value;

      leftSelect.addEventListener('change', () => {
        cmp.left = parseOperandValue(leftSelect.value);
        leftConstInput.classList.toggle('hidden', cmp.left.kind !== 'constant');
      });
      leftConstInput.addEventListener('input', () => { cmp.left.value = parseFloat(leftConstInput.value) || 0; });

      opSelect.addEventListener('change', () => { cmp.op = opSelect.value; });

      rightSelect.addEventListener('change', () => {
        cmp.right = parseOperandValue(rightSelect.value);
        rightConstInput.classList.toggle('hidden', cmp.right.kind !== 'constant');
      });
      rightConstInput.addEventListener('input', () => { cmp.right.value = parseFloat(rightConstInput.value) || 0; });

      const operandsWrap = document.createElement('div');
      operandsWrap.className = 'condition-operands';
      operandsWrap.appendChild(leftSelect);
      operandsWrap.appendChild(leftConstInput);
      operandsWrap.appendChild(opSelect);
      operandsWrap.appendChild(rightSelect);
      operandsWrap.appendChild(rightConstInput);

      const footer = document.createElement('div');
      footer.className = 'condition-row-footer';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip-remove';
      removeBtn.textContent = '× remove';
      removeBtn.style.fontSize = '11px';
      removeBtn.addEventListener('click', () => {
        group.comparisons.splice(idx, 1);
        renderConditionGroup(groupName);
      });
      footer.appendChild(removeBtn);

      row.appendChild(operandsWrap);
      row.appendChild(footer);
      container.appendChild(row);
    });

    updateRunButtonState();
  }

  function refreshOperandSelectsEverywhere() {
    renderConditionGroup('entry');
    renderConditionGroup('exit');
  }

  renderConditionGroup('entry');
  renderConditionGroup('exit');

  // ---------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------
  function openModal(modal) { modal.classList.remove('hidden'); }
  function closeModal(modal) { modal.classList.add('hidden'); }
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(indicatorModal));
  });
  indicatorModal.addEventListener('click', (e) => {
    if (e.target === indicatorModal) closeModal(indicatorModal);
  });

  // ---------------------------------------------------------------------
  // Run button state
  // ---------------------------------------------------------------------
  function updateRunButtonState() {
    const ready = bars.length > 0 && entryGroup.comparisons.length > 0 && exitGroup.comparisons.length > 0;
    runBtn.disabled = !ready;
  }

  // ---------------------------------------------------------------------
  // Run backtest
  // ---------------------------------------------------------------------
  const emptyState = document.getElementById('emptyState');
  const resultsView = document.getElementById('resultsView');
  const metricStrip = document.getElementById('metricStrip');
  const tradeTableBody = document.getElementById('tradeTableBody');
  const exportBtn = document.getElementById('exportBtn');

  let lastTrades = [];

  runBtn.addEventListener('click', runBacktest);

  function runBacktest() {
    // compute all indicator series over full bar set
    const computedSeries = {};
    indicatorInstances.forEach(ix => {
      const def = Indicators.REGISTRY[ix.type];
      computedSeries[ix.id] = def.compute(bars, ix.params);
    });

    const config = {
      direction: document.getElementById('direction').value,
      entryGroup,
      exitGroup,
      stopLossPct: parseFloat(document.getElementById('stopLossPct').value) || 0,
      takeProfitPct: parseFloat(document.getElementById('takeProfitPct').value) || 0,
      quantity: parseFloat(document.getElementById('quantity').value) || 1,
      initialCapital: parseFloat(document.getElementById('initialCapital').value) || 100000
    };

    const result = Backtest.run(bars, computedSeries, config);
    const metrics = Backtest.computeMetrics(result, config.initialCapital);
    lastTrades = result.trades;

    emptyState.classList.add('hidden');
    resultsView.classList.remove('hidden');

    renderMetrics(metrics);
    renderEquityChart(result.equityCurve, config.initialCapital);
    renderTradeTable(result.trades);
  }

  function fmtMoney(v) {
    return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function fmtPct(v) { return v.toFixed(2) + '%'; }

  function renderMetrics(m) {
    const items = [
      { label: 'Total return', value: fmtPct(m.totalReturnPct), cls: m.totalReturnPct >= 0 ? 'pos' : 'neg' },
      { label: 'Net P&L', value: fmtMoney(m.totalPnl), cls: m.totalPnl >= 0 ? 'pos' : 'neg' },
      { label: 'Win rate', value: fmtPct(m.winRate), cls: '' },
      { label: 'Total trades', value: m.totalTrades, cls: '' },
      { label: 'Profit factor', value: isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞', cls: '' },
      { label: 'Max drawdown', value: fmtPct(m.maxDrawdownPct), cls: 'neg' }
    ];
    metricStrip.innerHTML = items.map(it => `
      <div class="metric">
        <span class="metric-label">${it.label}</span>
        <span class="metric-value ${it.cls}">${it.value}</span>
      </div>
    `).join('');
  }

  function renderEquityChart(equityCurve, initialCapital) {
    const ctx = document.getElementById('equityChart').getContext('2d');
    const labels = bars.map(b => b.date);
    const data = equityCurve.map(v => v == null ? initialCapital : v);

    if (equityChart) equityChart.destroy();
    equityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Equity',
          data,
          borderColor: '#D9A441',
          backgroundColor: 'rgba(217,164,65,0.08)',
          fill: true,
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#171D2B',
            borderColor: '#2A3244',
            borderWidth: 1,
            titleColor: '#E8EAF0',
            bodyColor: '#E8EAF0',
            callbacks: { label: (ctx) => ' ₹' + ctx.parsed.y.toLocaleString('en-IN', { maximumFractionDigits: 0 }) }
          }
        },
        scales: {
          x: { ticks: { color: '#8C94A6', maxTicksLimit: 10 }, grid: { color: '#2A3244' } },
          y: { ticks: { color: '#8C94A6' }, grid: { color: '#2A3244' } }
        }
      }
    });
  }

  function renderTradeTable(trades) {
    tradeTableBody.innerHTML = trades.map((t, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="side-${t.side}">${t.side.toUpperCase()}</td>
        <td>${t.entryDate}</td>
        <td>${t.entryPrice.toFixed(2)}</td>
        <td>${t.exitDate}</td>
        <td>${t.exitPrice.toFixed(2)}</td>
        <td>${t.qty}</td>
        <td class="${t.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtMoney(t.pnl)}</td>
        <td class="${t.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${fmtPct(t.pnlPct)}</td>
        <td>${t.reason}</td>
        <td>${t.barsHeld}</td>
      </tr>
    `).join('');
  }

  exportBtn.addEventListener('click', () => {
    if (!lastTrades.length) return;
    const header = 'side,entryDate,entryPrice,exitDate,exitPrice,qty,pnl,pnlPct,reason,barsHeld';
    const rows = lastTrades.map(t =>
      [t.side, t.entryDate, t.entryPrice, t.exitDate, t.exitPrice, t.qty, t.pnl.toFixed(2), t.pnlPct.toFixed(2), t.reason, t.barsHeld].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trade_log.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

})();
