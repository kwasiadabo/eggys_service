const PDFDocument = require('pdfkit');

const money = (n) => Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function header(doc, title, { from, to }) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a1714').text('VX Perfumery', { continued: false });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#8a7340').text(title);
  doc.font('Helvetica').fontSize(9).fillColor('#666')
    .text(`Period: ${dateLabel(from)} – ${dateLabel(to)}`)
    .text(`Generated: ${new Date().toLocaleString('en-GB')}`);
  doc.moveDown(0.75);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#ddd').stroke();
  doc.moveDown(0.5);
}

/**
 * Minimal table renderer — pdfkit has no built-in tables. Repeats the header
 * row on every page break so long reports stay readable.
 */
function table(doc, { columns, rows, rowHeight = 20 }) {
  const left = doc.page.margins.left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const drawRow = (values, { bold = false, fillHeader = false } = {}) => {
    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      drawHeaderRow();
    }
    let x = left;
    const y = doc.y;
    if (fillHeader) {
      doc.rect(left, y, columns.reduce((w, c) => w + c.width, 0), rowHeight).fill('#f5f1e8');
      doc.fillColor('#1a1714');
    }
    const baseFont = bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(baseFont).fillColor('#1a1714');
    columns.forEach((col, i) => {
      const value = String(values[i] ?? '');
      const cellWidth = col.width - 8;
      // pdfkit's lineBreak:false does not stop wrapping once text exceeds the
      // given width (it still breaks on hyphens), which corrupts the row below —
      // so shrink the font to fit instead of relying on it.
      let size = 8.5;
      doc.fontSize(size);
      while (size > 6.5 && doc.widthOfString(value) > cellWidth) {
        size -= 0.5;
        doc.fontSize(size);
      }
      doc.text(value, x + 4, y + 5, {
        width: cellWidth,
        align: col.align || 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += col.width;
    });
    doc.y = y + rowHeight;
  };

  const drawHeaderRow = () => drawRow(columns.map((c) => c.label), { bold: true, fillHeader: true });

  drawHeaderRow();
  rows.forEach((row) => drawRow(row));
}

function summaryBox(doc, lines) {
  if (doc.y + lines.length * 16 + 20 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.moveDown(0.5);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#ddd').stroke();
  doc.moveDown(0.5);
  lines.forEach(([label, value, bold]) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor('#1a1714');
    doc.text(label, doc.page.margins.left, doc.y, { continued: true, width: 300 });
    doc.text(value, { align: 'right' });
  });
}

function buildOrdersReport({ from, to, orders }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  header(doc, 'Orders Report', { from, to });

  const columns = [
    { label: '#', width: 18 },
    { label: 'Order #', width: 90 },
    { label: 'Date', width: 52 },
    { label: 'Customer', width: 90 },
    { label: 'Status', width: 58 },
    { label: 'Product (GHS)', width: 65, align: 'right' },
    { label: 'Delivery (GHS)', width: 65, align: 'right' },
    { label: 'Total (GHS)', width: 62, align: 'right' },
  ];
  const rows = orders.map((o, i) => [
    i + 1,
    o.orderNumber,
    dateLabel(o.createdAt),
    `${o.User?.firstName || ''} ${o.User?.lastName || ''}`.trim() || o.guestName || '—',
    o.status.replace(/_/g, ' '),
    money(o.subtotal),
    money(o.shippingCost),
    money(o.totalAmount),
  ]);
  table(doc, { columns, rows });

  const totalProduct = orders.reduce((sum, o) => sum + Number(o.subtotal || 0), 0);
  const totalDelivery = orders.reduce((sum, o) => sum + Number(o.shippingCost || 0), 0);
  const grandTotal = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  summaryBox(doc, [
    ['Orders', String(orders.length)],
    ['Total Product Price', `GHS ${money(totalProduct)}`],
    ['Total Delivery Fees', `GHS ${money(totalDelivery)}`],
    ['Grand Total', `GHS ${money(grandTotal)}`, true],
  ]);

  return doc;
}

function buildRiderDeliveriesReport({ from, to, riderGroups }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  header(doc, 'Rider Deliveries Report', { from, to });

  const columns = [
    { label: '#', width: 18 },
    { label: 'Order #', width: 88 },
    { label: 'Delivered', width: 58 },
    { label: 'Customer', width: 102 },
    { label: 'Product (GHS)', width: 70, align: 'right' },
    { label: 'Delivery (GHS)', width: 70, align: 'right' },
    { label: 'Total (GHS)', width: 60, align: 'right' },
  ];

  let grandDeliveries = 0;
  let grandTotal = 0;

  riderGroups.forEach(({ rider, orders }, i) => {
    if (i > 0) doc.moveDown(0.75);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1714')
      .text(`${rider.name}${rider.phoneNumber ? ` — ${rider.phoneNumber}` : ''}`);
    doc.moveDown(0.25);

    const rows = orders.map((o, j) => [
      j + 1,
      o.orderNumber,
      dateLabel(o.deliveredAt),
      `${o.User?.firstName || ''} ${o.User?.lastName || ''}`.trim() || o.guestName || '—',
      money(o.subtotal),
      money(o.shippingCost),
      money(o.totalAmount),
    ]);
    table(doc, { columns, rows });

    const riderTotal = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    doc.moveDown(0.25);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a1714')
      .text(`${rider.name} — ${orders.length} deliveries, GHS ${money(riderTotal)}`, doc.page.margins.left, doc.y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: 'right',
      });

    grandDeliveries += orders.length;
    grandTotal += riderTotal;
  });

  summaryBox(doc, [
    ['Riders', String(riderGroups.length)],
    ['Total Deliveries', String(grandDeliveries)],
    ['Grand Total Amount', `GHS ${money(grandTotal)}`, true],
  ]);

  return doc;
}

