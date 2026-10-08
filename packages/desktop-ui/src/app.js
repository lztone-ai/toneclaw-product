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
  const listingsLive = document.getElementById("listing-live");
  const listingProduct = document.getElementById("listing-product");
  const listingNotice = document.getElementById("listing-notice");
  const publishLive = document.getElementById("publish-live");
  const publishNotice = document.getElementById("publish-notice");
  const ordersLive = document.getElementById("orders-live");
  const ordersNotice = document.getElementById("orders-notice");
  const fulfillmentsLive = document.getElementById("fulfillments-live");
  const fulfillmentsNotice = document.getElementById("fulfillments-notice");
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
    created: "已创建", quote_pending: "待报价", quote_confirmed: "报价确认",
    awaiting_payment: "待付款", payment_confirmed: "付款确认", provider_preparing: "备货中",
    shipped: "已发货", in_transit: "运输中", delivered: "已送达",
    payment_failed: "付款失败", payment_expired: "付款过期", refund_requested: "退款中",
    refunded: "已退款", canceled: "已取消", redirected: "已跳转", paid_confirmed: "已确认",
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

  const listingStatusLabels = {
    draft: "草稿",
    ready_for_validation: "待校验",
    validated: "校验通过",
    waiting_approval: "待审批",
    approved: "已批准",
    published_snapshot: "已提交发布",
    archived: "已归档",
  };
  const listingContentLabels = { title: "标题", description: "描述", bullets: "卖点", keywords: "关键词" };
  const mediaStatusLabels = { imported: "已导入", ready: "可用", blocked: "已阻断", restricted: "受限" };

  const setListingNotice = (message, kind = "") => {
    if (listingNotice === null) return;
    listingNotice.textContent = message;
    listingNotice.className = `notice${kind === "" ? "" : ` is-${kind}`}`;
  };

  const setPublishNotice = (message, kind = "") => {
    if (publishNotice === null) return;
    publishNotice.textContent = message;
    publishNotice.className = `notice${kind === "" ? "" : ` is-${kind}`}`;
  };

  const setOrdersNotice = (message, kind = "") => {
    if (ordersNotice === null) return;
    ordersNotice.textContent = message;
    ordersNotice.className = `notice${kind === "" ? "" : ` is-${kind}`}`;
  };

  const setFulfillmentsNotice = (message, kind = "") => {
    if (fulfillmentsNotice === null) return;
    fulfillmentsNotice.textContent = message;
    fulfillmentsNotice.className = `notice${kind === "" ? "" : ` is-${kind}`}`;
  };

  const renderListings = (snapshot) => {
    if (listingsLive === null) return;
    const products = snapshot.products ?? [];
    if (listingProduct !== null) {
      const selected = listingProduct.value;
      listingProduct.innerHTML = ['<option value="">选择商品</option>']
        .concat(products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.title)}</option>`))
        .join("");
      if (products.some((product) => product.id === selected)) listingProduct.value = selected;
    }

    const rows = (snapshot.listings ?? []).map((listing) => {
      const product = products.find((candidate) => candidate.id === listing.productId);
      const pkg = (snapshot.manualPackages ?? []).find((candidate) => candidate.listingDraftId === listing.id);
      const task = (snapshot.approvalTasks ?? []).find((candidate) =>
        candidate.targetType === "ListingDraft" && candidate.targetId === listing.id);
      const variants = (snapshot.draftVariants ?? []).filter((candidate) => candidate.listingDraftId === listing.id);
      const contents = (snapshot.contentDrafts ?? []).filter((candidate) => candidate.productId === listing.productId);
      const media = (snapshot.mediaVariants ?? []).filter((candidate) => listing.mediaVariantIds.includes(candidate.id))
        .map((variant) => ({ variant, asset: (snapshot.mediaAssets ?? []).find((asset) => asset.id === variant.mediaAssetId) }));
      const contentHtml = contents.map((content) => `
        <div><dt>${escapeHtml(listingContentLabels[content.contentType] ?? content.contentType)}</dt>
        <dd>v${content.version} · ${escapeHtml(listingStatusLabels[content.status] ?? content.status)}</dd></div>`).join("");
      const mediaHtml = media.map(({ variant, asset }) => `
        <div><dt>${escapeHtml(variant.purpose)} · ${escapeHtml(variant.specKey)}</dt>
        <dd>${escapeHtml(mediaStatusLabels[asset?.rightsStatus ?? asset?.status] ?? asset?.status ?? variant.status)}
        ${listing.status === "draft" && asset ? ` <button type="button" data-media-action="own" data-id="${escapeHtml(asset.id)}">标记自有</button>` : ""}
        </dd></div>`).join("");
      const findings = (listing.validationResult ?? []).map((finding) =>
        `<em>${escapeHtml(finding.message)}</em>`).join("");
      const material = listing.attributes.find((attribute) => attribute.key === "material");

      let governance = "";
      if (listing.status === "draft") {
        governance = `
          <div class="filter-grid">
            <label>平台标题<input data-listing-field="title" data-id="${escapeHtml(listing.id)}" value="${escapeHtml(listing.title)}"></label>
            <label>平台类目<input data-listing-field="category" data-id="${escapeHtml(listing.id)}" value="${escapeHtml(listing.platformCategoryId)}"></label>
            <label>售价（分）<input data-listing-field="price" data-id="${escapeHtml(listing.id)}" type="number" min="1" value="${listing.priceMinor}"></label>
            <label>库存<input data-listing-field="stock" data-id="${escapeHtml(listing.id)}" type="number" min="0" value="${listing.stockQty}"></label>
            <label>材质<input data-listing-field="material" data-id="${escapeHtml(listing.id)}" value="${escapeHtml(material?.value ?? "")}"></label>
          </div>
          <label class="filter-panel">平台描述<textarea data-listing-field="description" data-id="${escapeHtml(listing.id)}" rows="4">${escapeHtml(listing.description)}</textarea></label>
          <div class="actions">
            <button type="button" data-listing-action="edit" data-id="${escapeHtml(listing.id)}">保存草稿</button>
            <button type="button" data-listing-action="adopt" data-id="${escapeHtml(listing.id)}">采纳内容</button>
            <button type="button" data-listing-action="validate" data-id="${escapeHtml(listing.id)}">校验草稿</button>
          </div>`;
      } else if (listing.status === "validated") {
        governance = '<div class="actions"><button type="button" data-listing-action="submit-approval" data-id="' + escapeHtml(listing.id) + '">提交审批</button></div>';
      } else if (listing.status === "waiting_approval") {
        governance = `
          <label>审批原因<input data-listing-field="reason" data-id="${escapeHtml(listing.id)}" value="内容快照与平台资料已确认"></label>
          <div class="actions">
            <button type="button" data-listing-action="approve" data-id="${escapeHtml(listing.id)}">批准</button>
            <button type="button" data-listing-action="reject" data-id="${escapeHtml(listing.id)}">拒绝</button>
          </div>
          <p class="context-note">${escapeHtml(task?.reason ?? "")}</p>`;
      } else if (listing.status === "approved") {
        const confirmation = (snapshot.approvalTasks ?? []).find((task) => task.targetId === listing.id &&
          task.taskType === "publish_confirmation" && task.status === "pending");
        const job = (snapshot.publishJobs ?? []).find((candidate) => candidate.listingDraftId === listing.id);
        if (confirmation !== undefined) {
          governance = `
            <label>发布确认原因<input data-listing-field="publish-reason" data-id="${escapeHtml(listing.id)}" value="已批准快照与人工资料一致"></label>
            <div class="actions">
              <button type="button" data-listing-action="publish-approve" data-id="${escapeHtml(listing.id)}">确认发布</button>
              <button type="button" data-listing-action="publish-reject" data-id="${escapeHtml(listing.id)}">拒绝发布</button>
            </div>`;
        } else if (job === undefined) {
          governance = '<div class="actions"><button type="button" data-listing-action="submit-publish" data-id="' + escapeHtml(listing.id) + '">提交发布确认</button></div>';
        } else if (job !== undefined && job.status === "running") {
          governance = '<p class="context-note">正在自动提交平台 Listing。</p>';
        } else {
          governance = '<p class="context-note">发布任务已完成，可在发布中心查看平台 Listing。</p>';
        }
      }

      return `
        <article class="panel">
          <h2>${escapeHtml(listing.title)}</h2>
          <dl class="usage-facts">
            <div><dt>状态</dt><dd>${escapeHtml(listingStatusLabels[listing.status] ?? listing.status)}</dd></div>
            <div><dt>商品</dt><dd>${escapeHtml(product?.title ?? listing.productId)}</dd></div>
            <div><dt>Offer</dt><dd>${variants.map((variant) => escapeHtml(variant.platformVariantKey)).join(" · ") || "—"}</dd></div>
            <div><dt>售价 / 库存</dt><dd>${formatMoney(listing.priceMinor, listing.currency)} · ${listing.stockQty}</dd></div>
            <div><dt>类目</dt><dd>${escapeHtml(listing.platformCategoryId)}</dd></div>
          </dl>
          <dl class="usage-facts">${contentHtml}${mediaHtml}</dl>
          ${governance}
          ${pkg ? `<p class="context-note">人工上架包：${escapeHtml(pkg.fileRef)}</p>` : ""}
          ${findings ? `<div class="ai-suggestion">${findings}</div>` : ""}
        </article>`;
    }).join("");

    listingsLive.innerHTML = `
      <section class="panel">
        <h2>Listing 治理</h2>
        ${rows === "" ? '<div class="empty-card">还没有 Listing 草稿。选择商品后点击生成草稿。</div>' : rows}
      </section>`;
  };

  const readListingEdits = (listingDraftId) => {
    const value = (name) => document.querySelector(`[data-listing-field="${name}"][data-id="${CSS.escape(listingDraftId)}"]`)?.value ?? "";
    const material = value("material").trim();
    const attributes = material === "" ? [] : [{ key: "material", value: material, valueType: "string" }];
    return {
      listingDraftId,
      title: value("title"),
      description: value("description"),
      platformCategoryId: value("category"),
      attributes,
      priceMinor: Number(value("price")),
      stockQty: Number(value("stock")),
    };
  };

  const runListingAction = async (action, listingDraftId) => {
    const commands = currentSnapshot?.commands;
    if (commands === undefined) {
      setListingNotice("命令服务尚未就绪。", "error");
      return;
    }
    setListingNotice("正在执行…");
    try {
      if (action === "generate") {
        const productId = listingProduct instanceof HTMLSelectElement ? listingProduct.value : "";
        if (productId === "") {
          setListingNotice("请先选择商品。", "error");
          return;
        }
        await postProductCommand("/listings/generate", { productId });
        setListingNotice("Listing 草稿已生成，请编辑并采纳内容。", "success");
      } else if (action === "edit") {
        const input = readListingEdits(listingDraftId);
        if (!Number.isInteger(input.priceMinor) || input.priceMinor <= 0) throw new Error("售价必须大于零");
        if (!Number.isInteger(input.stockQty) || input.stockQty < 0) throw new Error("库存不能为负数");
        await postProductCommand("/listings/edit", input);
        setListingNotice("草稿已保存，旧评估已标记待更新。", "success");
      } else if (action === "adopt") {
        await postProductCommand("/listings/content/adopt", { listingDraftId });
        setListingNotice("内容已采纳并同步到提交快照。", "success");
      } else if (action === "validate") {
        const result = await postProductCommand("/listings/validate", { listingDraftId });
        setListingNotice(result.status === "validated" ? "校验通过，可提交审批。" : "校验未通过，请查看原因。", result.status === "validated" ? "success" : "error");
      } else if (action === "submit-approval") {
        await postProductCommand("/listings/approval/submit", { listingDraftId });
        setListingNotice("已提交人工审批。", "success");
      } else if (action === "approve" || action === "reject") {
        const reasonInput = document.querySelector(`[data-listing-field="reason"][data-id="${CSS.escape(listingDraftId)}"]`);
        const reason = reasonInput?.value.trim() || "";
        if (reason === "") throw new Error("请填写审批原因");
        await postProductCommand("/listings/approval/decide", {
          listingDraftId, decision: action === "approve" ? "approved" : "rejected", reason,
        });
        setListingNotice(action === "approve" ? "Listing 已批准。" : "Listing 已拒绝并退回草稿。", "success");
      } else if (action === "package") {
        const result = await postProductCommand("/listings/manual-package/generate", { listingDraftId });
        setListingNotice(`人工上架包已生成：${result.fileRef}`, "success");
      } else if (action === "submit-publish") {
        await postProductCommand("/listings/publish-confirmation/submit", { listingDraftId });
        setListingNotice("已提交发布确认。", "success");
      } else if (action === "publish-approve" || action === "publish-reject") {
        const reason = document.querySelector(`[data-listing-field="publish-reason"][data-id="${CSS.escape(listingDraftId)}"]`)?.value.trim() || "";
        if (reason === "") throw new Error("请填写发布确认原因");
        await postProductCommand("/listings/publish-confirmation/decide", {
          listingDraftId, decision: action === "publish-approve" ? "approved" : "rejected", reason,
        });
        setListingNotice("发布确认已通过，Listing 已自动提交上架。", "success");
      }
      await refreshSourcing();
    } catch (error) {
      setListingNotice(error instanceof Error ? error.message : "Listing 操作失败。", "error");
    }
  };

  const runMediaAction = async (action, mediaAssetId) => {
    try {
      if (action === "own") {
        await postProductCommand("/media/assets/update", { mediaAssetId, rightsStatus: "owned", status: "ready" });
        setListingNotice("媒体版权已标记为自有。", "success");
        await refreshSourcing();
      }
    } catch (error) {
      setListingNotice(error instanceof Error ? error.message : "媒体治理失败。", "error");
    }
  };

  const renderPublishJobs = (snapshot) => {
    if (publishLive === null) return;
    const packages = snapshot.manualPackages ?? [];
    const listings = snapshot.listings ?? [];
    const rows = (snapshot.publishJobs ?? []).map((job) => {
      const listing = listings.find((candidate) => candidate.id === job.listingDraftId);
      const pkg = packages.find((candidate) => candidate.id === job.manualPackageId);
      let action = "";
      if (job.status === "queued" && pkg !== undefined) {
        action = `<button type="button" data-publish-action="manual" data-id="${escapeHtml(job.id)}" data-package-id="${escapeHtml(pkg.id)}">转人工上架</button>`;
      } else if (job.status === "needs_manual_action" && pkg !== undefined && pkg.status === "submitted_manually") {
        action = `
          <div class="filter-grid">
            <label>平台 Listing ID<input data-publish-field="external-id" data-id="${escapeHtml(job.id)}"></label>
            <label>核心状态<select data-publish-field="core-status" data-id="${escapeHtml(job.id)}"><option value="submitted">已提交</option><option value="platform_review">审核中</option><option value="live">在售</option><option value="rejected">驳回</option><option value="inactive">下架</option></select></label>
            <label>原始状态<input data-publish-field="raw-status" data-id="${escapeHtml(job.id)}"></label>
          </div>
          <button type="button" data-publish-action="import" data-id="${escapeHtml(job.id)}" data-package-id="${escapeHtml(pkg.id)}">导入结果</button>`;
      } else if (job.status === "needs_manual_action" && pkg?.status === "generated") {
        action = `<button type="button" data-publish-action="submit-package" data-id="${escapeHtml(job.id)}" data-package-id="${escapeHtml(pkg.id)}">已人工提交</button>`;
      }
      return `<article class="panel"><h2>${escapeHtml(listing?.title ?? job.listingDraftId)}</h2>
        <dl class="usage-facts"><div><dt>状态</dt><dd>${escapeHtml(job.status)}</dd></div>
        <div><dt>下一步</dt><dd>${escapeHtml(job.nextAction ?? "—")}</dd></div>
        <div><dt>人工包</dt><dd>${escapeHtml(pkg?.fileRef ?? "—")}</dd></div></dl>
        <div class="actions">${action}</div></article>`;
    }).join("");
    const platformRows = (snapshot.platformListings ?? []).map((listing) => `
      <tr><td>${escapeHtml(listing.externalListingId)}</td><td>${escapeHtml(listing.coreStatus)}</td>
      <td>${escapeHtml(listing.rawStatus)}</td><td>${formatMoney(listing.priceMinor, listing.currency)}</td></tr>`).join("");
    publishLive.innerHTML = `<section class="panel"><h2>发布任务</h2>${rows || '<div class="empty-card">还没有发布任务。</div>'}</section>
      <section class="panel"><h2>平台 Listing</h2>${platformRows ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>状态</th><th>原始状态</th><th>价格</th></tr></thead><tbody>${platformRows}</tbody></table></div>` : '<div class="empty-card">还没有平台 Listing。</div>'}</section>`;
  };

  const runPublishAction = async (action, publishJobId, packageId) => {
    try {
      if (action === "manual") {
        await postProductCommand("/listings/publish/manual-fallback", {
          publishJobId, manualPackageId: packageId, reason: "listing.create unavailable; use manual export/import",
        });
      } else if (action === "submit-package") {
        await postProductCommand("/listings/manual-package/submit", { manualPackageId: packageId });
      } else if (action === "import") {
        const value = (name) => document.querySelector(`[data-publish-field="${name}"][data-id="${CSS.escape(publishJobId)}"]`)?.value ?? "";
        await postProductCommand("/listings/manual-result/import", {
          manualPackageId: packageId, externalListingId: value("external-id"),
          coreStatus: value("core-status"), rawStatus: value("raw-status") || value("core-status"),
        });
      }
      setPublishNotice("发布状态已更新。", "success");
      await refreshSourcing();
    } catch (error) {
      setPublishNotice(error instanceof Error ? error.message : "发布操作失败。", "error");
    }
  };

  const renderOrders = (snapshot) => {
    if (ordersLive === null) return;
    const commerce = snapshot.commerce ?? {};
    const rows = (commerce.orders ?? []).map((order) => {
      const itemCount = (commerce.orderItems ?? []).filter((item) => item.orderId === order.id).length;
      return `<tr>
        <td><strong>${escapeHtml(order.orderNumber)}</strong><small>${escapeHtml(order.externalOrderId)} · ${itemCount} 项</small></td>
        <td><span class="status-pill">${escapeHtml(statusLabels[order.status] ?? order.status)}</span></td>
        <td>${formatMoney(order.totalMinor, order.currency)}</td>
        <td>${formatTime(order.placedAt)}</td>
      </tr>`;
    }).join("");
    ordersLive.innerHTML = `<section class="panel"><h2>订单状态</h2>
      ${rows === "" ? '<div class="empty-card">还没有订单。连接店铺后可人工导入。</div>' : `<div class="table-wrap"><table>
        <thead><tr><th>订单</th><th>状态</th><th>金额</th><th>下单时间</th></tr></thead><tbody>${rows}</tbody></table></div>`}
    </section>`;
  };

  const renderFulfillments = (snapshot) => {
    if (fulfillmentsLive === null) return;
    const commerce = snapshot.commerce ?? {};
    const orders = commerce.orders ?? [];
    const orderSelect = document.getElementById("procurement-order");
    if (orderSelect instanceof HTMLSelectElement) {
      const selected = orderSelect.value;
      orderSelect.innerHTML = ['<option value="">选择订单</option>']
        .concat(orders.map((order) => `<option value="${escapeHtml(order.id)}">${escapeHtml(order.orderNumber)} · ${escapeHtml(order.externalOrderId)}</option>`))
        .join("");
      if (orders.some((order) => order.id === selected)) orderSelect.value = selected;
    }

    const cards = (commerce.procurementOrders ?? []).map((order) => {
      const payment = (commerce.payments ?? [])
        .filter((candidate) => candidate.procurementOrderId === order.id)
        .at(-1);
      let action = "";
      if (order.status === "quote_pending") {
        action = `<button type="button" data-procurement-action="quote" data-id="${escapeHtml(order.id)}">确认报价</button>`;
      } else if (order.status === "quote_confirmed") {
        action = `<button type="button" data-procurement-action="pay" data-id="${escapeHtml(order.id)}">创建并跳转付款</button>`;
      } else if (order.status === "awaiting_payment" && payment?.status === "redirected") {
        action = `<button type="button" data-procurement-action="confirm-payment" data-id="${escapeHtml(order.id)}">确认已收款</button>`;
      } else if (order.status === "payment_confirmed") {
        action = `<button type="button" data-procurement-action="prepare" data-id="${escapeHtml(order.id)}">货盘方备货</button>`;
      } else if (order.status === "provider_preparing") {
        action = `
          <div class="filter-grid">
            <label>物流商<input data-procurement-field="carrier" data-id="${escapeHtml(order.id)}"></label>
            <label>运单号<input data-procurement-field="tracking" data-id="${escapeHtml(order.id)}"></label>
          </div>
          <button type="button" data-procurement-action="ship" data-id="${escapeHtml(order.id)}">发货</button>`;
      } else if (order.status === "shipped" || order.status === "in_transit") {
        action = `
          <button type="button" data-procurement-action="deliver" data-id="${escapeHtml(order.id)}">确认送达</button>
          <button type="button" data-procurement-action="refund" data-id="${escapeHtml(order.id)}">申请退款</button>`;
      } else if (order.status === "refund_requested") {
        action = `<button type="button" data-procurement-action="refund-complete" data-id="${escapeHtml(order.id)}">确认退款完成</button>`;
      }
      return `<article class="panel"><h2>采购 ${escapeHtml(order.id.slice(0, 8))}</h2>
        <dl class="usage-facts">
          <div><dt>平台订单</dt><dd>${escapeHtml(order.marketplaceOrderId)}</dd></div>
          <div><dt>状态</dt><dd>${escapeHtml(statusLabels[order.status] ?? order.status)}</dd></div>
          <div><dt>应付</dt><dd>${formatMoney(order.totalPayableMinor, order.currency)}</dd></div>
          <div><dt>支付</dt><dd>${escapeHtml(payment ? (statusLabels[payment.status] ?? payment.status) : "—")}</dd></div>
          <div><dt>运单</dt><dd>${escapeHtml(order.trackingNumber ?? "—")}</dd></div>
        </dl><div class="actions">${action}</div></article>`;
    }).join("");
    fulfillmentsLive.innerHTML = cards || '<section class="panel"><h2>采购履约</h2><div class="empty-card">还没有采购履约记录。</div></section>';
  };

  const generateButton = document.getElementById("listing-generate");
  if (generateButton !== null) {
    generateButton.addEventListener("click", () => { void runListingAction("generate", ""); });
  }
  if (listingsLive !== null) {
    listingsLive.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-listing-action],[data-media-action]") : null;
      if (target === null) return;
      const listingAction = target.getAttribute("data-listing-action");
      const mediaAction = target.getAttribute("data-media-action");
      const id = target.getAttribute("data-id");
      if (id === null) return;
      if (listingAction !== null) void runListingAction(listingAction, id);
      if (mediaAction !== null) void runMediaAction(mediaAction, id);
    });
  }
  if (publishLive !== null) {
    publishLive.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-publish-action]") : null;
      if (target !== null) {
        void runPublishAction(target.getAttribute("data-publish-action") ?? "", target.getAttribute("data-id") ?? "", target.getAttribute("data-package-id") ?? "");
      }
    });
  }

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

  const runOrderImport = async () => {
    const value = (id) => document.getElementById(id)?.value.trim() ?? "";
    const integer = (id) => Number(document.getElementById(id)?.value ?? "0");
    setOrdersNotice("正在导入订单…");
    try {
      const externalOrderId = value("order-external-id");
      const orderNumber = value("order-number");
      if (externalOrderId === "" || orderNumber === "") throw new Error("请填写外部订单号和订单编号");
      const quantity = integer("order-item-quantity");
      const unitPriceMinor = integer("order-item-price");
      if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
        throw new Error("订单数量和单价必须有效");
      }
      const placedAt = value("order-placed-at");
      await postProductCommand("/commerce/orders/import", {
        externalOrderId,
        orderNumber,
        rawStatus: value("order-raw-status") || "created",
        subtotalMinor: integer("order-subtotal"),
        shippingMinor: integer("order-shipping"),
        placedAt: placedAt === "" ? new Date().toISOString() : new Date(placedAt).toISOString(),
        items: [{
          externalItemId: value("order-item-external-id") || externalOrderId,
          sku: value("order-item-sku") || "SKU",
          title: value("order-item-title") || "平台商品",
          quantity,
          unitPriceMinor,
        }],
      });
      setOrdersNotice("订单已导入。", "success");
      await refreshSourcing();
    } catch (error) {
      setOrdersNotice(error instanceof Error ? error.message : "订单导入失败。", "error");
    }
  };

  const runProcurementCreate = async () => {
    const value = (id) => document.getElementById(id)?.value.trim() ?? "";
    const integer = (id) => Number(document.getElementById(id)?.value ?? "0");
    setFulfillmentsNotice("正在创建采购单…");
    try {
      const orderId = value("procurement-order");
      const quantity = integer("procurement-quantity");
      const unitCostMinor = integer("procurement-unit-cost");
      if (orderId === "" || value("procurement-sourcing-item") === "" || value("procurement-supplier") === "") {
        throw new Error("请选择订单并填写货盘行和供应商");
      }
      if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(unitCostMinor) || unitCostMinor < 0) {
        throw new Error("采购数量和单价成本必须有效");
      }
      const result = await postProductCommand("/commerce/procurements/create", {
        orderId,
        sourcingItemId: value("procurement-sourcing-item"),
        supplierId: value("procurement-supplier"),
        providerId: value("procurement-provider") || "provider-001",
        quantity,
        unitCostMinor,
        shippingFeeMinor: integer("procurement-shipping-fee"),
        serviceFeeMinor: integer("procurement-service-fee"),
      });
      setFulfillmentsNotice(`采购单已创建，应付 ${result.totalPayableMinor} 分。`, "success");
      await refreshSourcing();
    } catch (error) {
      setFulfillmentsNotice(error instanceof Error ? error.message : "采购创建失败。", "error");
    }
  };

  const runProcurementAction = async (action, procurementOrderId) => {
    const fieldValue = (name) => document
      .querySelector(`[data-procurement-field="${name}"][data-id="${CSS.escape(procurementOrderId)}"]`)?.value ?? "";
    try {
      if (action === "quote") {
        await postProductCommand("/commerce/procurements/quote/confirm", { procurementOrderId });
        setFulfillmentsNotice("报价已确认。", "success");
      } else if (action === "pay") {
        const paymentRecord = await postProductCommand("/commerce/payments/create", { procurementOrderId });
        await postProductCommand("/commerce/payments/redirect", { paymentId: paymentRecord.paymentId });
        setFulfillmentsNotice("付款会话已创建并跳转。", "success");
      } else if (action === "confirm-payment") {
        const payment = (currentSnapshot?.commerce?.payments ?? [])
          .filter((candidate) => candidate.procurementOrderId === procurementOrderId)
          .at(-1);
        if (payment === undefined) throw new Error("还没有付款会话");
        await postProductCommand("/commerce/payments/confirm", { paymentId: payment.id });
        setFulfillmentsNotice("收款已确认。", "success");
      } else if (action === "prepare") {
        await postProductCommand("/commerce/procurements/provider-preparing", { procurementOrderId });
        setFulfillmentsNotice("货盘方已进入备货。", "success");
      } else if (action === "ship") {
        const carrier = fieldValue("carrier");
        const trackingNumber = fieldValue("tracking");
        if (carrier === "" || trackingNumber === "") throw new Error("请填写物流商和运单号");
        await postProductCommand("/commerce/procurements/ship", {
          procurementOrderId, carrier, trackingNumber, inTransit: true,
        });
        setFulfillmentsNotice("采购单已发货。", "success");
      } else if (action === "deliver") {
        await postProductCommand("/commerce/procurements/deliver", { procurementOrderId });
        setFulfillmentsNotice("采购履约已送达。", "success");
      } else if (action === "refund") {
        await postProductCommand("/commerce/procurements/refund/request", {
          procurementOrderId, reason: "seller requested refund",
        });
        setFulfillmentsNotice("退款已申请。", "success");
      } else if (action === "refund-complete") {
        await postProductCommand("/commerce/procurements/refund/complete", { procurementOrderId });
        setFulfillmentsNotice("退款已完成。", "success");
      }
      await refreshSourcing();
    } catch (error) {
      setFulfillmentsNotice(error instanceof Error ? error.message : "履约操作失败。", "error");
    }
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
  const orderImportButton = document.getElementById("order-import");
  if (orderImportButton !== null) orderImportButton.addEventListener("click", () => { void runOrderImport(); });
  const procurementCreateButton = document.getElementById("procurement-create");
  if (procurementCreateButton !== null) procurementCreateButton.addEventListener("click", () => { void runProcurementCreate(); });
  if (fulfillmentsLive !== null) {
    fulfillmentsLive.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-procurement-action]") : null;
      if (target !== null) {
        void runProcurementAction(target.getAttribute("data-procurement-action") ?? "", target.getAttribute("data-id") ?? "");
      }
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
    renderListings(snapshot);
    renderPublishJobs(snapshot);
    renderStores(snapshot.platform);
    renderOrders(snapshot);
    renderFulfillments(snapshot);
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
