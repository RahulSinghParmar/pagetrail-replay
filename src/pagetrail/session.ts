// PageTrail Replay. SPDX-License-Identifier: AGPL-3.0-or-later
export type Session = {
  id: string;
  tabId: number;
  origin: string;
  title: string;
  startedAt: string;
  state:
    | "STARTING"
    | "RECORDING"
    | "PAUSED"
    | "FINISHING"
    | "STOPPED"
    | "ERROR";
  notice: string;
};
export type Tab = { id: number; url: string; title?: string };
type Dependencies = {
  load: () => Promise<Session | null>;
  save: (session: Session) => Promise<void>;
  tab: (id: number) => Promise<Tab>;
  create: (title: string) => Promise<string>;
  attach: (session: Session) => Promise<void>;
  detach: (session: Session) => Promise<void>;
  now: () => string;
};

export function inScope(origin: string, raw: string): boolean {
  try {
    const base = new URL(origin),
      next = new URL(raw);
    return (
      !next.username &&
      !next.password &&
      ["http:", "https:"].includes(next.protocol) &&
      next.protocol === base.protocol &&
      next.port === base.port &&
      (next.hostname === base.hostname ||
        next.hostname.endsWith("." + base.hostname))
    );
  } catch {
    return false;
  }
}

export function createSessionController(deps: Dependencies) {
  let session: Session | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const ready = (async () => {
    session = await deps.load();
    if (
      session &&
      ["STARTING", "RECORDING", "FINISHING"].includes(session.state)
    ) {
      session.state = "PAUSED";
      session.notice =
        "Recorder restarted or disconnected. Saved resources remain local. Resume explicitly.";
      await deps.save(session);
    }
  })();
  const copy = () => (session ? structuredClone(session) : null);
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };
  async function save(state: Session["state"], notice: string) {
    if (!session) throw new Error("No recording session.");
    const updated = { ...session, state, notice };
    await deps.save(updated);
    session = updated;
  }
  async function pause(notice: string, finished = false) {
    if (!session) throw new Error("No recording session.");
    if (session.state === "STOPPED") return;
    if (session.state !== "PAUSED" || finished) {
      await save(
        "FINISHING",
        "Finishing pending resources. Please keep this tab open…",
      );
      try {
        await deps.detach(session);
      } catch {
        await save(
          "ERROR",
          "Could not confirm recording stopped. Keep this tab open and retry Finish. Saved resources remain local.",
        );
        throw new Error(
          "Could not finish recording cleanly. Your archive has not been deleted.",
        );
      }
    }
    await save(finished ? "STOPPED" : "PAUSED", notice);
  }
  async function attach() {
    if (!session) throw new Error("No recording session.");
    const tab = await deps.tab(session.tabId);
    if (!inScope(session.origin, tab.url))
      throw new Error(
        "Return to the original site in the recording tab before resuming.",
      );
    await save(
      "STARTING",
      "Connecting recorder. The tab will reload to capture its resources…",
    );
    try {
      // Await cleanup from an unexpected prior debugger disconnect before reuse.
      await deps.detach(session);
      await deps.attach(session);
      await save(
        "RECORDING",
        "Recording resources and visual page states, including accessible course frames. Browse normally; pause briefly after revealing each section.",
      );
    } catch {
      let cleaned = true;
      try {
        await deps.detach(session);
      } catch {
        cleaned = false;
      }
      await save(
        cleaned ? "PAUSED" : "ERROR",
        cleaned
          ? "Could not attach the recorder. Close this tab's developer tools and check extension errors before resuming."
          : "Could not connect or confirm cleanup. Retry Finish before starting another recording.",
      );
      throw new Error(
        "Could not connect the recorder. Existing archive data is preserved.",
      );
    }
  }
  return {
    async status() {
      await ready;
      return copy();
    },
    async command(
      action: string,
      options: { tabId?: number; acknowledged?: boolean } = {},
    ) {
      await ready;
      return serial(async () => {
        if (action === "start") {
          if (session && session.state !== "STOPPED")
            throw new Error(
              "Finish the current session before starting another.",
            );
          if (!options.acknowledged)
            throw new Error(
              "Confirm you are allowed to save this content locally.",
            );
          if (!Number.isInteger(options.tabId))
            throw new Error("Choose a normal website tab.");
          const tab = await deps.tab(options.tabId!);
          const url = new URL(tab.url);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            throw new Error(
              "Choose a normal HTTP(S) site without credentials in its URL.",
            );
          const title =
            (tab.title || url.hostname).slice(0, 160) +
            " · " +
            deps.now().slice(0, 16);
          const id = await deps.create(title);
          const created: Session = {
            id,
            tabId: tab.id,
            origin: url.origin,
            title,
            startedAt: deps.now(),
            state: "PAUSED",
            notice: "",
          };
          await deps.save(created);
          session = created;
          await attach();
        } else if (action === "pause") {
          if (!session || session.state !== "RECORDING")
            throw new Error("No session is currently recording.");
          await pause(
            "Paused. Nothing new is recorded. Resume reloads the same tab and continues the same archive.",
          );
        } else if (action === "resume") {
          if (!session || session.state !== "PAUSED")
            throw new Error("Only a paused session can resume.");
          await attach();
        } else if (action === "finish") {
          await pause(
            "Session finished. Open the library to check capture coverage and save one website-session HTML. WACZ remains available for resource replay.",
            true,
          );
        } else throw new Error("Unknown recording action.");
        return copy();
      });
    },
    async navigated(tabId: number, url: string) {
      await ready;
      return serial(async () => {
        if (
          session?.state === "RECORDING" &&
          session.tabId === tabId &&
          !inScope(session.origin, url)
        ) {
          await pause(
            "Left the recording site. Capture paused; return to the original site and Resume.",
          );
        }
        return copy();
      });
    },
    async interrupted(tabId: number) {
      await ready;
      return serial(async () => {
        if (session?.tabId === tabId && session.state === "RECORDING") {
          await save(
            "PAUSED",
            "The recording tab closed or debugging connection ended. Saved resources remain local.",
          );
        }
        return copy();
      });
    },
  };
}
