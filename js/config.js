/**
 * ALTITUDE 2026 — Advanced Core Configuration & Diagnostics
 * Central Initialization, Performance Tracking, and Network Integrity Engine
 * Rotaract District 3206 · Ooty Trekking Event
 */

(function () {
  "use strict";

  const CONFIG = {
    // Environment Control
    DEBUG: true,
    VERSION: "4.1.0",

    // Supabase Credentials
    SUPABASE_URL: "https://nywnwnforqyrtdmsregq.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY",

    // EmailJS Credentials
    EMAILJS_SERVICE_ID: "service_ojeg5q8",
    EMAILJS_PUBLIC_KEY: "M1tEIYjvJ0UmKdDW8",
    EMAILJS_PRIVATE_KEY: "yHsYhjdAwcEms79c9jroA",

    // Optimized 2-Template System
    EMAILJS_TEMPLATES: {
      OTP: "template_otp",
      NOTIFICATION: "template_notification"
    },

    // Permanent Event Metadata
    EVENT: {
      NAME: "ALTITUDE",
      YEAR: "2026",
      DATES: "December 12-13, 2026",
      LOCATION: "Ooty, Tamil Nadu",
      VENUE: "Nilgiri Hills, Ooty",
      FEE_INR: 3000,
      DRR: "Rtr. PP. Muruganandam",
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

    // Centralized State & Diagnostics
    STATE: {
      isOnline: navigator.onLine,
      dbInitialized: false,
      environment: null
    },

    // Centralized System Logger
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

  // ==================== ENVIRONMENT & SECURITY CHECKS ====================
  function detectEnvironment() {
    const protocol = window.location.protocol;
    if (protocol === "file:") {
      CONFIG.STATE.environment = "local-file";
      CONFIG.warn(
        "Application loaded via file:// protocol. LocalStorage, camera hardware, and fetch API operations may fail due to browser security restrictions. Please serve files via local HTTP server.",
        "SECURITY"
      );
    } else if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      CONFIG.STATE.environment = "local-server";
      CONFIG.log("Running on development loopback server.", "ENVIRONMENT");
    } else {
      CONFIG.STATE.environment = "production";
      CONFIG.log("Running in secure production environment.", "ENVIRONMENT");
    }
  }

  // ==================== CONNECTIVITY TRACKER ====================
  function initConnectivityTracker() {
    const handleStatusChange = () => {
      CONFIG.STATE.isOnline = navigator.onLine;
      if (navigator.onLine) {
        CONFIG.log("Network connection restored.", "NETWORK");
        if (window.showToast) window.showToast("Your internet connection is restored.", "success");
      } else {
        CONFIG.warn("Internet connection lost. Offline mode active.", "NETWORK");
        if (window.showToast) window.showToast("Network connection lost. Please check your internet.", "warning");
      }
    };

    window.addEventListener("online", handleStatusChange);
    window.addEventListener("offline", handleStatusChange);
  }

  // ==================== SUPABASE CLIENT INITIALIZATION ====================
  function initSupabaseCore() {
    // Block multiple instantiations of GoTrueClient
    if (window.db) {
      CONFIG.log("Existing database client instance detected. Bypassing duplication.", "DATABASE");
      return;
    }

    if (typeof supabase !== "undefined" && supabase.createClient) {
      try {
        const client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: "altitude_session_token" // Custom isolated storage key
          }
        });

        // Attach globally as both db and supabaseClient
        window.db = client;
        window.supabaseClient = client;
        CONFIG.STATE.dbInitialized = true;
        CONFIG.log("Database core engine successfully initialized.", "DATABASE");

        // Dispatch a custom window event for modules waiting on DB initialization
        window.dispatchEvent(new CustomEvent("dbReady", { detail: { db: client } }));
      } catch (err) {
        CONFIG.error("Failed to initialize database core engine.", err, "DATABASE");
      }
    } else {
      // Retry safely if scripts are loaded out of order
      CONFIG.warn("Supabase library not yet loaded in DOM. Retrying initialization...", "DATABASE");
      let retries = 0;
      const retryInterval = setInterval(() => {
        retries++;
        if (typeof supabase !== "undefined" && supabase.createClient) {
          clearInterval(retryInterval);
          initSupabaseCore();
        } else if (retries >= 50) { // Timeout after 5 seconds
          clearInterval(retryInterval);
          CONFIG.error("Supabase script failed to load. Core engine initialization aborted.", null, "DATABASE");
        }
      }, 100);
    }
  }

  // ==================== EMAILJS INITIALIZATION ====================
  function initEmailJSCore() {
    if (typeof emailjs !== "undefined") {
      try {
        emailjs.init({
          publicKey: CONFIG.EMAILJS_PUBLIC_KEY,
          blockHeadless: true,
          limitRate: {
            id: "altitude_app",
            throttle: 5000 // 5-second cooldown to block spam bots
          }
        });
        CONFIG.log("EmailJS communication matrix initialized.", "EMAIL");
      } catch (err) {
        CONFIG.error("Failed to initialize EmailJS communication matrix.", err, "EMAIL");
      }
    } else {
      CONFIG.warn("EmailJS library not yet loaded in DOM.", "EMAIL");
    }
  }

  // ==================== CONTROLLED STARTUP ====================
  detectEnvironment();
  initConnectivityTracker();
  initSupabaseCore();
  initEmailJSCore();

  // Expose configuration globally
  window.CONFIG = CONFIG;
})();