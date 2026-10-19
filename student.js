(() => {
  const elements = {
    messages: document.querySelector("#messages"),
    form: document.querySelector("#student-form"),
    input: document.querySelector("#student-input"),
    banner: document.querySelector("#connection-banner"),
    typing: document.querySelector("#typing-indicator"),
    newMessages: document.querySelector("#new-messages"),
    newChat: document.querySelector("#new-chat"),
    toast: document.querySelector("#toast"),
  };
  const SESSION_KEY = "qccHelpDeskSessionId";
  const seen = new Set();
  let sessionId = getOrCreateSessionId();
  let lastSeq = 0;
  let humanMode = false;
  let shouldAutoScroll = true;
  let toastTimer = null;

  function getOrCreateSessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 5000);
  }

  function formatTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function messageKey(message) {
    return `${message.seq}|${message.sender}`;
  }

  function scrollToLatest() {
    elements.messages.scrollTop = elements.messages.scrollHeight;
    shouldAutoScroll = true;
    elements.newMessages.hidden = true;
  }

  function noteNewContent() {
    if (shouldAutoScroll) scrollToLatest();
    else elements.newMessages.hidden = false;
  }

  function appendMessage({ sender, message, staff_name: staffName, sent_at: sentAt }, options = {}) {
    const item = document.createElement("li");
    item.className = `message-item is-${sender === "user" ? "user" : sender === "staff" ? "staff" : sender === "system" ? "system" : "ai"}`;

    if (sender === "system") {
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = message;
      item.append(bubble);
    } else {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      const name = document.createElement("strong");
      name.textContent = sender === "user" ? "You" : sender === "staff" ? (staffName || "Support team") : "IT Help Desk";
      const time = document.createElement("time");
      time.textContent = formatTime(sentAt);
      meta.append(name, time);

      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      if (sender === "ai") appendActionText(bubble, message);
      else bubble.textContent = message;
      item.append(meta, bubble);

      if (options.status) {
        const status = document.createElement("span");
        status.className = "message-status";
        status.textContent = options.status;
        item.append(status);
      }
    }

    elements.messages.append(item);
    noteNewContent();
    return item;
  }

  function appendActionText(container, text) {
    const tokenPattern = /\[([A-Z0-9_]+)\]/g;
    let cursor = 0;
    let match;
    const actions = [];
    while ((match = tokenPattern.exec(text)) !== null) {
      container.append(document.createTextNode(text.slice(cursor, match.index)));
      const action = CONFIG.ACTION_TOKENS[match[1]];
      if (action) actions.push(action);
      cursor = tokenPattern.lastIndex;
    }
    container.append(document.createTextNode(text.slice(cursor)));
    if (actions.length) {
      const actionRow = document.createElement("div");
      actionRow.className = "message-actions";
      for (const action of actions) {
        const link = document.createElement("a");
        link.className = "action-link";
        link.href = action.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = action.label;
        actionRow.append(link);
      }
      container.append(actionRow);
    }
  }

  function setHumanMode(enabled, status = "waiting", staffName = "") {
    humanMode = enabled;
    if (!enabled) {
      elements.banner.hidden = true;
      elements.banner.classList.remove("is-active");
      studentPoller.stop();
      return;
    }
    const active = status === "active" || Boolean(staffName);
    elements.banner.textContent = active
      ? `You're chatting with ${staffName || "a support team member"}.`
      : "Connecting you with a support team member...";
    elements.banner.classList.toggle("is-active", active);
    elements.banner.hidden = false;
    studentPoller.start();
  }

  async function pollStudentMessages() {
    const data = await getStudentMessages(sessionId, lastSeq);
    const messages = Array.isArray(data.messages) ? data.messages : [];
    for (const message of messages) {
      const seq = Number(message.seq) || 0;
      lastSeq = Math.max(lastSeq, seq);
      const key = messageKey(message);
      if (seen.has(key)) continue;
      seen.add(key);
      if (message.sender === "user" && !restoring) continue;
      appendMessage(message);
    }

    if (data.status === "closed" || data.human_mode === false) {
      setHumanMode(false);
    } else if (data.human_mode === true) {
      const newestStaff = [...messages].reverse().find((message) => message.sender === "staff");
      setHumanMode(true, data.status, newestStaff?.staff_name || "");
    }
  }

  let restoring = false;
  const studentPoller = createPoller(
    pollStudentMessages,
    CONFIG.STUDENT_POLL_MS,
    (error) => showToast(error.message || "Unable to update the conversation."),
  );

  async function restoreSession() {
    restoring = true;
    try {
      await pollStudentMessages();
    } catch (error) {
      showToast(error.message || "Unable to restore this conversation.");
    } finally {
      restoring = false;
    }
  }

  elements.messages.addEventListener("scroll", () => {
    const distanceFromBottom = elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight;
    shouldAutoScroll = distanceFromBottom < 48;
    if (shouldAutoScroll) elements.newMessages.hidden = true;
  });
  elements.newMessages.addEventListener("click", scrollToLatest);

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = elements.input.value.trim();
    if (!message) return;
    elements.input.value = "";
    const sentSessionId = sessionId;
    const userItem = appendMessage({ sender: "user", message, sent_at: new Date().toISOString() }, { status: humanMode ? "Sent" : "" });
    elements.input.focus();
    elements.typing.hidden = true;

    try {
      elements.typing.hidden = false;
      const data = await sendChatMessage(message, sentSessionId);
      if (sessionId !== sentSessionId) return;
      elements.typing.hidden = true;
      if (data.response) appendMessage({ sender: "ai", message: data.response, sent_at: new Date().toISOString() });
      if (data.human_mode === true) {
        if (data.status === "sent_to_agent") {
          let status = userItem.querySelector(".message-status");
          if (!status) {
            status = document.createElement("span");
            status.className = "message-status";
            userItem.append(status);
          }
          status.textContent = "Sent";
        }
        setHumanMode(true, data.status || "waiting");
      }
    } catch (error) {
      if (sessionId !== sentSessionId) return;
      elements.typing.hidden = true;
      showToast(error.message || "Your message could not be sent.");
    }
  });

  elements.newChat.addEventListener("click", () => {
    studentPoller.stop();
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
    lastSeq = 0;
    humanMode = false;
    seen.clear();
    elements.messages.replaceChildren();
    elements.banner.hidden = true;
    elements.banner.classList.remove("is-active");
    elements.newMessages.hidden = true;
    elements.input.value = "";
    elements.typing.hidden = true;
    shouldAutoScroll = true;
  });

  elements.form.querySelector("button[type='submit']").disabled = true;
  restoreSession().finally(() => {
    elements.form.querySelector("button[type='submit']").disabled = false;
  });
})();