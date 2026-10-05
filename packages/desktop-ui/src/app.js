(() => {
  "use strict";

  const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
  const subNavs = [...document.querySelectorAll(".sub-nav")];
  const views = [...document.querySelectorAll(".view")];
  const usageLive = document.getElementById("usage-live");

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
})();
