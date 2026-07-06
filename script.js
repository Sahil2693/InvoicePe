"use strict";

/* ============================================================
   InvoicePe — Free GST Invoice Generator
   Vanilla JS: live preview, item calculations, localStorage,
   and PDF export via jsPDF.
============================================================ */

/* ---------- localStorage keys ---------- */
const LS_INVOICE_SEQ = "invoicepe_invoice_seq"; // running invoice counter
const LS_MY_DETAILS = "invoicepe_my_details"; // saved "Your Details"
const LS_CURRENCY = "invoicepe_currency"; // selected currency code

/* ---------- Currencies ----------
   `symbol` is shown on screen. `pdf` is used in the generated PDF, since
   jsPDF's built-in font can't render ₹ or Arabic glyphs — those fall back
   to text. Symbol-only switch: numbers are never converted. */
const CURRENCIES = {
  INR: { symbol: "₹", pdf: "Rs. " },
  USD: { symbol: "$", pdf: "$" },
  EUR: { symbol: "€", pdf: "€" },
  GBP: { symbol: "£", pdf: "£" },
  AED: { symbol: "د.إ", pdf: "AED " },
};

// Currently selected currency code (updated by the dropdown / storage).
let currentCurrency = "INR";

/* ---------- Safe storage helpers ----------
   localStorage can throw (file:// pages, private mode, blocked cookies).
   These wrappers make storage best-effort so it can NEVER break the app. */
function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* storage unavailable — ignore, app still works this session */
  }
}

/* ---------- Element references ---------- */
const el = {
  // Your Details
  bizName: document.getElementById("biz-name"),
  bizEmail: document.getElementById("biz-email"),
  bizPhone: document.getElementById("biz-phone"),
  bizAddress: document.getElementById("biz-address"),
  bizPayment: document.getElementById("biz-payment"),
  // Bill To
  clientName: document.getElementById("client-name"),
  clientEmail: document.getElementById("client-email"),
  clientAddress: document.getElementById("client-address"),
  // Invoice Info
  invoiceNumber: document.getElementById("invoice-number"),
  invoiceDate: document.getElementById("invoice-date"),
  dueDate: document.getElementById("due-date"),
  currency: document.getElementById("currency"),
  // Items + tax
  itemsBody: document.getElementById("items-body"),
  addItem: document.getElementById("add-item"),
  gstRate: document.getElementById("gst-rate"),
  // Preview targets
  pvBizName: document.getElementById("pv-biz-name"),
  pvBizAddress: document.getElementById("pv-biz-address"),
  pvBizContact: document.getElementById("pv-biz-contact"),
  pvInvoiceNumber: document.getElementById("pv-invoice-number"),
  pvInvoiceDate: document.getElementById("pv-invoice-date"),
  pvDueDate: document.getElementById("pv-due-date"),
  pvClientName: document.getElementById("pv-client-name"),
  pvClientEmail: document.getElementById("pv-client-email"),
  pvClientAddress: document.getElementById("pv-client-address"),
  pvItemsBody: document.getElementById("pv-items-body"),
  pvSubtotal: document.getElementById("pv-subtotal"),
  pvTaxLabel: document.getElementById("pv-tax-label"),
  pvTaxAmount: document.getElementById("pv-tax-amount"),
  pvGrandTotal: document.getElementById("pv-grand-total"),
  pvBizPayment: document.getElementById("pv-biz-payment"),
  // Actions
  generatePdf: document.getElementById("generate-pdf"),
  pdfError: document.getElementById("pdf-error"),
  footerYear: document.getElementById("footer-year"),
};

/* ============================================================
   Helpers
============================================================ */

