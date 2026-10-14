(() => {
  "use strict";

  const databaseName = "al-bardaji-local";
  const databaseVersion = 1;
  const storeNames = ["branches", "customers", "orders", "payments", "expenses", "inventory", "measurements", "order_status_history", "audit_log", "meta"];
  let databasePromise;

  function makeId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of storeNames) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === "meta" ? "key" : "id" });
        }
      };
      request.onerror = () => reject(request.error || new Error("تعذر فتح قاعدة البيانات المحلية."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
    return databasePromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("تعذر تنفيذ عملية قاعدة البيانات."));
    });
  }

  async function seedBranches() {
    const db = await openDatabase();
    const tx = db.transaction(["branches"], "readwrite");
    const store = tx.objectStore("branches");
    const existing = await requestResult(store.getAll());
    if (!existing.length) {
      const now = new Date().toISOString();
      [
        ["branch-main", "الفرع الرئيسي: الحلة / بابل", "الحلة / بابل"],
        ["branch-baghdad", "فرع بغداد", "بغداد"],
        ["branch-karbala", "فرع كربلاء", "كربلاء"]
      ].forEach(([id, name, address]) => store.add({ id, name, address, active: true, created_at: now }));
    }
    await transactionDone(tx);
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("فشلت معاملة التخزين المحلي."));
      tx.onabort = () => reject(tx.error || new Error("أُلغيت معاملة التخزين المحلي."));
    });
  }

  function comparable(value) {
    if (typeof value !== "string") return value;
    if (/^\d{4}-\d\d-\d\d$/.test(value)) return `${value}T00:00:00`;
    return value;
  }

  function compare(left, operator, right) {
    const a = comparable(left);
    const b = comparable(right);
    if (operator === "eq") return a === b;
    if (operator === "neq") return a !== b;
    if (operator === "gte") return a >= b;
    if (operator === "lte") return a <= b;
    return false;
  }

  class Query {
    constructor(table) {
      if (!storeNames.includes(table) || table === "meta") throw new Error(`جدول غير معروف: ${table}`);
      this.table = table;
      this.filters = [];
      this.sort = null;
      this.maxRows = Infinity;
      this.operation = "select";
      this.payload = null;
      this.returning = false;
      this.singleResult = false;
    }

    select() { this.returning = true; return this; }
    eq(column, value) { this.filters.push({ column, operator: "eq", value }); return this; }
    neq(column, value) { this.filters.push({ column, operator: "neq", value }); return this; }
    gte(column, value) { this.filters.push({ column, operator: "gte", value }); return this; }
    is(column, value) {
      if (value === null) this.filters.push({ column, operator: "eq", value: null });
      else this.filters.push({ column, operator: "eq", value });
      return this;
    }
    not(column, operator, expression) {
      if (operator === "in") {
        const excluded = String(expression).replace(/^\(|\)$/g, "").split(",").map((item) => item.trim());
        this.filters.push({ column, operator: "notIn", value: excluded });
      }
      return this;
    }
    filter(column, operator, value) { this.filters.push({ column, operator, value }); return this; }
    order(column, options = {}) { this.sort = { column, ascending: options.ascending !== false }; return this; }
    limit(count) { this.maxRows = Math.max(0, Number(count) || 0); return this; }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    delete() { this.operation = "delete"; return this; }
    single() { this.singleResult = true; return this; }

    then(resolve, reject) { return this.execute().then(resolve, reject); }

    async execute() {
      if (this.operation === "insert") {
        const inserted = await insertRows(this.table, this.payload);
        const result = this.returning ? inserted : null;
        return { data: this.singleResult && Array.isArray(result) ? result[0] : result, error: null };
      }
      if (this.operation === "update" || this.operation === "delete") {
        const changed = await mutateRows(this.table, this.filters, this.operation, this.payload);
        const result = this.returning ? changed : null;
        return { data: this.singleResult && Array.isArray(result) ? result[0] || null : result, error: null };
      }
      const rows = await readRows(this.table);
      let filtered = rows.filter((row) => this.matches(row));
      if (this.sort) {
        const { column, ascending } = this.sort;
        filtered.sort((left, right) => {
          const a = left[column] ?? "";
          const b = right[column] ?? "";
          const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
          return ascending ? result : -result;
        });
      }
      filtered = filtered.slice(0, this.maxRows);
      const hydrated = await hydrate(this.table, filtered);
      return { data: this.singleResult ? hydrated[0] || null : hydrated, error: null };
    }

    matches(row) {
      return matchesFilters(row, this.filters);
    }
  }

  function matchesFilters(row, filters) {
    return filters.every((filter) => {
      if (filter.operator === "notIn") return !filter.value.includes(String(row[filter.column]));
      if (filter.operator === "lte" && filter.value === "minimum_quantity") return Number(row[filter.column]) <= Number(row.minimum_quantity);
      return compare(row[filter.column], filter.operator, filter.value);
    });
  }

  async function readRows(table) {
    const db = await openDatabase();
    const tx = db.transaction([table], "readonly");
    const rows = await requestResult(tx.objectStore(table).getAll());
    await transactionDone(tx);
    return rows;
  }

  async function insertRows(table, payload) {
    const rows = (Array.isArray(payload) ? payload : [payload]).map((record) => prepareRecord(table, record));
    const db = await openDatabase();
    const tx = db.transaction([table, "meta", ...(table === "orders" ? ["order_status_history"] : [])], "readwrite");
    const store = tx.objectStore(table);
    for (const row of rows) {
      if (table === "customers") row.customer_number = `C-${String(await nextSequence(tx, "customer")).padStart(6, "0")}`;
      if (table === "orders") {
        const sequence = await nextSequence(tx, "order");
        row.order_number = `ORD-${String(sequence).padStart(6, "0")}`;
        row.invoice_number = `BD-${String(await nextSequence(tx, "invoice")).padStart(6, "0")}`;
        row.paid_total = 0;
        row.remaining = Number(row.total || 0);
        tx.objectStore("order_status_history").add({
          id: makeId(), order_id: row.id, old_status: null, new_status: row.status,
          changed_by: null, changed_at: row.created_at
        });
      }
      store.add(row);
    }
    await transactionDone(tx);
    return rows;
  }

  async function mutateRows(table, filters, operation, payload) {
    const db = await openDatabase();
    const tx = db.transaction([table], "readwrite");
    const store = tx.objectStore(table);
    const rows = await requestResult(store.getAll());
    const changed = rows.filter((row) => matchesFilters(row, filters));
    for (const row of changed) {
      if (operation === "delete") {
        store.delete(row.id);
      } else {
        store.put({ ...row, ...payload, id: row.id, created_at: row.created_at });
      }
    }
    await transactionDone(tx);
    return changed;
  }

  async function nextSequence(tx, name) {
    const meta = tx.objectStore("meta");
    const key = `sequence:${name}`;
    const existing = await requestResult(meta.get(key));
    const next = Number(existing?.value || 0) + 1;
    meta.put({ key, value: next });
    return next;
  }

  function prepareRecord(table, source) {
    const record = { ...source };
    const now = new Date().toISOString();
    record.id = makeId();
    record.created_at = record.created_at || now;
    if (table === "orders") {
      record.status = record.status || "طلب جديد";
      record.total = Number(record.total || 0);
      record.cost_total = Number(record.cost_total || 0);
      record.paid_total = 0;
      record.remaining = record.total;
      record.updated_at = now;
    }
    if (table === "payments") {
      record.amount = Number(record.amount || 0);
      record.paid_at = record.paid_at || now;
      record.cancelled_at = null;
      record.cancelled_by = null;
      record.cancellation_reason = null;
    }
    if (table === "expenses") {
      record.amount = Number(record.amount || 0);
      record.spent_at = record.spent_at || now.slice(0, 10);
    }
    if (table === "inventory") {
      ["quantity", "purchase_price", "sale_price", "minimum_quantity"].forEach((key) => { record[key] = Number(record[key] || 0); });
    }
    return record;
  }

  async function hydrate(table, rows) {
    const needsCustomers = table === "orders" || table === "payments";
    const needsOrders = table === "payments";
    const needsBranches = table === "expenses";
    if (!needsCustomers && !needsOrders && !needsBranches) return rows;
    const [customers, orders, branches] = await Promise.all([
      needsCustomers ? readRows("customers") : Promise.resolve([]),
      needsOrders ? readRows("orders") : Promise.resolve([]),
      needsBranches ? readRows("branches") : Promise.resolve([])
    ]);
    const customerById = new Map(customers.map((row) => [row.id, row]));
    const orderById = new Map(orders.map((row) => [row.id, row]));
    if (table === "orders") {
      return rows.map((row) => ({ ...row, customer: customerById.has(row.customer_id) ? { name: customerById.get(row.customer_id).name } : null }));
    }
    if (table === "expenses") {
      const branchById = new Map(branches.map((row) => [row.id, row]));
      return rows.map((row) => ({ ...row, branch: branchById.has(row.branch_id) ? { name: branchById.get(row.branch_id).name } : null }));
    }
    return rows.map((row) => {
      const order = orderById.get(row.order_id);
      const customer = order ? customerById.get(order.customer_id) : null;
      return { ...row, order: order ? { order_number: order.order_number, customer: customer ? { name: customer.name } : null } : null };
    });
  }

  async function recordPayment(params) {
    const { p_order_id, p_amount, p_method, p_notes } = params;
    const amount = Number(p_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("أدخل مبلغ دفعة صحيحاً أكبر من صفر.");
    const db = await openDatabase();
    const tx = db.transaction(["orders", "payments", "audit_log"], "readwrite");
    const orders = tx.objectStore("orders");
    const order = await requestResult(orders.get(p_order_id));
    if (!order) {
      tx.abort();
      throw new Error("الطلب غير موجود.");
    }
    if (amount > Number(order.remaining || 0)) {
      tx.abort();
      throw new Error("المبلغ أكبر من المتبقي على الطلب.");
    }
    const now = new Date().toISOString();
    const payment = prepareRecord("payments", {
      branch_id: order.branch_id, order_id: order.id, amount, method: p_method,
      notes: p_notes, paid_by: null, paid_at: now
    });
    order.paid_total = Number(order.paid_total || 0) + amount;
    order.remaining = Math.max(0, Number(order.total || 0) - order.paid_total);
    order.updated_at = now;
    orders.put(order);
    tx.objectStore("payments").add(payment);
    tx.objectStore("audit_log").add({
      id: makeId(), branch_id: order.branch_id, actor_id: null, action: "payment_recorded",
      entity_type: "payment", entity_id: payment.id, details: { order_id: order.id, amount, method: p_method },
      occurred_at: now
    });
    await transactionDone(tx);
    return payment.id;
  }

  async function cancelPayment(params) {
    const { p_payment_id, p_reason } = params;
    if (!p_reason || String(p_reason).trim().length < 3) throw new Error("سبب الإلغاء مطلوب (ثلاثة أحرف على الأقل).");
    const db = await openDatabase();
    const tx = db.transaction(["payments", "orders", "audit_log"], "readwrite");
    const payments = tx.objectStore("payments");
    const payment = await requestResult(payments.get(p_payment_id));
    if (!payment || payment.cancelled_at) {
      tx.abort();
      throw new Error("الدفعة غير موجودة أو ملغاة مسبقاً.");
    }
    const orders = tx.objectStore("orders");
    const order = await requestResult(orders.get(payment.order_id));
    if (!order) {
      tx.abort();
      throw new Error("الطلب المرتبط بالدفعة غير موجود.");
    }
    const now = new Date().toISOString();
    payment.cancelled_at = now;
    payment.cancelled_by = null;
    payment.cancellation_reason = String(p_reason).trim();
    order.paid_total = Math.max(0, Number(order.paid_total || 0) - Number(payment.amount || 0));
    order.remaining = Math.max(0, Number(order.total || 0) - order.paid_total);
    order.updated_at = now;
    payments.put(payment);
    orders.put(order);
    tx.objectStore("audit_log").add({
      id: makeId(), branch_id: payment.branch_id, actor_id: null, action: "payment_cancelled",
      entity_type: "payment", entity_id: payment.id,
      details: { reason: payment.cancellation_reason, amount: payment.amount }, occurred_at: now
    });
    await transactionDone(tx);
  }

  const store = {
    from(table) { return new Query(table); },
    async rpc(name, params) {
      if (name === "record_payment") return { data: await recordPayment(params), error: null };
      if (name === "cancel_payment") return { data: await cancelPayment(params), error: null };
      throw new Error(`إجراء غير معروف: ${name}`);
    },
    async initialize() { await seedBranches(); }
  };

  globalThis.BardajiLocalStore = store;
})();
