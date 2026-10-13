import { letterIcon, orderIconUrls, parsePageIdentity } from "./parse-identity.js";
import { deletePresetFromList, upsertPresetList } from "./presets.js";

browser.runtime.onMessage.addListener((msg, sender) => {
  return handle(msg, sender).catch((err) => ({
    error:
      err && (err.name === "TimeoutError" || err.name === "AbortError")
        ? "That page took too long."
        : err instanceof Error && err.message
          ? err.message
          : "Something went wrong.",
  }));
});

browser.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId).catch(() => {});
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  readTabs()
    .then((tabs) => {
      const disguise = tabs[String(tabId)];
      if (!disguise) return;
      return push(tabId, disguise);
    })
    .catch(() => {});
});

async function handle(msg, sender) {
  if (!msg || typeof msg !== "object") return { error: "Empty request." };
  switch (msg.type) {
    case "getDisguise": {
      const tabId = sender.tab && sender.tab.id;
      if (tabId == null) return { disguise: null };
      const tabs = await readTabs();
      return { disguise: tabs[String(tabId)] || null };
    }
    case "getState":
      return getState();
    case "clone":
      return clonePage(msg.url);
    case "icon":
      return { icon: await shrinkIcon(await fetchImage(msg.url)) };
    case "shrink":
      return { icon: await shrinkIcon(msg.icon) };
    case "apply":
      return applyToActive(msg.title, msg.icon, msg.presetId ?? null);
    case "clear":
      return clearActive();
    case "upsertPreset":
      return {
        preset: await upsertPreset({
          id: msg.id ?? null,
          title: msg.title,
          icon: msg.icon,
          sourceUrl: msg.sourceUrl ?? null,
        }),
      };
    case "deletePreset":
      await deletePreset(msg.id);
      return { ok: true };
    default:
      return { error: "Unknown request." };
  }
}

async function getState() {
  const tab = await activeTab();
  const presets = await readPresets();
  if (!tab || tab.id == null) {
    return { canCloak: false, disguise: null, presets, pageTitle: null };
  }
  const tabs = await readTabs();
  const disguise = tabs[String(tab.id)] || null;
  return {
    canCloak: canCloak(tab.url),
    disguise,
    presets,
    pageTitle: disguise ? null : tab.title || null,
  };
}

async function applyToActive(title, icon, presetId) {
  const tab = await activeTab();
  if (!tab || tab.id == null || !canCloak(tab.url)) {
    throw new Error("This page can't be disguised. Open a normal webpage.");
  }
  const disguise = {
    title: cleanTitle(title),
    icon: cleanIcon(icon),
    presetId: typeof presetId === "string" ? presetId : null,
  };
  const tabs = await readTabs();
  tabs[String(tab.id)] = disguise;
  await browser.storage.session.set({ tabDisguises: tabs });
  await push(tab.id, disguise);
  return { ok: true };
}

async function clearActive() {
  const tab = await activeTab();
  if (!tab || tab.id == null) throw new Error("No tab to restore.");
  await forgetTab(tab.id);
  try {
    await browser.tabs.sendMessage(tab.id, { type: "clear" });
  } catch {
    // Page had no content script. Nothing to undo.
  }
  return { ok: true };
}

async function push(tabId, disguise) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "apply", disguise });
    return;
  } catch {
    // Content script is not listening yet.
  }
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await browser.tabs.sendMessage(tabId, { type: "apply", disguise });
  } catch {
    throw new Error("This page can't be disguised.");
  }
}

async function upsertPreset(input) {
  const title = cleanTitle(input.title);
  const icon = cleanIcon(input.icon);
  const sourceUrl = cleanSource(input.sourceUrl);
  const current = await readPresets();
  const { presets, preset } = upsertPresetList(current, {
    id: input.id,
    title,
    icon,
    sourceUrl,
  });
  await browser.storage.local.set({ presets });
  await syncTabs(preset);
  return preset;
}

async function deletePreset(id) {
  const presets = deletePresetFromList(await readPresets(), id);
  await browser.storage.local.set({ presets });
}