// Parse an input value into a safe number (0 if empty/invalid).
function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// Format a number with the selected currency symbol for the on-screen UI.
function formatMoney(amount) {
  const symbol = CURRENCIES[currentCurrency].symbol;
  return symbol + amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// PDF-safe formatting (uses the currency's `pdf` label for missing glyphs).
function formatPdfMoney(amount) {
  const symbol = CURRENCIES[currentCurrency].pdf;
  return symbol + amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Format an ISO date (yyyy-mm-dd) into a readable dd Mon yyyy string.
function formatDate(isoValue) {
  if (!isoValue) return "";
  const d = new Date(isoValue + "T00:00:00");
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Set an element's text, falling back to a placeholder when empty.
function setText(node, value, fallback = "") {
  node.textContent = value && value.trim() ? value : fallback;
}

/* ============================================================
   Invoice number (auto-increment, persisted in localStorage)
============================================================ */
function initInvoiceNumber() {
  // Read the last used sequence, increment for this session.
  let seq = parseInt(safeGet(LS_INVOICE_SEQ), 10);
  if (!Number.isFinite(seq) || seq < 0) seq = 0;
  seq += 1;
  safeSet(LS_INVOICE_SEQ, String(seq));

  // Format as INV-0001 (zero-padded to 4 digits).
  el.invoiceNumber.value = "INV-" + String(seq).padStart(4, "0");
}

/* ============================================================
   "Your Details" — save + auto-fill via localStorage
============================================================ */
function saveMyDetails() {
  const details = {
    bizName: el.bizName.value,
    bizEmail: el.bizEmail.value,
    bizPhone: el.bizPhone.value,
    bizAddress: el.bizAddress.value,
    bizPayment: el.bizPayment.value,
  };
  safeSet(LS_MY_DETAILS, JSON.stringify(details));
}

function loadMyDetails() {
  const raw = safeGet(LS_MY_DETAILS);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    el.bizName.value = d.bizName || "";
    el.bizEmail.value = d.bizEmail || "";
    el.bizPhone.value = d.bizPhone || "";
    el.bizAddress.value = d.bizAddress || "";
    el.bizPayment.value = d.bizPayment || "";
  } catch (e) {
    // Corrupt data — ignore and start fresh.
  }
}

/* ============================================================
   Currency (symbol switch only — never converts the numbers)
============================================================ */
function loadCurrency() {
  const saved = safeGet(LS_CURRENCY);
  if (saved && CURRENCIES[saved]) {
    currentCurrency = saved;
    el.currency.value = saved;
  }
}

function onCurrencyChange() {
  currentCurrency = CURRENCIES[el.currency.value] ? el.currency.value : "INR";
  safeSet(LS_CURRENCY, currentCurrency);
  // Refresh every row's Amount cell in the form, then the whole preview.
  Array.from(el.itemsBody.children).forEach(updateRowAmount);
  updatePreview();
}

/* ============================================================
   Items table
============================================================ */

// Create and append a new item row. Optional preset values.
function addItemRow(desc = "", qty = "", rate = "") {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td class="col-desc"><input type="text" class="item-desc" placeholder="Design work, consulting, etc."></td>
    <td class="col-qty"><input type="number" class="item-qty" min="0" step="1" placeholder="1"></td>
    <td class="col-rate"><input type="number" class="item-rate" min="0" step="0.01" placeholder="0.00"></td>
    <td class="col-amount cell-amount">₹0.00</td>
    <td class="col-action">
      <button type="button" class="row-delete" title="Remove item" aria-label="Remove item">✕</button>
    </td>
  `;

  // Preset values (used when this could be pre-populated in future).
  tr.querySelector(".item-desc").value = desc;
  tr.querySelector(".item-qty").value = qty;
  tr.querySelector(".item-rate").value = rate;

  // NOTE: no per-row listeners here on purpose. All Qty/Rate/Description
  // changes and delete clicks are handled via event delegation on the
  // table body (see setupItemsDelegation), so newly added rows work
  // automatically without needing listeners re-attached each time.

  el.itemsBody.appendChild(tr);
  updateRowAmount(tr);
  return tr;
}

/* Event delegation: one set of listeners on the <tbody> handles every
   row, including rows added later by "+ Add Item". */
function setupItemsDelegation() {
  // Recalculate whenever any Qty/Rate/Description input changes.
  el.itemsBody.addEventListener("input", (event) => {
    const row = event.target.closest("tr");
    if (!row) return;
    // Update THIS row's amount from its own inputs, then refresh totals.
    updateRowAmount(row);
    updatePreview();
  });

  // Handle per-row delete clicks.
  el.itemsBody.addEventListener("click", (event) => {
    const deleteBtn = event.target.closest(".row-delete");
    if (!deleteBtn) return;
    const row = deleteBtn.closest("tr");
    if (row) row.remove();
    // Always keep at least one row present.
    if (el.itemsBody.children.length === 0) addItemRow();
    updatePreview();
  });
}

// Amount for one row = Qty × Rate.
function updateRowAmount(tr) {
  const qty = num(tr.querySelector(".item-qty").value);
  const rate = num(tr.querySelector(".item-rate").value);
  const amount = qty * rate;
  tr.querySelector(".cell-amount").textContent = formatMoney(amount);
  return amount;
}

// Read every row into an array of { desc, qty, rate, amount }.
function readItems() {
  return Array.from(el.itemsBody.children).map((tr) => {
    const desc = tr.querySelector(".item-desc").value;
    const qty = num(tr.querySelector(".item-qty").value);
    const rate = num(tr.querySelector(".item-rate").value);
    return { desc, qty, rate, amount: qty * rate };
  });
}

/* ============================================================
   Totals (Subtotal, Tax, Grand Total)
============================================================ */
function computeTotals() {
  const items = readItems();
  const subtotal = items.reduce((sum, it) => sum + it.amount, 0);
  const gst = num(el.gstRate.value);
  const taxAmount = subtotal * (gst / 100);
  const grandTotal = subtotal + taxAmount;
  return { subtotal, gst, taxAmount, grandTotal };
}

/* ============================================================
   Live preview
============================================================ */
function updatePreview() {
  // From (business) block
  setText(el.pvBizName, el.bizName.value, "Your Business Name");
  setText(el.pvBizAddress, el.bizAddress.value);

  const contactParts = [el.bizEmail.value, el.bizPhone.value].filter((v) => v && v.trim());
  el.pvBizContact.textContent = contactParts.join("  •  ");

  // Invoice meta
  setText(el.pvInvoiceNumber, el.invoiceNumber.value, "—");
  setText(el.pvInvoiceDate, formatDate(el.invoiceDate.value), "—");
  setText(el.pvDueDate, formatDate(el.dueDate.value), "—");

  // Bill To
  setText(el.pvClientName, el.clientName.value, "Client Name");
  setText(el.pvClientEmail, el.clientEmail.value);
  setText(el.pvClientAddress, el.clientAddress.value);

  // Payment details
  setText(el.pvBizPayment, el.bizPayment.value);

  // Items table in preview
  const items = readItems();
  el.pvItemsBody.innerHTML = "";

  const visibleItems = items.filter((it) => it.desc.trim() || it.qty || it.rate);
  if (visibleItems.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "ip-empty";
    tr.innerHTML = `<td colspan="4">No items added yet</td>`;
    el.pvItemsBody.appendChild(tr);
  } else {
    visibleItems.forEach((it) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="ip-col-desc"></td>
        <td class="ip-col-qty">${it.qty}</td>
        <td class="ip-col-rate">${formatMoney(it.rate)}</td>
        <td class="ip-col-amount">${formatMoney(it.amount)}</td>
      `;
      // Use textContent for description to avoid HTML injection.
      tr.querySelector(".ip-col-desc").textContent = it.desc || "—";
      el.pvItemsBody.appendChild(tr);
    });
  }

  // Totals
  const { subtotal, gst, taxAmount, grandTotal } = computeTotals();
  el.pvSubtotal.textContent = formatMoney(subtotal);
  el.pvTaxLabel.textContent = `Tax (GST ${gst}%)`;
  el.pvTaxAmount.textContent = formatMoney(taxAmount);
  el.pvGrandTotal.textContent = formatMoney(grandTotal);
}