function buildRiderOwnReport({ from, to, rider, assigned, delivered }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  header(doc, `My Report — ${rider.name}`, { from, to });

  const assignedColumns = [
    { label: '#', width: 16 },
    { label: 'Order #', width: 72 },
    { label: 'Assigned', width: 45 },
    { label: 'Customer', width: 62 },
    { label: 'Status', width: 46 },
    { label: 'Item (GHS)', width: 50, align: 'right' },
    { label: 'Delivery Fee (GHS)', width: 55, align: 'right' },
    { label: 'Delivery Description', width: 85 },
    { label: 'Total (GHS)', width: 50, align: 'right' },
  ];
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1714').text('Orders Assigned to Me');
  doc.moveDown(0.25);
  if (assigned.length) {
    table(doc, {
      columns: assignedColumns,
      rows: assigned.map((o, i) => [
        i + 1,
        o.orderNumber,
        dateLabel(o.createdAt),
        `${o.User?.firstName || ''} ${o.User?.lastName || ''}`.trim() || o.guestName || '—',
        o.status.replace(/_/g, ' '),
        money(o.subtotal),
        money(o.shippingCost),
        o.shippingAddress || '—',
        money(o.totalAmount),
      ]),
    });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No orders assigned in this period.');
  }

  doc.moveDown(1);
  const deliveredColumns = [
    { label: '#', width: 18 },
    { label: 'Order #', width: 78 },
    { label: 'Delivered', width: 50 },
    { label: 'Customer', width: 65 },
    { label: 'Product (GHS)', width: 58, align: 'right' },
    { label: 'Delivery Fee (GHS)', width: 60, align: 'right' },
    { label: 'Delivery Description', width: 100 },
    { label: 'Total (GHS)', width: 57, align: 'right' },
  ];
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1714').text('Deliveries Completed');
  doc.moveDown(0.25);
  if (delivered.length) {
    table(doc, {
      columns: deliveredColumns,
      rows: delivered.map((o, i) => [
        i + 1,
        o.orderNumber,
        dateLabel(o.deliveredAt),
        `${o.User?.firstName || ''} ${o.User?.lastName || ''}`.trim() || o.guestName || '—',
        money(o.subtotal),
        money(o.shippingCost),
        o.shippingAddress || '—',
        money(o.totalAmount),
      ]),
    });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor('#666').text('No deliveries completed in this period.');
  }

  const deliveredAmount = delivered.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  const deliveredFees = delivered.reduce((sum, o) => sum + Number(o.shippingCost || 0), 0);
  summaryBox(doc, [
    ['Orders Assigned', String(assigned.length)],
    ['Deliveries Completed', String(delivered.length)],
    ['Total Delivery Fees', `GHS ${money(deliveredFees)}`],
    ['Total Delivered Amount', `GHS ${money(deliveredAmount)}`, true],
  ]);

  return doc;
}

function buildSalesReport({ from, to, daily, totals }) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  header(doc, 'Sales Report', { from, to });

  const columns = [
    { label: '#', width: 25 },
    { label: 'Date', width: 110 },
    { label: 'Orders', width: 90, align: 'right' },
    { label: 'Revenue (GHS)', width: 110, align: 'right' },
  ];
  const activeDays = daily.filter((d) => d.orders > 0);
  table(doc, {
    columns,
    rows: activeDays.map((d, i) => [i + 1, dateLabel(d.day), String(d.orders), money(d.revenue)]),
  });

  summaryBox(doc, [
    ['Days in Period', String(totals.days)],
    ['Total Orders', String(totals.totalOrders)],
    ['Average Daily Revenue', `GHS ${money(totals.averageDailyRevenue)}`],
    ['Average Order Value', `GHS ${money(totals.averageOrderValue)}`],
    ['Total Revenue', `GHS ${money(totals.totalRevenue)}`, true],
  ]);

  return doc;
}

module.exports = { buildOrdersReport, buildRiderDeliveriesReport, buildRiderOwnReport, buildSalesReport };
