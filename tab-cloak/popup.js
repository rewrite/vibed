import { letterIcon } from "./parse-identity.js";

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing " + id);
  return el;
};

let state = { canCloak: false, disguise: null, presets: [], pageTitle: null };
let currentIcon = "";
let clone = null;
let customIcon = "";
let editing = null;

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError) && Boolean(text));
}

async function send(msg) {
  const res = await browser.runtime.sendMessage(msg);
  if (!res) throw new Error("Something went wrong.");
  if (res.error) throw new Error(res.error);
  return res;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image."));
      return;
    }
    if (file.size > 1_500_000) {
      reject(new Error("That image is too large."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

async function iconFromFile(file) {
  if (!file) return "";
  const dataUrl = await fileToDataUrl(file);
  const res = await send({ type: "shrink", icon: dataUrl });
  return res.icon;
}

async function refresh() {
  state = await send({ type: "getState" });
  if (state.disguise) {
    currentIcon = state.disguise.icon;
    const title = $("current-title");
    if (document.activeElement !== title) title.value = state.disguise.title;
    $("current-icon").src = currentIcon;
  }
  renderCurrent();
  renderSaved();
}

function renderCurrent() {
  const empty = $("current-empty");
  const form = $("current-form");
  if (!state.disguise) {
    empty.hidden = false;
    form.hidden = true;
    if (!state.canCloak) empty.textContent = "This page can't be disguised.";
    else if (state.pageTitle) empty.textContent = "Not disguised. Title is “" + state.pageTitle + "”.";
    else empty.textContent = "Not disguised.";
    return;
  }
  empty.hidden = true;
  form.hidden = false;
  $("current-icon").src = currentIcon || state.disguise.icon;
}

function renderSaved() {
  const list = $("saved");
  const empty = $("saved-empty");
  const presets = [...(state.presets || [])].reverse();
  empty.hidden = presets.length > 0;
  list.replaceChildren();
  for (const preset of presets) {
    const li = document.createElement("li");
    if (editing && editing.id === preset.id) li.append(editorRow(preset));
    else li.append(...viewRow(preset));
    list.append(li);
  }
}

function viewRow(preset) {
  const img = document.createElement("img");
  img.src = preset.icon;
  img.alt = "";
  img.width = 16;
  img.height = 16;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = preset.title;
  return [
    img,
    name,
    button("Use", () => usePreset(preset)),
    button("Edit", () => {
      editing = { id: preset.id, title: preset.title, icon: preset.icon };
      renderSaved();
    }),
    button("Remove", () => removePreset(preset)),
  ];
}

function editorRow(preset) {
  const wrap = document.createElement("div");
  wrap.className = "edit";
  const img = document.createElement("img");
  img.src = editing.icon;
  img.alt = "";
  img.width = 16;
  img.height = 16;
  const title = document.createElement("input");
  title.type = "text";
  title.maxLength = 180;
  title.value = editing.title;
  title.setAttribute("aria-label", "Title");
  title.addEventListener("input", () => {
    editing.title = title.value;
  });
  const fileLabel = document.createElement("label");
  fileLabel.className = "file";
  fileLabel.append("Replace icon ");
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/*";
  file.addEventListener("change", () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    iconFromFile(chosen)
      .then((icon) => {
        editing.icon = icon;
        img.src = icon;
        setStatus("");
      })
      .catch((err) => setStatus(err.message, true));
  });
  fileLabel.append(file);
  const row = document.createElement("div");
  row.className = "inline";
  row.append(img, title);
  const actions = document.createElement("div");
  actions.className = "inline";
  actions.append(
    button("Save", () => saveEdit(preset)),
    button("Cancel", () => {
      editing = null;
      renderSaved();
    }),
    button("Remove", () => removePreset(preset)),
  );
  wrap.append(row, fileLabel, actions);
  return wrap;
}

function button(label, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.addEventListener("click", () => {
    Promise.resolve()
      .then(onClick)
      .catch((err) => setStatus(err instanceof Error ? err.message : "Something went wrong.", true));
  });
  return el;
}

async function usePreset(preset) {
  await send({ type: "apply", title: preset.title, icon: preset.icon, presetId: preset.id });
  setStatus("Disguised.");
  await refresh();
}

async function removePreset(preset) {
  await send({ type: "deletePreset", id: preset.id });
  if (editing && editing.id === preset.id) editing = null;
  setStatus("Removed.");
  await refresh();
}

async function saveEdit(preset) {
  const title = editing.title;
  const icon = editing.icon;
  const res = await send({
    type: "upsertPreset",
    id: preset.id,
    title,
    icon,
    sourceUrl: preset.sourceUrl,
  });
  editing = null;
  if (state.disguise && state.disguise.presetId === preset.id) {
    await send({
      type: "apply",
      title: res.preset.title,
      icon: res.preset.icon,
      presetId: preset.id,
    });
  }
  setStatus("Saved.");
  await refresh();
}

$("current-file").addEventListener("change", () => {
  const file = $("current-file").files && $("current-file").files[0];
  if (!file) return;
  iconFromFile(file)
    .then((icon) => {
      currentIcon = icon;
      $("current-icon").src = icon;
      setStatus("");
    })
    .catch((err) => setStatus(err.message, true));
});

$("current-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.disguise) return;
  const title = $("current-title").value;
  const icon = currentIcon || state.disguise.icon;
  let presetId = state.disguise.presetId;
  Promise.resolve()
    .then(async () => {
      if (presetId) {
        try {
          await send({ type: "upsertPreset", id: presetId, title, icon });
        } catch (err) {
          if (!String(err instanceof Error ? err.message : "").includes("gone")) throw err;
          const created = await send({ type: "upsertPreset", title, icon });
          presetId = created.preset.id;
        }
      }
      await send({ type: "apply", title, icon, presetId });
      $("current-file").value = "";
      setStatus("Saved.");
      await refresh();
    })
    .catch((err) => setStatus(err instanceof Error ? err.message : "Something went wrong.", true));
});

$("current-remove").addEventListener("click", () => {
  send({ type: "clear" })
    .then(() => {
      currentIcon = "";
      setStatus("Removed.");
      return refresh();
    })
    .catch((err) => setStatus(err.message, true));
});

$("clone-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const buttonEl = $("clone-go");
  buttonEl.disabled = true;
  setStatus("Fetching…");
  send({ type: "clone", url: $("clone-url").value })
    .then((res) => {
      clone = { title: res.title, icon: res.icon, sourceUrl: res.sourceUrl };
      $("clone-preview").hidden = false;
      $("clone-icon").src = res.icon;
      $("clone-title").value = res.title;
      $("clone-source").textContent = res.sourceUrl;
      $("clone-file").value = "";
      setStatus("");
    })
    .catch((err) => setStatus(err.message, true))
    .finally(() => {
      buttonEl.disabled = false;
    });
});

$("clone-file").addEventListener("change", () => {
  const file = $("clone-file").files && $("clone-file").files[0];
  if (!file || !clone) return;
  iconFromFile(file)
    .then((icon) => {
      clone.icon = icon;
      $("clone-icon").src = icon;
      setStatus("");
    })
    .catch((err) => setStatus(err.message, true));
});

$("clone-preview").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!clone) return;
  const title = $("clone-title").value;
  const icon = clone.icon;
  send({ type: "upsertPreset", title, icon, sourceUrl: clone.sourceUrl })
    .then((saved) =>
      send({
        type: "apply",
        title: saved.preset.title,
        icon: saved.preset.icon,
        presetId: saved.preset.id,
      }),
    )
    .then(() => {
      setStatus("Disguised.");
      return refresh();
    })
    .catch((err) => setStatus(err.message, true));
});

$("custom-file").addEventListener("change", () => {
  const file = $("custom-file").files && $("custom-file").files[0];
  if (!file) return;
  iconFromFile(file)
    .then((icon) => {
      customIcon = icon;
      setStatus("");
    })
    .catch((err) => {
      customIcon = "";
      setStatus(err.message, true);
    });
});

$("custom-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter) submitter.disabled = true;
  const title = $("custom-title").value;
  const iconUrl = $("custom-icon-url").value.trim();
  Promise.resolve()
    .then(async () => {
      let icon = customIcon;
      if (!icon && iconUrl) icon = (await send({ type: "icon", url: iconUrl })).icon;
      if (!icon) icon = letterIcon(title);
      const saved = await send({ type: "upsertPreset", title, icon, sourceUrl: null });
      await send({
        type: "apply",
        title: saved.preset.title,
        icon: saved.preset.icon,
        presetId: saved.preset.id,
      });
      customIcon = "";
      $("custom-file").value = "";
      $("custom-title").value = "";
      $("custom-icon-url").value = "";
      setStatus("Disguised.");
      await refresh();
    })
    .catch((err) => setStatus(err instanceof Error ? err.message : "Something went wrong.", true))
    .finally(() => {
      if (submitter) submitter.disabled = false;
    });
});

refresh().catch((err) => setStatus(err instanceof Error ? err.message : "Something went wrong.", true));