/* ============================================================
   Validation
============================================================ */
function validateForm() {
  const errors = [];
  if (!el.bizName.value.trim()) errors.push("your business name");
  if (!el.clientName.value.trim()) errors.push("the client name");

  const hasItem = readItems().some((it) => it.desc.trim() && (it.qty > 0 || it.rate > 0));
  if (!hasItem) errors.push("at least one item");

  return errors;
}

function showError(message) {
  el.pdfError.textContent = message;
  el.pdfError.hidden = false;
}

function clearError() {
  el.pdfError.hidden = true;
  el.pdfError.textContent = "";
}

/* ============================================================
   PDF generation (jsPDF)
============================================================ */
function generatePDF() {
  const errors = validateForm();
  if (errors.length) {
    // Join naturally: "a", "a and b", or "a, b and c".
    const list = errors.length > 1
      ? errors.slice(0, -1).join(", ") + " and " + errors[errors.length - 1]
      : errors[0];
    showError("Please add " + list + " before generating the PDF.");
    return;
  }
  clearError();

  // Brief loading state for perceived quality.
  const btn = el.generatePdf;
  const originalText = btn.textContent;
  btn.textContent = "Generating...";
  btn.disabled = true;

  // Defer so the button repaint is visible before the (fast) render.
  setTimeout(() => {
    try {
      buildPdf();
    } catch (e) {
      showError("Something went wrong generating the PDF. Please try again.");
      console.error(e);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }, 250);
}

function buildPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 48;
  const contentW = pageW - margin * 2;
  const indigo = [44, 62, 145];
  const muted = [110, 114, 130];
  let y = margin;

  // ----- Header: business (left) + INVOICE meta (right) -----
  doc.setTextColor(...indigo);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(el.bizName.value || "Your Business Name", margin, y);

  doc.setTextColor(60, 60, 70);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let leftY = y + 16;
  const bizLines = [];
  if (el.bizAddress.value.trim()) bizLines.push(...el.bizAddress.value.split("\n"));
  const contact = [el.bizEmail.value, el.bizPhone.value].filter((v) => v && v.trim()).join("  |  ");
  if (contact) bizLines.push(contact);
  bizLines.forEach((line) => {
    doc.text(line, margin, leftY);
    leftY += 12;
  });

  // Right side title + meta
  doc.setTextColor(35, 38, 58);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("INVOICE", pageW - margin, y, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const meta = [
    ["Invoice #", el.invoiceNumber.value || "-"],
    ["Date", formatDate(el.invoiceDate.value) || "-"],
    ["Due", formatDate(el.dueDate.value) || "-"],
  ];
  let metaY = y + 16;
  meta.forEach(([label, value]) => {
    doc.setTextColor(...muted);
    doc.text(label, pageW - margin - 120, metaY);
    doc.setTextColor(35, 38, 58);
    doc.text(String(value), pageW - margin, metaY, { align: "right" });
    metaY += 14;
  });

  y = Math.max(leftY, metaY) + 8;

  // Divider under header
  doc.setDrawColor(...indigo);
  doc.setLineWidth(1.5);
  doc.line(margin, y, pageW - margin, y);
  y += 24;

  // ----- Bill To -----
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("BILL TO", margin, y);
  y += 14;

  doc.setTextColor(35, 38, 58);
  doc.setFontSize(11);
  doc.text(el.clientName.value || "Client Name", margin, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 70);
  const clientLines = [];
  if (el.clientEmail.value.trim()) clientLines.push(el.clientEmail.value);
  if (el.clientAddress.value.trim()) clientLines.push(...el.clientAddress.value.split("\n"));
  clientLines.forEach((line) => {
    doc.text(line, margin, y);
    y += 12;
  });
  y += 12;

  // ----- Items table -----
  const items = readItems().filter((it) => it.desc.trim() || it.qty || it.rate);

  // Column x-positions
  const colDescX = margin + 8;
  const colQtyX = margin + contentW * 0.6;
  const colRateX = margin + contentW * 0.78;
  const colAmountX = pageW - margin - 8;

  // Header row background
  doc.setFillColor(...indigo);
  doc.rect(margin, y, contentW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("DESCRIPTION", colDescX, y + 15);
  doc.text("QTY", colQtyX, y + 15, { align: "right" });
  doc.text("RATE", colRateX, y + 15, { align: "right" });
  doc.text("AMOUNT", colAmountX, y + 15, { align: "right" });
  y += 22;

  // Body rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  items.forEach((it, i) => {
    const descLines = doc.splitTextToSize(it.desc || "-", contentW * 0.55);
    const rowH = Math.max(20, descLines.length * 12 + 8);

    // Zebra striping
    if (i % 2 === 1) {
      doc.setFillColor(244, 246, 251);
      doc.rect(margin, y, contentW, rowH, "F");
    }

    doc.setTextColor(35, 38, 58);
    doc.text(descLines, colDescX, y + 14);
    doc.text(String(it.qty), colQtyX, y + 14, { align: "right" });
    doc.text(formatPdfMoney(it.rate), colRateX, y + 14, { align: "right" });
    doc.text(formatPdfMoney(it.amount), colAmountX, y + 14, { align: "right" });

    y += rowH;
    doc.setDrawColor(236, 238, 244);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
  });
  y += 20;

  // ----- Totals (right aligned) -----
  const { subtotal, gst, taxAmount, grandTotal } = computeTotals();
  const totalsLabelX = pageW - margin - 150;
  const totalsValueX = pageW - margin;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const drawTotalRow = (label, value) => {
    doc.setTextColor(60, 60, 70);
    doc.text(label, totalsLabelX, y);
    doc.text(value, totalsValueX, y, { align: "right" });
    y += 16;
  };

  drawTotalRow("Subtotal", formatPdfMoney(subtotal));
  drawTotalRow(`Tax (GST ${gst}%)`, formatPdfMoney(taxAmount));

  // Grand total emphasized
  y += 4;
  doc.setDrawColor(...indigo);
  doc.setLineWidth(1);
  doc.line(totalsLabelX, y - 6, totalsValueX, y - 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...indigo);
  doc.text("Grand Total", totalsLabelX, y + 10);
  doc.text(formatPdfMoney(grandTotal), totalsValueX, y + 10, { align: "right" });
  y += 40;

  // ----- Payment details footer -----
  if (el.bizPayment.value.trim()) {
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("PAYMENT DETAILS", margin, y);
    y += 13;
    doc.setTextColor(60, 60, 70);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    el.bizPayment.value.split("\n").forEach((line) => {
      doc.text(line, margin, y);
      y += 12;
    });
    y += 8;
  }

  doc.setTextColor(...muted);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text("Thank you for your business!", margin, y);

  // ----- Save -----
  const safeNumber = (el.invoiceNumber.value || "invoice").replace(/[^\w-]/g, "");
  doc.save(`invoice-${safeNumber}.pdf`);
}

