(function () {
  "use strict";
  const ID = "whatsapp.web";
  const TOOL = "whatsapp_prepare_message";
  const SEND_TOOL = "whatsapp_send_message";
  const boundDocument = document;
  const SEARCH = '#side input[data-tab="3"]';
  const EDITOR = '#main footer div[contenteditable="true"][role="textbox"][data-testid="conversation-compose-box-input"][aria-placeholder="Type a message"]';
  const registry = window.WebGPTContentAdapters;
  const connectors = window.WebGPTConnectorTools;
  if (!registry || !connectors) throw new Error("WebGPT registries required.");
  function semanticText(node) {
    if (!node) return "";
    if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || "";
    if (node.nodeType === 1 && node.tagName === "IMG") return node.getAttribute("alt") || "";
    return Array.from(node.childNodes || [], semanticText).join("");
  }
  function validArguments(action) {
    return typeof action?.recipient === "string" && Boolean(action.recipient.trim()) &&
      action.recipient.length <= 200 && action.fieldValues &&
      typeof action.fieldValues === "object" && !Array.isArray(action.fieldValues) &&
      typeof action.fieldValues.message === "string" &&
      action.fieldValues.message.length > 0 && action.fieldValues.message.length <= 10000 &&
      Object.keys(action.fieldValues).every(key => key === "message");
  }
  function blank(editor) {
    if (!editor || editor.textContent !== "") return false;
    if (!editor.childNodes.length) return true;
    if (editor.childNodes.length !== 1) return false;
    const p = editor.firstChild;
    if (p.nodeType !== 1 || p.tagName !== "P" ||
        p.getAttribute("contenteditable") === "false") return false;
    if (!p.childNodes.length) return true;
    return p.childNodes.length === 1 && p.firstChild.nodeType === 1 &&
      p.firstChild.tagName === "BR" && !p.firstChild.childNodes.length;
  }

  const one = (doc, selector) => {
    const elements = doc.querySelectorAll(selector);
    return elements.length === 1 ? elements[0] : null;
  };
  function matches(url, doc) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "web.whatsapp.com" &&
        parsed.pathname === "/" && Boolean(one(doc, SEARCH) || one(doc, EDITOR));
    } catch (_) { return false; }
  }
  function selected(doc, recipient) {
    const titles = Array.from(doc.querySelectorAll(
      '#main header span[data-testid="conversation-info-header-chat-title"]'
    ));
    const editor = one(doc, EDITOR);
    const title = titles.length === 1 ? titles[0] : null;
    const rect = title?.getBoundingClientRect();
    const style = title ? window.getComputedStyle(title) : null;
    return title && rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden" &&
      semanticText(title) === recipient && editor &&
      editor.getAttribute("aria-label") === `Type a message to ${recipient}` ? editor : null;
  }
  function mapControl(control, element, doc) {
    if (!element || !control.selector) return false;
    try { return one(doc, control.selector) === element; }
    catch (_) { return false; }
  }
  function targetId(state, editor, doc) {
    return (state?.controls || []).find(c => mapControl(c, editor, doc))?.id || null;
  }
  const pause = () => new Promise(resolve => setTimeout(resolve, 100));
  async function waitFor(read) {
    for (let i = 0; i < 30; i++) {
      const value = read();
      if (value) return value;
      await pause();
    }
    return null;
  }
  let running = false;
  connectors.register(TOOL, async (action, ctx) => {
    if (running) return { ok: false, committed: false, detail: "Preparation already running." };
    const recipient = action?.recipient;
    const message = action?.fieldValues?.message;
    if (!validArguments(action)) {
      return { ok: false, committed: false, detail: "Exact recipient and message required." };
    }
    const doc = document;
    const primitives = ctx?.primitives || window.WebGPTRunnerModules?.primitives;
    const utils = ctx?.domUtils || window.WebGPTRunnerModules?.domUtils;
    const ready = el => el && el.isConnected && utils?.isVisible(el) && utils?.isEnabled(el);
    if (doc !== boundDocument || !matches(location.href, doc) || !primitives?.fillElement ||
        !primitives?.clickElement || !utils?.isVisible || !utils?.isEnabled) {
      return { ok: false, committed: false, detail: "Page or runner not ready." };
    }
    running = true;
    let searched = false;
    let opened = false;
    let attemptedFill = false;
    try {
      let editor = selected(doc, recipient);
      if (!editor) {
        const search = one(doc, SEARCH);
        if (!ready(search) || search.value !== "") {
          return { ok: false, committed: false, detail: "Empty unique search required; existing search preserved." };
        }
        await primitives.fillElement(search, recipient);
        searched = true;
        if (search.value !== recipient) throw new Error("Search did not commit.");
        // Inspect only exact title attributes, never row text or conversation content.
        const exactCells = () => Array.from(new Set(Array.from(
          doc.querySelectorAll("#side span[title]")
        ).filter(el => el.getAttribute("title") === recipient)
          .map(el => el.closest('[role="gridcell"]')).filter(ready)));
        await pause();
        await pause();
        const found = await waitFor(() => exactCells().length ? exactCells() : null);
        if (!found || found.length !== 1 || one(doc, SEARCH) !== search ||
            search.value !== recipient) throw new Error("Unique exact chat match unavailable.");
        await pause();
        const fresh = exactCells();
        if (fresh.length !== 1 || fresh[0] !== found[0]) throw new Error("Chat match changed.");
        await primitives.clickElement(fresh[0]);
        opened = true;
        editor = await waitFor(() => selected(doc, recipient));
      }
      if (!ready(editor) || selected(doc, recipient) !== editor) throw new Error("Chat identity not verified.");
      // Any text, including whitespace, is an existing draft and must survive.
      if (!blank(editor)) {
        return { ok: false, committed: false, searched, opened,
          detail: "Existing nonempty draft preserved." };
      }
      if (selected(doc, recipient) !== editor || !blank(editor)) throw new Error("Chat changed before fill.");
      attemptedFill = true;
      await primitives.fillElement(editor, message);
      await pause();
      const freshEditor = selected(doc, recipient);
      if (!ready(freshEditor) || semanticText(freshEditor) !== message) throw new Error("Draft verification failed; no retry performed.");
      return { ok: true, committed: true, sent: false, searched, opened,
        fieldValues: { message }, fieldTargets: { message: targetId(ctx?.state, freshEditor, doc) },
        detail: "Exact chat verified; text prepared as an unsent draft." };
    } catch (_) {
      return { ok: false, committed: false, recoverable: !attemptedFill,
        continueBatch: false, searched, opened, draftMayHaveChanged: attemptedFill,
        detail: "Preparation not verified. Prior effects preserved; do not automatically retry." };
    } finally { running = false; }
  });
  connectors.register(SEND_TOOL, async (action, ctx) => {
    const fail = detail => ({ ok: false, committed: false, continueBatch: false, detail });
    if (!validArguments(action)) return fail("Exact recipient and message required.");
    if (running) return fail("Another messaging operation is running.");
    const doc = document;
    const utils = ctx?.domUtils || window.WebGPTRunnerModules?.domUtils;
    if (doc !== boundDocument || !matches(location.href, doc) ||
        typeof ctx?.sendApprovedWhatsAppMessage !== "function") {
      return fail("Selected page or approved host send operation unavailable.");
    }
    const { recipient, fieldValues: { message } } = action;
    const editor = selected(doc, recipient);
    if (!editor || !editor.isConnected || !editor.isContentEditable ||
        !utils?.isVisible?.(editor) || !utils?.isEnabled?.(editor) ||
        semanticText(editor) !== message) {
      return fail("Exact selected chat and prepared draft not verified; nothing sent.");
    }
    running = true;
    try {
      return await ctx.sendApprovedWhatsAppMessage({ recipient, message });
    } catch (_) {
      return { ok: false, committed: false, uncertain: true, continueBatch: false,
        detail: "Host send outcome not verified; do not retry." };
    } finally { running = false; }
  }, { requiresAuthorization: true });
  registry.register({
    id: ID,
    priority: 60,
    provides: { "messaging.prepare": TOOL, "messaging.send": SEND_TOOL },
    match({ url, document: doc }) { return matches(url, doc); },
    enhanceState({ state, document: doc }) {
      const editor = one(doc, EDITOR);
      const search = one(doc, SEARCH);
      const controls = (state.controls || []).filter(c =>
        mapControl(c, editor, doc) || mapControl(c, search, doc)).map(c => {
        const isMessage = mapControl(c, editor, doc);
        // Keep real editable controls without projecting draft or inbox text.
        return { id: c.id, selector: isMessage ? EDITOR : SEARCH,
          tag: isMessage ? "div" : "input", role: "textbox",
          controlType: "textbox", visible: true,
          enabled: Boolean(isMessage ? editor && editor.getAttribute("aria-disabled") !== "true" :
            search && !search.disabled && search.getAttribute("aria-disabled") !== "true"),
          label: isMessage ? "Message" : "Search",
          ariaLabel: isMessage ? "Type a message" : "Search or start a new chat",
          fieldKey: isMessage ? "message" : "recipient_search",
          adapterHints: { [ID]: { semanticRole: isMessage ? "message" : "search",
            preferredAction: TOOL, exactValueMode: "text" } } };
      });
      return { url: "https://web.whatsapp.com/", title: "WhatsApp Web",
        controls, groups: [], headings: [], visibleTextSummary: [],
        siteAdapter: { id: ID, pageKind: "messaging",
          primaryControlIds: controls.map(c => c.id),
          plannerHints: ["Prepare preserves existing drafts and never sends; sending requires the separate authorized Send tool."] } };
    },
    provideTools({ document: doc }) {
      if (doc !== boundDocument || !matches(location.href, doc)) return [];
      if (!one(doc, SEARCH) && !one(doc, EDITOR)) return [];
      const tools = [{
        schema: {
          type: "function", name: TOOL,
          description: "Find one exact recipient and prepare fieldValues.message as exact Unicode text in an empty composer. Verify the selected chat and exact draft, preserve nonempty drafts, and never send. Available when chat search or the composer exists.",
          parameters: {
            type: "object", additionalProperties: false,
            required: ["recipient", "fieldValues"],
            properties: {
              recipient: { type: "string", minLength: 1, maxLength: 200 },
              fieldValues: { type: "object", additionalProperties: false,
                required: ["message"], properties: {
                  message: { type: "string", minLength: 1, maxLength: 10000 }
                } }
            }
          },
          webgpt: { adapterId: ID, replayable: false, mayCauseNavigation: false }
        },
        execution: { realm: "page", capability: null, effect: "write",
          sensitiveArguments: ["fieldValues.message"] }
      }];
      if (one(doc, EDITOR)) tools.push({
        schema: {
          type: "function", name: SEND_TOOL,
          description: "Send an already prepared exact Unicode fieldValues.message to one exact recipient, only after selected-chat and editable draft verification and separate one-use host authorization. Available only with a composer. Delegates once to the approved host send operation; never prepares text or retries an uncertain send.",
          parameters: tools[0].schema.parameters,
          webgpt: { adapterId: ID, replayable: false, mayCauseNavigation: false }
        },
        execution: { realm: "page", effect: "write", operation: SEND_TOOL,
          requiresAuthorization: true, sensitiveArguments: ["fieldValues.message"] }
      });
      return tools;
    }
  });
})();