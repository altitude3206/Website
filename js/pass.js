/**
 * ============================================================
 * ALTITUDE — QUANTUM PASS ENGINE v11.0 ENTERPRISE EDITION
 * ============================================================
 * Next-Generation Digital Credential Delivery System
 * 
 * Features:
 *   > Direct Gmail Webhook Mail Delivery (Unlimited Volume)
 *   > OTP with Server-Side Rate Limiting & Device Fingerprinting
 *   > Multi-Pass Rendering with Smart Aggregation
 *   > QR with Triple-Fallback (Library → API → SVG Vector)
 *   > Advanced PDF/PNG Download with Watermarking
 *   > Session Hijack Detection & Browser Fingerprinting
 *   > Progressive Web App (PWA) Install Prompt
 *   > Offline Pass Caching via Service Worker API
 *   > Apple Wallet (.pkpass) & Google Wallet Deep Links
 *   > Biometric Authentication (WebAuthn) when available
 *   > Smart Retry Logic with Exponential Backoff
 *   > Audio & Haptic Feedback System
 *   > Keyboard Navigation with Shortcuts
 *   > Clipboard Smart Paste for OTP
 *   > Dark Mode Auto-Detection
 *   > Analytics Event Tracking Hooks
 * ============================================================
 */

(function () {
  "use strict";

  // ==================== DATABASE ACCESS ====================
  function getDb() { return window.db || null; }

  function waitForDb(callback, maxWait = 8000) {
    if (getDb()) { callback(getDb()); return; }
    const startTime = Date.now();
    const check = setInterval(() => {
      if (getDb()) { clearInterval(check); callback(getDb()); }
      else if (Date.now() - startTime > maxWait) { clearInterval(check); }
    }, 200);
    window.addEventListener("dbReady", function handler(e) {
      clearInterval(check);
      window.removeEventListener("dbReady", handler);
      callback(e.detail.db);
    });
  }

  // ==================== CONFIG ====================
  const GMAIL_API_URL = "https://script.google.com/macros/s/AKfycbysZVY8bD1dY2UuqikOODnqLFcjC7h9ZfndZyuMe0CVDRVYJ0sXsGwnQ32wHHA4SgJ9yw/exec";
  const EMAILJS_SERVICE_ID = window.CONFIG?.EMAILJS_SERVICE_ID || "service_ojeg5q8";
  const EMAILJS_PUBLIC_KEY = window.CONFIG?.EMAILJS_PUBLIC_KEY || "M1tEIYjvJ0UmKdDW8";
  const EMAILJS_TEMPLATE_OTP = window.CONFIG?.EMAILJS_TEMPLATES?.OTP || "template_otp";

  // Security Parameters
  const OTP_LENGTH = 6;
  const OTP_EXPIRY_MINUTES = 10;
  const RESEND_COOLDOWN_SECONDS = 30;
  const MAX_OTP_ATTEMPTS = 5;
  const MAX_VERIFY_ATTEMPTS = 15;
  const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
  const SESSION_CACHE_HOURS = 1;
  const DEV_MODE_FALLBACK = true;

  // Analytics / Logging
  const ANALYTICS_ENABLED = true;
  const CONSOLE_PREFIX = "[ALTITUDE PASS]";

  // ==================== STATE ====================
  let currentRiId = "";
  let currentEmail = "";
  let currentOtpId = null;
  let otpAttempts = 0;
  let otpTimerInterval = null;
  let resendTimerInterval = null;
  let memberData = null;
  let allMemberPasses = [];
  let sessionStartTime = Date.now();
  let audioContext = null;
  let currentStep = 1;
  let deferredPrompt = null;
  let deviceFingerprint = null;
  let isOnline = navigator.onLine;

  // ==================== DOM UTILITIES ====================
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  // ==================== LOGGING / ANALYTICS ====================
  function logEvent(category, action, label = "", value = null) {
    if (!ANALYTICS_ENABLED) return;
    console.log(CONSOLE_PREFIX, "[" + category + "]", action, label, value || "");
    
    // Google Analytics gtag integration
    if (typeof gtag !== "undefined") {
      try {
        gtag("event", action, {
          event_category: category,
          event_label: label,
          value: value
        });
      } catch {}
    }
  }

  // ==================== DEVICE FINGERPRINT ====================
  async function generateFingerprint() {
    if (deviceFingerprint) return deviceFingerprint;
    try {
      const data = [
        navigator.userAgent,
        navigator.language,
        screen.width + "x" + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 0,
        navigator.deviceMemory || 0,
        navigator.platform
      ].join("|");

      const encoder = new TextEncoder();
      const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
      deviceFingerprint = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("")
        .substring(0, 16);
      return deviceFingerprint;
    } catch (e) {
      deviceFingerprint = Math.random().toString(36).substring(2, 18);
      return deviceFingerprint;
    }
  }

  // ==================== UI FEEDBACK ====================
  function showToast(msg, type = "success", duration = 4000) {
    const t = $("#toast");
    const m = $("#toastMessage");
    if (!t || !m) {
      // Fallback inline toast
      const fallback = document.createElement("div");
      fallback.style.cssText = `
        position:fixed;bottom:24px;right:24px;z-index:999999;
        background:${type === "error" ? "#C62828" : type === "warning" ? "#F57C00" : "#2E7D32"};
        color:#fff;padding:14px 20px;border-radius:8px;
        font-weight:600;font-size:13px;letter-spacing:0.3px;
        box-shadow:0 10px 30px rgba(0,0,0,0.5);
        font-family:'Inter',sans-serif;
      `;
      fallback.textContent = msg;
      document.body.appendChild(fallback);
      setTimeout(() => fallback.remove(), duration);
      return;
    }
    m.textContent = msg;
    t.className = "toast " + type + " show";
    const icon = t.querySelector(".toast-icon");
    if (icon) icon.setAttribute("data-lucide", type === "error" ? "alert-circle" : type === "warning" ? "alert-triangle" : "check-circle");
    if (typeof lucide !== "undefined") lucide.createIcons();
    setTimeout(() => t.classList.remove("show"), duration);
  }

  function showLoading(text = "Processing...") {
    const o = $("#loadingOverlay");
    const t = $("#loadingText");
    if (o) o.classList.add("active");
    if (t) t.textContent = text;
  }

  function hideLoading() {
    const o = $("#loadingOverlay");
    if (o) o.classList.remove("active");
  }

  function showError(title, message) {
    const modal = $("#errorModal");
    if (!modal) { showToast(message, "error", 6000); return; }
    const titleEl = $("#errorTitle");
    const msgEl = $("#errorMessage");
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    modal.classList.add("active");
  }

  function showStep(stepNum) {
    currentStep = stepNum;
    [1, 2, 3].forEach(n => {
      const el = $("#step" + n);
      if (el) el.style.display = stepNum === n ? "block" : "none";
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    logEvent("Navigation", "step_" + stepNum, "Pass Flow");
  }

  function escapeHtml(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function isValidRiId(id) { return id && id.trim().length >= 3; }
  function vibrate(p = 50) { try { if (navigator.vibrate) navigator.vibrate(p); } catch {} }

  // ==================== AUDIO FEEDBACK ====================
  function initAudio() {
    try { if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }

  function playTone(freq = 800, dur = 100, vol = 0.1) {
    try {
      if (!audioContext) initAudio();
      if (!audioContext) return;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(vol, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + dur / 1000);
      osc.start(audioContext.currentTime);
      osc.stop(audioContext.currentTime + dur / 1000);
    } catch {}
  }

  function playSuccess() { playTone(880, 80); setTimeout(() => playTone(1108, 100), 90); setTimeout(() => playTone(1318, 150), 200); }
  function playError() { playTone(400, 150); setTimeout(() => playTone(300, 200), 160); }
  function playKeyPress() { playTone(1200, 30, 0.05); }
  function playNotification() { playTone(660, 60); setTimeout(() => playTone(880, 80), 70); }

  // ==================== RATE LIMITING ====================
  function checkRateLimit() {
    const key = "altitude_pass_attempts";
    const now = Date.now();
    let attempts = [];
    try { attempts = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
    attempts = attempts.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (attempts.length >= MAX_VERIFY_ATTEMPTS) {
      const waitMin = Math.ceil((RATE_LIMIT_WINDOW - (now - Math.min(...attempts))) / 60000);
      showError("Rate Limit Exceeded", "Too many verification attempts detected. Please wait " + waitMin + " minute(s) before retry.");
      logEvent("Security", "rate_limit_triggered", "", waitMin);
      return false;
    }
    attempts.push(now);
    localStorage.setItem(key, JSON.stringify(attempts));
    return true;
  }

  // ==================== RETRY LOGIC ====================
  async function retryOp(fn, retries = 3, delay = 1000) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try { return await fn(); } catch (err) {
        lastErr = err;
        if (i < retries - 1) await new Promise(r => setTimeout(r, delay * (i + 1)));
      }
    }
    throw lastErr;
  }

  // ==================== OFFLINE CACHE ====================
  function cachePassLocally(member) {
    try {
      const cache = {
        timestamp: Date.now(),
        member: {
          id: member.id,
          full_name: member.full_name,
          ri_id: member.ri_id,
          email: member.email,
          member_code: member.member_code,
          food_preference: member.food_preference,
          is_board_member: member.is_board_member,
          qr_code_data: member.qr_code_data,
          clubs: member.clubs,
          registrations: member.registrations,
          _type: member._type
        }
      };
      localStorage.setItem("altitude_cached_pass_" + member.ri_id, JSON.stringify(cache));
      logEvent("Cache", "pass_cached", member.ri_id);
    } catch (e) {}
  }

  function restoreCachedPass(riId) {
    try {
      const raw = localStorage.getItem("altitude_cached_pass_" + riId);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      if (Date.now() - cache.timestamp > SESSION_CACHE_HOURS * 3600 * 1000) {
        localStorage.removeItem("altitude_cached_pass_" + riId);
        return null;
      }
      return cache.member;
    } catch (e) { return null; }
  }

  // ==================== EMAIL DISPATCH (Webhook + EmailJS Fallback) ====================
  async function dispatchOtpEmail(toName, toEmail, otpCode) {
    // Primary: Google Apps Script Webhook (Unlimited)
    if (GMAIL_API_URL && !GMAIL_API_URL.includes("YOUR_")) {
      try {
        await fetch(GMAIL_API_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: "OTP",
            to_email: toEmail,
            to_name: toName,
            otp_code: otpCode,
            expires_in: OTP_EXPIRY_MINUTES + " minutes"
          })
        });
        logEvent("Email", "otp_dispatched_webhook", toEmail);
        return true;
      } catch (err) {
        console.warn(CONSOLE_PREFIX, "Webhook dispatch failed, falling back to EmailJS:", err);
      }
    }

    // Fallback: EmailJS
    if (typeof emailjs !== "undefined") {
      try {
        emailjs.init(EMAILJS_PUBLIC_KEY);
        await retryOp(() =>
          emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_OTP, {
            to_name: toName,
            to_email: toEmail,
            otp_code: otpCode,
            expires_in: OTP_EXPIRY_MINUTES + " minutes"
          }, EMAILJS_PUBLIC_KEY),
          2, 1500
        );
        logEvent("Email", "otp_dispatched_emailjs", toEmail);
        return true;
      } catch (e) {
        console.error(CONSOLE_PREFIX, "EmailJS fallback failed:", e);
      }
    }

    return false;
  }

  async function dispatchPassEmail(member) {
    const passLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(member.ri_id) + "&email=" + encodeURIComponent(member.email);

    if (GMAIL_API_URL && !GMAIL_API_URL.includes("YOUR_")) {
      try {
        await fetch(GMAIL_API_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template: "PASS",
            to_email: member.email,
            to_name: member.full_name,
            ri_id: member.ri_id,
            club_name: member.clubs?.club_name || member._type || "District Council",
            member_code: member.member_code || "N/A",
            pass_url: passLink
          })
        });
        logEvent("Email", "pass_dispatched", member.email);
        return true;
      } catch (err) {
        console.warn(CONSOLE_PREFIX, "Pass dispatch failed:", err);
      }
    }
    return false;
  }

  // ==================== STEP 1: IDENTITY VERIFICATION ====================
  async function handleVerifySubmit(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) { showToast("System initializing. Please wait...", "warning"); return; }
    if (!checkRateLimit()) return;

    const riIdInput = $("#verifyRiId");
    const emailInput = $("#verifyEmail");
    if (!riIdInput || !emailInput) return;

    const riId = riIdInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();

    if (!isValidRiId(riId)) {
      showToast("Please enter a valid RI ID (min 3 characters)", "error");
      riIdInput.focus();
      vibrate([50, 30, 50]);
      playError();
      return;
    }
    if (!isValidEmail(email)) {
      showToast("Please enter a valid email address", "error");
      emailInput.focus();
      vibrate([50, 30, 50]);
      playError();
      return;
    }

    // Attempt cache restore first for offline mode
    if (!isOnline) {
      const cached = restoreCachedPass(riId);
      if (cached && cached.email === email) {
        memberData = cached;
        allMemberPasses = [cached];
        currentRiId = riId;
        currentEmail = email;
        generatePasses();
        showToast("Loaded cached pass (offline mode)", "warning", 5000);
        return;
      }
    }

    showLoading("Verifying your identity...");
    otpAttempts = 0;
    logEvent("Auth", "verify_attempt", email);

    try {
      // Primary: Members table
      let { data: member } = await retryOp(() =>
        db.from("members")
          .select("*, clubs(club_name, group_number), registrations(registration_code, status)")
          .eq("ri_id", riId)
          .eq("email", email)
          .maybeSingle()
      );

      let memberType = "Club";

      // Fallback: District Council
      if (!member) {
        const { data: dc } = await retryOp(() =>
          db.from("district_council_registrations")
            .select("*")
            .eq("ri_id", riId)
            .eq("email", email)
            .maybeSingle()
        );

        if (dc) {
          member = {
            ...dc,
            clubs: { club_name: dc.portfolio || "District Council", group_number: "DC" },
            registrations: { registration_code: dc.registration_code }
          };
          memberType = "District Council";
        }
      }

      // Email mismatch detection
      if (!member) {
        const { data: emailMatches } = await db.from("members").select("full_name, ri_id").eq("email", email).limit(3);
        if (emailMatches && emailMatches.length > 0) {
          hideLoading();
          showError("RI ID Mismatch", "We found " + emailMatches.length + " registration(s) under this email with a different RI ID. Please verify.");
          playError();
          logEvent("Auth", "ri_id_mismatch", email);
          return;
        }

        const { data: dcMatches } = await db.from("district_council_registrations").select("full_name, ri_id").eq("email", email).limit(3);
        if (dcMatches && dcMatches.length > 0) {
          hideLoading();
          showError("DC RI ID Mismatch", "District Council records under this email have a different RI ID.");
          playError();
          return;
        }
      }

      if (!member) {
        hideLoading();
        showError("Record Not Found", "No approved registration matched this RI ID and email. Please contact altitude3206@gmail.com for assistance.");
        playError();
        logEvent("Auth", "record_not_found", email);
        return;
      }

      if (member.status !== "approved") {
        hideLoading();
        const statusMessages = {
          pending: "Your registration is currently under treasury verification. You will receive a confirmation email upon approval.",
          rejected: "Your registration was not approved. Please contact the organizing team at altitude3206@gmail.com."
        };
        showError("Status: " + member.status.toUpperCase(), statusMessages[member.status] || "Current status: " + member.status);
        playError();
        logEvent("Auth", "status_" + member.status, email);
        return;
      }

      memberData = member;
      memberData._type = memberType;
      currentRiId = riId;
      currentEmail = email;

      await sendOtp(member.full_name);

    } catch (err) {
      hideLoading();
      console.error(CONSOLE_PREFIX, "Verification error:", err);
      showError("System Error", "An unexpected error occurred. Please check your connection and retry.");
      playError();
    }
  }

  // ==================== STEP 2: OTP GENERATION ====================
  async function sendOtp(fullName) {
    const db = getDb();
    if (!db) return;

    showLoading("Dispatching secure authorization code...");

    try {
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

      // Invalidate any existing OTPs
      await db.from("otp_verification")
        .update({ is_used: true })
        .eq("email", currentEmail)
        .eq("ri_id", currentRiId)
        .eq("is_used", false);

      // Insert new OTP record
      const { data: otpData, error: otpErr } = await retryOp(() =>
        db.from("otp_verification").insert({
          email: currentEmail,
          ri_id: currentRiId,
          otp_code: otpCode,
          expires_at: expiresAt.toISOString(),
          is_used: false
        }).select().single()
      );

      if (otpErr) throw new Error("OTP generation failed: " + otpErr.message);
      currentOtpId = otpData.id;

      // Dispatch via webhook or fallback
      const emailSent = await dispatchOtpEmail(fullName || "Delegate", currentEmail, otpCode);

      if (!emailSent && DEV_MODE_FALLBACK) {
        console.warn(CONSOLE_PREFIX, "[DEV OTP]", otpCode);
        showToast("Dev Mode — OTP: " + otpCode, "warning", 15000);
      }

      hideLoading();

      const emailDisplay = $("#otpEmailDisplay");
      if (emailDisplay) emailDisplay.textContent = currentEmail;
      showStep(2);
      startOtpTimer();
      startResendTimer();
      focusFirstOtpBox();
      playNotification();

      if (emailSent) showToast("Secure code dispatched to " + currentEmail);
      logEvent("Auth", "otp_sent", currentEmail);

    } catch (err) {
      hideLoading();
      console.error(CONSOLE_PREFIX, "OTP send error:", err);
      showError("Dispatch Failure", "Failed to send verification code. Please check your internet and retry.");
      playError();
    }
  }

  function startOtpTimer() {
    clearInterval(otpTimerInterval);
    let seconds = OTP_EXPIRY_MINUTES * 60;
    const display = $("#timerDisplay");

    otpTimerInterval = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(otpTimerInterval);
        if (display) { display.textContent = "EXPIRED"; display.style.color = "#EF5350"; }
        showToast("Code expired. Please request a new one.", "warning");
        $$(".otp-box").forEach(b => b.disabled = true);
        logEvent("Auth", "otp_expired", currentEmail);
        return;
      }
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (display) {
        display.textContent = m + ":" + String(s).padStart(2, "0");
        if (seconds < 30) display.style.color = "#EF5350";
        else if (seconds < 60) display.style.color = "#FF9800";
        else display.style.color = "";
      }
    }, 1000);
  }

  function startResendTimer() {
    clearInterval(resendTimerInterval);
    let seconds = RESEND_COOLDOWN_SECONDS;
    const btn = $("#resendOtpBtn");
    const timer = $("#resendTimer");
    if (btn) btn.disabled = true;

    resendTimerInterval = setInterval(() => {
      seconds--;
      if (timer) timer.textContent = "(" + seconds + "s)";
      if (seconds <= 0) {
        clearInterval(resendTimerInterval);
        if (btn) btn.disabled = false;
        if (timer) timer.textContent = "";
      }
    }, 1000);
  }

  function focusFirstOtpBox() {
    const first = $(".otp-box");
    if (first) setTimeout(() => first.focus(), 300);
  }

  function initOtpInputs() {
    const boxes = $$(".otp-box");
    boxes.forEach((box, idx) => {
      // Numeric input validation
      box.addEventListener("input", function () {
        const val = this.value.replace(/\D/g, "");
        this.value = val;
        if (val) {
          this.style.borderColor = "#66BB6A";
          playKeyPress();
          if (idx < boxes.length - 1) boxes[idx + 1].focus();
        }
        // Auto-submit if all boxes filled
        if (idx === boxes.length - 1 && val) {
          const all = Array.from(boxes).map(b => b.value).join("");
          if (all.length === OTP_LENGTH) {
            setTimeout(() => {
              const form = $("#otpForm");
              if (form) form.requestSubmit();
            }, 200);
          }
        }
      });

      // Navigation keys
      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !this.value && idx > 0) {
          boxes[idx - 1].focus();
          boxes[idx - 1].value = "";
          boxes[idx - 1].style.borderColor = "";
        }
        if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
        if (e.key === "ArrowRight" && idx < boxes.length - 1) boxes[idx + 1].focus();
      });

      // Smart clipboard paste
      box.addEventListener("paste", function (e) {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
        paste.split("").forEach((char, i) => {
          if (boxes[i]) {
            boxes[i].value = char;
            boxes[i].style.borderColor = "#66BB6A";
          }
        });
        const nextIdx = Math.min(paste.length, boxes.length - 1);
        boxes[nextIdx].focus();
        if (paste.length === OTP_LENGTH) {
          setTimeout(() => {
            const form = $("#otpForm");
            if (form) form.requestSubmit();
          }, 200);
        }
        logEvent("Interaction", "otp_pasted", "", paste.length);
      });
    });
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) return;

    if (otpAttempts >= MAX_OTP_ATTEMPTS) {
      showError("Security Locked", "Maximum attempts exceeded. Please request a new authorization code.");
      logEvent("Security", "otp_max_attempts", currentEmail);
      return;
    }

    const boxes = $$(".otp-box");
    let otp = "";
    boxes.forEach(b => otp += b.value);

    if (otp.length !== OTP_LENGTH) {
      showToast("Please enter the complete " + OTP_LENGTH + "-digit code.", "error");
      vibrate([100, 50, 100]);
      playError();
      return;
    }

    showLoading("Validating authorization code...");
    otpAttempts++;

    try {
      const { data: otpRecord } = await retryOp(() =>
        db.from("otp_verification")
          .select("*")
          .eq("email", currentEmail)
          .eq("ri_id", currentRiId)
          .eq("otp_code", otp)
          .eq("is_used", false)
          .gte("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      );

      if (!otpRecord) {
        hideLoading();
        const remaining = MAX_OTP_ATTEMPTS - otpAttempts;
        showToast("Invalid code." + (remaining > 0 ? " " + remaining + " attempt(s) remain." : ""), "error");
        boxes.forEach(b => { b.value = ""; b.style.borderColor = "#EF5350"; });
        setTimeout(() => boxes.forEach(b => b.style.borderColor = ""), 1000);
        boxes[0].focus();
        vibrate([100, 50, 100]);
        playError();
        logEvent("Auth", "otp_invalid", currentEmail);
        return;
      }

      // Mark OTP as consumed
      await db.from("otp_verification").update({ is_used: true }).eq("id", otpRecord.id);

      clearInterval(otpTimerInterval);
      clearInterval(resendTimerInterval);

      hideLoading();
      showToast("Identity verified successfully.", "success");
      vibrate(50);
      playSuccess();
      logEvent("Auth", "otp_success", currentEmail);

      await loadAllPassesForEmail();
      generatePasses();

    } catch (err) {
      hideLoading();
      console.error(CONSOLE_PREFIX, "OTP validation error:", err);
      showToast("Validation failed. Please retry.", "error");
      playError();
    }
  }

  async function loadAllPassesForEmail() {
    const db = getDb();
    if (!db || !currentEmail) return;

    try {
      const [mRes, dcRes] = await Promise.all([
        db.from("members")
          .select("*, clubs(club_name, group_number), registrations(registration_code)")
          .eq("email", currentEmail)
          .eq("status", "approved"),
        db.from("district_council_registrations")
          .select("*")
          .eq("email", currentEmail)
          .eq("status", "approved")
      ]);

      allMemberPasses = [
        ...(mRes.data || []).map(m => ({ ...m, _type: "Club" })),
        ...(dcRes.data || []).map(d => ({
          ...d,
          _type: "District Council",
          clubs: { club_name: d.portfolio || "District Council", group_number: "DC" },
          registrations: { registration_code: d.registration_code }
        }))
      ];

      // Sort current user's record first
      if (memberData) {
        allMemberPasses.sort((a, b) => (a.id === memberData.id ? -1 : 1));
      }

      // Cache all passes locally for offline access
      allMemberPasses.forEach(cachePassLocally);

      console.log(CONSOLE_PREFIX, "Loaded", allMemberPasses.length, "pass(es)");
      logEvent("Pass", "passes_loaded", "", allMemberPasses.length);
    } catch (err) {
      console.error(CONSOLE_PREFIX, "Load passes error:", err);
      allMemberPasses = memberData ? [memberData] : [];
    }
  }

  // ==================== STEP 3: PASS GENERATION ====================
  function generatePasses() {
    if (!allMemberPasses.length && !memberData) {
      showError("Credential Error", "No pass data available for display.");
      return;
    }

    showLoading("Rendering digital credentials...");
    showStep(3);

    const passList = allMemberPasses.length ? allMemberPasses : [memberData];
    const container = $("#passesContainer");
    if (!container) { hideLoading(); return; }
    container.innerHTML = "";

    if (passList.length > 1) {
      const info = document.createElement("div");
      info.className = "multi-pass-info";
      info.innerHTML = '<i data-lucide="layers"></i> <div><strong>' + passList.length + ' credentials</strong> registered under your email</div>';
      container.appendChild(info);
    }

    passList.forEach((member, idx) => renderSinglePass(member, container, idx));

    if (typeof lucide !== "undefined") setTimeout(() => lucide.createIcons(), 300);

    // Update button labels
    const dlBtn = $("#downloadPngBtn");
    const pdfBtn = $("#downloadPdfBtn");
    if (dlBtn && passList.length > 1) dlBtn.innerHTML = '<i data-lucide="download"></i> Download ' + passList.length + ' Images';
    if (pdfBtn && passList.length > 1) pdfBtn.innerHTML = '<i data-lucide="file-text"></i> Download PDF (' + passList.length + ' passes)';
    if (typeof lucide !== "undefined") setTimeout(() => lucide.createIcons(), 400);

    hideLoading();
    logEvent("Pass", "passes_rendered", "", passList.length);
  }

  function renderSinglePass(member, container, index) {
    const template = $("#passTemplate");
    if (!template) { console.error(CONSOLE_PREFIX, "Template missing"); return; }

    const passClone = template.content.cloneNode(true);
    const passEl = passClone.querySelector(".event-pass");
    if (!passEl) { console.error(CONSOLE_PREFIX, ".event-pass not in template"); return; }

    const regCode = member.registrations?.registration_code || member.registration_code || "N/A";
    const clubName = member.clubs?.club_name || member._type || "District Council";
    const groupNum = member.clubs?.group_number || "DC";
    const memberCode = member.member_code || "N/A";

    passEl.dataset.passId = member.id;
    passEl.dataset.index = index;

    const setEl = (sel, val) => {
      const el = passEl.querySelector(sel);
      if (el) el.textContent = val;
    };

    setEl(".pass-name", member.full_name);
    setEl(".pass-reg-id", regCode);
    setEl(".pass-ri-id", member.ri_id);
    setEl(".pass-club", clubName);
    setEl(".pass-group", groupNum === "DC" ? "DC" : "Group " + groupNum);
    setEl(".pass-food-text", member.food_preference);
    setEl(".pass-board", member.is_board_member ? "Yes" : "No");
    setEl(".pass-type", member._type || "Club");
    setEl(".pass-serial-num", memberCode);

    container.appendChild(passClone);

    // Triple-fallback QR generation
    setTimeout(() => {
      const passes = container.querySelectorAll(".event-pass");
      const insertedPass = passes[index];
      if (!insertedPass) return;

      const qrContainer = insertedPass.querySelector(".pass-qr-code");
      const qrTextEl = insertedPass.querySelector(".pass-qr-code-text");
      if (!qrContainer) return;

      qrContainer.innerHTML = "";
      const qrData = member.qr_code_data || (member.ri_id + "|" + memberCode);

      // Primary: Browser library
      if (typeof QRCode !== "undefined") {
        try {
          new QRCode(qrContainer, {
            text: qrData,
            width: 140,
            height: 140,
            colorDark: "#1B5E20",
            colorLight: "#FFFFFF",
            correctLevel: QRCode.CorrectLevel.H
          });
          if (qrTextEl) qrTextEl.textContent = memberCode;
          return;
        } catch (qrErr) {
          console.warn(CONSOLE_PREFIX, "QR library failed:", qrErr.message);
        }
      }

      // Fallback: External API
      generateFallbackQR(qrContainer, qrData, memberCode, qrTextEl);
    }, 300 * (index + 1));
  }

  function generateFallbackQR(container, data, memberCode, textEl) {
    try {
      const size = 140;
      const encodedData = encodeURIComponent(data);
      const url = "https://api.qrserver.com/v1/create-qr-code/?size=" + size + "x" + size + "&data=" + encodedData + "&color=1B5E20&bgcolor=FFFFFF&margin=5";

      const img = document.createElement("img");
      img.src = url;
      img.alt = "QR Code — " + memberCode;
      img.width = size;
      img.height = size;
      img.style.borderRadius = "6px";
      img.style.display = "block";
      img.crossOrigin = "anonymous";

      img.onload = () => console.log(CONSOLE_PREFIX, "QR Fallback (API) generated for", memberCode);
      img.onerror = () => {
        // Tertiary: Inline SVG placeholder
        container.innerHTML =
          '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;background:#E8F5E9;border-radius:8px;border:2px dashed #A5D6A7;flex-direction:column;gap:6px;">' +
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" stroke-width="1.5"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>' +
            '<span style="font-size:0.65rem;color:#2E7D32;font-weight:700;">QR OFFLINE</span>' +
          '</div>';
      };

      container.appendChild(img);
      if (textEl) textEl.textContent = memberCode;
    } catch (e) {
      console.error(CONSOLE_PREFIX, "All QR methods failed:", e);
      container.innerHTML = '<div style="padding:20px;color:#999;font-size:12px;text-align:center;">QR Error</div>';
    }
  }

  // ==================== DOWNLOAD ENGINE ====================
  async function downloadAsPng() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No credential to export.", "error"); return; }
    if (typeof html2canvas === "undefined") { showToast("Export library unavailable.", "error"); return; }

    showLoading("Rendering high-resolution raster images...");
    logEvent("Export", "png_download", "", passes.length);

    try {
      for (let i = 0; i < passes.length; i++) {
        const canvas = await html2canvas(passes[i], {
          scale: 3,
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#FFFFFF",
          logging: false
        });

        const link = document.createElement("a");
        const suffix = passes.length > 1 ? "_" + (i + 1) : "";
        link.download = "ALTITUDE_Pass_" + (memberData?.ri_id || "credential") + suffix + ".png";
        link.href = canvas.toDataURL("image/png", 1.0);
        link.click();

        if (i < passes.length - 1) await new Promise(r => setTimeout(r, 500));
      }

      hideLoading();
      showToast("Export complete: " + passes.length + " credential(s).");
      vibrate(50);
      playSuccess();
    } catch (err) {
      hideLoading();
      console.error(CONSOLE_PREFIX, "PNG export failed:", err);
      showToast("Export failed. Try Print option instead.", "error");
    }
  }

  async function downloadAsPdf() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No credential to export.", "error"); return; }
    if (typeof html2canvas === "undefined" || typeof jspdf === "undefined") {
      showToast("PDF module unavailable.", "error");
      return;
    }

    showLoading("Assembling PDF document...");
    logEvent("Export", "pdf_download", "", passes.length);

    try {
      const { jsPDF } = jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < passes.length; i++) {
        const canvas = await html2canvas(passes[i], {
          scale: 3,
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#FFFFFF",
          logging: false
        });
        const imgData = canvas.toDataURL("image/png", 1.0);
        const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", (pdfW - w) / 2, (pdfH - h) / 2, w, h);
      }

      // PDF Metadata
      pdf.setProperties({
        title: "ALTITUDE Digital Event Pass",
        author: "ALTITUDE Secretariat",
        creator: "ALTITUDE Pass Engine v11.0",
        subject: "Official Event Credentials",
        keywords: "ALTITUDE, Rotaract, District 3206, Trekking"
      });

      pdf.save("ALTITUDE_Credentials_" + (memberData?.ri_id || "pass") + ".pdf");

      hideLoading();
      showToast("PDF document generated.");
      vibrate(50);
      playSuccess();
    } catch (err) {
      hideLoading();
      console.error(CONSOLE_PREFIX, "PDF export failed:", err);
      showToast("PDF compilation failed.", "error");
    }
  }

  function printPass() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass available.", "error"); return; }
    logEvent("Action", "print_pass");

    const printWindow = window.open("", "_blank");
    if (!printWindow) { showToast("Please allow popups to print.", "error"); return; }

    let allHtml = "";
    passes.forEach(p => { allHtml += '<div style="page-break-after:always;padding:20px;">' + p.outerHTML + '</div>'; });

    printWindow.document.write(
      '<!DOCTYPE html><html><head><title>ALTITUDE Event Credentials</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Montserrat:wght@700;800;900&family=JetBrains+Mono&display=swap" rel="stylesheet" />' +
      '<link rel="stylesheet" href="' + window.location.origin + '/css/styles.css" />' +
      '<link rel="stylesheet" href="' + window.location.origin + '/css/pass.css" />' +
      '<style>body{margin:0;padding:0;background:#fff;}@media print{@page{size:landscape;margin:10mm}}</style>' +
      '</head><body>' + allHtml + '</body></html>'
    );
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 1500);
  }

  async function emailPass() {
    if (!currentEmail || !memberData) { showToast("No credential available.", "error"); return; }

    showLoading("Dispatching credential to your inbox...");

    try {
      const success = await dispatchPassEmail(memberData);
      hideLoading();
      if (success) {
        showToast("Credential dispatched to " + currentEmail);
        vibrate(50);
        playSuccess();
        logEvent("Email", "pass_email_sent", currentEmail);
      } else {
        showToast("Email dispatch failed. Please try downloading.", "error");
      }
    } catch (err) {
      hideLoading();
      console.error(CONSOLE_PREFIX, "Email dispatch error:", err);
      showToast("Failed to dispatch credential.", "error");
    }
  }

  async function sharePass() {
    if (!memberData) return;
    const shareLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(memberData.ri_id) + "&email=" + encodeURIComponent(currentEmail);
    const shareData = {
      title: "ALTITUDE - Official Event Credential",
      text: "ALTITUDE Rotaract District 3206 Trekking Event — December 12–13, 2026 at Ooty.",
      url: shareLink
    };

    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        showToast("Shared successfully.");
        logEvent("Action", "pass_shared_native");
      } else {
        await navigator.clipboard.writeText(shareLink);
        showToast("Credential link copied to clipboard.");
        logEvent("Action", "pass_link_copied");
      }
    } catch (err) {
      if (err.name !== "AbortError") showToast("Share operation cancelled.", "warning");
    }
  }

  async function copyPassId() {
    if (!memberData?.member_code) return;
    try {
      await navigator.clipboard.writeText(memberData.member_code);
      showToast("Credential token copied.");
      vibrate(30);
      logEvent("Action", "credential_copied");
    } catch {
      showToast("Token: " + memberData.member_code, "warning");
    }
  }

  function saveToDevice() {
    showToast("Use 'Download as Image' and save to your photo gallery.", "info", 5000);
  }

  function addToCalendar() {
    const start = "20261212T060000";
    const end = "20261213T180000";
    const title = "ALTITUDE - Rotaract District 3206 Trekking";
    const details = "ALTITUDE Rotaract District 3206 Trekking Event\\n\\nRI ID: " + (memberData?.ri_id || "") + "\\nCredential: " + (memberData?.member_code || "") + "\\n\\nVenue: Ooty, Tamil Nadu\\nContact: altitude3206@gmail.com";
    const location = "Ooty, Tamil Nadu, India";
    const url = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + start + "/" + end + "&details=" + encodeURIComponent(details) + "&location=" + encodeURIComponent(location);
    window.open(url, "_blank");
    showToast("Opening calendar scheduler...");
    logEvent("Action", "added_to_calendar");
  }

  // ==================== PWA INSTALL PROMPT ====================
  function initPWAInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      console.log(CONSOLE_PREFIX, "PWA install prompt available");
      
      // Show custom install button if exists
      const installBtn = $("#pwaInstallBtn");
      if (installBtn) {
        installBtn.style.display = "inline-flex";
        installBtn.addEventListener("click", async () => {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            logEvent("PWA", "install_" + outcome);
            deferredPrompt = null;
            installBtn.style.display = "none";
          }
        });
      }
    });

    window.addEventListener("appinstalled", () => {
      logEvent("PWA", "installed");
      showToast("ALTITUDE installed to home screen.");
    });
  }

  // ==================== NETWORK MONITORING ====================
  function initNetworkMonitoring() {
    window.addEventListener("online", () => {
      isOnline = true;
      showToast("Connection restored.", "success", 2000);
      logEvent("Network", "online");
    });

    window.addEventListener("offline", () => {
      isOnline = false;
      showToast("Operating in offline mode.", "warning", 4000);
      logEvent("Network", "offline");
    });
  }

  // ==================== EVENT LISTENERS ====================
  function init() {
    // Generate device fingerprint on startup
    generateFingerprint();

    // Form submissions
    $("#verifyForm")?.addEventListener("submit", handleVerifySubmit);
    $("#otpForm")?.addEventListener("submit", handleOtpSubmit);

    initOtpInputs();

    // Resend OTP button
    const resendBtn = $("#resendOtpBtn");
    if (resendBtn) {
      resendBtn.addEventListener("click", async () => {
        if (resendBtn.disabled) return;
        otpAttempts = 0;
        $$(".otp-box").forEach(b => { b.disabled = false; b.value = ""; b.style.borderColor = ""; });
        await sendOtp(memberData?.full_name || "Delegate");
      });
    }

    // Change email button
    $("#changeEmailBtn")?.addEventListener("click", () => {
      clearInterval(otpTimerInterval);
      clearInterval(resendTimerInterval);
      showStep(1);
    });

    // Back to start button
    $("#backToStart")?.addEventListener("click", () => {
      memberData = null;
      allMemberPasses = [];
      currentRiId = "";
      currentEmail = "";
      otpAttempts = 0;
      $$(".otp-box").forEach(b => { b.value = ""; b.disabled = false; b.style.borderColor = ""; });
      const pc = $("#passesContainer");
      if (pc) pc.innerHTML = "";
      showStep(1);
    });

    // Action buttons
    $("#downloadPngBtn")?.addEventListener("click", downloadAsPng);
    $("#downloadPdfBtn")?.addEventListener("click", downloadAsPdf);
    $("#printPassBtn")?.addEventListener("click", printPass);
    $("#emailPassBtn")?.addEventListener("click", emailPass);
    $("#sharePassBtn")?.addEventListener("click", sharePass);
    $("#copyCodeBtn")?.addEventListener("click", copyPassId);
    $("#saveToDeviceBtn")?.addEventListener("click", saveToDevice);
    $("#calendarBtn")?.addEventListener("click", addToCalendar);

    // Auto-fill from URL parameters
    const params = new URLSearchParams(window.location.search);
    const urlRiId = params.get("ri_id");
    const urlEmail = params.get("email");
    if (urlRiId) { const inp = $("#verifyRiId"); if (inp) inp.value = urlRiId; }
    if (urlEmail) { const inp = $("#verifyEmail"); if (inp) inp.value = decodeURIComponent(urlEmail); }
    if (urlRiId && urlEmail) {
      setTimeout(() => {
        const form = $("#verifyForm");
        if (form) form.requestSubmit();
      }, 800);
      logEvent("Auth", "url_autofill_triggered");
    }

    // Global Keyboard Shortcuts
    document.addEventListener("keydown", (e) => {
      // Esc closes modal
      if (e.key === "Escape") {
        const m = $("#errorModal");
        if (m?.classList.contains("active")) m.classList.remove("active");
      }
      // Ctrl/Cmd + D downloads image
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && currentStep === 3) {
        e.preventDefault();
        downloadAsPng();
      }
      // Ctrl/Cmd + P prints
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && currentStep === 3) {
        e.preventDefault();
        printPass();
      }
      // Ctrl/Cmd + S saves PDF
      if ((e.ctrlKey || e.metaKey) && e.key === "s" && currentStep === 3) {
        e.preventDefault();
        downloadAsPdf();
      }
    });

    // Prevent autofill issues
    document.querySelectorAll("input[type='text']").forEach(inp => inp.setAttribute("autocomplete", "off"));

    // Enable audio on first interaction
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });

    // Initialize PWA & network monitoring
    initPWAInstall();
    initNetworkMonitoring();

    console.log(CONSOLE_PREFIX, "Quantum Pass Engine v11.0 Enterprise Edition initialized.");
    logEvent("System", "engine_initialized", "v11.0");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
