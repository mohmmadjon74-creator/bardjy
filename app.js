(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const money = new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 0 });
  const dateFormat = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium" });
  const pages = {
    dashboard: { title: "لوحة التحكم", eyebrow: "نظرة عامة" },
    orders: { title: "الطلبات", eyebrow: "إدارة العمل" },
    customers: { title: "الزبائن", eyebrow: "إدارة العمل" },
    payments: { title: "الدفعات", eyebrow: "الحسابات" },
    expenses: { title: "المصاريف", eyebrow: "الحسابات" },
    inventory: { title: "المخزون", eyebrow: "المتابعة" },
    reports: { title: "التقارير", eyebrow: "المتابعة" }
  };
  const tablePages = {
    orders: { table: "orders", columns: [["order_number", "رقم الطلب"], ["customer_name", "الزبون"], ["status", "الحالة"], ["total", "الإجمالي"], ["remaining", "المتبقي"], ["created_at", "التاريخ"]] },
    customers: { table: "customers", columns: [["customer_number", "رقم الزبون"], ["name", "اسم الزبون"], ["phone", "رقم الهاتف"], ["province", "المحافظة"], ["area", "المنطقة"]] },
    payments: { table: "payments", columns: [["order_number", "رقم الطلب"], ["amount", "المبلغ"], ["method", "طريقة الدفع"], ["paid_at", "تاريخ الدفع"], ["payment_status", "الحالة"], ["notes", "ملاحظات"]] },
    expenses: { table: "expenses", columns: [["category", "نوع المصروف"], ["amount", "المبلغ"], ["branch_name", "الفرع"], ["spent_at", "التاريخ"], ["notes", "ملاحظات"]] },
    inventory: { table: "inventory", columns: [["fabric_name", "اسم القماش"], ["fabric_code", "الكود"], ["color", "اللون"], ["quantity", "الكمية"], ["unit", "الوحدة"], ["minimum_quantity", "الحد الأدنى"]] }
  };
  let client;
  let profile;
  let branches = [];
  let activeBranch = "";
  let currentPage = "dashboard";
  let allPageRows = [];
  let orderItems = [];
  let orderSaving = false;
  let dashboardStatistics = {};

  function notify(message, isError) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    $("#toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  function formatMoney(value) {
    return `${money.format(Number(value || 0))} د.ع`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const normalized = /^\d{4}-\d\d-\d\d$/.test(value) ? `${value}T12:00:00` : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? "—" : dateFormat.format(parsed);
  }

  function localDateValue(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  async function checkResult(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async function startSession() {
    await client.initialize();
    profile = { id: null, full_name: "إدارة البردجي", role: "manager", branch_id: null, active: true };
    branches = await checkResult(client.from("branches").select("id,name").eq("active", true).order("name"));
    if (!branches.length) throw new Error("لا توجد فروع مفعّلة في قاعدة البيانات.");
    activeBranch = branches[0].id;
    renderShell();
    await renderPage("dashboard");
  }

  function renderShell() {
    $("#user-name").textContent = profile.full_name;
    $("#user-role").textContent = "وصول مباشر · بلا حسابات";
    $("#user-avatar").textContent = profile.full_name.trim().slice(0, 1);
    document.querySelectorAll(".nav-link[data-page]").forEach((item) => {
      item.classList.toggle("hidden", !canSeePage(item.dataset.page));
    });
    $("#today-label").textContent = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "full" }).format(new Date());
    $("#branch-select").innerHTML = branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join("");
    $("#mobile-branch-select").innerHTML = branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join("");
    if (profile.role !== "manager") {
      branches = branches.filter((branch) => branch.id === profile.branch_id);
      $("#branch-select").innerHTML = branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join("");
      $("#mobile-branch-select").innerHTML = branches.map((branch) => `<option value="${esc(branch.id)}">${esc(branch.name)}</option>`).join("");
      $("#branch-select").disabled = true;
      $("#mobile-branch-select").disabled = true;
    }
    $("#branch-select").value = activeBranch;
    $("#mobile-branch-select").value = activeBranch;
  }

  function roleName(role) {
    return ({ manager: "مدير", accountant: "محاسب", sales: "مبيعات", measurement: "قياس", sewing: "خياطة", installation: "تركيب" })[role] || "موظف";
  }

  function canCreate(page) {
    if (profile.role === "manager") return ["orders", "customers", "payments", "expenses", "inventory"].includes(page);
    const permissions = {
      accountant: ["payments", "expenses"],
      sales: ["orders", "customers"],
      measurement: ["orders"],
      sewing: [],
      installation: []
    };
    return (permissions[profile.role] || []).includes(page);
  }

  function canSeePage(page) {
    if (profile.role === "manager") return true;
    const visible = {
      accountant: ["dashboard", "orders", "customers", "payments", "expenses", "reports"],
      sales: ["dashboard", "orders", "customers", "payments"],
      measurement: ["dashboard", "orders", "customers"],
      sewing: ["dashboard", "orders"],
      installation: ["dashboard", "orders"]
    };
    return (visible[profile.role] || ["dashboard"]).includes(page);
  }

  async function renderPage(page) {
    if (!canSeePage(page)) {
      notify("ليس لديك صلاحية لعرض هذه الصفحة.", true);
      return;
    }
    currentPage = page;
    document.querySelectorAll(".nav-link[data-page]").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    $("#page-title").textContent = pages[page].title;
    $("#breadcrumb").textContent = pages[page].eyebrow;
    if (page === "dashboard") {
      await renderDashboard();
    } else if (page === "reports") {
      await renderReports();
    } else {
      await renderTablePage(page);
    }
  }

  async function renderDashboard() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = localDateValue(todayStart);
    const branchFilter = (query, column = "branch_id") => query.eq(column, activeBranch);
    const [orders, payments, expenses, recentOrders, recentPayments, recentExpenses, inventoryRows, allOrders] = await Promise.all([
      checkResult(branchFilter(client.from("orders").select("id,total,cost_total,status,created_at,order_number,customer:customers(name)").gte("created_at", today).neq("status", "ملغي"))),
      checkResult(branchFilter(client.from("payments").select("id,amount,method,paid_at,order_id,order:orders(order_number,customer:customers(name))").gte("paid_at", today).is("cancelled_at", null))),
      checkResult(branchFilter(client.from("expenses").select("id,category,amount,spent_at,notes").gte("spent_at", today))),
      checkResult(branchFilter(client.from("orders").select("id,order_number,total,status,created_at,customer:customers(name)").order("created_at", { ascending: false }).limit(6))),
      checkResult(branchFilter(client.from("payments").select("amount,paid_at,order:orders(order_number,customer:customers(name))").is("cancelled_at", null).order("paid_at", { ascending: false }).limit(5))),
      checkResult(branchFilter(client.from("expenses").select("category,amount,spent_at").order("spent_at", { ascending: false }).limit(5))),
      checkResult(branchFilter(client.from("inventory").select("fabric_name,quantity,minimum_quantity").limit(250))),
      checkResult(branchFilter(client.from("orders").select("id,order_number,total,cost_total,paid_total,status,created_at,customer:customers(name)")))
    ]);
    const totalSales = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const received = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const expensesTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const costs = orders.reduce((sum, order) => sum + Number(order.cost_total || 0), 0);
    const activeOrders = allOrders.filter((order) => order.status !== "ملغي");
    const outstandingOrders = activeOrders.filter((order) => Math.max(0, Number(order.total || 0) - Number(order.paid_total || 0)) > 0);
    const outstanding = outstandingOrders.reduce((sum, order) => sum + Math.max(0, Number(order.total || 0) - Number(order.paid_total || 0)), 0);
    const counts = allOrders.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
    const lowStockItems = inventoryRows.filter((item) => Number(item.quantity) <= Number(item.minimum_quantity)).slice(0, 5);
    $("#orders-count").textContent = String(allOrders.length || "");
    const newOrders = allOrders.filter((order) => order.status === "طلب جديد");
    const completedOrders = allOrders.filter((order) => ["جاهز", "مكتمل"].includes(order.status));
    const netToday = totalSales - costs - expensesTotal;
    const currentBranchName = branches.find((branch) => branch.id === activeBranch)?.name || "";
    dashboardStatistics = {
      sales: {
        title: "مبيعات اليوم",
        period: "طلبات اليوم",
        summary: [["إجمالي المبيعات", formatMoney(totalSales)], ["عدد الطلبات", money.format(orders.length)]],
        columns: ["رقم الطلب", "الزبون", "الحالة", "التاريخ", "الإجمالي"],
        rows: orders.map((order) => [order.order_number, order.customer?.name || "—", order.status, formatDate(order.created_at), formatMoney(order.total)])
      },
      received: {
        title: "المقبوض اليوم",
        period: "دفعات اليوم",
        summary: [["إجمالي المقبوض", formatMoney(received)], ["عدد الدفعات", money.format(payments.length)]],
        columns: ["رقم الطلب", "الزبون", "طريقة الدفع", "التاريخ", "المبلغ"],
        rows: payments.map((payment) => [payment.order?.order_number || "—", payment.order?.customer?.name || "—", payment.method || "—", formatDate(payment.paid_at), formatMoney(payment.amount)])
      },
      balance: {
        title: "المبالغ المتبقية عند الزبائن",
        period: "كل طلبات الفرع غير الملغاة",
        summary: [["إجمالي المتبقي", formatMoney(outstanding)], ["عدد الطلبات ذات الرصيد", money.format(outstandingOrders.length)]],
        columns: ["رقم الطلب", "الزبون", "الحالة", "تاريخ الطلب", "المتبقي"],
        rows: outstandingOrders.map((order) => [order.order_number, order.customer?.name || "—", order.status, formatDate(order.created_at), formatMoney(Math.max(0, Number(order.total || 0) - Number(order.paid_total || 0)))])
      },
      expenses: {
        title: "مصروفات اليوم",
        period: "مصروفات اليوم",
        summary: [["إجمالي المصروفات", formatMoney(expensesTotal)], ["عدد المصروفات", money.format(expenses.length)]],
        columns: ["نوع المصروف", "التفاصيل", "التاريخ", "المبلغ"],
        rows: expenses.map((expense) => [expense.category || "—", expense.notes || "—", formatDate(expense.spent_at), formatMoney(expense.amount)])
      },
      profit: {
        title: "صافي ربح اليوم",
        period: "طلبات ومصروفات اليوم",
        summary: [["المبيعات", formatMoney(totalSales)], ["تكلفة الطلبات", formatMoney(costs)], ["المصروفات", formatMoney(expensesTotal)], ["صافي الربح", formatMoney(netToday)]],
        columns: ["النوع", "رقم / بيان", "الزبون / الملاحظات", "الإجمالي", "التكلفة"],
        rows: [
          ...orders.map((order) => ["طلب", order.order_number, order.customer?.name || "—", formatMoney(order.total), formatMoney(order.cost_total)]),
          ...expenses.map((expense) => ["مصروف", expense.category || "—", expense.notes || "—", formatMoney(expense.amount), "—"])
        ]
      },
      newOrders: {
        title: "الطلبات الجديدة",
        period: "كل طلبات الفرع بحالة طلب جديد",
        summary: [["عدد الطلبات الجديدة", money.format(newOrders.length)]],
        columns: ["رقم الطلب", "الزبون", "الحالة", "تاريخ الطلب", "الإجمالي"],
        rows: newOrders.map((order) => [order.order_number, order.customer?.name || "—", order.status, formatDate(order.created_at), formatMoney(order.total)])
      },
      completed: {
        title: "الطلبات الجاهزة والمكتملة",
        period: "كل طلبات الفرع الجاهزة أو المكتملة",
        summary: [["إجمالي الطلبات", money.format(completedOrders.length)], ["جاهز", money.format(completedOrders.filter((order) => order.status === "جاهز").length)], ["مكتمل", money.format(completedOrders.filter((order) => order.status === "مكتمل").length)]],
        columns: ["رقم الطلب", "الزبون", "الحالة", "تاريخ الطلب", "الإجمالي"],
        rows: completedOrders.map((order) => [order.order_number, order.customer?.name || "—", order.status, formatDate(order.created_at), formatMoney(order.total)])
      }
    };
    const cards = [
      ["مبيعات اليوم", formatMoney(totalSales), "sales", "sales"],
      ["المقبوض اليوم", formatMoney(received), "received", "received"],
      ["المتبقي عند الزبائن", formatMoney(outstanding), "balance", "balance"],
      ["مصروفات اليوم", formatMoney(expensesTotal), "expenses", "expenses"],
      ["صافي ربح اليوم", formatMoney(netToday), "profit", "profit"],
      ["طلبات جديدة", money.format(counts["طلب جديد"] || 0), "new-order", "newOrders"],
      ["جاهز / مكتمل", money.format((counts["جاهز"] || 0) + (counts["مكتمل"] || 0)), "complete", "completed"]
    ];
    $("#page-content").innerHTML = `
      <div class="section-heading"><div><h2>أهلاً ${esc(profile.full_name)}</h2><p>ملخص حركة الفرع وأهم ما يحتاج إلى متابعة.</p></div><button class="button button-primary" data-action="new-order">＋ طلب جديد</button></div>
      <div class="stats-grid">${cards.map(([label, value, icon, stat]) => `<button type="button" class="stat-card stat-card-button" data-dashboard-stat="${stat}" aria-label="عرض إحصائيات ${label} في ${esc(currentBranchName)}"><span class="stat-top"><span>${label}</span><span class="stat-icon">${iconSvg(icon)}</span></span><strong class="stat-value">${value}</strong><span class="stat-note">اضغط لعرض التفاصيل · ${esc(currentBranchName)}</span></button>`).join("")}</div>
      <div class="content-grid">
        <section class="panel"><div class="panel-header"><h2>آخر الطلبات</h2><button class="link-button" data-goto="orders">عرض الكل ←</button></div>${recentOrders.length ? `<div class="table-wrap"><table><thead><tr><th>رقم الطلب</th><th>الزبون</th><th>الحالة</th><th>الإجمالي</th></tr></thead><tbody>${recentOrders.map((row) => `<tr><td>${esc(row.order_number)}</td><td>${esc(row.customer?.name || "—")}</td><td>${statusTag(row.status)}</td><td>${formatMoney(row.total)}</td></tr>`).join("")}</tbody></table></div>` : empty("لا توجد طلبات مسجلة بعد.")}</section>
        <section class="panel"><div class="panel-header"><h2>آخر الدفعات</h2><button class="link-button" data-goto="payments">عرض الكل ←</button></div><div class="activity-list">${recentPayments.length ? recentPayments.map((row) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${formatMoney(row.amount)} · ${esc(row.order?.customer?.name || "دفعة")}</strong><small>${esc(row.order?.order_number || "")} · ${formatDate(row.paid_at)}</small></div></div>`).join("") : empty("لا توجد دفعات مسجلة.")}</div></section>
        <section class="panel"><div class="panel-header"><h2>آخر المصاريف</h2><button class="link-button" data-goto="expenses">عرض الكل ←</button></div><div class="activity-list">${recentExpenses.length ? recentExpenses.map((row) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${esc(row.category)} · ${formatMoney(row.amount)}</strong><small>${formatDate(row.spent_at)}</small></div></div>`).join("") : empty("لا توجد مصاريف مسجلة.")}</div></section>
        <section class="panel"><div class="panel-header"><h2>تنبيه المخزون</h2><button class="link-button" data-goto="inventory">المخزون ←</button></div><div class="activity-list">${lowStockItems.length ? lowStockItems.map((item) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${esc(item.fabric_name)}</strong><small>المتبقي ${money.format(item.quantity)} · الحد الأدنى ${money.format(item.minimum_quantity)}</small></div></div>`).join("") : empty("لا توجد أصناف وصلت للحد الأدنى.")}</div></section>
        <section class="panel"><div class="panel-header"><h2>متابعة الذمم</h2><span class="status warn">تحتاج متابعة</span></div><div class="activity-list"><div class="activity-item"><span class="activity-dot"></span><div><strong>إجمالي المبالغ المتبقية</strong><small>${formatMoney(outstanding)} على طلبات هذا الفرع</small></div></div><div class="activity-item"><span class="activity-dot"></span><div><strong>عدد الطلبات غير المكتملة</strong><small>${money.format(allOrders.filter((row) => !["مكتمل", "ملغي"].includes(row.status)).length)} طلب</small></div></div></div></section>
      </div>`;
  }

  function iconSvg(name) {
    const paths = {
      sales: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/><path d="M16 6h4v4"/>',
      received: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
      balance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      expenses: '<path d="M4 18 18 4M8 4h10v10"/><path d="M4 20h16"/>',
      profit: '<path d="M4 18 9 13l4 3 7-9"/><path d="M15 7h5v5"/>',
      "new-order": '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v5h4M10 13h6M10 17h4"/>',
      progress: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
      complete: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
      report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
    };
    return `<svg class="stat-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.report}</svg>`;
  }

  function openDashboardStatistics(key) {
    const statistics = dashboardStatistics[key];
    if (!statistics) throw new Error("تعذر العثور على إحصائيات هذا المربع.");
    $("#statistics-title").textContent = statistics.title;
    $("#statistics-kicker").textContent = `${branches.find((branch) => branch.id === activeBranch)?.name || ""} · ${statistics.period}`;
    const summary = `<div class="statistics-summary">${statistics.summary.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}</div>`;
    const rows = statistics.rows.length
      ? `<div class="table-wrap statistics-table-wrap"><table><thead><tr>${statistics.columns.map((column) => `<th>${esc(column)}</th>`).join("")}</tr></thead><tbody>${statistics.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : empty("لا توجد سجلات ضمن هذه الإحصائيات.");
    $("#statistics-body").innerHTML = `${summary}<p class="statistics-count">عدد السجلات: ${money.format(statistics.rows.length)}</p>${rows}`;
    $("#statistics-dialog").showModal();
  }

  function statusTag(value) {
    const cls = ["ملغي", "متأخر"].includes(value) ? "danger" : ["جاهز", "قيد التركيب"].includes(value) ? "warn" : "";
    return `<span class="status ${cls}">${esc(value || "—")}</span>`;
  }

  function empty(message) {
    return `<div class="empty-state">${esc(message)}</div>`;
  }

  async function renderTablePage(page) {
    const spec = tablePages[page];
    if (!spec) return;
    const selection = page === "expenses" ? "*,branch:branches(name)" :
      page === "payments" ? "*,order:orders(order_number)" :
      page === "orders" ? "*,customer:customers(name)" : "*";
    let query = client.from(spec.table).select(selection);
    if (page !== "customers") query = query.eq("branch_id", activeBranch);
    query = query.order(page === "payments" ? "paid_at" : page === "expenses" ? "spent_at" : "created_at", { ascending: false }).limit(250);
    allPageRows = await checkResult(query);
    const headingText = page === "customers" ? "سجل الزبائن" : pages[page].title;
    const button = canCreate(page) ? `<button class="button button-primary" data-action="create">＋ ${createLabel(page)}</button>` : "";
    const customerActions = page === "customers" && canCreate(page);
    const searchPlaceholder = page === "customers" ? "ابحث بالاسم أو الهاتف أو رقم الزبون" : "ابحث في السجلات";
    $("#page-content").innerHTML = `
      <div class="section-heading"><div><h2>${headingText}</h2><p>السجلات الخاصة بفرع ${esc(branches.find((item) => item.id === activeBranch)?.name || "")}</p></div>${button}</div>
      <div class="toolbar"><input class="search-input" id="table-search" type="search" placeholder="${searchPlaceholder}" aria-label="${searchPlaceholder}"><span class="status">${allPageRows.length} سجل</span></div>
      <div class="table-panel"><div class="table-wrap"><table><thead><tr>${spec.columns.map(([, label]) => `<th>${label}</th>`).join("")}${page === "payments" && ["manager", "accountant"].includes(profile.role) ? "<th>إجراء</th>" : ""}${customerActions ? "<th>إجراءات</th>" : ""}</tr></thead><tbody id="table-body"></tbody></table></div><div class="pagination-note">عرض آخر ${allPageRows.length} سجل كحد أقصى.</div></div>`;
    drawRows(spec, allPageRows);
    $("#table-search").addEventListener("input", (event) => {
      const term = event.target.value.trim().toLocaleLowerCase();
      drawRows(spec, allPageRows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLocaleLowerCase().includes(term))));
    });
  }

  function drawRows(spec, rows) {
    const body = $("#table-body");
    if (!rows.length) {
      const extraColumns = spec.table === "customers" && canCreate("customers") || spec.table === "payments" && ["manager", "accountant"].includes(profile.role) ? 1 : 0;
      body.innerHTML = `<tr><td colspan="${spec.columns.length + extraColumns}">${empty("لا توجد سجلات مطابقة.")}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((row) => `<tr>${spec.columns.map(([field]) => {
      if (field === "order_number" && spec.table === "payments") return `<td>${esc(row.order?.order_number || "—")}</td>`;
      if (field === "customer_name" && spec.table === "orders") return `<td>${esc(row.customer?.name || "—")}</td>`;
      if (field === "payment_status") return `<td>${row.cancelled_at ? `<span class="status danger">ملغاة · ${esc(row.cancellation_reason || "")}</span>` : '<span class="status">مسجلة</span>'}</td>`;
      return `<td>${cellValue(field, field === "branch_name" ? row.branch?.name : row[field])}</td>`;
    }).join("")}${spec.table === "payments" && ["manager", "accountant"].includes(profile.role) ? `<td>${row.cancelled_at ? "—" : `<button class="link-button" data-cancel-payment="${esc(row.id)}">إلغاء مسبب</button>`}</td>` : ""}${spec.table === "customers" && canCreate("customers") ? `<td><button class="link-button" data-edit-customer="${esc(row.id)}">تعديل</button><button class="link-button customer-delete" data-delete-customer="${esc(row.id)}">حذف</button></td>` : ""}</tr>`).join("");
  }

  function cellValue(field, value) {
    if (field === "status") return statusTag(value);
    if (["total", "remaining", "amount"].includes(field)) return formatMoney(value);
    if (["created_at", "paid_at", "spent_at"].includes(field)) return formatDate(value);
    if (field === "quantity" && value != null) return money.format(value);
    return esc(value || "—");
  }

  function createLabel(page) {
    return ({ orders: "طلب جديد", customers: "زبون جديد", payments: "تسجيل دفعة", expenses: "إضافة مصروف", inventory: "إضافة صنف" })[page];
  }

  function field(name, label, type = "text", options = {}) {
    const wide = options.wide ? " wide" : "";
    const required = options.required ? "required" : "";
    const placeholder = options.placeholder ? `placeholder="${esc(options.placeholder)}"` : "";
    if (type === "select") {
      const values = options.values || [];
      const emptyOption = options.required
        ? `<option value="" selected disabled>${esc(options.placeholder || (values.length ? "اختر خياراً" : "لا توجد خيارات متاحة"))}</option>`
        : "";
      const hint = options.hint ? `<small class="field-hint">${esc(options.hint)}</small>` : "";
      return `<label class="${wide}">${label}<select name="${name}" ${required}>${emptyOption}${values.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("")}</select>${hint}</label>`;
    }
    return `<label class="${wide}">${label}<input name="${name}" type="${type}" ${required} ${placeholder} ${options.min != null ? `min="${options.min}"` : ""} ${options.step ? `step="${options.step}"` : ""}></label>`;
  }

  function customerOptions() {
    return checkResult(client.from("customers").select("id,name,phone").order("name").limit(1000));
  }

  async function openCreateDialog(page) {
    if (page === "orders") {
      await renderNewOrderForm();
      return;
    }
    const branchName = branches.find((branch) => branch.id === activeBranch)?.name || "";
    let fields = "";
    if (page === "customers") {
      fields = customerFields();
    } else if (page === "payments") {
      const rows = await checkResult(client.from("orders").select("id,order_number,customer:customers(name)").eq("branch_id", activeBranch).not("status", "in", "(مكتمل,ملغي)").order("created_at", { ascending: false }).limit(500));
      fields = field("order_id", "الطلب", "select", { required: true, values: rows.map((row) => ({ value: row.id, label: `${row.order_number} · ${row.customer?.name || ""}` })) }) +
        field("amount", "المبلغ (د.ع)", "number", { required: true, min: 1, step: "1" }) +
        field("method", "طريقة الدفع", "select", { values: ["نقدي", "Master Card", "Visa", "Zain Cash", "أخرى"].map((value) => ({ value, label: value })) }) +
        field("notes", "ملاحظات", "text", { wide: true });
    } else if (page === "expenses") {
      fields = field("category", "نوع المصروف", "select", { required: true, values: ["إيجار", "رواتب", "كهرباء", "نقل", "وقود", "إعلانات", "صيانة", "شراء مواد", "مصاريف أخرى"].map((value) => ({ value, label: value })) }) +
        field("amount", "المبلغ (د.ع)", "number", { required: true, min: 1, step: "1" }) + field("spent_at", "التاريخ", "date", { required: true }) +
        field("notes", "ملاحظات", "text", { wide: true });
    } else if (page === "inventory") {
      fields = field("fabric_name", "اسم القماش", "text", { required: true }) + field("fabric_code", "كود القماش") +
        field("color", "اللون") + field("supplier_name", "المورد") + field("quantity", "الكمية", "number", { required: true, min: 0, step: "0.01" }) +
        field("unit", "وحدة القياس", "select", { values: ["متر", "قطعة", "لفة"].map((value) => ({ value, label: value })) }) +
        field("purchase_price", "سعر الشراء", "number", { min: 0, step: "1" }) + field("sale_price", "سعر البيع", "number", { min: 0, step: "1" }) +
        field("minimum_quantity", "الحد الأدنى", "number", { min: 0, step: "0.01" });
    }
    $("#dialog-title").textContent = createLabel(page);
    $("#dialog-kicker").textContent = `إضافة سجل · ${branchName}`;
    $("#dialog-fields").innerHTML = fields;
    const dateInput = $("#record-form").elements.spent_at;
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    $("#record-form").dataset.page = page;
    delete $("#record-form").dataset.recordId;
    $("#dialog-save").textContent = "حفظ السجل";
    $("#record-dialog").showModal();
  }

  function customerFields() {
    return field("name", "اسم الزبون", "text", { required: true }) + field("phone", "رقم الهاتف", "tel", { required: true }) +
      field("province", "المحافظة") + field("area", "المنطقة") + field("address", "العنوان", "text", { wide: true }) +
      field("notes", "ملاحظات", "text", { wide: true });
  }

  function openCustomerEditDialog(customer) {
    const form = $("#record-form");
    form.reset();
    form.dataset.page = "customers";
    form.dataset.recordId = customer.id;
    $("#dialog-fields").innerHTML = customerFields();
    for (const name of ["name", "phone", "province", "area", "address", "notes"]) {
      form.elements.namedItem(name).value = customer[name] || "";
    }
    $("#dialog-title").textContent = "تعديل معلومات الزبون";
    $("#dialog-kicker").textContent = `تعديل سجل · ${customer.customer_number || ""}`;
    $("#dialog-save").textContent = "حفظ التعديلات";
    $("#record-dialog").showModal();
  }

  async function renderNewOrderForm() {
    const customers = await customerOptions();
    const branchName = branches.find((branch) => branch.id === activeBranch)?.name || "";
    const customerOptionsMarkup = customers.map((row) =>
      `<option value="${esc(row.id)}">${esc(row.name)}${row.phone ? ` · ${esc(row.phone)}` : ""}</option>`
    ).join("");
    orderItems = [{ description: "", quantity: 1, unit_price: 0 }];
    orderSaving = false;
    currentPage = "orders";
    document.querySelectorAll(".nav-link[data-page]").forEach((item) => item.classList.toggle("active", item.dataset.page === "orders"));
    $("#page-title").textContent = "طلب جديد";
    $("#breadcrumb").textContent = "إدارة العمل";
    $("#page-content").innerHTML = `
      <form id="new-order-form" class="order-form">
        <div class="section-heading">
          <div><h2>طلب جديد</h2><p>أدخل بيانات الزبون وأضف المواد المطلوبة.</p></div>
          <button class="button button-quiet" type="button" data-order-cancel>العودة للطلبات</button>
        </div>
        <section class="order-meta panel">
          <label class="order-number-field">رقم القائمة
            <strong class="order-number">يُنشأ عند الحفظ</strong>
          </label>
          <label>حضرة السيد
            <select name="customer_id" required ${customers.length ? "" : "disabled"}>
              <option value="" selected disabled>${customers.length ? "اختر اسم الزبون..." : "لا يوجد زبائن مسجلون"}</option>
              ${customerOptionsMarkup}
            </select>
            ${customers.length ? "" : '<small class="field-hint">أضف زبوناً من صفحة الزبائن قبل تسجيل الطلب.</small>'}
          </label>
          <label>التاريخ<input name="order_date" type="date" value="${localDateValue()}" required></label>
          <label>مصدر الزبون
            <select name="source">
              ${["فيسبوك", "إنستغرام", "واتساب", "اتصال", "زبون سابق", "إحالة", "آخر"].map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}
            </select>
          </label>
          <span class="order-branch">${esc(branchName)}</span>
        </section>
        <section class="order-items-panel panel" aria-label="مواد الطلب">
          <div class="table-wrap">
            <table class="order-items-table">
              <thead><tr><th>التفاصيل</th><th>العدد</th><th>سعر المفرد</th><th>المبلغ الكلي</th><th><span class="visually-hidden">إجراء</span></th></tr></thead>
              <tbody id="order-items-body"></tbody>
            </table>
          </div>
          <div class="order-items-actions">
            <button class="button button-quiet" type="button" data-add-order-item>＋ إضافة مادة</button>
            <div class="order-total"><span>المبلغ الإجمالي</span><strong id="order-total-value">${formatMoney(0)}</strong></div>
          </div>
        </section>
        <label class="order-notes">ملاحظات<textarea name="notes" rows="3" placeholder="ملاحظات إضافية على الطلب"></textarea></label>
        <div class="order-form-actions">
          <button class="button button-quiet" type="button" data-order-cancel>إلغاء</button>
          <button class="button button-primary" type="submit">حفظ الطلب</button>
        </div>
      </form>`;
    renderOrderItems();
  }

  function renderOrderItems() {
    const body = $("#order-items-body");
    if (!body) return;
    body.innerHTML = orderItems.map((item, index) => `
      <tr>
        <td><input type="text" data-order-item-field="description" data-index="${index}" value="${esc(item.description)}" placeholder="وصف المادة" aria-label="تفاصيل المادة ${index + 1}" required></td>
        <td><input type="number" data-order-item-field="quantity" data-index="${index}" value="${esc(item.quantity)}" min="0.01" step="0.01" aria-label="عدد المادة ${index + 1}" required></td>
        <td><input type="number" data-order-item-field="unit_price" data-index="${index}" value="${esc(item.unit_price)}" min="0" step="1" aria-label="سعر المفرد للمادة ${index + 1}" required></td>
        <td class="order-line-total" id="order-line-total-${index}">${formatMoney(Number(item.quantity || 0) * Number(item.unit_price || 0))}</td>
        <td><button class="icon-button order-remove-item" type="button" data-remove-order-item="${index}" aria-label="حذف المادة ${index + 1}" ${orderItems.length === 1 ? "disabled" : ""}>×</button></td>
      </tr>`).join("");
    updateOrderTotal();
  }

  function updateOrderTotal() {
    const total = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
    const totalElement = $("#order-total-value");
    if (totalElement) totalElement.textContent = formatMoney(total);
    orderItems.forEach((item, index) => {
      const lineElement = $(`#order-line-total-${index}`);
      if (lineElement) lineElement.textContent = formatMoney(Number(item.quantity || 0) * Number(item.unit_price || 0));
    });
  }

  async function saveNewOrder(event) {
    event.preventDefault();
    if (orderSaving) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const items = orderItems.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      total: Number(item.quantity) * Number(item.unit_price)
    }));
    if (!items.length || items.some((item) => !item.description || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      notify("تحقق من تفاصيل المواد والكميات والأسعار.", true);
      return;
    }
    const total = items.reduce((sum, item) => sum + item.total, 0);
    const formData = new FormData(form);
    const orderDate = String(formData.get("order_date"));
    const orderRecord = {
      branch_id: activeBranch,
      customer_id: String(formData.get("customer_id")),
      source: String(formData.get("source") || ""),
      notes: String(formData.get("notes") || "").trim(),
      order_date: orderDate,
      created_at: new Date(`${orderDate}T12:00:00`).toISOString(),
      items,
      total,
      cost_total: 0,
      paid_total: 0,
      remaining: total,
      status: "طلب جديد",
      created_by: profile.id
    };
    orderSaving = true;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      await checkResult(client.from("orders").insert(orderRecord).select().single());
      notify("تم حفظ الطلب بنجاح.");
      await renderPage("orders");
    } catch (error) {
      orderSaving = false;
      submitButton.disabled = false;
      throw error;
    }
  }

  async function saveRecord(event) {
    event.preventDefault();
    const page = $("#record-form").dataset.page;
    const formData = new FormData($("#record-form"));
    const record = Object.fromEntries(formData.entries());
    delete record.undefined;
    if (page !== "customers") record.branch_id = activeBranch;
    if (page === "orders") {
      record.total = Number(record.total);
      record.cost_total = Number(record.cost_total || 0);
      record.paid_total = 0;
      record.status = "طلب جديد";
      record.created_by = profile.id;
    }
    const recordId = $("#record-form").dataset.recordId;
    if (page === "customers" && !recordId) record.created_by = profile.id;
    if (page === "payments") {
      record.amount = Number(record.amount);
      record.paid_by = profile.id;
      record.paid_at = new Date().toISOString();
    }
    if (page === "expenses") {
      record.amount = Number(record.amount);
      record.created_by = profile.id;
    }
    if (page === "inventory") {
      ["quantity", "purchase_price", "sale_price", "minimum_quantity"].forEach((key) => { record[key] = Number(record[key] || 0); });
    }
    const table = tablePages[page].table;
    if (page === "payments") {
      await checkResult(client.rpc("record_payment", { p_order_id: record.order_id, p_amount: record.amount, p_method: record.method, p_notes: record.notes || null, p_paid_by: profile.id }));
    } else if (recordId) {
      const updated = await checkResult(client.from(table).update(record).eq("id", recordId).select().single());
      if (!updated) throw new Error("لم يُعثر على سجل الزبون المطلوب تعديله.");
    } else {
      await checkResult(client.from(table).insert(record).select().single());
    }
    $("#record-dialog").close();
    delete $("#record-form").dataset.recordId;
    notify(recordId ? "تم تعديل معلومات الزبون بنجاح." : "تم حفظ السجل بنجاح.");
    await renderPage(page);
  }

  async function renderReports() {
    const [orders, expenses] = await Promise.all([
      checkResult(client.from("orders").select("total,cost_total,paid_total,status").eq("branch_id", activeBranch).neq("status", "ملغي")),
      checkResult(client.from("expenses").select("amount").eq("branch_id", activeBranch))
    ]);
    const sums = orders.reduce((acc, row) => {
      acc.sales += Number(row.total || 0);
      acc.cost += Number(row.cost_total || 0);
      acc.received += Number(row.paid_total || 0);
      acc.debt += Math.max(0, Number(row.total || 0) - Number(row.paid_total || 0));
      return acc;
    }, { sales: 0, cost: 0, received: 0, debt: 0 });
    const expensesTotal = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const reportCards = [
      ["إجمالي المبيعات", sums.sales], ["إجمالي المقبوضات", sums.received], ["الديون المستحقة", sums.debt],
      ["إجمالي المصاريف", expensesTotal], ["إجمالي التكلفة", sums.cost], ["صافي الربح", sums.sales - sums.cost - expensesTotal]
    ];
    $("#page-content").innerHTML = `    <div class="section-heading"><div><h2>ملخص أداء الفرع</h2><p>الإجماليات من السجلات المسجلة في قاعدة البيانات المشتركة.</p></div></div><div class="stats-grid">${reportCards.map(([label, value]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${iconSvg("report")}</span></div><strong class="stat-value">${formatMoney(value)}</strong><span class="stat-note">من بداية التسجيل</span></article>`).join("")}</div><section class="panel"><div class="panel-header"><h2>حالة الطلبات</h2></div><div class="activity-list">${Object.entries(orders.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {})).map(([name, count]) => `<div class="activity-item"><span class="activity-dot"></span><div><strong>${esc(name)}</strong><small>${money.format(count)} طلب</small></div></div>`).join("") || empty("لا توجد طلبات مسجلة.")}</div></section>`;
  }

  $("#main-nav").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    try { await renderPage(button.dataset.page); }
    catch (error) { notify(`تعذر تحميل الصفحة: ${error.message}`, true); }
  });
  async function changeBranch(event) {
    activeBranch = event.currentTarget.value;
    $("#branch-select").value = activeBranch;
    $("#mobile-branch-select").value = activeBranch;
    try { await renderPage(currentPage); }
    catch (error) { notify(`تعذر تحميل بيانات الفرع: ${error.message}`, true); }
  }
  $("#branch-select").addEventListener("change", changeBranch);
  $("#mobile-branch-select").addEventListener("change", changeBranch);
  $("#page-content").addEventListener("click", async (event) => {
    const statisticsCard = event.target.closest("[data-dashboard-stat]");
    if (statisticsCard) {
      try { openDashboardStatistics(statisticsCard.dataset.dashboardStat); }
      catch (error) { notify(`تعذر عرض الإحصائيات: ${error.message}`, true); }
      return;
    }
    if (event.target.closest("[data-order-cancel]")) {
      try { await renderPage("orders"); }
      catch (error) { notify(`تعذر الرجوع إلى الطلبات: ${error.message}`, true); }
      return;
    }
    if (event.target.closest("[data-add-order-item]")) {
      orderItems.push({ description: "", quantity: 1, unit_price: 0 });
      renderOrderItems();
      $("#order-items-body tr:last-child input")?.focus();
      return;
    }
    const removeItem = event.target.closest("[data-remove-order-item]");
    if (removeItem) {
      orderItems.splice(Number(removeItem.dataset.removeOrderItem), 1);
      renderOrderItems();
      return;
    }
    const cancelButton = event.target.closest("[data-cancel-payment]");
    if (cancelButton) {
      $("#cancel-form").dataset.paymentId = cancelButton.dataset.cancelPayment;
      $("#cancel-dialog").showModal();
      return;
    }
    const editCustomer = event.target.closest("[data-edit-customer]");
    if (editCustomer) {
      try {
        if (!canCreate("customers")) throw new Error("ليس لديك صلاحية لتعديل بيانات الزبائن.");
        const customer = allPageRows.find((row) => row.id === editCustomer.dataset.editCustomer);
        if (!customer) throw new Error("لم يُعثر على سجل الزبون المطلوب تعديله.");
        openCustomerEditDialog(customer);
      } catch (error) { notify(`تعذر فتح نموذج التعديل: ${error.message}`, true); }
      return;
    }
    const deleteCustomer = event.target.closest("[data-delete-customer]");
    if (deleteCustomer) {
      try {
        if (!canCreate("customers")) throw new Error("ليس لديك صلاحية لحذف بيانات الزبائن.");
        const customer = allPageRows.find((row) => row.id === deleteCustomer.dataset.deleteCustomer);
        if (!customer) throw new Error("لم يُعثر على سجل الزبون المطلوب حذفه.");
        const linkedOrders = await checkResult(client.from("orders").select("id").eq("customer_id", customer.id).limit(1));
        if (linkedOrders.length) throw new Error("لا يمكن حذف زبون لديه طلبات مسجلة حفاظاً على سجل الطلبات. يمكنك تعديل بياناته بدلاً من ذلك.");
        if (!window.confirm(`هل أنت متأكد من حذف بيانات الزبون «${customer.name}»؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
        const deleted = await checkResult(client.from("customers").delete().eq("id", customer.id).select().single());
        if (!deleted) throw new Error("لم يُعثر على سجل الزبون المطلوب حذفه.");
        notify("تم حذف بيانات الزبون بنجاح.");
        await renderPage("customers");
      } catch (error) { notify(`تعذر حذف بيانات الزبون: ${error.message}`, true); }
      return;
    }
    const goto = event.target.closest("[data-goto]");
    if (goto) {
      try { await renderPage(goto.dataset.goto); }
      catch (error) { notify(`تعذر تحميل الصفحة: ${error.message}`, true); }
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    try {
      const page = action.dataset.action === "new-order" ? "orders" : currentPage;
      if (!canCreate(page)) throw new Error("ليس لديك صلاحية لإضافة هذا السجل.");
      await openCreateDialog(page);
    } catch (error) { notify(`تعذر فتح النموذج: ${error.message}`, true); }
  });
  $("#page-content").addEventListener("input", (event) => {
    const input = event.target.closest("[data-order-item-field]");
    if (!input) return;
    const index = Number(input.dataset.index);
    const fieldName = input.dataset.orderItemField;
    orderItems[index][fieldName] = fieldName === "description" ? input.value : Number(input.value);
    updateOrderTotal();
  });
  $("#page-content").addEventListener("submit", async (event) => {
    if (event.target.id !== "new-order-form") return;
    try { await saveNewOrder(event); }
    catch (error) { notify(`تعذر حفظ الطلب: ${error.message}`, true); }
  });
  $("#record-form").addEventListener("submit", async (event) => {
    try { await saveRecord(event); }
    catch (error) {
      event.preventDefault();
      notify(`تعذر حفظ السجل: ${error.message}`, true);
    }
  });
  $("#dialog-close").addEventListener("click", () => $("#record-dialog").close());
  $("#dialog-cancel").addEventListener("click", () => $("#record-dialog").close());
  $("#statistics-close").addEventListener("click", () => $("#statistics-dialog").close());
  $("#cancel-close").addEventListener("click", () => $("#cancel-dialog").close());
  $("#cancel-dismiss").addEventListener("click", () => $("#cancel-dialog").close());
  $("#cancel-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const reason = new FormData(form).get("reason");
      await checkResult(client.rpc("cancel_payment", {
        p_payment_id: form.dataset.paymentId,
        p_reason: String(reason).trim()
      }));
      $("#cancel-dialog").close();
      form.reset();
      notify("تم تسجيل إلغاء الدفعة مع سبب الإلغاء.");
      await renderPage("payments");
    } catch (error) {
      notify(`تعذر إلغاء الدفعة: ${error.message}`, true);
    }
  });

  async function boot() {
    try {
      client = window.BardajiLocalStore;
      if (!client) throw new Error("تعذر تحميل وحدة التخزين المحلية.");
      await startSession();
    } catch (error) {
      notify(`تعذر فتح قاعدة البيانات المحلية: ${error.message}`, true);
    }
  }
  boot();
})();
