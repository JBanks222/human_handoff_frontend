(() => {
  const elements = {
    nameDisplay: document.querySelector("#staff-name-display"),
    changeName: document.querySelector("#change-name"),
    notificationButton: document.querySelector("#notification-permission"),
    count: document.querySelector("#waiting-count"),
    summary: document.querySelector("#queue-summary"),
    queue: document.querySelector("#queue-list"),
    empty: document.querySelector("#conversation-empty"),
    active: document.querySelector("#conversation-active"),
    activeTitle: document.querySelector("#active-session-title"),
    details: document.querySelector("#session-details"),
    transcript: document.querySelector("#transcript"),
    replyForm: document.querySelector("#reply-form"),
    replyInput: document.querySelector("#reply-input"),
    endChat: document.querySelector("#end-chat"),
    nameDialog: document.querySelector("#name-dialog"),
    nameForm: document.querySelector("#name-form"),
    nameInput: document.querySelector("#staff-name-input"),
    toast: document.querySelector("#toast"),
  };
  const NAME_KEY = "qccHelpDeskStaffName";
  const NOTIFIED_KEY = "qccHelpDeskSeenSessions";
  const ACTIVE_SESSION_KEY = "qccHelpDeskActiveSessionId";
  const notified = new Set(JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || "[]"));
  const messageKeys = new Set();
  let staffName = localStorage.getItem(NAME_KEY) || "";
  let sessions = [];
  let waitingCount = 0;
  let activeSessionId = "";
  let lastSeq = 0;
  let toastTimer = null;
  let queueRequestInFlight = false;
  let loadGeneration = 0;

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 5500);
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function shortId(id) {
    return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
  }

  function elapsed(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Time unknown";
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return `${seconds}s waiting`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s waiting`;
  }

  function beep() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
      oscillator.addEventListener("ended", () => context.close(), { once: true });
    } catch {}
  }

  function updateNotificationButton() {
    if (!("Notification" in window)) {
      elements.notificationButton.textContent = "Notifications unavailable";
      elements.notificationButton.disabled = true;
    } else if (Notification.permission === "granted") {
      elements.notificationButton.textContent = "Notifications enabled";
      elements.notificationButton.disabled = true;
    } else if (Notification.permission === "denied") {
      elements.notificationButton.textContent = "Notifications blocked";
      elements.notificationButton.disabled = true;
    } else {
      elements.notificationButton.textContent = "Enable notifications";
      elements.notificationButton.disabled = false;
    }
  }

  function notifyWaitingSession(session) {
    if (notified.has(session.session_id)) return;
    notified.add(session.session_id);
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified]));
    beep();
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("New QCC help request", {
        body: `${shortId(session.session_id)} is waiting for support.`,
        tag: session.session_id,
      });
    }
  }

  function renderQueue() {
    elements.count.textContent = String(waitingCount);
    document.title = `(${waitingCount}) Staff Console`;
    elements.summary.textContent = sessions.length
      ? `${sessions.length} open ${sessions.length === 1 ? "conversation" : "conversations"}`
      : "No open requests";
    elements.queue.replaceChildren();

    if (!sessions.length) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "queue-empty";
      emptyItem.textContent = "No students are waiting right now.";
      elements.queue.append(emptyItem);
      return;
    }

    for (const session of sessions) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "queue-item-button";
      button.classList.toggle("is-selected", session.session_id === activeSessionId);
      button.classList.toggle("is-new", session.isNew);
      button.setAttribute("aria-label", `${shortId(session.session_id)}, ${session.status}, ${session.handoff_reason || "Help request"}`);
      const top = document.createElement("span");
      top.className = "queue-topline";
      const id = document.createElement("strong");
      id.className = "queue-id";
      id.textContent = shortId(session.session_id);
      const badge = document.createElement("span");
      badge.className = `status-badge status-${session.status}`;
      badge.textContent = session.status;
      top.append(id, badge);

      const reason = document.createElement("span");
      reason.className = "queue-reason";
      reason.textContent = session.handoff_reason || "Student requested a support team member.";

      const bottom = document.createElement("span");
      bottom.className = "queue-bottomline";
      const assignee = document.createElement("span");
      assignee.className = "queue-staff";
      assignee.textContent = session.assigned_staff ? `With ${session.assigned_staff}` : "Unassigned";
      const wait = document.createElement("time");
      wait.dateTime = session.requested_at || "";
      wait.textContent = elapsed(session.requested_at);
      bottom.append(assignee, wait);
      button.append(top, reason, bottom);
      button.addEventListener("click", () => openConversation(session));
      item.append(button);
      elements.queue.append(item);
    }
  }

  function updateWaitTimes() {
    for (const time of elements.queue.querySelectorAll("time[datetime]")) {
      time.textContent = elapsed(time.dateTime);
    }
  }

  async function pollQueue() {
    if (queueRequestInFlight) return;
    queueRequestInFlight = true;
    try {
      const data = await getQueue();
      const incoming = Array.isArray(data.sessions) ? data.sessions : [];
      waitingCount = Number.isFinite(Number(data.waiting_count))
        ? Number(data.waiting_count)
        : incoming.filter((session) => session.status === "waiting").length;
      const previousIds = new Set(sessions.map((session) => session.session_id));
      sessions = incoming.map((session) => {
        const isNew = session.status === "waiting" && !previousIds.has(session.session_id);
        if (isNew) notifyWaitingSession(session);
        return { ...session, isNew };
      });
      renderQueue();
      if (!activeSessionId) {
        const savedSessionId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
        const savedSession = sessions.find((session) => session.session_id === savedSessionId);
        if (savedSession) openConversation(savedSession);
        else if (savedSessionId) sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } finally {
      queueRequestInFlight = false;
    }
  }

  function appendTranscriptMessage(message) {
    const item = document.createElement("li");
    const sender = message.sender;
    item.className = `message-item is-${sender === "user" ? "user" : sender === "staff" ? "staff" : sender === "system" ? "system" : "ai"}`;
    if (sender === "system") {
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = message.message;
      item.append(bubble);
    } else {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      const name = document.createElement("strong");
      name.textContent = sender === "user" ? "Student" : sender === "staff" ? (message.staff_name || "Staff") : "AI";
      const time = document.createElement("time");
      time.textContent = formatTime(message.sent_at);
      meta.append(name, time);
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = message.message;
      item.append(meta, bubble);
    }
    elements.transcript.append(item);
    elements.transcript.scrollTop = elements.transcript.scrollHeight;
  }

  function addTranscriptMessages(messages, notifyNewUsers = false) {
    for (const message of messages) {
      const seq = Number(message.seq) || 0;
      lastSeq = Math.max(lastSeq, seq);
      const key = `${seq}|${message.sender}`;
      if (messageKeys.has(key)) continue;
      messageKeys.add(key);
      appendTranscriptMessage(message);
      if (notifyNewUsers && message.sender === "user" && !window.document.hasFocus()) beep();
    }
  }

  async function pollTranscript() {
    if (!activeSessionId) return;
    const data = await getTranscript(activeSessionId, lastSeq);
    addTranscriptMessages(Array.isArray(data.messages) ? data.messages : [], true);
  }

  async function openConversation(session) {
    loadGeneration += 1;
    const generation = loadGeneration;
    activeSessionId = session.session_id;
    sessionStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    lastSeq = 0;
    messageKeys.clear();
    chatPoller.stop();
    elements.empty.hidden = true;
    elements.active.hidden = false;
    elements.activeTitle.textContent = `Chat ${shortId(session.session_id)}`;
    elements.details.replaceChildren();
    for (const detailText of [
      `Status: ${session.status}`,
      `Assigned: ${session.assigned_staff || "Unassigned"}`,
      `Reason: ${session.handoff_reason || "Not provided"}`,
    ]) {
      const detail = document.createElement("span");
      detail.textContent = detailText;
      elements.details.append(detail);
    }
    elements.transcript.replaceChildren();
    elements.replyInput.value = "";
    renderQueue();
    try {
      const data = await getTranscript(session.session_id, 0);
      if (generation !== loadGeneration) return;
      addTranscriptMessages(Array.isArray(data.messages) ? data.messages : []);
      chatPoller.start();
    } catch (error) {
      if (generation === loadGeneration) showToast(error.message || "Unable to load this conversation.");
    }
  }

  function saveStaffName(value) {
    staffName = value.trim();
    if (!staffName) return false;
    localStorage.setItem(NAME_KEY, staffName);
    elements.nameDisplay.textContent = staffName;
    return true;
  }

  function requestStaffName() {
    elements.nameInput.value = staffName;
    if (!elements.nameDialog.open) elements.nameDialog.showModal();
    window.setTimeout(() => elements.nameInput.focus(), 0);
  }

  const queuePoller = createPoller(
    pollQueue,
    CONFIG.STAFF_QUEUE_POLL_MS,
    (error) => showToast(error.message || "Unable to refresh the queue."),
  );
  const chatPoller = createPoller(
    pollTranscript,
    CONFIG.STAFF_CHAT_POLL_MS,
    (error) => showToast(error.message || "Unable to update this conversation."),
  );

  elements.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (saveStaffName(elements.nameInput.value)) elements.nameDialog.close();
  });
  elements.changeName.addEventListener("click", requestStaffName);
  elements.notificationButton.addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    try {
      await Notification.requestPermission();
      updateNotificationButton();
    } catch {
      showToast("Notification permission could not be requested.");
    }
  });

  elements.replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.replyInput.value.trim();
    if (!activeSessionId || !message) return;
    const sessionId = activeSessionId;
    elements.replyInput.value = "";
    try {
      const result = await sendStaffReply(sessionId, message, staffName);
      if (activeSessionId !== sessionId) return;
      addTranscriptMessages([{
        seq: result.seq,
        sender: "staff",
        message,
        staff_name: staffName,
        sent_at: new Date().toISOString(),
      }]);
      const session = sessions.find((item) => item.session_id === sessionId);
      if (session) {
        if (session.status === "waiting") waitingCount = Math.max(0, waitingCount - 1);
        session.status = "active";
      }
      renderQueue();
    } catch (error) {
      elements.replyInput.value = message;
      showToast(error.message || "Your reply could not be sent.");
    }
  });

  elements.replyInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.replyForm.requestSubmit();
    }
  });

  elements.endChat.addEventListener("click", async () => {
    if (!activeSessionId || !window.confirm("End this conversation and return it to the AI help desk?")) return;
    const sessionId = activeSessionId;
    try {
      await closeChat(sessionId, staffName);
      const closedSession = sessions.find((session) => session.session_id === sessionId);
      if (closedSession?.status === "waiting") waitingCount = Math.max(0, waitingCount - 1);
      sessions = sessions.filter((session) => session.session_id !== sessionId);
      activeSessionId = "";
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      loadGeneration += 1;
      lastSeq = 0;
      messageKeys.clear();
      chatPoller.stop();
      elements.active.hidden = true;
      elements.empty.hidden = false;
      elements.transcript.replaceChildren();
      renderQueue();
    } catch (error) {
      showToast(error.message || "The conversation could not be closed.");
    }
  });

  window.setInterval(() => {
    if (sessions.length) updateWaitTimes();
  }, 1000);
  updateNotificationButton();
  if (!staffName) requestStaffName();
  else elements.nameDisplay.textContent = staffName;
  queuePoller.start();
})();