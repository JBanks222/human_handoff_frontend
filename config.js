const CONFIG = {
  BASE_URL: "https://jalen222.app.n8n.cloud/webhook",
  CHAT_PATH: "782df198-c304-498e-b5ff-9e443f0b303c",
  STUDENT_POLL_MS: 3000,
  STAFF_QUEUE_POLL_MS: 5000,
  STAFF_CHAT_POLL_MS: 3000,
  ACTION_TOKENS: {
    CUNY_PASSWORD_RESET: {
      label: "Reset your CUNY password",
      url: "https://reset.cuny.edu/",
    },
    CUNY_MFA_TYPE: {
      label: "Manage CUNY MFA",
      url: "https://mfa.cuny.edu/",
    },
    TSSC_MFA_RESET: {
      label: "Request an MFA reset",
      url: "https://www.qcc.cuny.edu/its/",
    },
  },
};