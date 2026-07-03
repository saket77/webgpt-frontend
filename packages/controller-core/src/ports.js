import { getEmptySession } from "./state/sessionStore.js";

const inMemorySessions = new Map();

function key(id) {
  return String(id);
}

const defaultSessionStore = {
  async ensureHydrated() {},
  async getSession(id) {
    const sessionKey = key(id);
    if (!inMemorySessions.has(sessionKey)) {
      inMemorySessions.set(sessionKey, getEmptySession(id));
    }
    return inMemorySessions.get(sessionKey);
  },
  async saveSession(id, session) {
    inMemorySessions.set(key(id), session);
  },
  async replaceSession(id, session) {
    inMemorySessions.set(key(id), session);
  },
  async moveSession(fromId, toId, nextSession) {
    const fromStub = getEmptySession(fromId);
    fromStub.movedToTabId = toId;
    inMemorySessions.set(key(fromId), fromStub);
    inMemorySessions.set(key(toId), {
      ...nextSession,
      tabId: toId,
      attachedTabId: toId,
      movedToTabId: null,
    });
  },
  async getSessionIfExists(id) {
    return inMemorySessions.get(key(id)) || null;
  },
};

const defaultEventSink = {
  async addEvent(_id, event) {
    return {
      timestamp: new Date().toISOString(),
      ...event,
    };
  },
};

const defaultHost = {
  async hasBrowserHostAccess() {
    return true;
  },
  async getTab() {
    return null;
  },
  async updateTab() {},
  onTabCreated() {
    return () => {};
  },
  onTabUpdated() {
    return () => {};
  },
};

const ports = {
  sessionStore: defaultSessionStore,
  eventSink: defaultEventSink,
  host: defaultHost,
};

export function configureControllerCorePorts({
  sessionStore,
  eventSink,
  host,
} = {}) {
  ports.sessionStore = {
    ...defaultSessionStore,
    ...(sessionStore || {}),
  };
  ports.eventSink = {
    ...defaultEventSink,
    ...(eventSink || {}),
  };
  ports.host = {
    ...defaultHost,
    ...(host || {}),
  };
}

export function getControllerCorePorts() {
  return ports;
}
