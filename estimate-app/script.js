// === CORE STATE ===
let scheduleItems = [], rowCount = 0;
let calcHistoryMap = JSON.parse(sessionStorage.getItem('calcHistoryMap') || '{}');
let calcInputMap = JSON.parse(sessionStorage.getItem('calcInputMap') || '{}');
let activeCalcCell = null;
let mathScope = {};
let archivedItems = [];

const COL = { QTY: 4, RATE: 6, AMT: 7 };
const GST_RATE = 0.18;
const CESS_RATE = 0.01;
const byId = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);
const qsa = sel => Array.from(document.querySelectorAll(sel));

// === UTILITIES ===
function autoSaveSession() {
  const session = getSessionSnapshot();
  localStorage.setItem('estimateSavedSession', JSON.stringify(session));
}
function generateRowId() {
  return '_' + Math.random().toString(36).slice(2, 11);
}
function createButton(cls, text, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
function getSessionSnapshot() {
  return {
    tableHTML: qs('#estimateTable tbody').innerHTML,
    rowCount,
    calcHistoryMap,
    calcInputMap,
    office: document.querySelector('h2').textContent,
    work: document.querySelectorAll('span[contenteditable]')[0].textContent,
    ref: document.querySelectorAll('span[contenteditable]')[1].textContent,
    archivedItems
  };
}
function replaceCommentsForDisplay(line) {
  let out = line;

  // Remove //hidden comments//
  out = out.replace(/\/\/.*?\/\//g, '');

  // Remove only the expression inside !!expr!! but keep surrounding text
  out = out.replace(/!!(.*?)!!/g, '');

  // Keep #visible comments#
  out = out.replace(/#(.*?)#/g, '$1');

  return out.trim();
}
function extractExpressionOnly(line) {
  return line
    // remove //comments//
    .replace(/\/\/.*?\/\//g, '')
    // remove #comments#
    .replace(/#.*?#/g, '')
    // keep only expr inside !!expr!!
    .replace(/!!(.*?)!!/g, '$1')
    .trim();
}
function clearSavedSession() {
  if (!confirm("Clear saved session and CSV history? This cannot be undone ❗")) return;

  // Remove saved estimate
  localStorage.removeItem('estimateSavedSession');

  // Remove stored CSV upload history
  localStorage.removeItem('csvHistory');

  // Optional: clear calculator session if you want
  sessionStorage.removeItem('calcHistoryMap');
  sessionStorage.removeItem('calcInputMap');

  alert("All saved data cleared, including CSV history.");
  // refresh UI so cleared state is immediately visible
  location.reload();
}

document.addEventListener('focusin', e => {
  const td = e.target.closest('td');
  if (td && (td.cellIndex === COL.QTY || td.cellIndex === COL.RATE)) {
    activeCalcCell = td;
  }
});
document.addEventListener("input", e => {
  if (e.target.isContentEditable) {
    calculateAmounts();
    autoSaveSession();
  }
});

// Highlight row on hover
document.querySelector('#estimateTable tbody').addEventListener('mouseover', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;

  document.querySelectorAll('#estimateTable tbody tr').forEach(row =>
    row.classList.remove('highlighted-row')
  );
  tr.classList.add('highlighted-row');
});

// Remove highlight when pointer leaves the table
document.querySelector('#estimateTable tbody').addEventListener('mouseleave', () => {
  document.querySelectorAll('#estimateTable tbody tr').forEach(row =>
    row.classList.remove('highlighted-row')
  );
});


// === SCHEDULE MODAL ===
function openScheduleModal() {
  document.getElementById('csvUpload')?.remove();
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.csv';
  input.id = 'csvUpload'; input.className = 'hidden-upload';
  input.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(txt => {
      parseCSV(txt);
      populateModal();
      document.getElementById('scheduleModal').style.display = 'block';
      storeCsvHistory(f.name, txt);
      input.remove();
    });
  };
  document.body.appendChild(input); input.click();
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  scheduleItems = lines.map(l => {
    const parts = l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
                    .map(s => s.replace(/^"|"$/g, ''));
    return { reference: parts[0], description: parts[1], unit: parts[2], rate: parts[3] };
  });
}

function populateModal() {
  const c = document.getElementById('scheduleList');
  c.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'schedule-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Select</th>
      <th>Reference</th>
      <th>Description</th>
      <th>Unit</th>
      <th>Rate</th>
    </tr>
  `;
  table.appendChild(thead);
  
  const tbody = document.createElement('tbody');
  scheduleItems.forEach((it, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" data-idx="${i}"></td>
      <td>${it.reference || ''}</td>
      <td>${it.description || ''}</td>
      <td>${it.unit || ''}</td>
      <td>${it.rate || ''}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  c.appendChild(table);
}

function addSelectedItems() {
  const selected = Array.from(document.querySelectorAll('#scheduleList input:checked'));

  if (activeCalcCell?.closest('tr')) {
    // Focus is active → reverse so modal order is preserved
    selected.reverse().forEach(chk => {
      insertRowAfterActive(scheduleItems[chk.dataset.idx]);
    });
  } else {
    // No focus → just append in original order
    selected.forEach(chk => {
      insertRowAfterActive(scheduleItems[chk.dataset.idx], true); // ignoreActive = true
    });
  }

  document.getElementById('scheduleModal').style.display = 'none';
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').style.display = 'none';
}
window.closeScheduleModal = closeScheduleModal;

function safeBase64Encode(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  const base64String = btoa(String.fromCharCode(...utf8Bytes));
  return base64String;
}


function storeCsvHistory(fn, txt) {
  const hist = JSON.parse(localStorage.getItem('csvHistory') || '[]');
  const h = safeBase64Encode(txt).slice(0, 50);
  if (!hist.some(x => x.filename === fn && x.hash === h)) {
    hist.unshift({ filename: fn, csvText: txt, hash: h, timestamp: Date.now() });
    if (hist.length > 10) hist.pop();
    localStorage.setItem('csvHistory', JSON.stringify(hist));
  }
}

function loadCsvHistory() {
  return JSON.parse(localStorage.getItem('csvHistory') || '[]');
}

function populateHistoryPanel() {
  const hist = loadCsvHistory(), ul = document.getElementById('historyList');
  ul.innerHTML = '';
  hist.forEach(e => {
    const li = document.createElement('li');
    li.textContent = `${new Date(e.timestamp).toLocaleString()} \n ${e.filename}`;
    li.onclick = () => {
      parseCSV(e.csvText);
      populateModal();
      document.getElementById('scheduleModal').style.display = 'block';
      toggleHistoryPanel();
    };
    ul.appendChild(li);
  });
}

function toggleHistoryPanel() {
  const p = document.getElementById('historyPanel');
  p.classList.toggle('open');
  if (p.classList.contains('open')) populateHistoryPanel();
}

// Add hover effect for side-tabs to bring them to front
document.addEventListener('DOMContentLoaded', () => {
  const sideTabs = document.querySelectorAll('.history-panel .side-tab');
  sideTabs.forEach(tab => {
    tab.addEventListener('mouseover', () => {
      tab.classList.add('hovered-tab');
    });
    tab.addEventListener('mouseout', () => {
      tab.classList.remove('hovered-tab');
    });
  });
});

// === ARCHIVE (session-only) ===
function archiveSelectedRows() {
  const selectedRows = Array.from(document.querySelectorAll('#estimateTable tbody .rowCheckbox:checked')).map(checkbox => checkbox.closest('tr'));
  if (selectedRows.length === 0) return;

  selectedRows.forEach(tr => {
    if (tr.classList.contains('subtotal-row')) {
      tr.remove();
    } else {
      archivedItems.push({
        html: tr.innerHTML,
        rowId: tr.dataset.rowId || generateRowId(),
        timestamp: Date.now()
      });
      tr.remove();
    }
  });
  recalcSerials();
  calculateAmounts();
}

function archiveRow(btn) {
  const selectedRows = Array.from(document.querySelectorAll('#estimateTable tbody .rowCheckbox:checked'));
  if (selectedRows.length > 0) {
    archiveSelectedRows();
    return;
  }
  const tr = btn.closest('tr');
  if (tr) {
    if (tr.classList.contains('subtotal-row')) {
      tr.remove();
    } else {
      archivedItems.push({
        html: tr.innerHTML,
        rowId: tr.dataset.rowId || generateRowId(),
        timestamp: Date.now()
      });
      tr.remove();
    }
  }
  recalcSerials();
  calculateAmounts();
}

function restoreArchived(idx) {
  const item = archivedItems.splice(idx, 1)[0];
  const tbody = document.querySelector('#estimateTable tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = item.html;
  tr.dataset.rowId = item.rowId;
  restoreRowListeners(tr);
  tbody.appendChild(tr);
  recalcSerials();
  calculateAmounts();
  populateArchiveList();
}

function restoreRowListeners(tr) {
  // Check if the first cell is a checkbox, if not, add it
  if (!tr.cells[0] || !tr.cells[0].querySelector('.rowCheckbox')) {
    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'rowCheckbox';
    checkboxTd.appendChild(checkbox);
    tr.prepend(checkboxTd);
  }

  const tds = tr.querySelectorAll('td');
  tds.forEach((td, i) => {
    // Adjust index for contentEditable cells, as checkbox is now at index 0
    if (i >= 2 && i <= 6 && !tr.classList.contains('subtotal-row')) { // S.No is at 1, Ref is at 2
      td.contentEditable = true;
      td.addEventListener('input', calculateAmounts);
    }
  });
  const editBtn = tr.querySelector('.edit-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      if (!activeCalcCell || activeCalcCell.closest('tr') !== tr) {
        alert('Focus quantity or rate cell first.');
        return;
      }
      showCalculator();
    };
  }
  const subtotalDelBtn = tr.querySelector('button');
  if (subtotalDelBtn && subtotalDelBtn.textContent.includes('🗑️')) {
    subtotalDelBtn.onclick = () => archiveRow(subtotalDelBtn);
  }

}

function toggleArchiveModal() {
  const modal = document.getElementById('archiveModal');
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  if (modal.style.display === 'block') populateArchiveList();
}

function populateArchiveList() {
  const list = document.getElementById('archiveList');
  list.innerHTML = '';

  archivedItems.forEach((item, idx) => {
    const wrapper = document.createElement('div');

    const temp = document.createElement('table'); // more appropriate container for a <tr>
    temp.innerHTML = item.html;

    const row = temp.querySelector('tr');
    const tds = row ? Array.from(row.querySelectorAll('td')) : [];

    const texts = tds.map(td => td.textContent.trim());
    const preview = texts.join(' --- ').slice(0, 80) || 'Archived row';

    const label = document.createElement('span');
    label.textContent = `S.No:${preview}`;

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore-btn';
    restoreBtn.textContent = '🔃';
    restoreBtn.onclick = () => restoreArchived(idx);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'del-btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.onclick = () => {
      archivedItems.splice(idx, 1);
      populateArchiveList();
    };

    wrapper.append(label, restoreBtn, deleteBtn);
    list.appendChild(wrapper);
  });
}

function closeArchive() {
  document.getElementById('archiveModal').style.display = 'none';
}

window.openScheduleModal = openScheduleModal;
window.toggleHistoryPanel = toggleHistoryPanel;
window.addSelectedItems = addSelectedItems;
window.toggleArchiveModal = toggleArchiveModal;
window.restoreArchived = restoreArchived;
window.closeArchive = closeArchive;
function insertRowAfterActive(data = {}) {
  const tbody = qs('#estimateTable tbody');
  const tr = document.createElement('tr');
  const rowId = generateRowId();
  tr.dataset.rowId = rowId;

  function makeEditable(txt = '') {
    const td = document.createElement('td');
    td.contentEditable = true;
    td.textContent = txt;
    td.addEventListener('input', calculateAmounts);
    return td;
  }

  const checkboxTd = document.createElement('td');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'rowCheckbox';
  checkboxTd.appendChild(checkbox);
  tr.appendChild(checkboxTd);

  tr.appendChild(makeEditable(++rowCount));
  tr.appendChild(makeEditable(data.reference || ''));
  tr.appendChild(makeEditable(data.description || ''));
  tr.appendChild(makeEditable(data.quantity || '0'));
  tr.appendChild(makeEditable(data.unit || ''));
  tr.appendChild(makeEditable(data.rate || '0'));

  const amtTD = document.createElement('td');
  amtTD.textContent = '0.00';
  tr.appendChild(amtTD);

  const editTD = document.createElement('td');
  const btn = document.createElement('button');
  btn.className = 'edit-btn';
  btn.textContent = '✏️';
  btn.onclick = () => {
    if (!activeCalcCell || activeCalcCell.closest('tr') !== tr) {
      alert('Please focus the Quantity or Rate cell first.');
      return;
    }
    showCalculator();
  };
  editTD.appendChild(btn);
  tr.appendChild(editTD);



  const activeRow = activeCalcCell?.closest('tr');
  if (activeRow && activeRow.parentElement === tbody) {
    tbody.insertBefore(tr, activeRow.nextSibling);
  } else {
    tbody.appendChild(tr);
  }

  recalcSerials();
  calculateAmounts();
  autoSaveSession();
}

function insertSubtotalRow() {
  const tbody = document.querySelector('#estimateTable tbody');
  const tr = document.createElement('tr');
  tr.className = 'subtotal-row';

  const td1 = document.createElement('td'); // S.No
  const checkboxTd = document.createElement('td'); // Checkbox column for subtotal rows
  checkboxTd.innerHTML = '&nbsp;'; // Empty for subtotal rows
  tr.appendChild(checkboxTd);
  const td2 = document.createElement('td'); // Reference
  const td3 = document.createElement('td'); // Description
  td3.contentEditable = true;
  td3.textContent = 'Subtotal';

  const td4 = document.createElement('td'); // Quantity
  const td5 = document.createElement('td'); // Unit
  const td6 = document.createElement('td'); // Rate

  const amtTD = document.createElement('td'); // Amount
  amtTD.textContent = '0.00';

  const editTD = document.createElement('td'); // Edit Button (Empty for subtotal)

  
  tr.append(checkboxTd, td1, td2, td3, td4, td5, td6, amtTD, editTD);

  const activeRow = activeCalcCell?.closest('tr');
  if (activeRow && activeRow.parentNode === tbody) {
    activeRow.after(tr);
  } else {
    tbody.appendChild(tr);
  }

  recalcSerials();
  calculateAmounts();
}

function recalcSerials() {
  let counter = 0;
  document.querySelectorAll('#estimateTable tbody tr').forEach(tr => {
    if (!tr.classList.contains('subtotal-row')) {
      tr.cells[1].textContent = ++counter;
    }
  });
  rowCount = counter;
}

function calculateAmounts() {
  let grand = 0, subtotal = 0;

  document.querySelectorAll('#estimateTable tbody tr').forEach(tr => {
    if (tr.classList.contains('subtotal-row')) {
      tr.cells[6].textContent = subtotal.toFixed(2);
      grand += subtotal;
      subtotal = 0;
    } else {
      const q = parseFloat(tr.cells[COL.QTY].textContent) || 0;
      const r = parseFloat(tr.cells[COL.RATE].textContent) || 0;
      const a = q * r;
      tr.cells[COL.AMT].textContent = a.toFixed(2);
      subtotal += a;
    }
  });

  grand += subtotal;

  // Base Total
  document.getElementById('totalAmountCell').textContent = `₹${grand.toFixed(2)}`;

  // Taxes and Charges
  const gstAmount = grand * GST_RATE;
  const grandWithGST = grand + gstAmount;
  const cessAmount = grandWithGST * CESS_RATE;
  const grandWithGSTCess = grandWithGST + cessAmount;

  // Optional: Contingency
  const contingencyText = byId('contingencyRate')?.textContent || "0";
  const contingencyRate = parseFloat(contingencyText) / 100 || 0;
  const contingencyAmount = grandWithGST * contingencyRate;
  const finalTotal = grandWithGSTCess + contingencyAmount;

  // Update UI
  byId('gstAmountCell').textContent = `₹${gstAmount.toFixed(2)}`;
  byId('cessAmountCell').textContent = `₹${cessAmount.toFixed(2)}`;
  byId('grandWithGSTCessCell').textContent = `₹${grandWithGSTCess.toFixed(2)}`;
  byId('contingencyAmountCell').textContent = `₹${contingencyAmount.toFixed(2)}`;
  byId('finalTotalCell').textContent = `₹${finalTotal.toFixed(2)}`;
}

function moveSelectedRows(direction) {
  const selectedRows = Array.from(document.querySelectorAll('#estimateTable tbody .rowCheckbox:checked')).map(checkbox => checkbox.closest('tr'));
  if (selectedRows.length === 0) return;

  const tbody = qs('#estimateTable tbody');

  if (direction === 'up') {
    for (const tr of selectedRows) {
      const prevRow = tr.previousElementSibling;
      if (prevRow && !selectedRows.includes(prevRow)) {
        tbody.insertBefore(tr, prevRow);
      }
    }
  } else if (direction === 'down') {
    for (let i = selectedRows.length - 1; i >= 0; i--) {
      const tr = selectedRows[i];
      const nextRow = tr.nextElementSibling;
      if (nextRow && !selectedRows.includes(nextRow)) {
        tbody.insertBefore(nextRow, tr);
      }
    }
  }
  recalcSerials();
}

function moveActiveUp() {
  moveSelectedRows('up');
}

function moveActiveDown() {
  moveSelectedRows('down');
}

function exportToCSV() {
  // Gather work details
  const officeName = document.querySelector('h2')?.textContent || '';
  const workName = document.querySelectorAll('span[contenteditable]')[0]?.textContent || '';
  const refValue = document.querySelectorAll('span[contenteditable]')[1]?.textContent || '';

  let csv = 'ESTIMATE DETAILS\n';
  csv += `"Office Name","${officeName}"\n`;
  csv += `"Name of Work","${workName}"\n`;
  csv += `"Reference","${refValue}"\n\n`;

  csv += 'S.No,Reference,Description,Quantity,Unit,Rate,Amount\n';
  const rows = Array.from(document.querySelectorAll('#estimateTable tbody tr'));
  rows.forEach(tr => {
    if (tr.classList.contains('subtotal-row')) {
      const label = tr.cells[3].textContent || 'Subtotal'; // Get label from Description column
      const amt = tr.cells[7].textContent.replace(/^₹/, ''); // Get amount from Amount column
      csv += `"","","${label}","","","","${amt}"\n`; // Adjust CSV fields
    } else {
      const sno = tr.cells[1].textContent.trim();
      const ref = tr.cells[2].textContent.trim();
      const desc = tr.cells[3].textContent.trim();
      const qty = tr.cells[4].textContent;
      const unit = tr.cells[5].textContent;
      const rate = tr.cells[6].textContent;
      const amt = tr.cells[7].textContent.replace(/^₹/, '');
      csv += `"${sno}","${ref}","${desc}","${qty}","${unit}","${rate}","${amt}"\n`;
    }
  });
  const total = document.getElementById('totalAmountCell').textContent.replace(/^₹/, '');
  const gst = document.getElementById('gstAmountCell').textContent.replace(/^₹/, '');
  const cess = document.getElementById('cessAmountCell').textContent.replace(/^₹/, '');
  const finalTotal = document.getElementById('finalTotalCell').textContent.replace(/^₹/, '');

  csv += `\n"Summary"\n`;
  csv += `"Base Total","${total}"\n`;
  csv += `"GST @18%","${gst}"\n`;
  csv += `"Cess @1%","${cess}"\n`;
  csv += `"Final Total","${finalTotal}"\n\n`;

  csv += buildAnnexCSV('Annexure-I: Quantity Estimate', 4);
  csv += buildAnnexCSV('Annexure-II: Rate Analysis', 6);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const now = new Date();
  const timestamp = now.getFullYear() + '-' +
                    String(now.getMonth() + 1).padStart(2, '0') + '-' +
                    String(now.getDate()).padStart(2, '0') + '_' +
                    String(now.getHours()).padStart(2, '0') + '-' +
                    String(now.getMinutes()).padStart(2, '0') + '-' +
                    String(now.getSeconds()).padStart(2, '0');
  const filename = `estimate-with-annexures_${timestamp}.csv`;
  a.download = filename;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
  }, 0);
}

function buildAnnexCSV(header, colIdx) {
  let output = `"${header}"\n`; // Header for the annexure

  const grouped = {};
  Object.entries(calcHistoryMap).forEach(([key, steps]) => {
    const [rowId, col] = key.split('|');
    if (Number(col) === colIdx) grouped[rowId] = steps;
  });

  // If no data for this annexure, return note
  if (Object.keys(grouped).length === 0) {
    output += `"(No calculations recorded for this annexure)"\n\n`;
    return output;
  }

  const refMap = {};
  document.querySelectorAll('#estimateTable tbody tr').forEach(tr => {
    if (!tr.classList.contains('subtotal-row')) {
      refMap[tr.dataset.rowId] = {
        serial: parseInt(tr.cells[1].textContent, 10),
        desc: tr.cells[3].textContent.trim()
      };
    }
  });

  const sorted = Object.keys(grouped).sort(
    (a, b) => (refMap[a]?.serial || 9999) - (refMap[b]?.serial || 9999)
  );

  sorted.forEach((rid, idx) => {
    const { serial, desc } = refMap[rid] || { serial: '?', desc: '(No Description)' };
    // Add a row for the item itself
    output += `\n"Item S.No.: ${serial}","Description: ${desc}"\n`;
    output += `"Step","Label","Value"\n`; // Headers for calculation steps

    grouped[rid].forEach((line, stepIdx) => {
      const expr = extractExpressionOnly(line);
      const label = replaceCommentsForDisplay(line);
      let value = '';

      // detect hidden part ONLY
      const hiddenMatch = line.match(/!!(.*?)!!/);

      if (hiddenMatch) {
        const hiddenExpr = hiddenMatch[1];
        try {
          const val = math.evaluate(hiddenExpr, mathScope);
          value = parseFloat(val).toFixed(2);
        } catch {
          value = '❌';
        }
      } else if (!expr && label) {
        value = ''; // No value for label-only lines
      } else {
        try {
          const val = math.evaluate(expr, mathScope);
          value = parseFloat(val).toFixed(2);
        } catch {
          value = '❌';
        }
      }
      output += `"${stepIdx + 1}","${label}","${value}"\n`;
    });
  });

  output += `\n"--- End of ${header} ---"\n\n`;
  return output;
}

window.addRow = insertRowAfterActive;
window.addManualSubtotal = insertSubtotalRow;
window.moveActiveUp = moveActiveUp;
window.moveActiveDown = moveActiveDown;
window.exportToCSV = exportToCSV;
function showCalculator() {
  if (!activeCalcCell) return alert('No active cell selected.');
  const row = activeCalcCell.closest('tr');
  const rowId = row.dataset.rowId;
  const col = activeCalcCell.cellIndex;
  const key = `${rowId}|${col}`;
  const raw = calcInputMap[key] || [];
  const initialInput = raw.join('\n') || activeCalcCell.textContent.trim();
  byId('calcInput').value = initialInput;
  updateLivePreview(raw.length ? raw : [initialInput]);
  byId('calcOverlay').style.display = 'block';
  byId('calcInput').focus();
}

function updateLivePreview(lines) {
  mathScope = {};
  const preview = lines.map(line => {
    const label = replaceCommentsForDisplay(line);
    const expr = extractExpressionOnly(line);

    // Detect hidden expression syntax
    const hiddenMatch = line.match(/!!(.*?)!!/);

    // Comment-only lines
    if (!expr && label) {
      return label;
    }

    // Empty line
    if (!expr) return '';

    // Hidden expression
    if (hiddenMatch) {
      const hiddenExpr = hiddenMatch[1];
      try {
        const result = math.evaluate(hiddenExpr, mathScope);
        return label
          ? `${label} = ${parseFloat(result).toFixed(4)}`
          : `${parseFloat(result).toFixed(4)}`;
      } catch {
        return `${label || ''} ❌`;
      }
    }

    // Normal visible expression
    try {
      const result = math.evaluate(expr, mathScope);
      return `${label} = ${parseFloat(result).toFixed(4)}`;
    } catch {
      return `${label} ❌`;
    }
  });

  byId('calcLiveResults').textContent = preview.join('\n');
}

byId('calcInput').addEventListener('input', () => {
  updateLivePreview(byId('calcInput').value.split('\n'));
});

byId('calcSave').onclick = () => {
  const lines = byId('calcInput').value.split('\n');
  const row = activeCalcCell.closest('tr');
  const rowId = row.dataset.rowId;
  const col = activeCalcCell.cellIndex;
  const key = `${rowId}|${col}`;
  calcInputMap[key] = lines;
  calcHistoryMap[key] = lines;
  sessionStorage.setItem('calcInputMap', JSON.stringify(calcInputMap));
  sessionStorage.setItem('calcHistoryMap', JSON.stringify(calcHistoryMap));

  const lastValid = [...lines].reverse().find(l => {
    const expr = extractExpressionOnly(l);
    try {
      return expr && !isNaN(math.evaluate(expr, mathScope));
    } catch {
      return false;
    }
  });
  if (!lastValid) return alert('No valid expression.');
  try {
    const val = math.evaluate(extractExpressionOnly(lastValid), mathScope);
    if (!isNaN(val)) {
      activeCalcCell.textContent = parseFloat(val).toFixed(2);
      calculateAmounts();
      autoSaveSession();
      byId('calcOverlay').style.display = 'none';
      byId('calcLiveResults').textContent = '';
    } else {
      alert('Invalid expression result.');
    }
  } catch {
    alert('Calculation error.');
  }
};

byId('calcClear').onclick = () => {
  byId('calcInput').value = '';
  byId('calcLiveResults').textContent = '';
};

byId('calcClose').onclick = () => {
  byId('calcOverlay').style.display = 'none';
};

function saveSession() {
  const session = getSessionSnapshot();

  const now = new Date();
  const timestamp = now.getFullYear() + '-' +
                    String(now.getMonth() + 1).padStart(2, '0') + '-' +
                    String(now.getDate()).padStart(2, '0') + '_' +
                    String(now.getHours()).padStart(2, '0') + '-' +
                    String(now.getMinutes()).padStart(2, '0') + '-' +
                    String(now.getSeconds()).padStart(2, '0');
  const filename = `estimate_session_${timestamp}.json`;

  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 0);
}

function loadSession() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    file.text().then(txt => {
      try {
        const ses = JSON.parse(txt);
        const tbody = document.querySelector('#estimateTable tbody');
        tbody.innerHTML = ses.tableHTML;
        rowCount = ses.rowCount || 0;
        calcInputMap = ses.calcInputMap || {};
        calcHistoryMap = ses.calcHistoryMap || {};
        archivedItems = ses.archivedItems || [];
        sessionStorage.setItem('calcInputMap', JSON.stringify(calcInputMap));
        sessionStorage.setItem('calcHistoryMap', JSON.stringify(calcHistoryMap));
        tbody.querySelectorAll('tr').forEach(tr => restoreRowListeners(tr));
        document.querySelector('h2').textContent = ses.office || '';
        const spans = document.querySelectorAll('span[contenteditable]');
        spans[0].textContent = ses.work || '';
        spans[1].textContent = ses.ref || '';
        recalcSerials();
        calculateAmounts();
        alert('Session loaded.');
      } catch {
        alert('Invalid JSON session.');
      }
    });
  };
  input.click();
}

function downloadSample() {
  const csv = `Reference,Description,Unit,Rate
A001,Excavation in ordinary soil,Cum,120.00
A002,Concrete M15 mix,Cum,3200.00
A003,Reinforcement steel,Kg,76.50`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sample-schedule.csv';
  a.click();
}

function filterRows() {
  const q = document.getElementById('searchBox').value.toLowerCase();
  document.querySelectorAll('#estimateTable tbody tr').forEach(tr =>
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'
  );
}

window.saveSession = saveSession;
window.loadSession = loadSession;
window.downloadSample = downloadSample;
window.filterRows = filterRows;

window.addEventListener('beforeprint', () => {
  recalcSerials();
  mathScope = {}; // Initialize mathScope for print calculations

  const grouped = { quantity: {}, rate: {} };

  Object.entries(calcHistoryMap).forEach(([key, steps]) => {
    const [rowId, col] = key.split('|');
    if (col === '4') grouped.quantity[rowId] = steps; // Corrected index for Quantity
    if (col === '6') grouped.rate[rowId] = steps;    // Corrected index for Rate
  });

  const refMap = {};
  document.querySelectorAll('#estimateTable tbody tr').forEach(tr => {
    if (!tr.classList.contains('subtotal-row')) {
      refMap[tr.dataset.rowId] = {
        serial: parseInt(tr.cells[1].textContent, 10), // Corrected index for S.No
        desc: tr.cells[3].textContent.trim() // Corrected index for Description
      };
    }
  });

  const container = document.getElementById('printAnnexures');
  container.innerHTML = '';

  ['quantity', 'rate'].forEach((type, idx) => {
    const section = document.createElement('div');
    section.style.breakBefore = 'always';

    const hdr = document.createElement('h3');
    hdr.textContent = idx === 0
      ? 'Annexure-I: Quantity Estimate'
      : 'Annexure-II: Rate Analysis';
    section.appendChild(hdr);

    const items = grouped[type];

    const sorted = Object.keys(items).sort(
      (a, b) => (refMap[a]?.serial || 0) - (refMap[b]?.serial || 0)
    );

    let count = 1;

    sorted.forEach(rid => {
      const { serial, desc } = refMap[rid] || { serial: '?', desc: rid };

      const itemDiv = document.createElement('div');
      itemDiv.className = 'annex-item';

      const title = document.createElement('div');
      title.className = 'annex-item-title';
      title.textContent = `${count++}. [Item S.No.-${serial}] ${desc}`;
      itemDiv.appendChild(title);

      items[rid].forEach(line => {
        const expr = extractExpressionOnly(line);
        const label = replaceCommentsForDisplay(line);

        const stepDiv = document.createElement('div');
        stepDiv.className = 'annex-step';

        // detect hidden only inside !!
        const hiddenMatch = line.match(/!!(.*?)!!/);

        if (hiddenMatch) {
          const hiddenExpr = hiddenMatch[1];
          try {
            const val = math.evaluate(hiddenExpr, mathScope);
            stepDiv.textContent = `${label} = ${parseFloat(val).toFixed(2)}`;
          } catch {
            stepDiv.textContent = `${label} ❌`;
          }
          itemDiv.appendChild(stepDiv);
          return;
        }

        if (!expr && label) {
          stepDiv.textContent = label;
          itemDiv.appendChild(stepDiv);
          return;
        }

        try {
          const val = math.evaluate(expr, mathScope);
          stepDiv.textContent = `${label} = ${parseFloat(val).toFixed(2)}`;
        } catch {
          stepDiv.textContent = `${label} ❌`;
        }

        itemDiv.appendChild(stepDiv);
      });

      section.appendChild(itemDiv);
    });

    container.appendChild(section);
  });
});

let matchIndex = -1;
let matchedRows = [];

function filterScheduleModal() {
  const q = document.getElementById('scheduleSearch').value.toLowerCase().trim();
  matchedRows.forEach(row => row.classList.remove('schedule-match'));
  matchedRows = [];

  if (!q) return;

  const rows = document.querySelectorAll('#scheduleList table tbody tr');
  rows.forEach(row => {
    if (row.textContent.toLowerCase().includes(q)) {
      row.classList.add('schedule-match');
      matchedRows.push(row);
    }
  });

  matchIndex = -1; // reset index for navigation
}

document.getElementById('scheduleSearch').addEventListener('keydown', e => {
  if (e.key === 'Enter' && matchedRows.length > 0) {
    e.preventDefault();
    matchIndex = (matchIndex + 1) % matchedRows.length;
    const row = matchedRows[matchIndex];

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    matchedRows.forEach(r => r.classList.remove('current-match'));
    row.classList.add('current-match');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const selectAllCheckbox = document.getElementById('selectAllRows');
  selectAllCheckbox.addEventListener('change', (event) => {
    document.querySelectorAll('.rowCheckbox').forEach(checkbox => {
      checkbox.checked = event.target.checked;
    });
  });

  document.querySelector('#estimateTable tbody').addEventListener('change', (event) => {
    if (event.target.classList.contains('rowCheckbox')) {
      const allCheckboxes = document.querySelectorAll('.rowCheckbox');
      const allChecked = Array.from(allCheckboxes).every(checkbox => checkbox.checked);
      selectAllCheckbox.checked = allChecked;
    }
  });

  const saved = localStorage.getItem('estimateSavedSession');
  if (!saved) return;

  try {
    const ses = JSON.parse(saved);
    const tbody = document.querySelector('#estimateTable tbody');
    tbody.innerHTML = ses.tableHTML;
    rowCount = ses.rowCount || 0;
    calcInputMap = ses.calcInputMap || {};
    calcHistoryMap = ses.calcHistoryMap || {};
    archivedItems = ses.archivedItems || [];

    sessionStorage.setItem('calcInputMap', JSON.stringify(calcInputMap));
    sessionStorage.setItem('calcHistoryMap', JSON.stringify(calcHistoryMap));

    tbody.querySelectorAll('tr').forEach(tr => restoreRowListeners(tr));

    document.querySelector('h2').textContent = ses.office || '';
    const spans = document.querySelectorAll('span[contenteditable]');
    spans[0].textContent = ses.work || '';
    spans[1].textContent = ses.ref || '';

    recalcSerials();
    calculateAmounts();

  } catch (e) {
    console.error("Error loading saved session:", e);
  }
});
