export const MAX_PRESETS = 40;

/**
 * @typedef {{ id: string, title: string, icon: string, sourceUrl: string | null }} Preset
 * @typedef {{ id?: string | null, title: string, icon: string, sourceUrl?: string | null }} PresetInput
 */

/**
 * @param {Preset[]} presets
 * @param {PresetInput} input
 * @returns {{ presets: Preset[], preset: Preset }}
 */
export function upsertPresetList(presets, input) {
  const title = input.title;
  const icon = input.icon;
  const sourceUrl = input.sourceUrl ?? null;
  /** @type {Preset[]} */
  const next = presets.map((preset) => ({ ...preset }));
  let id = typeof input.id === "string" && input.id ? input.id : null;
  if (!id && sourceUrl) {
    const match = next.find((preset) => preset.sourceUrl === sourceUrl);
    if (match) id = match.id;
  }
  if (!id && !sourceUrl) {
    const match = next.find((preset) => preset.sourceUrl == null && preset.title === title);
    if (match) id = match.id;
  }
  if (id) {
    const index = next.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("That saved identity is gone.");
    const preset = {
      id,
      title,
      icon,
      sourceUrl: sourceUrl ?? next[index].sourceUrl ?? null,
    };
    next[index] = preset;
    return { presets: next, preset };
  }
  if (next.length >= MAX_PRESETS) throw new Error("Remove a saved identity first.");
  const preset = {
    id: globalThis.crypto.randomUUID(),
    title,
    icon,
    sourceUrl,
  };
  next.push(preset);
  return { presets: next, preset };
}

/**
 * @param {Preset[]} presets
 * @param {string} id
 * @returns {Preset[]}
 */
export function deletePresetFromList(presets, id) {
  if (typeof id !== "string" || !id) throw new Error("Missing identity.");
  return presets.filter((preset) => preset.id !== id);
}