async function syncTabs(preset) {
  const tabs = await readTabs();
  const hits = [];
  for (const [id, disguise] of Object.entries(tabs)) {
    if (disguise.presetId !== preset.id) continue;
    disguise.title = preset.title;
    disguise.icon = preset.icon;
    hits.push(Number(id));
  }
  if (hits.length === 0) return;
  await browser.storage.session.set({ tabDisguises: tabs });
  await Promise.all(hits.map((tabId) => push(tabId, tabs[String(tabId)]).catch(() => {})));
}

async function forgetTab(tabId) {
  const tabs = await readTabs();
  if (!tabs[String(tabId)]) return;
  delete tabs[String(tabId)];
  await browser.storage.session.set({ tabDisguises: tabs });
}

async function readTabs() {
  const data = await browser.storage.session.get("tabDisguises");
  const tabs = data.tabDisguises;
  if (!tabs || typeof tabs !== "object") return {};
  return tabs;
}

async function readPresets() {
  const data = await browser.storage.local.get("presets");
  return Array.isArray(data.presets) ? data.presets : [];
}

async function activeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function canCloak(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function clonePage(raw) {
  const url = parseHttpUrl(raw);
  const res = await fetch(url.href, {
    credentials: "omit",
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
  });
  if (!res.ok) throw new Error(`Could not fetch that page (${res.status}).`);
  const finalUrl = res.url || url.href;
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (type.startsWith("image/")) {
    const icon = await shrinkIcon(await blobToDataUrl(await res.blob()));
    return { title: hostTitle(finalUrl), icon, sourceUrl: finalUrl };
  }
  const html = await readText(res, 600_000);
  const parsed = parsePageIdentity(html, finalUrl);
  const title = parsed.title || hostTitle(finalUrl);
  const candidates = orderIconUrls(parsed.iconUrls, finalUrl, parsed.appleUrls);
  let icon = null;
  for (const candidate of candidates) {
    try {
      icon = await shrinkIcon(await fetchImage(candidate));
      break;
    } catch {
      icon = null;
    }
  }
  return { title, icon: icon || letterIcon(title), sourceUrl: finalUrl };
}

async function fetchImage(raw) {
  const url = parseHttpUrl(raw);
  const res = await fetch(url.href, {
    credentials: "omit",
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "image/*,*/*;q=0.8" },
  });
  if (!res.ok) throw new Error("Could not load that image.");
  const type = (res.headers.get("content-type") || "").toLowerCase();
  const blob = await res.blob();
  if (blob.size > 1_500_000) throw new Error("That image is too large.");
  if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
    throw new Error("That URL is not an image.");
  }
  return blobToDataUrl(blob);
}

async function readText(res, max) {
  const reader = res.body && res.body.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > max) {
      chunks.push(step.value.subarray(0, step.value.byteLength - (total - max)));
      await reader.cancel();
      break;
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(blob);
  });
}

async function shrinkIcon(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("Could not read that image.");
  }
  if (dataUrl.startsWith("data:image/svg") && dataUrl.length < 80_000) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const size = 32;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image.");
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const w = Math.max(1, bitmap.width * scale);
    const h = Math.max(1, bitmap.height * scale);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();
    const out = await canvas.convertToBlob({ type: "image/png" });
    return blobToDataUrl(out);
  } catch {
    if (dataUrl.length < 150_000) return dataUrl;
    throw new Error("Could not read that image.");
  }
}

function parseHttpUrl(raw) {
  if (typeof raw !== "string") throw new Error("Enter a full URL, including https://.");
  let text = raw.trim();
  if (!text) throw new Error("Enter a full URL, including https://.");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = "https://" + text;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Enter a full URL, including https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs work.");
  }
  return url;
}

function hostTitle(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw;
  }
}

function cleanTitle(title) {
  if (typeof title !== "string") throw new Error("Title is required.");
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Title is required.");
  if (text.length > 180) throw new Error("Title is too long.");
  return text;
}

function cleanIcon(icon) {
  if (typeof icon !== "string" || !icon.startsWith("data:image/")) throw new Error("Icon must be an image.");
  if (icon.length > 400_000) throw new Error("Icon is too large.");
  return icon;
}

function cleanSource(sourceUrl) {
  if (sourceUrl == null || sourceUrl === "") return null;
  if (typeof sourceUrl !== "string") return null;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}
