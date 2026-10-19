function buildUrl(path, params = {}) {
  const url = new URL(`${CONFIG.BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function request(path, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || `Request failed (${response.status})`);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function sendChatMessage(message, sessionId) {
  const url = buildUrl(CONFIG.CHAT_PATH, { message, sessionId });
  return request(url, {}, 60000);
}

function getStudentMessages(sessionId, since = 0) {
  return request(buildUrl("chat/messages", { sessionId, since }));
}

function getQueue() {
  return request(buildUrl("staff/queue"));
}

function getTranscript(sessionId, since = 0) {
  return request(buildUrl("staff/messages", { sessionId, since }));
}

function sendStaffReply(sessionId, message, staffName) {
  return request(
    buildUrl("staff/reply"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message, staffName }),
    },
  );
}

function closeChat(sessionId, staffName) {
  return request(
    buildUrl("staff/close"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, staffName }),
    },
  );
}

function createPoller(fn, intervalMs, onError = () => {}) {
  let timer = null;
  let stopped = true;
  let inFlight = false;
  let failures = 0;

  function schedule(delay) {
    if (stopped || document.visibilityState === "hidden" || inFlight) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(run, delay);
  }

  async function run() {
    if (stopped || document.visibilityState === "hidden" || inFlight) return;
    inFlight = true;
    try {
      await fn();
      failures = 0;
    } catch (error) {
      failures += 1;
      onError(error);
    } finally {
      inFlight = false;
      const delay = failures
        ? Math.min(intervalMs * (2 ** failures), 15000)
        : intervalMs;
      schedule(delay);
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      window.clearTimeout(timer);
    } else if (!stopped && !inFlight) {
      schedule(0);
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(0);
    },
    stop() {
      stopped = true;
      window.clearTimeout(timer);
    },
    dispose() {
      this.stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  };
}