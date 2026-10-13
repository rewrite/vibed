"use strict";

if (!globalThis.__tabCloak) {
  globalThis.__tabCloak = true;
  initTabCloak();
}

function initTabCloak() {
  const state = {
    active: false,
    title: "",
    icon: "",
    originalTitle: null,
    latestTitle: null,
    observer: null,
    watchingHead: false,
    timer: null,
    enforcing: false,
  };
  let epoch = 0;

  function isTabIcon(rel) {
    const tokens = rel.toLowerCase().split(/\s+/);
    if (!tokens.includes("icon") && !tokens.includes("shortcut")) return false;
    const blob = tokens.join(" ");
    return !blob.includes("apple") && !blob.includes("mask") && !blob.includes("prefetch");
  }

  function iconType(icon) {
    if (icon.includes("image/svg")) return "image/svg+xml";
    if (icon.includes("image/jpeg")) return "image/jpeg";
    if (icon.includes("image/gif")) return "image/gif";
    if (icon.includes("image/webp")) return "image/webp";
    if (icon.includes("image/x-icon") || icon.includes("image/vnd.microsoft.icon")) return "image/x-icon";
    return "image/png";
  }

  function noteTitle() {
    const text = document.title || "";
    if (!text || text === state.title) return;
    if (state.originalTitle == null) state.originalTitle = text;
    state.latestTitle = text;
  }

  function enforce() {
    if (!state.active || state.enforcing) return;
    const head = document.head || document.documentElement;
    if (!head) return;
    state.enforcing = true;
    try {
      if (document.title !== state.title) document.title = state.title;
      let titleEl = document.querySelector("title");
      if (!titleEl) {
        titleEl = document.createElement("title");
        head.appendChild(titleEl);
      }
      if (titleEl.textContent !== state.title) titleEl.textContent = state.title;

      let owned = document.getElementById("tab-cloak-icon");
      if (!owned || owned.getAttribute("href") !== state.icon || head.lastElementChild !== owned) {
        const fresh = document.createElement("link");
        fresh.id = "tab-cloak-icon";
        fresh.rel = "icon";
        fresh.type = iconType(state.icon);
        fresh.href = state.icon;
        if (owned) owned.remove();
        head.appendChild(fresh);
        owned = fresh;
      }

      for (const link of document.querySelectorAll("link[rel]")) {
        if (link === owned) continue;
        if (!isTabIcon(link.getAttribute("rel") || "")) continue;
        const href = link.getAttribute("href") || "";
        if (!link.hasAttribute("data-cloak-orig") && href && href !== state.icon) {
          link.setAttribute("data-cloak-orig", href);
        }
        if (link.getAttribute("href") !== state.icon) link.setAttribute("href", state.icon);
      }
    } finally {
      state.enforcing = false;
    }
  }

  function armObserver() {
    if (state.observer) return;
    const headOpts = {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "rel"],
    };
    const obs = new MutationObserver(() => {
      if (document.head && !state.watchingHead) {
        obs.disconnect();
        obs.observe(document.head, headOpts);
        state.watchingHead = true;
      }
      if (!state.active || state.enforcing) return;
      noteTitle();
      enforce();
    });
    state.observer = obs;
    if (document.head) {
      obs.observe(document.head, headOpts);
      state.watchingHead = true;
    } else {
      obs.observe(document.documentElement || document, { childList: true, subtree: true });
    }
    if (!state.timer) {
      state.timer = setInterval(() => {
        if (!state.active) return;
        if (document.head && state.observer && !state.watchingHead) {
          state.observer.disconnect();
          state.observer.observe(document.head, headOpts);
          state.watchingHead = true;
        }
        noteTitle();
        enforce();
      }, 700);
    }
  }

  function stopObserver() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    state.watchingHead = false;
  }

  function apply(disguise) {
    if (!disguise || typeof disguise.title !== "string" || typeof disguise.icon !== "string") return;
    epoch += 1;
    noteTitle();
    state.title = disguise.title;
    state.icon = disguise.icon;
    state.active = true;
    armObserver();
    enforce();
  }

  function clear() {
    epoch += 1;
    const restore = state.latestTitle || state.originalTitle || "";
    state.active = false;
    stopObserver();
    state.enforcing = true;
    try {
      if (restore) document.title = restore;
      const titleEl = document.querySelector("title");
      if (titleEl && restore) titleEl.textContent = restore;
      const owned = document.getElementById("tab-cloak-icon");
      if (owned) owned.remove();
      for (const link of document.querySelectorAll("link[data-cloak-orig]")) {
        link.setAttribute("href", link.getAttribute("data-cloak-orig") || "");
        link.removeAttribute("data-cloak-orig");
      }
    } finally {
      state.enforcing = false;
    }
    state.title = "";
    state.icon = "";
    state.originalTitle = null;
    state.latestTitle = null;
  }

  function ask() {
    const asked = epoch;
    browser.runtime
      .sendMessage({ type: "getDisguise" })
      .then((res) => {
        if (epoch !== asked) return;
        if (res && res.disguise) apply(res.disguise);
      })
      .catch(() => {});
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "apply") apply(msg.disguise);
    else if (msg.type === "clear") clear();
  });

  window.addEventListener("pageshow", () => {
    if (state.active) enforce();
    else ask();
  });

  ask();
}
