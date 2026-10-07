(() => {
  "use strict";

  const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
  const subNavs = [...document.querySelectorAll(".sub-nav")];
  const views = [...document.querySelectorAll(".view")];
  const usageLive = document.getElementById("usage-live");
  const sourcingLive = document.getElementById("sourcing-live");
  const selectionLive = document.getElementById("selection-live");
  const selectionNotice = document.getElementById("selection-notice");
  const productsLive = document.getElementById("products-live");
  let currentSnapshot = null;

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
    selected: "已通过",
    rejected: "已淘汰",
    archived: "已归档",
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

  const setSelectionNotice = (message, kind = "") => {
    if (selectionNotice === null) return;
    selectionNotice.textContent = message;
    selectionNotice.className = `notice${kind === "" ? "" : ` is-${kind}`}`;
  };

  const selectionRows = () => {
    if (currentSnapshot === null) return [];
    const numberValue = (id) => {
      const element = document.getElementById(id);
      const value = element instanceof HTMLInputElement ? element.value.trim() : "";
      return value === "" ? null : Number(value);
    };
    const category = document.getElementById("filter-category") instanceof HTMLInputElement
      ? document.getElementById("filter-category").value.trim().toLowerCase()
      : "";
    const priceMin = numberValue("filter-price-min");
    const priceMax = numberValue("filter-price-max");
    const minMargin = numberValue("filter-margin");
    const maxMoq = numberValue("filter-moq");
    const maxLeadTime = numberValue("filter-lead-time");
    return currentSnapshot.items.filter((item) => {
      if (item.status !== "candidate" && item.status !== "selected") return false;
      if (category !== "" && !item.categoryLabels.some((label) => label.toLowerCase().includes(category))) return false;
      const cost = item.purchasePriceMinor / 100;
      if (priceMin !== null && cost < priceMin) return false;
      if (priceMax !== null && cost > priceMax) return false;
      if (minMargin !== null) {
        if (item.suggestedRetailPriceMinor === null) return false;
        const retail = item.suggestedRetailPriceMinor / 100;
        if (((retail - cost) / retail) * 100 < minMargin) return false;
      }
      if (maxMoq !== null && item.moq !== null && item.moq > maxMoq) return false;
      if (maxLeadTime !== null && item.leadTimeDays !== null && item.leadTimeDays > maxLeadTime) return false;
      return true;
    });
  };

  const renderSelection = () => {
    if (selectionLive === null) return;
    const rows = selectionRows();
    const rowHtml = rows.map((item) => {
      const retail = item.suggestedRetailPriceMinor;
      const margin = retail === null ? "—" : `${(((retail - item.purchasePriceMinor) / retail) * 100).toFixed(1)}%`;
      let aiSuggestion = "";
      if (item.decisionBy === "ai" && typeof item.scoresJson === "string" && item.scoresJson !== "") {
        try {
          const scores = JSON.parse(item.scoresJson);
          if (scores.recommendation === "observe") {
            aiSuggestion = `<div class="ai-suggestion"><strong>AI ${scores.score}</strong><span>${escapeHtml(scores.summary)}</span>${(scores.risks || []).map((risk) => `<em>${escapeHtml(risk)}</em>`).join("")}</div>`;
          }
        } catch { /* malformed historical suggestions remain hidden from actions */ }
      }
      const reasonInput = '<input class="decision-reason" type="text" placeholder="理由必填" aria-label="选品理由">';
      let actions = "";
      if (item.status === "candidate") {
        actions = `
          <div class="decision-form">${reasonInput}
            <button type="button" data-selection-action="approve" data-id="${escapeHtml(item.id)}">通过</button>
            <button type="button" data-selection-action="reject" data-id="${escapeHtml(item.id)}">淘汰</button>
            <button type="button" data-selection-action="observe" data-id="${escapeHtml(item.id)}">观察</button>
          </div>`;
      } else if (item.productCreated) {
        actions = '<span class="status-pill">已创建商品</span>';
      } else {
        actions = `
          <div class="decision-form">${reasonInput}
            <button type="button" data-selection-action="create" data-id="${escapeHtml(item.id)}">创建商品</button>
            <button type="button" data-selection-action="reopen" data-id="${escapeHtml(item.id)}">重开</button>
          </div>`;
      }
      return `
        <tr>
          <td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.categoryLabels.join(" / ") || "未分类")}</small></td>
          <td>${formatMoney(item.purchasePriceMinor, item.currency)}</td>
          <td>${retail === null ? "—" : formatMoney(retail, item.currency)}</td>
          <td>${margin}</td>
          <td>${item.moq ?? "—"}</td>
          <td>${item.leadTimeDays === null ? "—" : `${item.leadTimeDays} 天`}</td>
          <td><span class="status-pill">${escapeHtml(statusLabels[item.status] ?? item.status)}</span></td>
          <td>${actions}</td>
          <td>${aiSuggestion}</td>
        </tr>`;
    }).join("");
    selectionLive.innerHTML = `
      <section class="panel">
        <h2>候选与决策</h2>
        ${rowHtml === "" ? '<div class="empty-card">当前筛选条件下没有可选货盘。</div>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>商品</th><th>供货价</th><th>建议零售</th><th>毛利</th><th>MOQ</th><th>时效</th><th>状态</th><th>选品动作</th><th>AI 参考</th></tr></thead>
            <tbody>${rowHtml}</tbody>
          </table></div>`}
        <p class="context-note">所有决策都会保留理由、旧决策替换记录和审计；通过后可创建商品并双写成本基准。</p>
      </section>`;
  };

  const renderProducts = () => {
    if (productsLive === null || currentSnapshot === null) return;
    const rows = currentSnapshot.products.map((product) => `
      <tr>
        <td><strong>${escapeHtml(product.title)}</strong><small>商品 ID：${escapeHtml(product.id)}</small></td>
        <td>${product.purchasePriceMinor === null ? "—" : formatMoney(product.purchasePriceMinor, product.currency)}</td>
        <td><span class="status-pill">${escapeHtml(product.status)}</span></td>
        <td>${escapeHtml(product.riskStatus)}</td>
        <td><small>货盘：${escapeHtml(product.sourcingItemId ?? "—")}<br>决策：${escapeHtml(product.createdFromSelectionId ?? "—")}</small></td>
        <td>${formatTime(product.createdAt)}</td>
      </tr>`).join("");
    productsLive.innerHTML = `
      <section class="panel">
        <h2>经营商品</h2>
        ${rows === "" ? '<div class="empty-card">还没有商品。选品通过后可一键创建。</div>' : `
          <div class="table-wrap"><table>
            <thead><tr><th>商品</th><th>成本基准</th><th>状态</th><th>风险</th><th>选品追溯</th><th>创建时间</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`}
      </section>`;
  };

  const postProductCommand = async (path, body) => {
    const commands = currentSnapshot?.commands;
    if (commands === undefined) throw new Error("选品命令服务尚未就绪");
    const response = await fetch(`${commands.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${commands.token}` },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `命令失败（${response.status}）`);
    return payload;
  };

  const runSelectionAction = async (button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const action = button.getAttribute("data-selection-action");
    const itemId = button.getAttribute("data-id");
    if (action === null || itemId === null) return;
    const row = button.closest("tr");
    const reasonInput = row instanceof HTMLTableRowElement ? row.querySelector(".decision-reason") : null;
    const reason = reasonInput instanceof HTMLInputElement ? reasonInput.value.trim() : "";
    const needsReason = action !== "create";
    if (needsReason && reason === "") {
      setSelectionNotice("请先填写选品理由。", "error");
      return;
    }
    const decisionValues = { approve: "approved", reject: "rejected", observe: "observing" };
    button.disabled = true;
    setSelectionNotice("正在保存决策…");
    try {
      if (action === "create") {
        await postProductCommand("/products/from-selection", { sourcingItemId: itemId });
        setSelectionNotice("商品已创建。", "success");
      } else if (action === "reopen") {
        await postProductCommand("/selection/reopen", { sourcingItemId: itemId, reason });
        setSelectionNotice("选品已重开为候选。", "success");
      } else {
        await postProductCommand("/selection/decisions", { sourcingItemId: itemId, decision: decisionValues[action], reason });
        setSelectionNotice("选品决策已保存。", "success");
      }
      await refreshSourcing();
    } catch (error) {
      setSelectionNotice(error instanceof Error ? error.message : "命令执行失败。", "error");
      button.disabled = false;
    }
  };

  const applyFilterButton = document.getElementById("apply-filters");
  const resetFilterButton = document.getElementById("reset-filters");
  if (applyFilterButton !== null) applyFilterButton.addEventListener("click", renderSelection);
  if (resetFilterButton !== null) {
    resetFilterButton.addEventListener("click", () => {
      for (const id of ["filter-category", "filter-price-min", "filter-price-max", "filter-margin", "filter-moq", "filter-lead-time"]) {
        const input = document.getElementById(id);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      renderSelection();
    });
  }
  if (selectionLive !== null) {
    selectionLive.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-selection-action]") : null;
      if (target !== null) void runSelectionAction(target);
    });
  }

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
    renderSelection();
    renderProducts();
    renderStores(snapshot.platform);
  };

  const storeConnection = document.getElementById("store-connection");
  const storeCapabilities = document.getElementById("store-capabilities");
  const storeNotice = document.getElementById("store-notice");
  const setStoreNotice = (message, kind) => {
    if (storeNotice === null) return;
    storeNotice.textContent = message;
    storeNotice.classList.toggle("is-error", kind === "error");
  };

  const capabilityLabels = {
    "store.read": "店铺信息",
    "category.read": "类目读取",
    "attribute.read": "属性读取",
    "listing.create": "上架提交",
    "listing.status.read": "上架状态",
    "order.read": "订单读取",
    "fulfillment.read": "履约读取",
    "settlement.read": "结算读取",
  };

  const renderStores = (platform) => {
    if (storeConnection === null || platform === undefined || platform === null) return;
    const connections = platform.connections ?? [];
    const stores = platform.stores ?? [];
    storeConnection.innerHTML = (connections.length === 0
      ? '<p class="empty-card">还没有连接店铺。</p>'
      : connections.map((connection) => `
          <dl class="usage-facts">
            <div><dt>连接</dt><dd>${escapeHtml(connection.id.slice(0, 8))}…</dd></div>
            <div><dt>授权状态</dt><dd>${escapeHtml(statusLabels[connection.status] ?? connection.status)}</dd></div>
            <div><dt>最近验证</dt><dd>${formatTime(connection.lastVerifiedAt)}</dd></div>
          </dl>`).join(""))
      + stores.map((store) => `
          <dl class="usage-facts">
            <div><dt>店铺</dt><dd>${escapeHtml(store.name)}</dd></div>
            <div><dt>模式</dt><dd>${escapeHtml(store.businessMode)}</dd></div>
            <div><dt>地区 / 币种</dt><dd>${escapeHtml(store.region)} · ${escapeHtml(store.currency)}</dd></div>
            <div><dt>店铺状态</dt><dd>${escapeHtml(statusLabels[store.status] ?? store.status)}</dd></div>
          </dl>`).join("");
    if (storeCapabilities !== null) {
      const capabilityRows = stores.flatMap((store) => store.capabilities).map((capability) => `
        <li><span>${escapeHtml(capabilityLabels[capability.capabilityKey] ?? capability.capabilityKey)}</span>
        <em>${escapeHtml(statusLabels[capability.status] ?? capability.status)} · ${escapeHtml(capability.mode)}</em></li>`);
      storeCapabilities.innerHTML = capabilityRows.length === 0
        ? '<li><span>连接后探测</span><em>—</em></li>'
        : capabilityRows.join("");
    }
  };

  const runStoreAction = async (action) => {
    const commands = currentSnapshot?.commands;
    if (commands === undefined) {
      setStoreNotice("命令服务尚未就绪。", "error");
      return;
    }
    setStoreNotice("正在执行…");
    try {
      if (action === "connect") {
        const start = await postProductCommand("/platform/connections/start", {});
        await postProductCommand("/platform/connections/callback", {
          connectionId: start.connectionId, state: start.state, approved: true,
        });
        setStoreNotice("店铺已连接（Mock 授权）。", "success");
      } else {
        const connectionId = currentSnapshot?.platform?.connections?.[0]?.id;
        if (connectionId === undefined) {
          setStoreNotice("还没有可操作的连接。", "error");
          return;
        }
        if (action === "expire") {
          await postProductCommand("/platform/connections/expire", { connectionId });
          setStoreNotice("已模拟凭证过期，请点验证同步状态。", "success");
        } else {
          const health = await postProductCommand(`/platform/connections/${action}`, { connectionId });
          setStoreNotice(`已${action === "verify" ? "验证" : "断开"}：${health.connectionStatus}。`, "success");
        }
      }
      await refreshSourcing();
    } catch (error) {
      setStoreNotice(error instanceof Error ? error.message : "命令执行失败。", "error");
    }
  };

  for (const [buttonId, action] of [
    ["store-connect", "connect"],
    ["store-verify", "verify"],
    ["store-expire", "expire"],
    ["store-disconnect", "disconnect"],
  ]) {
    const button = document.getElementById(buttonId);
    if (button !== null) button.addEventListener("click", () => { void runStoreAction(action); });
  }

  const refreshSourcing = () => {
    if (sourcingLive === null) return;
    fetch("./data/sourcing.json", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
      .then((snapshot) => {
        currentSnapshot = snapshot;
        renderSourcing(snapshot);
      })
      .catch(() => {
        sourcingLive.innerHTML = '<div class="empty-panel"><h2>还没有货盘数据</h2><p>本地导入服务尚未生成快照。配置导入目录后，把 CSV 放入根目录。</p></div>';
      });
  };

  refreshSourcing();
  setInterval(refreshSourcing, 15_000);
})();
