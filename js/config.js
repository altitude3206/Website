/**
 * ============================================================
 * ALTITUDE — ENTERPRISE CORE CONFIGURATION & SYSTEM DIAGNOSTICS
 * ============================================================
 * Version: 8.0.0 | Codename: QUANTUM SHIELD
 * 
 * Single-Instance DB Initializer · RBAC Role Registry
 * Gmail Webhook Gateway · Network Integrity Monitor
 * PWA Lifecycle Manager · Session Security Engine
 * 
 * Rotaract District 3206 · Ooty Trekking Event
 * December 12-13, 2026 · Nilgiri Hills
 * Project ID: nywnwnforqyrtdmsregq
 * ============================================================
 */

(function () {
  "use strict";

  const CONFIG = {
    // ==================== VERSION CONTROL ====================
    DEBUG: window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1",
    VERSION: "8.0.0",
    CODENAME: "QUANTUM SHIELD",
    BUILD_TIMESTAMP: new Date().toISOString(),

    // ==================== SUPABASE CORE ====================
    SUPABASE_URL: "https://nywnwnforqyrtdmsregq.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY",

    // ==================== EMAIL COMMUNICATION GATEWAY ====================
    // Primary: Google Apps Script Webhook (Unlimited Volume, Zero Cost)
    GMAIL_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbysZVY8bD1dY2UuqikOODnqLFcjC7h9ZfndZyuMe0CVDRVYJ0sXsGwnQ32wHHA4SgJ9yw/exec",

    // Fallback: EmailJS (200 emails/month free tier)
    EMAILJS_SERVICE_ID: "service_ojeg5q8",
    EMAILJS_PUBLIC_KEY: "M1tEIYjvJ0UmKdDW8",
    EMAILJS_PRIVATE_KEY: "yHsYhjdAwcEms79c9jroA",

    // Template Registry (Maps to Google Apps Script template names)
    EMAIL_TEMPLATES: {
      OTP: "OTP",
      APPROVAL: "APPROVAL",
      REJECTION: "REJECTION",
      RECEIPT: "RECEIPT",
      PASS: "PASS"
    },

    // ==================== RBAC ROLE REGISTRY ====================
    ROLES: {
      SUPER_ADMIN: "super_admin",
      ADMIN: "admin",
      EVENT_TREASURER: "event_treasurer",
      EVENT_SECRETARY: "event_secretary",
      SCANNER: "scanner",
      VIEWER: "viewer"
    },

    ROLE_LABELS: {
      super_admin: "Super Administrator",
      admin: "Administrator",
      event_treasurer: "Event Treasurer",
      event_secretary: "Event Secretary",
      scanner: "Scanner Operator",
      viewer: "Read-Only Viewer"
    },

    // ==================== SECURITY PARAMETERS ====================
    SECURITY: {
      SESSION_HOURS: 8,
      OTP_LENGTH: 6,
      OTP_EXPIRY_MINUTES: 10,
      OTP_RESEND_COOLDOWN: 30,
      OTP_MAX_ATTEMPTS: 5,
      RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
      RATE_LIMIT_MAX_ATTEMPTS: 15,
      PASSWORD_MIN_LENGTH: 8,
      FINGERPRINT_ENABLED: true,
      TAMPER_DETECTION: true
    },

    // ==================== EVENT SPECIFICATIONS ====================
    EVENT: {
      NAME: "ALTITUDE",
      YEAR: "2026",
      DATES: "December 12-13, 2026",
      DATE_START: "2026-12-12",
      DATE_END: "2026-12-13",
      LOCATION: "Ooty, Tamil Nadu",
      VENUE: "Nilgiri Hills, Ooty",
      FEE_INR: 3000,
      CURRENCY: "INR",
      CHAIRPERSON: "Rtr. PP. Muruganandam",
      DISTRICT: "Rotaract RI District 3206",
      CONTACT_EMAIL: "altitude3206@gmail.com",
      HOSTS: [
        "Rotaract Club of Coimbatore Unity",
        "Rotaract Club of Young Vibrants",
        "Rotaract Club of TNAU"
      ],
      BANK: {
        NAME: "HDFC Bank",
        ACCOUNT_NAME: "Rotaract Club of Coimbatore Unity",
        ACCOUNT_NUMBER: "50200083954561",
        IFSC_CODE: "HDFC0000031",
        UPI_ID: "altitude3206@hdfcbank"
      }
    },

    // ==================== REAL-TIME SYSTEM STATE ====================
    STATE: {
      isOnline: navigator.onLine,
      dbInitialized: false,
      emailGatewayReady: false,
      environment: null,
      activeRole: null,
      sessionFingerprint: null,
      pwaInstalled: false,
      offlineQueueLength: 0
    },

    // ==================== PWA CONFIGURATION ====================
    PWA: {
      NAME: "ALTITUDE",
      SHORT_NAME: "ALTITUDE",
      THEME_COLOR: "#0D3B12",
      BACKGROUND_COLOR: "#0a0a0a",
      DISPLAY: "standalone",
      CACHE_HOURS: 1
    },

    // ==================== ANALYTICS CONFIG ====================
    ANALYTICS: {
      ENABLED: true,
      TRACK_PAGE_VIEWS: true,
      TRACK_EVENTS: true,
      CONSOLE_PREFIX: "[ALTITUDE]"
    },

    // ==================== MICRO-LOGGER UTILITY ====================
    log: function (message, context = "SYSTEM") {
      if (this.DEBUG) {
        const timestamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
        console.log(
          "%c[" + timestamp + "][" + context + "] %c" + message,
          "color: #4CAF50; font-weight: bold; font-family: monospace;",
          "color: inherit;"
        );
      }
    },

    warn: function (message, context = "WARNING") {
      const timestamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
      console.warn(
        "%c[" + timestamp + "][" + context + "] %c" + message,
        "color: #FFA726; font-weight: bold; font-family: monospace;",
        "color: #FFA726;"
      );
    },

    error: function (message, err = null, context = "ERROR") {
      const timestamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
      console.error(
        "%c[" + timestamp + "][" + context + "] %c" + message,
        "color: #EF5350; font-weight: bold; font-family: monospace;",
        "color: #EF5350;",
        err || ""
      );
    },

    // ==================== EMAIL DISPATCH HELPER ====================
    sendEmail: async function (template, recipientEmail, recipientName, data = {}) {
      const payload = {
        template: template,
        to_email: recipientEmail,
        to_name: recipientName,
        ...data
      };

      // Primary: Gmail Webhook
      if (this.GMAIL_WEBHOOK_URL && !this.GMAIL_WEBHOOK_URL.includes("YOUR_")) {
        try {
          await fetch(this.GMAIL_WEBHOOK_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          this.log("Email dispatched via Gmail Webhook: " + template + " -> " + recipientEmail, "MAIL");
          return true;
        } catch (err) {
          this.warn("Gmail Webhook failed, falling back to EmailJS.", "MAIL");
        }
      }

      // Fallback: EmailJS
      if (typeof emailjs !== "undefined") {
        try {
          emailjs.init(this.EMAILJS_PUBLIC_KEY);
          await emailjs.send(
            this.EMAILJS_SERVICE_ID,
            this.EMAILJS_TEMPLATES.NOTIFICATION,
            {
              to_name: recipientName,
              to_email: recipientEmail,
              email_subject: template + " — ALTITUDE",
              ...data
            },
            this.EMAILJS_PUBLIC_KEY
          );
          this.log("Email dispatched via EmailJS: " + template + " -> " + recipientEmail, "MAIL");
          return true;
        } catch (err) {
          this.error("EmailJS fallback also failed.", err, "MAIL");
        }
      }

      return false;
    }
  };

  // ==================== ENVIRONMENT DETECTION ====================
  function detectEnvironment() {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    if (protocol === "file:") {
      CONFIG.STATE.environment = "local-file";
      CONFIG.warn(
        "Application loaded via file:// protocol. LocalStorage, Camera, Web Share, and Fetch APIs are restricted. Serve via HTTP server for full functionality.",
        "SECURITY"
      );
    } else if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname)) {
      CONFIG.STATE.environment = "development";
      CONFIG.log("Development environment detected: " + hostname, "ENVIRONMENT");
    } else if (hostname.includes("netlify") || hostname.includes("vercel") || hostname.includes("github")) {
      CONFIG.STATE.environment = "staging";
      CONFIG.log("Staging environment detected: " + hostname, "ENVIRONMENT");
    } else {
      CONFIG.STATE.environment = "production";
      CONFIG.log("Production environment active: " + hostname, "ENVIRONMENT");
    }
  }

  // ==================== NETWORK CONNECTIVITY TRACKER ====================
  function initConnectivityTracker() {
    const updateStatus = () => {
      CONFIG.STATE.isOnline = navigator.onLine;
      if (navigator.onLine) {
        CONFIG.log("Network link established.", "NETWORK");
        if (window.showToast) window.showToast("Connection restored.", "success", 2000);
        flushOfflineQueue();
      } else {
        CONFIG.warn("Network lost. Offline mode active.", "NETWORK");
        if (window.showToast) window.showToast("Offline mode. Some features queued.", "warning", 4000);
      }
    };

    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
  }

  // ==================== OFFLINE QUEUE MANAGER ====================
  function flushOfflineQueue() {
    try {
      const raw = localStorage.getItem("altitude_offline_queue");
      if (!raw) return;
      const queue = JSON.parse(raw);
      if (queue.length === 0) return;

      CONFIG.log("Flushing " + queue.length + " queued offline actions.", "QUEUE");
      // Process queued items (extensible)
      localStorage.setItem("altitude_offline_queue", "[]");
      CONFIG.STATE.offlineQueueLength = 0;
    } catch (e) {}
  }

  function addToOfflineQueue(action, payload) {
    try {
      const raw = localStorage.getItem("altitude_offline_queue") || "[]";
      const queue = JSON.parse(raw);
      queue.push({ action, payload, timestamp: Date.now() });
      localStorage.setItem("altitude_offline_queue", JSON.stringify(queue));
      CONFIG.STATE.offlineQueueLength = queue.length;
      CONFIG.log("Action queued for offline sync: " + action, "QUEUE");
    } catch (e) {}
  }

  // ==================== SESSION FINGERPRINT ENGINE ====================
  async function generateSessionFingerprint() {
    if (!CONFIG.SECURITY.FINGERPRINT_ENABLED) return null;
    try {
      const data = [
        navigator.userAgent,
        navigator.language,
        screen.width + "x" + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 0,
        navigator.deviceMemory || 0,
        navigator.platform,
        CONFIG.STATE.environment
      ].join("|");

      const encoder = new TextEncoder();
      const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
      const fingerprint = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .substring(0, 16);

      CONFIG.STATE.sessionFingerprint = fingerprint;
      CONFIG.log("Session fingerprint generated: " + fingerprint.substring(0, 8) + "...", "SECURITY");
      return fingerprint;
    } catch (e) {
      CONFIG.STATE.sessionFingerprint = Math.random().toString(36).substring(2, 18);
      return CONFIG.STATE.sessionFingerprint;
    }
  }

  // ==================== SUPABASE CORE ENGINE (Strict Singleton) ====================
  function initSupabaseCore() {
    if (window.db || window.supabaseClient) {
      CONFIG.log("Database instance already bound. Skipping duplicate initialization.", "DATABASE");
      return;
    }

    if (typeof supabase !== "undefined" && supabase.createClient) {
      try {
        const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: "altitude_session_v8"
          },
          global: {
            headers: {
              "X-Client-Version": CONFIG.VERSION,
              "X-Client-Env": CONFIG.STATE.environment || "unknown"
            }
          },
          db: {
            schema: "public"
          },
          realtime: {
            params: {
              eventsPerSecond: 10
            }
          }
        });

        window.db = client;
        window.supabaseClient = client;
        CONFIG.STATE.dbInitialized = true;
        CONFIG.log("Quantum Database Engine v8.0 mounted successfully.", "DATABASE");

        window.dispatchEvent(new CustomEvent("dbReady", { detail: { db: client } }));
      } catch (err) {
        CONFIG.error("Database Engine constructor failed.", err, "DATABASE");
      }
    } else {
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        if (typeof supabase !== "undefined" && supabase.createClient) {
          clearInterval(check);
          initSupabaseCore();
        } else if (attempts >= 50) {
          clearInterval(check);
          CONFIG.error("Supabase library injection timeout (5s). Check script tags.", null, "DATABASE");
        }
      }, 100);
    }
  }

  // ==================== EMAILJS FALLBACK ENGINE ====================
  function initEmailJSCore() {
    if (typeof emailjs !== "undefined") {
      try {
        emailjs.init({
          publicKey: CONFIG.EMAILJS_PUBLIC_KEY,
          blockHeadless: true,
          limitRate: {
            id: "altitude_rate_limiter",
            throttle: 5000
          }
        });
        CONFIG.STATE.emailGatewayReady = true;
        CONFIG.log("EmailJS fallback gateway mounted.", "COMM");
      } catch (err) {
        CONFIG.error("EmailJS initialization failed.", err, "COMM");
      }
    } else {
      CONFIG.warn("EmailJS library not detected. Gmail Webhook is primary.", "COMM");
      // Gmail Webhook does not require client-side library
      CONFIG.STATE.emailGatewayReady = !!CONFIG.GMAIL_WEBHOOK_URL;
    }
  }

  // ==================== PWA LIFECYCLE MANAGER ====================
  function initPWALifecycle() {
    // Detect if running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      CONFIG.STATE.pwaInstalled = true;
      CONFIG.log("Running as installed PWA application.", "PWA");
    }

    // Capture install prompt
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      window._pwaInstallPrompt = e;
      CONFIG.log("PWA install prompt captured.", "PWA");
    });

    window.addEventListener("appinstalled", () => {
      CONFIG.STATE.pwaInstalled = true;
      CONFIG.log("PWA installed to device home screen.", "PWA");
    });
  }

  // ==================== CONSOLE DIAGNOSTIC SUITE ====================
  window.AltitudeDiagnostics = function () {
    const divider = "─".repeat(50);
    console.log("%c" + divider, "color: #2E7D32;");
    console.log(
      "%c ALTITUDE v" + CONFIG.VERSION + " (" + CONFIG.CODENAME + ") — DIAGNOSTIC REPORT ",
      "background: #0D3B12; color: #A5D6A7; font-weight: bold; padding: 6px 12px; font-size: 13px; border-radius: 4px;"
    );
    console.log("%c" + divider, "color: #2E7D32;");
    console.log("  Database       :", CONFIG.STATE.dbInitialized ? "ACTIVE" : "OFFLINE");
    console.log("  Email Gateway  :", CONFIG.STATE.emailGatewayReady ? "ACTIVE (Webhook + EmailJS)" : "DEGRADED");
    console.log("  Network Link   :", CONFIG.STATE.isOnline ? "CONNECTED" : "OFFLINE");
    console.log("  Environment    :", (CONFIG.STATE.environment || "UNKNOWN").toUpperCase());
    console.log("  PWA Status     :", CONFIG.STATE.pwaInstalled ? "INSTALLED" : "BROWSER");
    console.log("  Active Role    :", CONFIG.STATE.activeRole || "NONE");
    console.log("  Fingerprint    :", CONFIG.STATE.sessionFingerprint ? CONFIG.STATE.sessionFingerprint.substring(0, 8) + "..." : "NOT GENERATED");
    console.log("  Offline Queue  :", CONFIG.STATE.offlineQueueLength + " pending items");
    console.log("  Project ID     : nywnwnforqyrtdmsregq");
    console.log("  Build Time     :", CONFIG.BUILD_TIMESTAMP);
    console.log("%c" + divider, "color: #2E7D32;");
    return "Diagnostic complete.";
  };

  // ==================== GLOBAL HELPERS ====================
  window.addToOfflineQueue = addToOfflineQueue;

  // ==================== STARTUP SEQUENCE ====================
  detectEnvironment();
  initConnectivityTracker();
  generateSessionFingerprint();
  initSupabaseCore();
  initEmailJSCore();
  initPWALifecycle();

  // Expose configuration globally
  window.CONFIG = CONFIG;

  // Startup banner
  if (CONFIG.DEBUG) {
    console.log(
      "%c ALTITUDE v" + CONFIG.VERSION + " " + CONFIG.CODENAME + " %c " + CONFIG.EVENT.DATES + " · " + CONFIG.EVENT.LOCATION + " ",
      "background: #2E7D32; color: #fff; font-weight: bold; padding: 4px 8px; border-radius: 4px 0 0 4px;",
      "background: #1B5E20; color: #A5D6A7; padding: 4px 8px; border-radius: 0 4px 4px 0;"
    );
  }
})();
