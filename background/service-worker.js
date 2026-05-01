import { registerInstallHandlers } from "./install.js";
import { registerTabHandlers } from "./controller/index.js";
import { registerMessageHandlers } from "./messages.js";

registerInstallHandlers();
registerTabHandlers();
registerMessageHandlers();
