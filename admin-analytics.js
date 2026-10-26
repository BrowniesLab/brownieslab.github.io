/* Chỉ tổng hợp dữ liệu admin đã được Worker kiểm tra quyền truy cập. */
(() => {
  const vnDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').trim().toLowerCase();
  const objectRows = table => (table.rows || []).map(row => Object.fromEntries(
    table.headers.map((header, index) => [header, row.values[index]])
  ));
  const integer = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') &&
    Number.isSafeInteger(Number(value));

  function localTimestamp(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(text)) {
      return Date.parse(text.replace(' ', 'T') + '+07:00');
    }
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return Date.parse(text);
    return NaN;
  }

  function dateKey(value) {
    const timestamp = localTimestamp(value);
    if (!Number.isFinite(timestamp)) return '';
    const parts = Object.fromEntries(vnDate.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function product(line) {
    const id = String(line.itemId || '').trim();
    const name = String(line.name || '').trim();
    // Ưu tiên mã món: tên hộp Mix có thể chứa cả chữ Classic và Matcha.
    for (const key of [normalize(id), normalize(name)]) {
      if (key.includes('mix')) return { key: 'mix', name: 'Mix' };
      if (key.includes('matcha')) return { key: 'matcha', name: 'Matcha' };
      if (key.includes('classic') || key.includes('fudge')) return { key: 'classic', name: 'Classic' };
    }
    return { key: 'other:' + normalize(id || name), name: name || id };
  }

  function summarizeSales(table, { from = '', to = '' } = {}) {
    if (from && to && from > to) throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const products = new Map();
    const summary = {
      items: [], orders: 0, boxes: 0, customer: 0, manual: 0, revenue: 0, orderTotal: 0,
      invalidOrders: 0, undatedOrders: 0, excludedOrders: 0, difference: 0
    };
    for (const order of objectRows(table)) {
      const status = normalize(order.Status);
      const payment = normalize(order.PaymentStatus);
      if (/\bhuy\b|cancel/.test(status + ' ' + payment) || !/^(da thanh toan|paid)(?:$|\s*[-(])/.test(payment)) {
        summary.excludedOrders++;
        continue;
      }
      if (from || to) {
        const day = dateKey(order.CreatedAt);
        if (!day) { summary.undatedOrders++; continue; }
        if (from && day < from || to && day > to) continue;
      }
      let lines;
      try { lines = JSON.parse(order.ItemsJSON); } catch { /* báo đơn lỗi, không đoán số tiền */ }
      if (!Array.isArray(lines) || !lines.length || !integer(order.Total) || Number(order.Total) < 0 ||
          lines.some(line => !line || !(line.itemId || line.name) || !integer(line.qty) || Number(line.qty) <= 0 ||
            !integer(line.price) || Number(line.price) < 0 || !Number.isSafeInteger(Number(line.qty) * Number(line.price)))) {
        summary.invalidOrders++;
        continue;
      }
      const source = /-A[A-Z0-9]+$/i.test(String(order.OrderID || '')) ? 'manual' : 'customer';
      summary.orders++;
      summary.orderTotal += Number(order.Total);
      for (const line of lines) {
        const kind = product(line);
        const item = products.get(kind.key) || { ...kind, boxes: 0, customer: 0, manual: 0, revenue: 0 };
        const qty = Number(line.qty), revenue = qty * Number(line.price);
        item.boxes += qty;
        item[source] += qty;
        item.revenue += revenue;
        summary.boxes += qty;
        summary[source] += qty;
        summary.revenue += revenue;
        products.set(kind.key, item);
      }
    }
    const rank = { classic: 0, matcha: 1, mix: 2 };
    summary.items = [...products.values()].sort((a, b) =>
      (rank[a.key] ?? 3) - (rank[b.key] ?? 3) || a.name.localeCompare(b.name, 'vi'));
    summary.difference = summary.orderTotal - summary.revenue;
    return summary;
  }

  function summarizeSessions(table, now = Date.now()) {
    let active = 0, expired = 0, invalid = 0;
    const accounts = new Set();
    for (const session of objectRows(table)) {
      const timestamp = localTimestamp(session.ExpiresAt);
      if (!Number.isFinite(timestamp)) { invalid++; continue; }
      if (timestamp > now) {
        active++;
        const phone = String(session.Phone || '').trim();
        if (phone) accounts.add(phone);
      } else expired++;
    }
    return { active, accounts: accounts.size, expired, invalid };
  }

  function salesCSV(summary) {
    const cell = value => {
      let text = String(value);
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = [['Loại bánh', 'Khách đặt (hộp)', 'Nhập tay (hộp)', 'Tổng số hộp', 'Doanh thu tiền bánh (VND)'],
      ...summary.items.map(item => [item.name, item.customer, item.manual, item.boxes, item.revenue]),
      ['Tổng', summary.customer, summary.manual, summary.boxes, summary.revenue]];
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
  }

  globalThis.AdminAnalytics = { summarizeSales, summarizeSessions, salesCSV };
})();
