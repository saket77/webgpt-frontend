import { getEmptySession } from "@webgpt/controller-core";

function key(id) {
  return String(id);
}

export function createCloudSessionStore() {
  const sessions = new Map();

  return {
    async ensureHydrated() {},

    async getSession(id) {
      const sessionKey = key(id);
      if (!sessions.has(sessionKey)) {
        sessions.set(sessionKey, getEmptySession(id));
      }
      return sessions.get(sessionKey);
    },

    async saveSession(id, session) {
      sessions.set(key(id), session);
    },

    async replaceSession(id, session) {
      sessions.set(key(id), session);
    },

    async moveSession(fromId, toId, nextSession) {
      const fromStub = getEmptySession(fromId);
      fromStub.movedToTabId = toId;
      sessions.set(key(fromId), fromStub);
      sessions.set(key(toId), {
        ...nextSession,
        tabId: toId,
        attachedTabId: toId,
        movedToTabId: null,
      });
    },

    async getSessionIfExists(id) {
      return sessions.get(key(id)) || null;
    },
  };
}
