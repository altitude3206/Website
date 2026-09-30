/**
 * ALTITUDE 2026 — Advanced Core Configuration & System Diagnostics
 * Single-Instance DB Initializer, Network Integrity, and Comm Matrix
 * Rotaract District 3206 · Ooty Trekking Event · December 12-13, 2026
 * Project ID: nywnwnforqyrtdmsregq
 */

(function () {
  "use strict";

  const CONFIG = {
    // Debug & Version Control
    DEBUG: true,
    VERSION: "5.0.0",

    // Supabase Core Credentials
    SUPABASE_URL: "https://nywnwnforqyrtdmsregq.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY",

    // EmailJS Production Credentials
    EMAILJS_SERVICE_ID: "service_ojeg5q8",
    EMAILJS_PUBLIC_KEY: "M1tEIYjvJ0UmKdDW8",
    EMAILJS_PRIVATE_KEY: "yHsYhjdAwcEms79c9jroA",

    // Consolidated 2-Template Communications Matrix (Free Tier Optimized)
    EMAILJS_TEMPLATES: {
      OTP: "template_otp",
      NOTIFICATION: "template_notification"
    },

    // Permanent Event Specifications
    EVENT: {
      NAME: "ALTITUDE",
      YEAR: "2026",
      DATES: "December 12-13, 2026",
      LOCATION: "Ooty, Tamil Nadu",
      VENUE: "Nilgiri Hills, Ooty",
      FEE_INR: 3000,
      CHAIRPERSON: "Rtr. PP. Muruganandam",
      HOSTS: [
        "Rotaract Club of Coimbatore Unity",
        "Rotaract Club of Young Vibrants",
        "Rotaract Club of TNAU"
      ],
      BANK: {
        NAME: "HDFC Bank",
        ACCOUNT_NAME: "Rotaract Club of Coimbatore Unity",
        ACCOUNT_NUMBER: "50200083954561",
        IFSC_CODE: "HDFC0000031"
      }
    },

    // Real-Time System State Tracking
    STATE: {
      isOnline: navigator.onLine,
      dbInitialized: false,
      environment: null
    },

    // Micro-Logger Utility
    log: function (message, context = "SYSTEM") {
      if (this.DEBUG) {
        console.log(`%c[${context}] %c${message}`, "color: #4CAF50; font-weight: bold;", "color: inherit;");
      }
    },

    warn: function (message, context = "WARNING") {
      console.warn(`%c[${context}] ${message}`, "color: #FFA726; font-weight: bold;");
    },

    error: function (message, err = null, context = "ERROR") {
      console.error(`%c[${context}] ${message}`, "color: #EF5350; font-weight: bold;", err);
    }
  };

  // ==================== SECURITY & PROTOCOL DETECTION ====================
  function detectEnvironment() {
    const protocol = window.location.protocol;
    if (protocol === "file:") {
      CONFIG.STATE.environment = "local-file";
      CONFIG.warn(
        "Application loaded via 'file://' origin. Browsers strictly limit LocalStorage, Web Share APIs, Camera hardware permissions, and Fetch API network requests in this state. Please serve via local HTTP server.",
        "SECURITY"
      );
    } else if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      CONFIG.STATE.environment = "development-loopback";
      CONFIG.log("Running in development environment via localhost.", "ENVIRONMENT");
    } else {
      CONFIG.STATE.environment = "production";
      CONFIG.log("Running in secure production environment.", "ENVIRONMENT");
    }
  }

  // ==================== NETWORK CONNECTIVITY TRACKER ====================
  function initConnectivityTracker() {
    const updateNetworkStatus = () => {
      CONFIG.STATE.isOnline = navigator.onLine;
      if (navigator.onLine) {
        CONFIG.log("Internet link established.", "NETWORK");
        if (window.showToast) window.showToast("Your internet connection is restored.", "success");
      } else {
        CONFIG.warn("Internet connection dropped. Local offline queuing active.", "NETWORK");
        if (window.showToast) window.showToast("Network lost. Some features will queue offline.", "warning");
      }
    };

    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
  }

  // ==================== SUPABASE CORE ENGINE (Strict Singleton) ====================
  function initSupabaseCore() {
    // Enforce Singleton Pattern to prevent GoTrueClient duplicate warnings
    if (window.db || window.supabaseClient) {
      CONFIG.log("Active database instance already bound to global context. Skipping duplication.", "DATABASE");
      return;
    }

    if (typeof supabase !== "undefined" && supabase.createClient) {
      try {
        const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: "altitude_session_token_v5" // Isolated storage key to prevent token collisions
          }
        });

        // Set global references
        window.db = client;
        window.supabaseClient = client;
        CONFIG.STATE.dbInitialized = true;
        CONFIG.log("Quantum Database Engine fully loaded and mounted.", "DATABASE");

        // Dispatch global ready event
        window.dispatchEvent(new CustomEvent("dbReady", { detail: { db: client } }));
      } catch (err) {
        CONFIG.error("Failed to compile Database Engine constructor.", err, "DATABASE");
      }
    } else {
      // Dynamic retry loop to handle out-of-order DOM loading safely
      let checkAttempts = 0;
      const checkInterval = setInterval(() => {
        checkAttempts++;
        if (typeof supabase !== "undefined" && supabase.createClient) {
          clearInterval(checkInterval);
          initSupabaseCore();
        } else if (checkAttempts >= 50) { // Timeout after 5 seconds
          clearInterval(checkInterval);
          CONFIG.error("DOM Script injection timeout. Supabase library is missing.", null, "DATABASE");
        }
      }, 100);
    }
  }

  // ==================== EMAILJS CORE matrix ====================
  function initEmailJSCore() {
    if (typeof emailjs !== "undefined") {
      try {
        emailjs.init({
          publicKey: CONFIG.EMAILJS_PUBLIC_KEY,
          blockHeadless: true,
          limitRate: {
            id: "altitude_app_rate_limiter",
            throttle: 5000 // 5-second cooldown to block repetitive bot-spamming
          }
        });
        CONFIG.log("EmailJS Communication Matrix successfully mounted.", "COMM");
      } catch (err) {
        CONFIG.error("Failed to initialize EmailJS communication matrix.", err, "COMM");
      }
    } else {
      CONFIG.warn("EmailJS library not detected in DOM script register.", "COMM");
    }
  }

  // ==================== CONSOLE DIAGNOSTIC SUITE ====================
  window.AltitudeDiagnostics = function () {
    console.group("%c ALTITUDE v" + CONFIG.VERSION + " - CORE DIAGNOSTIC REPORT ", "background: #0D3B12; color: #fff; font-weight: bold; padding: 4px;");
    console.log("Database Status :", CONFIG.STATE.dbInitialized ? "🟢 ACTIVE" : "🔴 OFFLINE");
    console.log("Internet Link   :", CONFIG.STATE.isOnline ? "🟢 CONNECTED" : "🔴 OFFLINE");
    console.log("Environment     :", CONFIG.STATE.environment.toUpperCase());
    console.log("Project Ref ID  :", "nywnwnforqyrtdmsregq");
    console.log("Active Session  :", localStorage.getItem("altitude_session") ? "🟢 LOGGED IN" : "⚪ NO ACTIVE SESSION");
    console.log("Offline Queue   :", localStorage.getItem("altitude_offline_queue") ? JSON.parse(localStorage.getItem("altitude_offline_queue")).length + " pending items" : "0 items");
    console.log("Recent Scans    :", localStorage.getItem("altitude_recent_scans") ? JSON.parse(localStorage.getItem("altitude_recent_scans")).length + " cached scans" : "0 scans");
    console.groupEnd();
    return "Diagnostic fetch complete.";
  };

  // ==================== STARTUP INGESTION ====================
  detectEnvironment();
  initConnectivityTracker();
  initSupabaseCore();
  initEmailJSCore();

  // Expose configuration globally
  window.CONFIG = CONFIG;
})();