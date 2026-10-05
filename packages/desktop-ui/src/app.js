(() => {
  "use strict";

  const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
  const subNavs = [...document.querySelectorAll(".sub-nav")];
  const views = [...document.querySelectorAll(".view")];
  const usageLive = document.getElementById("usage-live");
  const sourcingLive = document.getElementById("sourcing-live");

  const activate = (name, group) => {
    for (const item of navItems) {
      item.classList.toggle("is-active", item.dataset.view === name);
    }
    for (const sub of subNavs) {
      sub.classList.toggle("is-open", sub.dataset.group === group);
    }
    for (const view of views) {
      const active = view.id === `view-${name}`;
      view.classList.toggle("is-active", active);
      if (active) view.removeAttribute("hidden");
      else view.setAttribute("hidden", "");
    }
  };

  navItems.forEach((item) => {
    item.addEventListener("click", () => activate(item.dataset.view ?? "today", item.dataset.group ?? "today"));
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (target !== null && target.getAttribute("data-action") === "goto-view") {
      const name = target.getAttribute("data-target") ?? "today";
      const owner = navItems.find(item => item.dataset.view === name);
      activate(name, owner?.dataset.group ?? name);
    }
  });

  const renderUsage = (snapshot) => {
    if (usageLive === null) return;
    const quota = snapshot.quota;
    const used = quota.usedInputTokens + quota.usedOutputTokens;
    const statusLabel = { Active: "正常", SoftLimit: "接近上限", Exhausted: "已用尽", Expired: "已过期" }[quota.status] ?? quota.status;
    usageLive.innerHTML =
      '<h2>配额服务</h2>' +
      '<dl class="usage-facts">' +
      `<div><dt>套餐</dt><dd>${snapshot.plan.name}</dd></div>` +
      `<div><dt>周期</dt><dd>${quota.periodStart} ~ ${quota.periodEnd}</dd></div>` +
      `<div><dt>状态</dt><dd>${statusLabel}</dd></div>` +
      "</dl>" +
      `<progress class="usage-bar" max="${quota.tokenLimit}" value="${used}"></progress>` +
      `<p>${used} / ${quota.tokenLimit} Tokens · ${quota.usedRequests} 次请求 · 生成于 ${snapshot.generatedAt.slice(0, 19).replace("T", " ")}</p>`;
  };

  const refreshUsage = () => {
    if (usageLive === null) return;
    fetch("./data/usage.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then(renderUsage)
      .catch(() => { if (usageLive !== null) usageLive.innerHTML = '<h2>配额服务</h2><p>尚未连接配额服务（需在宿主配置 billing-host）。</p>'; });
  };

  refreshUsage();
  setInterval(refreshUsage, 15_000);

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const statusLabels = {
    candidate: "候选",
    completed: "已完成",
    partially_completed: "部分成功",
    failed: "失败",
    available: "充足",
    low: "偏低",
    out_of_stock: "缺货",
    unknown: "未知",
  };

  const formatMoney = (minor, currency) => new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(minor / 100);
  const formatTime = (value) => value.slice(0, 19).replace("T", " ");

  const renderSourcing = (snapshot) => {
    if (sourcingLive === null) return;
    const itemRows = snapshot.items.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.categoryLabels.join(" / ") || "未分类")}</small></td>
        <td>${formatMoney(item.purchasePriceMinor, item.currency)}</td>
        <td>${item.suggestedRetailPriceMinor === null ? "—" : formatMoney(item.suggestedRetailPriceMinor, item.currency)}</td>
        <td>${escapeHtml(statusLabels[item.stockStatus] ?? item.stockStatus)}</td>
        <td>${item.moq ?? "—"}</td>
        <td>${item.leadTimeDays === null ? "—" : `${item.leadTimeDays} 天`}</td>
        <td><span class="status-pill">${escapeHtml(statusLabels[item.status] ?? item.status)}</span></td>
      </tr>`).join("");
    const batchRows = snapshot.batches.map((batch) => `
      <tr>
        <td>${escapeHtml(batch.fileName)}</td>
        <td><span class="status-pill">${escapeHtml(statusLabels[batch.status] ?? batch.status)}</span></td>
        <td>${batch.validRows} / ${batch.totalRows}</td>
        <td>${batch.failedRows}</td>
        <td>${batch.warningRows}</td>
        <td>${formatTime(batch.createdAt)}</td>
      </tr>`).join("");
    sourcingLive.innerHTML = `
      <div class="overview-strip">
        <article class="status-card"><h2>货盘商品</h2><strong>${snapshot.summary.totalItems}</strong><span>本地最新版本</span></article>
        <article class="status-card"><h2>可选候选</h2><strong>${snapshot.summary.candidateItems}</strong><span>可进入选品</span></article>
        <article class="status-card"><h2>导入批次</h2><strong>${snapshot.summary.batches}</strong><span>已保留版本</span></article>
        <article class="status-card ${snapshot.summary.failedBatches > 0 ? "is-danger" : ""}"><h2>失败批次</h2><strong>${snapshot.summary.failedBatches}</strong><span>需修复后重导</span></article>
      </div>
      <section class="panel">
        <h2>货盘商品</h2>
        ${itemRows === "" ? '<p class="empty-card">还没有货盘商品。把 CSV 放入本地导入目录后自动处理。</p>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>商品</th><th>供货价</th><th>建议零售</th><th>库存</th><th>MOQ</th><th>时效</th><th>状态</th></tr></thead>
            <tbody>${itemRows}</tbody>
          </table></div>`}
      </section>
      <section class="panel">
        <h2>导入记录</h2>
        ${batchRows === "" ? '<p class="empty-card">还没有导入记录。</p>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>文件</th><th>状态</th><th>有效 / 总行</th><th>失败</th><th>警告</th><th>时间</th></tr></thead>
            <tbody>${batchRows}</tbody>
          </table></div>`}
        <p class="context-note">同一文件重复导入会命中指纹并跳过；失败原因报告保留在本地数据目录。</p>
      </section>`;
  };

  const refreshSourcing = () => {
    if (sourcingLive === null) return;
    fetch("./data/sourcing.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then(renderSourcing)
      .catch(() => {
        sourcingLive.innerHTML = '<div class="empty-panel"><h2>还没有货盘数据</h2><p>本地导入服务尚未生成快照。配置导入目录后，把 CSV 放入根目录。</p></div>';
      });
  };

  refreshSourcing();
  setInterval(refreshSourcing, 15_000);
})();
