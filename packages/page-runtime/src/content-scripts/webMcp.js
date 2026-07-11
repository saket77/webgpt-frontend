// WebMCP bridge shared by the extension and Browserbase hosts. The website owns
// the tools; WebGPT discovers a serializable view for planning and re-discovers
// the live browser handle immediately before execution.
(function () {
  const BRIDGE_REVISION = "webmcp-2026-07-11-v1";
  if (
    globalThis.WebGPTWebMCP &&
    globalThis.WebGPTWebMCP.revision === BRIDGE_REVISION &&
    typeof globalThis.WebGPTWebMCP.discoverTools === "function"
  ) {
    return;
  }

  const MAX_TOOLS = 32;
  const MAX_DISCOVERY_CANDIDATES = 128;
  const MAX_DISCOVERY_ERRORS = 8;
  const MAX_ERROR_LENGTH = 500;
  const MAX_NAME_LENGTH = 128;
  const MAX_TITLE_LENGTH = 240;
  const MAX_DESCRIPTION_LENGTH = 1200;
  const MAX_SCHEMA_BYTES = 32 * 1024;
  const MAX_EXECUTION_ARGUMENT_BYTES = 64 * 1024;
  const MAX_OUTPUT_BYTES = 64 * 1024;
  const MAX_EXTRACTION_TEXT_BYTES = 16 * 1024;
  const MAX_OUTPUT_COLLECTION_ITEMS = 500;
  const MAX_EXECUTION_COLLECTION_ITEMS = 1000;
  const MAX_JSON_DEPTH = 32;
  const DISCOVERY_TIMEOUT_MS = 3_000;
  const EXECUTION_TIMEOUT_MS = 30_000;
  const VALID_TOOL_NAME = /^[A-Za-z0-9_.-]+$/;

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncate(value, maxLength) {
    const text = normalizeText(value);
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
  }

  function discoveryError(error) {
    return truncate(error?.message || String(error), MAX_ERROR_LENGTH);
  }

  function modelContextFor(documentRef = document) {
    return (
      documentRef?.modelContext ||
      globalThis.navigator?.modelContext ||
      null
    );
  }

  function byteLength(value) {
    const text = String(value || "");
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(text).length;
    }
    return text.length;
  }

  function hashText(value) {
    const text = String(value || "");
    let hashA = 2166136261;
    let hashB = 3339675911;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      hashA ^= code;
      hashA = Math.imul(hashA, 16777619);
      hashB ^= code + index;
      hashB = Math.imul(hashB, 2246822519);
    }
    return [hashA, hashB]
      .map((hash) => (hash >>> 0).toString(16).padStart(8, "0"))
      .join("");
  }

  function truncateUtf8(value, maxBytes) {
    const text = String(value || "");
    if (byteLength(text) <= maxBytes) return text;

    let low = 0;
    let high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (byteLength(text.slice(0, middle)) <= maxBytes) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return text.slice(0, low);
  }

  function assertJsonExecutionValue(value, path, seen, depth) {
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(
        `WebMCP execution arguments exceed ${MAX_JSON_DEPTH} levels at ${path}.`,
      );
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      return;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error(`WebMCP execution argument ${path} is not finite.`);
      }
      return;
    }

    if (typeof value !== "object") {
      throw new Error(
        `WebMCP execution argument ${path} is not JSON-serializable.`,
      );
    }

    if (seen.has(value)) {
      throw new Error(`WebMCP execution arguments are circular at ${path}.`);
    }
    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > MAX_EXECUTION_COLLECTION_ITEMS) {
        throw new Error(
          `WebMCP execution argument ${path} exceeds ${MAX_EXECUTION_COLLECTION_ITEMS} items.`,
        );
      }
      for (let index = 0; index < value.length; index += 1) {
        assertJsonExecutionValue(
          value[index],
          `${path}[${index}]`,
          seen,
          depth + 1,
        );
      }
      seen.delete(value);
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `WebMCP execution argument ${path} must be a plain JSON object.`,
      );
    }

    const keys = Object.keys(value);
    if (keys.length > MAX_EXECUTION_COLLECTION_ITEMS) {
      throw new Error(
        `WebMCP execution argument ${path} exceeds ${MAX_EXECUTION_COLLECTION_ITEMS} keys.`,
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor)) {
        throw new Error(
          `WebMCP execution argument ${path}.${key} cannot be an accessor.`,
        );
      }
      assertJsonExecutionValue(
        descriptor.value,
        `${path}.${key}`,
        seen,
        depth + 1,
      );
    }
    seen.delete(value);
  }

  function serializeExecutionArguments(action) {
    const args = action?.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error(
        "WebMCP action requires an exact nested arguments JSON object.",
      );
    }

    assertJsonExecutionValue(args, "arguments", new Set(), 0);
    const serialized = JSON.stringify(args);
    const serializedBytes = byteLength(serialized);
    if (serializedBytes > MAX_EXECUTION_ARGUMENT_BYTES) {
      throw new Error(
        `WebMCP execution arguments exceed ${MAX_EXECUTION_ARGUMENT_BYTES} bytes.`,
      );
    }

    return { serialized, serializedBytes };
  }

  function normalizeOutputValue(value, seen, depth, metadata) {
    if (value === null) return null;
    if (
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      return value;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value;
      metadata.truncated = true;
      return String(value);
    }
    if (typeof value === "bigint") {
      metadata.truncated = true;
      return String(value);
    }
    if (value === undefined) {
      metadata.truncated = true;
      return null;
    }
    if (typeof value === "function" || typeof value === "symbol") {
      metadata.truncated = true;
      return `[Unsupported ${typeof value}]`;
    }
    if (depth > MAX_JSON_DEPTH) {
      metadata.truncated = true;
      return "[Max depth exceeded]";
    }
    if (seen.has(value)) {
      metadata.truncated = true;
      return "[Circular]";
    }

    seen.add(value);
    if (Array.isArray(value)) {
      const result = value
        .slice(0, MAX_OUTPUT_COLLECTION_ITEMS)
        .map((item) =>
          normalizeOutputValue(item, seen, depth + 1, metadata),
        );
      if (value.length > MAX_OUTPUT_COLLECTION_ITEMS) {
        metadata.truncated = true;
        result.push(
          `[${value.length - MAX_OUTPUT_COLLECTION_ITEMS} items omitted]`,
        );
      }
      seen.delete(value);
      return result;
    }

    if (value instanceof Date) {
      seen.delete(value);
      return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
    }

    const result = Object.create(null);
    let descriptors;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch (_error) {
      seen.delete(value);
      metadata.truncated = true;
      return "[Unreadable object]";
    }

    const descriptorEntries = Object.entries(descriptors);
    if (descriptorEntries.length > MAX_OUTPUT_COLLECTION_ITEMS) {
      metadata.truncated = true;
    }
    for (const [key, descriptor] of descriptorEntries.slice(
      0,
      MAX_OUTPUT_COLLECTION_ITEMS,
    )) {
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        metadata.truncated = true;
        result[key] = "[Accessor omitted]";
        continue;
      }
      result[key] = normalizeOutputValue(
        descriptor.value,
        seen,
        depth + 1,
        metadata,
      );
    }
    seen.delete(value);
    return result;
  }

  function normalizeBoundedOutput(output) {
    const metadata = { truncated: false };
    let normalized;
    try {
      normalized = normalizeOutputValue(output, new Set(), 0, metadata);
    } catch (_error) {
      metadata.truncated = true;
      normalized = "[Unreadable output]";
    }
    let value = normalized;
    let serialized = JSON.stringify(value);

    if (byteLength(serialized) > MAX_OUTPUT_BYTES) {
      metadata.truncated = true;
      let preview = truncateUtf8(serialized, MAX_OUTPUT_BYTES - 1024);
      value = { truncated: true, preview };
      serialized = JSON.stringify(value);

      while (byteLength(serialized) > MAX_OUTPUT_BYTES && preview.length) {
        preview = preview.slice(0, Math.floor(preview.length * 0.8));
        value = { truncated: true, preview };
        serialized = JSON.stringify(value);
      }
    }

    return {
      value,
      metadata: {
        truncated: metadata.truncated,
        byteLength: byteLength(serialized),
      },
      serialized,
    };
  }

  function boundedExtractionText(serialized) {
    if (byteLength(serialized) <= MAX_EXTRACTION_TEXT_BYTES) return serialized;
    const marker = "\n[truncated]";
    return `${truncateUtf8(
      serialized,
      MAX_EXTRACTION_TEXT_BYTES - byteLength(marker),
    )}${marker}`;
  }

  function parseInputSchema(inputSchema) {
    const parsed =
      typeof inputSchema === "string"
        ? JSON.parse(inputSchema || "{}")
        : JSON.parse(JSON.stringify(inputSchema || {}));

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("inputSchema must be a JSON object.");
    }

    const serialized = JSON.stringify(parsed);
    if (byteLength(serialized) > MAX_SCHEMA_BYTES) {
      throw new Error(`inputSchema exceeds ${MAX_SCHEMA_BYTES} bytes.`);
    }

    return { parsed, serialized };
  }

  function normalizeTool(tool) {
    if (!tool || typeof tool !== "object") {
      throw new Error("Tool must be an object.");
    }

    const name = String(tool.name || "").trim();
    if (!name) throw new Error("Tool name is required.");
    if (name.length > MAX_NAME_LENGTH) {
      throw new Error(`Tool name exceeds ${MAX_NAME_LENGTH} characters.`);
    }
    if (!VALID_TOOL_NAME.test(name)) {
      throw new Error(`Tool name ${name} contains unsupported characters.`);
    }

    const { parsed: parameters, serialized } = parseInputSchema(
      tool.inputSchema,
    );
    const origin = normalizeText(tool.origin || globalThis.location?.origin);

    return {
      source: "webmcp",
      name,
      title: truncate(tool.title, MAX_TITLE_LENGTH),
      description: truncate(tool.description, MAX_DESCRIPTION_LENGTH),
      origin,
      parameters,
      annotations: {
        readOnlyHint: Boolean(tool.annotations?.readOnlyHint),
        untrustedContentHint: Boolean(
          tool.annotations?.untrustedContentHint,
        ),
      },
      schemaHash: hashText(serialized),
    };
  }

  async function discoverLiveTools(documentRef = document) {
    const modelContext = modelContextFor(documentRef);
    if (!modelContext || typeof modelContext.getTools !== "function") {
      return { supported: false, modelContext: null, liveTools: [] };
    }

    let timeoutId = null;
    const liveTools = await Promise.race([
      modelContext.getTools(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("WebMCP tool discovery timed out.")),
          DISCOVERY_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));
    const localWindow =
      documentRef?.defaultView || globalThis.window || globalThis;
    return {
      supported: true,
      modelContext,
      liveTools: Array.isArray(liveTools)
        ? liveTools.filter(
            (tool) => !tool?.window || tool.window === localWindow,
          )
        : [],
    };
  }

  async function discoverTools(documentRef = document) {
    try {
      const discovery = await discoverLiveTools(documentRef);
      if (!discovery.supported) {
        return { supported: false, tools: [], errors: [] };
      }

      const tools = [];
      const errors = [];
      const seen = new Set();

      for (const liveTool of discovery.liveTools.slice(
        0,
        MAX_DISCOVERY_CANDIDATES,
      )) {
        try {
          const tool = normalizeTool(liveTool);
          const identity = `${tool.origin}|${tool.name}`;
          if (seen.has(identity)) continue;
          seen.add(identity);
          tools.push(tool);
          if (tools.length >= MAX_TOOLS) break;
        } catch (error) {
          if (errors.length < MAX_DISCOVERY_ERRORS) {
            errors.push(discoveryError(error));
          }
        }
      }

      return { supported: true, tools, errors };
    } catch (error) {
      return {
        supported: true,
        tools: [],
        errors: [discoveryError(error)],
      };
    }
  }

  async function augmentState(state, documentRef = document) {
    const webMcp = await discoverTools(documentRef);
    return {
      ...(state || {}),
      webMcp,
    };
  }

  async function executeAction(
    action,
    documentRef = document,
    { frameId = null } = {},
  ) {
    if (action?.executor !== "webmcp") {
      throw new Error("WebMCP execution requires executor=webmcp.");
    }

    const route = action?.webMcp;
    const requestedName = String(route?.name || "");
    const requestedOrigin = String(route?.origin || "");
    const requestedSchemaHash = String(route?.schemaHash || "");
    if (
      !requestedName ||
      !requestedOrigin ||
      !requestedSchemaHash ||
      typeof route?.readOnlyHint !== "boolean" ||
      typeof route?.untrustedContentHint !== "boolean"
    ) {
      throw new Error(
        "WebMCP action is missing name, origin, schemaHash, or annotation routing metadata.",
      );
    }

    const { serialized: serializedArguments } =
      serializeExecutionArguments(action);
    const discovery = await discoverLiveTools(documentRef);
    if (
      !discovery.supported ||
      typeof discovery.modelContext?.executeTool !== "function"
    ) {
      throw new Error("WebMCP execution is not supported in this frame.");
    }

    let match = null;
    let acceptedToolCount = 0;
    const seenToolIdentities = new Set();
    for (const liveTool of discovery.liveTools.slice(
      0,
      MAX_DISCOVERY_CANDIDATES,
    )) {
      try {
        const normalized = normalizeTool(liveTool);
        const identity = `${normalized.origin}|${normalized.name}`;
        if (seenToolIdentities.has(identity)) continue;
        seenToolIdentities.add(identity);
        acceptedToolCount += 1;
        if (
          normalized.name === requestedName &&
          normalized.origin === requestedOrigin &&
          normalized.schemaHash === requestedSchemaHash
        ) {
          match = { liveTool, normalized };
          break;
        }
        if (acceptedToolCount >= MAX_TOOLS) break;
      } catch (_error) {
        // A malformed neighboring tool must not prevent the routed tool from
        // being found. It was also excluded from the planning-time snapshot.
      }
    }

    if (!match) {
      throw new Error(
        `WebMCP tool ${requestedName} is no longer available with the planned schema.`,
      );
    }

    if (
      match.normalized.annotations.readOnlyHint !== route.readOnlyHint ||
      match.normalized.annotations.untrustedContentHint !==
        route.untrustedContentHint
    ) {
      throw new Error(
        `WebMCP tool ${requestedName} annotations changed since planning.`,
      );
    }

    let timeoutId = null;
    const rawOutput = await Promise.race([
      Promise.resolve().then(() =>
        discovery.modelContext.executeTool(
          match.liveTool,
          serializedArguments,
        ),
      ),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("WebMCP tool execution timed out.")),
          EXECUTION_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timeoutId));

    const boundedOutput = normalizeBoundedOutput(rawOutput);
    const webMcp = {
      name: match.normalized.name,
      origin: match.normalized.origin,
      schemaHash: match.normalized.schemaHash,
      readOnlyHint: match.normalized.annotations.readOnlyHint,
      untrustedContentHint:
        match.normalized.annotations.untrustedContentHint,
    };
    const result = {
      ok: true,
      detail:
        rawOutput === null
          ? `WebMCP tool ${requestedName} started navigation.`
          : `WebMCP tool ${requestedName} completed.`,
      webMcp,
      webMcpOutput: boundedOutput.value,
      webMcpOutputMeta: boundedOutput.metadata,
    };

    if (rawOutput === null) {
      result.navigationStarted = true;
      return result;
    }

    if (webMcp.readOnlyHint) {
      const targetId = `webmcp:${webMcp.origin}:${webMcp.name}`;
      result.extractionBatch = {
        frameId: Number.isInteger(frameId) ? frameId : undefined,
        targetId,
        extractedCount: 1,
        context: {
          source: "webmcp",
          plannerName: String(action?.type || ""),
          toolName: webMcp.name,
          origin: webMcp.origin,
          untrustedContent: true,
        },
        items: [
          {
            id: `webmcp_${webMcp.schemaHash}`,
            targetId,
            kind: "webmcp_tool_result",
            adapterId: "webmcp",
            preferredAction: "extract",
            label: match.normalized.title || webMcp.name,
            text: boundedExtractionText(boundedOutput.serialized),
            toolName: webMcp.name,
            origin: webMcp.origin,
            // Page-returned data is always untrusted. The annotation is only a
            // site-supplied hint and never upgrades output to trusted content.
            untrustedContent: true,
          },
        ],
      };
    }

    return result;
  }

  globalThis.WebGPTWebMCP = {
    revision: BRIDGE_REVISION,
    MAX_TOOLS,
    MAX_DISCOVERY_CANDIDATES,
    MAX_DISCOVERY_ERRORS,
    MAX_EXECUTION_ARGUMENT_BYTES,
    MAX_OUTPUT_BYTES,
    DISCOVERY_TIMEOUT_MS,
    EXECUTION_TIMEOUT_MS,
    augmentState,
    discoverTools,
    executeAction,
    modelContextFor,
    normalizeTool,
    serializeExecutionArguments,
  };
})();
