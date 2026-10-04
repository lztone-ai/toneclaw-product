(() => {
  "use strict";

  const navItems = [...document.querySelectorAll(".nav-item[data-view]")];
  const views = [...document.querySelectorAll(".view")];

  const activateView = (name) => {
    for (const item of navItems) item.classList.toggle("is-active", item.dataset.view === name);
    for (const view of views) {
      const active = view.id === `view-${name}`;
      view.classList.toggle("is-active", active);
      if (active) view.removeAttribute("hidden");
      else view.setAttribute("hidden", "");
    }
  };

  navItems.forEach((item) => {
    item.addEventListener("click", () => activateView(item.dataset.view ?? "dashboard"));
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (target === null) return;
    if (target.getAttribute("data-action") === "goto-view") {
      activateView(target.getAttribute("data-target") ?? "dashboard");
      return;
    }
    // Desktop application entry point; matches the shell-owned application document.
    if (target.getAttribute("data-action") === "open-assistant") {
      window.location.assign("dsh-app://app/");
    }
  });
})();
