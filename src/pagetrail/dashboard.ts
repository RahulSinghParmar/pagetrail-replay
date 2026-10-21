// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
import { mountDashboard } from "./dashboard-app";
mountDashboard({
  check: () =>
    chrome.runtime.sendMessage({
      method: "pagetrail.replay",
      action: "session-status",
    }),
  status: () =>
    chrome.runtime.sendMessage({
      method: "pagetrail.replay",
      action: "status",
    }),
});
