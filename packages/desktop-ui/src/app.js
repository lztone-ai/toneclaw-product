(() => {
  "use strict";

  const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
  const subNavs = [...document.querySelectorAll(".sub-nav")];
  const views = [...document.querySelectorAll(".view")];

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
})();
