import { PAGE_RUNTIME_VERSION } from "./contentScriptFiles.js";

const TEXT_KEYS = [
  "id", "selector", "label", "ariaLabel", "tag", "type", "role", "controlType",
  "name", "heading", "placeholder", "ariaAutocomplete", "ariaControls", "ariaExpanded",
  "ariaHaspopup", "className",
];

const list = value => Array.isArray(value) ? value : [];

export function projectMintObservation(frame, observationId) {
  const secrets = new Set();
  for (const control of list(frame.controls)) {
    if (["radio", "checkbox", "option"].includes(control?.type)) continue;
    for (const value of [control?.value, control?.currentValue, ...list(control?.selectedValues)]) {
      if (typeof value === "string" && value.trim()) secrets.add(value);
    }
  }

  function text(value) {
    if (typeof value !== "string") return "";
    // Match exact field values, and embedded values long enough to distinguish
    // them from ordinary short words and numbers in static form labels.
    if (secrets.has(value.trim())) return "[redacted]";
    for (const secret of secrets) {
      if (secret.length >= 4) value = value.replaceAll(secret, "[redacted]");
    }
    return value.replace(/\b(?:sk-[\w-]{18,}|Bearer\s+[\w./+=-]{10,}|[\w.%+-]+@[\w.-]+\.[a-z]{2,})\b/gi, "[redacted]")
      .trim().slice(0, 240);
  }

  const keys = (value, names) => Object.fromEntries(names
    .map(key => [key, text(value?.[key])]).filter(([, value]) => value));
  const labels = (values, limit) => list(values).slice(0, limit)
    .map(value => text(typeof value === "string" ? value : value?.label || value?.text)).filter(Boolean);
  const controls = list(frame.controls).filter(control => control?.id && control.visible !== false)
    .slice(0, 400).map(control => ({
      ...keys(control, TEXT_KEYS),
      enabled: control.enabled !== false,
      valueStatus: !Object.hasOwn(control, "currentValue") ? "unknown"
        : control.currentValue ? "populated_redacted" : "empty",
      ...(typeof control.required === "boolean" && { required: control.required }),
      ...(typeof control.multiple === "boolean" && { multiple: control.multiple }),
      ...(control.options && { options: labels(control.options, 80).map(label => ({ label })) }),
    }));
  const discoveredAdapters = frame.mintDiscovery?.activeAdapterIds;

  return {
    observationId,
    page: { url: frame.url, title: text(frame.title) },
    state: {
      controls,
      headings: labels(frame.headings, 40),
      groups: list(frame.groups).slice(0, 160).filter(Boolean).map(group => ({
        ...keys(group, ["label", "title", "kind", "type"]),
        controlIds: list(group.controlIds).slice(0, 120).map(text).filter(Boolean),
      })),
      scrollableContainers: list(frame.scrollableContainers).slice(0, 40).map(container =>
        keys(container, ["id", "label"])),
    },
    activeAdapterIds: list(discoveredAdapters).slice(0, 32).map(text).filter(Boolean),
    tools: list(frame.connectorTools).slice(0, 100).filter(tool => typeof tool?.name === "string")
      .map(tool => ({
        name: text(tool.name),
        capabilityIds: Object.entries(frame.mintDiscovery?.provides || {})
          .filter(([, toolName]) => toolName === tool.name).map(([id]) => text(id)),
      })),
    discoveryOk: frame.mintDiscovery?.ok === true && Array.isArray(discoveredAdapters) &&
      discoveredAdapters.every(id => typeof id === "string" && id.trim()),
    runtimeVersion: PAGE_RUNTIME_VERSION,
  };
}
