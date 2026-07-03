export const CLOUD_TAB_ID = 1;

export function createCloudHost({ runtime }) {
  const createdHandlers = new Set();
  const updatedHandlers = new Set();

  return {
    async hasBrowserHostAccess() {
      return true;
    },

    async getTab(tabId) {
      if (tabId !== CLOUD_TAB_ID) return null;
      return runtime.getTabInfo();
    },

    async updateTab(tabId, update = {}) {
      if (tabId !== CLOUD_TAB_ID) return null;
      if (update.url) {
        await runtime.goto(update.url);
      }
      return runtime.getTabInfo();
    },

    onTabCreated(handler) {
      createdHandlers.add(handler);
      return () => createdHandlers.delete(handler);
    },

    onTabUpdated(handler) {
      updatedHandlers.add(handler);
      runtime.addNavigationListener((tab) => {
        handler(CLOUD_TAB_ID, { status: "complete" }, tab);
      });
      return () => updatedHandlers.delete(handler);
    },

    emitTabCreated(tab) {
      for (const handler of createdHandlers) handler(tab);
    },
  };
}