/* ============================================================
   Wire up events + init
============================================================ */
function init() {
  // Footer year
  el.footerYear.textContent = new Date().getFullYear();

  // Restore saved "Your Details" + currency, then set a fresh invoice number.
  loadMyDetails();
  loadCurrency();
  initInvoiceNumber();

  // Default invoice date = today.
  const today = new Date().toISOString().slice(0, 10);
  if (!el.invoiceDate.value) el.invoiceDate.value = today;

  // Attach delegated item listeners once, then add the first row.
  setupItemsDelegation();
  addItemRow();

  // Live preview on any form input (covers GST %, dates, names, etc.).
  document.getElementById("invoice-form").addEventListener("input", updatePreview);

  // Auto-save "Your Details" as the user types.
  [el.bizName, el.bizEmail, el.bizPhone, el.bizAddress, el.bizPayment].forEach((input) => {
    input.addEventListener("input", saveMyDetails);
  });

  // Clear any error once the user starts fixing things.
  document.getElementById("invoice-form").addEventListener("input", () => {
    if (!el.pdfError.hidden) clearError();
  });

  // Add item button.
  el.addItem.addEventListener("click", () => {
    addItemRow();
    updatePreview();
  });

  // Currency switch — updates symbols everywhere instantly.
  el.currency.addEventListener("change", onCurrencyChange);

  // Generate PDF.
  el.generatePdf.addEventListener("click", generatePDF);

  // First render.
  updatePreview();
}

document.addEventListener("DOMContentLoaded", init);
