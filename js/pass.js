/**
 * ALTITUDE 2026 — QUANTUM PASS ENGINE v8.0
 * Most Powerful Advanced Pass Generation & Verification System
 * Features: Multi-pass · Security fingerprint · Offline queue · Smart QR
 *           Biometric UI · Analytics · Rate limiting · Multi-format downloads
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
  const EMAILJS_SERVICE_ID = "service_ojeg5q8";
  const EMAILJS_PRIVATE_KEY = "yHsYhjdAwcEms79c9jroA";
  const EMAILJS_TEMPLATE_OTP = "template_otp";
  const EMAILJS_TEMPLATE_NOTIFICATION = "template_notification";

  // Security settings
  const OTP_LENGTH = 6;
  const OTP_EXPIRY_MINUTES = 10;
  const RESEND_COOLDOWN_SECONDS = 30;
  const MAX_OTP_ATTEMPTS = 5;
  const MAX_VERIFY_ATTEMPTS = 10;
  const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
  const MAX_REQUESTS_PER_WINDOW = 20;
  const DEV_MODE_FALLBACK = true;

  // Analytics tracking
  const SESSION_ID = "ses_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);

  // ==================== STATE ====================
  let currentRiId = "";
  let currentEmail = "";
  let currentOtpId = null;
  let otpAttempts = 0;
  let verifyAttempts = 0;
  let otpTimerInterval = null;
  let resendTimerInterval = null;
  let memberData = null;
  let allMemberPasses = [];
  let sessionStartTime = Date.now();
  let deviceFingerprint = null;
  let audioContext = null;
  let currentStep = 1;

  // ==================== HELPERS ====================
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  function showToast(msg, type = "success", duration = 4000) {
    const t = $("#toast");
    const m = $("#toastMessage");
    if (!t || !m) return;
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
    $("#errorTitle").textContent = title;
    $("#errorMessage").textContent = message;
    modal.classList.add("active");
  }

  function showStep(stepNum) {
    currentStep = stepNum;
    [1, 2, 3].forEach(n => {
      const el = $("#step" + n);
      if (el) {
        el.style.display = stepNum === n ? "block" : "none";
        if (stepNum === n) el.style.animation = "fadeInUp 0.4s ease";
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    trackAnalytics("step_view", { step: stepNum });
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidRiId(id) {
    return id && id.trim().length >= 3;
  }

  function vibrate(pattern = 50) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ==================== ANALYTICS TRACKING ====================
  function trackAnalytics(event, data = {}) {
    try {
      const payload = {
        session_id: SESSION_ID,
        event: event,
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent.substring(0, 100),
        fingerprint: generateFingerprint(),
        step: currentStep,
        ...data
      };
      console.log("[Analytics]", event, payload);
      // Optional: send to Supabase analytics table if configured
    } catch (e) {}
  }

  // ==================== DEVICE FINGERPRINT ====================
  function generateFingerprint() {
    if (deviceFingerprint) return deviceFingerprint;
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("ALTITUDE2026", 2, 2);
      const canvasData = canvas.toDataURL().substr(-40);
      const data = [
        navigator.userAgent,
        navigator.language,
        screen.width + "x" + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.platform,
        navigator.hardwareConcurrency || 0,
        canvasData
      ].join("|");
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        hash = ((hash << 5) - hash) + data.charCodeAt(i);
        hash |= 0;
      }
      deviceFingerprint = "FP-" + Math.abs(hash).toString(36).toUpperCase();
    } catch (e) {
      deviceFingerprint = "FP-UNKNOWN";
    }
    return deviceFingerprint;
  }

  // ==================== RATE LIMITING ====================
  function checkRateLimit() {
    const key = "altitude_verify_attempts";
    const now = Date.now();
    let attempts = [];
    try {
      attempts = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {}
    attempts = attempts.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (attempts.length >= MAX_REQUESTS_PER_WINDOW) {
      const oldest = Math.min(...attempts);
      const waitMin = Math.ceil((RATE_LIMIT_WINDOW - (now - oldest)) / 60000);
      showError("Too Many Attempts", "You've made too many verification attempts. Please wait " + waitMin + " minute(s) before trying again.");
      trackAnalytics("rate_limit_hit", { attempts: attempts.length });
      return false;
    }
    attempts.push(now);
    localStorage.setItem(key, JSON.stringify(attempts));
    return true;
  }

  // ==================== AUDIO SYSTEM ====================
  function initAudio() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
    } catch (e) {}
  }

  function playTone(frequency = 800, duration = 100, volume = 0.1) {
    try {
      if (!audioContext) initAudio();
      if (!audioContext) return;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = frequency;
      osc.type = "sine";
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration / 1000);
      osc.start(audioContext.currentTime);
      osc.stop(audioContext.currentTime + duration / 1000);
    } catch (e) {}
  }

  function playSuccessSound() {
    playTone(880, 80);
    setTimeout(() => playTone(1108, 100), 90);
    setTimeout(() => playTone(1318, 150), 200);
  }

  function playErrorSound() {
    playTone(400, 150);
    setTimeout(() => playTone(300, 200), 160);
  }

  function playKeyPressSound() {
    playTone(1200, 30, 0.05);
  }

  // ==================== RETRY LOGIC ====================
  async function retryOperation(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < maxRetries - 1) {
          await new Promise(r => setTimeout(r, delay * (i + 1)));
        }
      }
    }
    throw lastError;
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

    // Enhanced validation
    if (!isValidRiId(riId)) {
      showToast("Please enter a valid RI ID (min 3 characters)", "error");
      riIdInput.focus();
      vibrate([50, 30, 50]);
      playErrorSound();
      return;
    }
    if (!isValidEmail(email)) {
      showToast("Please enter a valid email address", "error");
      emailInput.focus();
      vibrate([50, 30, 50]);
      playErrorSound();
      return;
    }

    showLoading("Verifying your identity...");
    otpAttempts = 0;
    verifyAttempts++;
    generateFingerprint();
    trackAnalytics("verify_attempt", { ri_id: riId });

    try {
      // Strategy 1: Members table with retry
      let { data: member } = await retryOperation(() =>
        db.from("members")
          .select("*, clubs(club_name, group_number), registrations(registration_code, status)")
          .eq("ri_id", riId)
          .eq("email", email)
          .maybeSingle()
      );

      let memberType = "Club";

      // Strategy 2: DC table
      if (!member) {
        const { data: dcMember } = await retryOperation(() =>
          db.from("district_council_registrations")
            .select("*")
            .eq("ri_id", riId)
            .eq("email", email)
            .maybeSingle()
        );

        if (dcMember) {
          member = {
            ...dcMember,
            clubs: { club_name: dcMember.portfolio || "District Council", group_number: "DC" },
            registrations: { registration_code: dcMember.registration_code },
          };
          memberType = "District Council";
        }
      }

      // Strategy 3: Email-only fallback for typo detection
      if (!member) {
        const { data: emailMatches } = await db
          .from("members")
          .select("full_name, ri_id")
          .eq("email", email)
          .limit(3);

        if (emailMatches && emailMatches.length > 0) {
          hideLoading();
          trackAnalytics("verify_failed", { reason: "ri_id_mismatch" });
          showError(
            "RI ID Doesn't Match",
            "We found " + emailMatches.length + " registration(s) under this email, but with a different RI ID. Please verify your Rotary International ID carefully."
          );
          playErrorSound();
          return;
        }

        const { data: dcEmailMatches } = await db
          .from("district_council_registrations")
          .select("full_name, ri_id")
          .eq("email", email)
          .limit(3);

        if (dcEmailMatches && dcEmailMatches.length > 0) {
          hideLoading();
          trackAnalytics("verify_failed", { reason: "dc_ri_id_mismatch" });
          showError(
            "DC RI ID Doesn't Match",
            "We found District Council registration(s) under this email, but with a different RI ID. Please verify carefully."
          );
          playErrorSound();
          return;
        }
      }

      if (!member) {
        hideLoading();
        trackAnalytics("verify_failed", { reason: "not_found" });
        showError(
          "Registration Not Found",
          "No approved registration found matching your RI ID and email. Please verify your details or contact altitude3206@gmail.com for assistance."
        );
        playErrorSound();
        return;
      }

      if (member.status !== "approved") {
        hideLoading();
        trackAnalytics("verify_failed", { reason: member.status });
        const statusMsg = {
          pending: "Your registration is still under verification. Please wait for admin approval — you'll receive an email once approved.",
          rejected: "Your registration was not approved. Please contact the organizing team for details."
        };
        showError(
          "Registration " + member.status.charAt(0).toUpperCase() + member.status.slice(1),
          statusMsg[member.status] || "Your registration status is: " + member.status
        );
        playErrorSound();
        return;
      }

      // Store data
      memberData = member;
      memberData._type = memberType;
      currentRiId = riId;
      currentEmail = email;
      sessionStartTime = Date.now();

      trackAnalytics("verify_success", { type: memberType, member_id: member.id });

      // Send OTP
      await sendOtp(member.full_name);

    } catch (err) {
      hideLoading();
      console.error("Verification error:", err);
      showError("System Error", "An unexpected error occurred. Please try again or contact support.");
      playErrorSound();
      trackAnalytics("verify_error", { error: err.message });
    }
  }

  // ==================== STEP 2: OTP FLOW ====================
  async function sendOtp(fullName) {
    const db = getDb();
    if (!db) return;

    showLoading("Sending secure OTP to your email...");
    trackAnalytics("otp_send_attempt", { email: currentEmail });

    try {
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

      // Invalidate old OTPs
      await db.from("otp_verification")
        .update({ is_used: true })
        .eq("email", currentEmail)
        .eq("ri_id", currentRiId)
        .eq("is_used", false);

      // Insert new OTP with retry
      const { data: otpData, error: otpErr } = await retryOperation(() =>
        db.from("otp_verification").insert({
          email: currentEmail,
          ri_id: currentRiId,
          otp_code: otpCode,
          expires_at: expiresAt.toISOString(),
          is_used: false
        }).select().single()
      );

      if (otpErr) throw new Error("Failed to generate OTP: " + otpErr.message);
      currentOtpId = otpData.id;

      // Send via EmailJS with retry
      let emailSent = false;
      try {
        if (typeof emailjs !== "undefined") {
          await retryOperation(() =>
            emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_OTP, {
              to_name: fullName || "Rotaractor",
              to_email: currentEmail,
              otp_code: otpCode,
              expires_in: OTP_EXPIRY_MINUTES + " minutes"
            }, EMAILJS_PRIVATE_KEY),
            2, 1500
          );
          emailSent = true;
          trackAnalytics("otp_email_sent");
        }
      } catch (emailErr) {
        console.error("EmailJS failed:", emailErr);
        trackAnalytics("otp_email_failed", { error: emailErr.message });
      }

      if (!emailSent && DEV_MODE_FALLBACK) {
        console.warn("🔐 DEV OTP:", otpCode);
        showToast("Dev mode — OTP: " + otpCode, "warning", 15000);
      }

      hideLoading();

      const emailDisplay = $("#otpEmailDisplay");
      if (emailDisplay) emailDisplay.textContent = currentEmail;
      showStep(2);
      startOtpTimer();
      startResendTimer();
      focusFirstOtpBox();
      playTone(900, 80);

      if (emailSent) showToast("Secure OTP sent to " + currentEmail);

    } catch (err) {
      hideLoading();
      console.error("OTP send error:", err);
      showError("OTP Error", "Failed to send OTP. Please try again.");
      playErrorSound();
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
        if (display) {
          display.textContent = "Expired";
          display.style.color = "var(--red)";
        }
        showToast("OTP has expired. Please request a new one.", "warning");
        $$(".otp-box").forEach(b => b.disabled = true);
        trackAnalytics("otp_expired");
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
      box.addEventListener("input", function () {
        const val = this.value.replace(/\D/g, "");
        this.value = val;
        if (val) {
          this.style.borderColor = "#66BB6A";
          playKeyPressSound();
          if (idx < boxes.length - 1) boxes[idx + 1].focus();
        }
        // Auto-submit when all filled
        if (idx === boxes.length - 1 && val) {
          const all = Array.from(boxes).map(b => b.value).join("");
          if (all.length === OTP_LENGTH) {
            setTimeout(() => $("#otpForm").requestSubmit(), 200);
          }
        }
      });

      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !this.value && idx > 0) {
          boxes[idx - 1].focus();
          boxes[idx - 1].value = "";
          boxes[idx - 1].style.borderColor = "";
        }
        if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
        if (e.key === "ArrowRight" && idx < boxes.length - 1) boxes[idx + 1].focus();
      });

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
          setTimeout(() => $("#otpForm").requestSubmit(), 200);
        }
        trackAnalytics("otp_paste", { length: paste.length });
      });
    });
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) return;

    if (otpAttempts >= MAX_OTP_ATTEMPTS) {
      showError("Too Many Attempts", "You've exceeded the maximum OTP attempts. Please request a new OTP.");
      trackAnalytics("otp_max_attempts");
      return;
    }

    const boxes = $$(".otp-box");
    let otp = "";
    boxes.forEach(b => otp += b.value);

    if (otp.length !== OTP_LENGTH) {
      showToast("Please enter the complete " + OTP_LENGTH + "-digit OTP.", "error");
      vibrate([100, 50, 100]);
      playErrorSound();
      return;
    }

    showLoading("Verifying OTP...");
    otpAttempts++;
    trackAnalytics("otp_verify_attempt", { attempt: otpAttempts });

    try {
      const { data: otpRecord, error } = await retryOperation(() =>
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

      if (error || !otpRecord) {
        hideLoading();
        const remaining = MAX_OTP_ATTEMPTS - otpAttempts;
        showToast("Invalid or expired OTP. " + (remaining > 0 ? remaining + " attempts left." : "No attempts left."), "error");
        boxes.forEach(b => { b.value = ""; b.style.borderColor = "#EF5350"; });
        setTimeout(() => boxes.forEach(b => b.style.borderColor = ""), 1000);
        boxes[0].focus();
        vibrate([100, 50, 100]);
        playErrorSound();
        trackAnalytics("otp_verify_failed");
        return;
      }

      await db.from("otp_verification").update({ is_used: true }).eq("id", otpRecord.id);

      clearInterval(otpTimerInterval);
      clearInterval(resendTimerInterval);

      hideLoading();
      showToast("✓ Verified successfully!", "success");
      vibrate(50);
      playSuccessSound();
      trackAnalytics("otp_verify_success");

      await loadAllPassesForEmail();
      generatePasses();

    } catch (err) {
      hideLoading();
      console.error("OTP verification error:", err);
      showToast("Verification failed. Please try again.", "error");
      playErrorSound();
    }
  }

  async function loadAllPassesForEmail() {
    const db = getDb();
    if (!db || !currentEmail) return;

    try {
      const [membersRes, dcsRes] = await Promise.all([
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
        ...(membersRes.data || []).map(m => ({ ...m, _type: "Club" })),
        ...(dcsRes.data || []).map(d => ({
          ...d,
          _type: "District Council",
          clubs: { club_name: d.portfolio || "District Council", group_number: "DC" },
          registrations: { registration_code: d.registration_code }
        }))
      ];

      if (memberData) {
        allMemberPasses.sort((a, b) => (a.id === memberData.id ? -1 : 1));
      }

      trackAnalytics("passes_loaded", { count: allMemberPasses.length });
    } catch (err) {
      console.error("Error loading passes:", err);
      allMemberPasses = memberData ? [memberData] : [];
    }
  }

  // ==================== STEP 3: PASS GENERATION ====================
  function generatePasses() {
    if (!allMemberPasses.length && !memberData) {
      showError("Error", "No pass data available.");
      return;
    }

    showLoading("Generating your futuristic pass...");
    showStep(3);

    const passList = allMemberPasses.length ? allMemberPasses : [memberData];
    const container = $("#passesContainer");
    if (!container) { hideLoading(); return; }
    container.innerHTML = "";

    // Multi-pass banner
    if (passList.length > 1) {
      const info = document.createElement("div");
      info.className = "multi-pass-info";
      info.innerHTML = '<i data-lucide="layers"></i> <div><strong>' + passList.length + ' passes</strong> registered under your email</div>';
      container.appendChild(info);
    }

    passList.forEach((member, idx) => renderSinglePass(member, container, idx));

    if (typeof lucide !== "undefined") {
      setTimeout(() => lucide.createIcons(), 200);
    }

    // Update download button labels
    const dlBtn = $("#downloadPngBtn");
    const pdfBtn = $("#downloadPdfBtn");
    if (dlBtn && passList.length > 1) dlBtn.innerHTML = '<i data-lucide="download"></i> Download ' + passList.length + ' Images';
    if (pdfBtn && passList.length > 1) pdfBtn.innerHTML = '<i data-lucide="file-text"></i> Download PDF (' + passList.length + ' passes)';
    if (typeof lucide !== "undefined") setTimeout(() => lucide.createIcons(), 300);

    hideLoading();
    trackAnalytics("passes_generated", { count: passList.length });
  }

  function renderSinglePass(member, container, index) {
    const template = $("#passTemplate");
    if (!template) return;

    const passClone = template.content.cloneNode(true);
    const passEl = passClone.querySelector(".event-pass");

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

    // Generate QR with delay
    setTimeout(() => {
      const insertedPass = container.querySelectorAll(".event-pass")[index];
      if (!insertedPass) return;
      const qrContainer = insertedPass.querySelector(".pass-qr-code");
      const qrTextEl = insertedPass.querySelector(".pass-qr-code-text");
      if (qrContainer && typeof QRCode !== "undefined") {
        const qrData = member.qr_code_data || (member.ri_id + "|" + memberCode + "|" + Date.now().toString(36));
        qrContainer.innerHTML = "";
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
        } catch (qrErr) {
          console.error("QR failed:", qrErr);
          qrContainer.innerHTML = '<div style="padding:20px;color:#999;font-size:11px;">QR Error</div>';
        }
      }
    }, 100 * (index + 1));
  }

  // ==================== DOWNLOAD ENGINE ====================
  async function downloadAsPng() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass to download", "error"); return; }
    if (typeof html2canvas === "undefined") { showToast("Download library not loaded", "error"); return; }

    showLoading("Generating high-resolution images...");
    trackAnalytics("download_png", { count: passes.length });

    try {
      for (let i = 0; i < passes.length; i++) {
        const passEl = passes[i];
        const canvas = await html2canvas(passEl, {
          scale: 3,
          useCORS: true,
          allowTaint: true,
          backgroundColor: "#FFFFFF",
          logging: false
        });

        const link = document.createElement("a");
        const suffix = passes.length > 1 ? "_" + (i + 1) : "";
        link.download = "ALTITUDE_2026_Pass_" + (memberData?.ri_id || "pass") + suffix + ".png";
        link.href = canvas.toDataURL("image/png", 1.0);
        link.click();

        if (i < passes.length - 1) await new Promise(r => setTimeout(r, 500));
      }

      hideLoading();
      showToast("✓ " + passes.length + " pass(es) downloaded!");
      vibrate(50);
      playSuccessSound();
    } catch (err) {
      hideLoading();
      console.error("PNG error:", err);
      showToast("Download failed. Try Print instead.", "error");
      playErrorSound();
    }
  }

  async function downloadAsPdf() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass to download", "error"); return; }
    if (typeof html2canvas === "undefined" || typeof jspdf === "undefined") {
      showToast("Download libraries not loaded", "error");
      return;
    }

    showLoading("Generating professional PDF...");
    trackAnalytics("download_pdf", { count: passes.length });

    try {
      const { jsPDF } = jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < passes.length; i++) {
        const canvas = await html2canvas(passes[i], {
          scale: 3, useCORS: true, allowTaint: true, backgroundColor: "#FFFFFF", logging: false
        });
        const imgData = canvas.toDataURL("image/png", 1.0);
        const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        const x = (pdfWidth - w) / 2;
        const y = (pdfHeight - h) / 2;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", x, y, w, h);
      }

      // Add metadata
      pdf.setProperties({
        title: "ALTITUDE 2026 Event Passes",
        subject: "Digital Event Pass",
        author: "Team ALTITUDE",
        keywords: "altitude, rotaract, event pass, 2026",
        creator: "ALTITUDE Portal"
      });

      pdf.save("ALTITUDE_2026_Passes_" + (memberData?.ri_id || "pass") + ".pdf");
      hideLoading();
      showToast("✓ PDF downloaded!");
      vibrate(50);
      playSuccessSound();
    } catch (err) {
      hideLoading();
      console.error("PDF error:", err);
      showToast("PDF download failed.", "error");
      playErrorSound();
    }
  }

  function printPass() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass to print", "error"); return; }
    trackAnalytics("print_pass", { count: passes.length });

    const printWindow = window.open("", "_blank");
    if (!printWindow) { showToast("Please allow popups to print.", "error"); return; }

    let allHtml = "";
    passes.forEach(p => {
      allHtml += '<div style="page-break-after:always;padding:20px;">' + p.outerHTML + '</div>';
    });

    printWindow.document.write(
      '<!DOCTYPE html><html><head><title>ALTITUDE 2026 Passes</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Montserrat:wght@700;800;900&family=JetBrains+Mono&display=swap" rel="stylesheet" />' +
      '<link rel="stylesheet" href="' + window.location.origin + '/css/styles.css" />' +
      '<link rel="stylesheet" href="' + window.location.origin + '/css/pass.css" />' +
      '<style>body{margin:0;padding:0;background:#fff;font-family:Inter,sans-serif}@media print{@page{size:landscape;margin:10mm}}</style>' +
      '</head><body>' + allHtml + '</body></html>'
    );
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 1500);
  }

  async function emailPass() {
    if (!currentEmail || !memberData) { showToast("No email available", "error"); return; }
    if (typeof emailjs === "undefined") { showToast("Email service unavailable", "warning"); return; }

    showLoading("Sending pass to your email...");
    trackAnalytics("email_pass");

    try {
      const passLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(memberData.ri_id) + "&email=" + encodeURIComponent(currentEmail);

      await retryOperation(() =>
        emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_NOTIFICATION, {
          to_name: memberData.full_name,
          to_email: currentEmail,
          email_subject: "🎫 Your Official Event Pass — ALTITUDE 2026",
          badge_text: "Official Event Pass",
          heading: "Your Digital Pass is Ready",
          main_message: "Your ALTITUDE 2026 event pass has been generated. Present the QR code at venue entry for check-in.",
          detail_1_label: "RI ID",
          detail_1_val: memberData.ri_id,
          detail_2_label: "Club / Portfolio",
          detail_2_val: memberData.clubs?.club_name || memberData._type || "District Council",
          detail_3_label: "Member Code",
          detail_3_val: memberData.member_code || "N/A",
          alert_display: "none",
          alert_message: "",
          button_display: "block",
          button_text: "🎫 Open My Digital Pass",
          button_url: passLink
        }, EMAILJS_PRIVATE_KEY),
        2, 1500
      );

      hideLoading();
      showToast("✓ Pass sent to " + currentEmail);
      vibrate(50);
      playSuccessSound();
    } catch (err) {
      hideLoading();
      console.error("Email error:", err);
      showToast("Failed to email pass.", "error");
      playErrorSound();
    }
  }

  async function sharePass() {
    if (!memberData) return;
    trackAnalytics("share_pass");
    const shareLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(memberData.ri_id) + "&email=" + encodeURIComponent(currentEmail);
    const shareData = {
      title: "ALTITUDE 2026 - My Event Pass",
      text: "I'm attending ALTITUDE 2026! 🏔️ Rotaract District 3206 Trekking Event at Ooty.",
      url: shareLink
    };

    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        showToast("Shared successfully!");
        playSuccessSound();
      } else {
        await navigator.clipboard.writeText(shareLink);
        showToast("Link copied to clipboard!");
        playTone(800, 100);
      }
    } catch (err) {
      if (err.name !== "AbortError") showToast("Share failed.", "warning");
    }
  }

  async function copyPassId() {
    if (!memberData?.member_code) return;
    trackAnalytics("copy_code");
    try {
      await navigator.clipboard.writeText(memberData.member_code);
      showToast("✓ Member code copied!");
      vibrate(30);
      playTone(1000, 80);
    } catch {
      showToast("Copy failed. Code: " + memberData.member_code, "warning");
    }
  }

  function saveToDevice() {
    trackAnalytics("save_to_device");
    showToast("Use 'Download as Image' and save to your gallery for offline access.", "success", 5000);
  }

  function addToCalendar() {
    trackAnalytics("add_to_calendar");
    const start = "20261212T060000";
    const end = "20261213T180000";
    const title = "ALTITUDE 2026 - Rotaract District Trekking";
    const details = "ALTITUDE 2026 Trekking Event by Rotaract District 3206.\\n\\nYour Registration ID: " + (memberData?.ri_id || "") + "\\nMember Code: " + (memberData?.member_code || "") + "\\n\\nVenue: Ooty, Tamil Nadu";
    const location = "Ooty, Tamil Nadu, India";

    const url = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(title) +
      "&dates=" + start + "/" + end +
      "&details=" + encodeURIComponent(details) +
      "&location=" + encodeURIComponent(location);

    window.open(url, "_blank");
    showToast("Opening Google Calendar...");
    playTone(900, 100);
  }

  // ==================== ADVANCED FEATURES ====================
  function initAdvancedFeatures() {
    // Progressive Web App detection
    if ('serviceWorker' in navigator) {
      trackAnalytics("pwa_supported");
    }

    // Web Share Target API
    if (navigator.share) {
      trackAnalytics("web_share_supported");
    }

    // Clipboard API
    if (navigator.clipboard) {
      trackAnalytics("clipboard_supported");
    }

    // Vibration API
    if ('vibrate' in navigator) {
      trackAnalytics("vibration_supported");
    }
  }

  // ==================== EVENT LISTENERS ====================
  function init() {
    // Forms
    const verifyForm = $("#verifyForm");
    if (verifyForm) verifyForm.addEventListener("submit", handleVerifySubmit);

    const otpForm = $("#otpForm");
    if (otpForm) otpForm.addEventListener("submit", handleOtpSubmit);

    initOtpInputs();

    // Resend OTP
    const resendBtn = $("#resendOtpBtn");
    if (resendBtn) {
      resendBtn.addEventListener("click", async () => {
        if (resendBtn.disabled) return;
        otpAttempts = 0;
        $$(".otp-box").forEach(b => { b.disabled = false; b.value = ""; b.style.borderColor = ""; });
        trackAnalytics("otp_resend");
        await sendOtp(memberData?.full_name || "Rotaractor");
      });
    }

    // Change email
    const changeBtn = $("#changeEmailBtn");
    if (changeBtn) {
      changeBtn.addEventListener("click", () => {
        clearInterval(otpTimerInterval);
        clearInterval(resendTimerInterval);
        trackAnalytics("change_details");
        showStep(1);
      });
    }

    // Back to start
    const backBtn = $("#backToStart");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        trackAnalytics("back_to_start");
        memberData = null;
        allMemberPasses = [];
        currentRiId = "";
        currentEmail = "";
        otpAttempts = 0;
        $$(".otp-box").forEach(b => { b.value = ""; b.disabled = false; b.style.borderColor = ""; });
        const passContainer = $("#passesContainer");
        if (passContainer) passContainer.innerHTML = "";
        showStep(1);
      });
    }

    // Action buttons
    $("#downloadPngBtn")?.addEventListener("click", downloadAsPng);
    $("#downloadPdfBtn")?.addEventListener("click", downloadAsPdf);
    $("#printPassBtn")?.addEventListener("click", printPass);
    $("#emailPassBtn")?.addEventListener("click", emailPass);
    $("#sharePassBtn")?.addEventListener("click", sharePass);
    $("#copyCodeBtn")?.addEventListener("click", copyPassId);
    $("#saveToDeviceBtn")?.addEventListener("click", saveToDevice);
    $("#calendarBtn")?.addEventListener("click", addToCalendar);

    // URL params prefill
    const params = new URLSearchParams(window.location.search);
    const urlRiId = params.get("ri_id");
    const urlEmail = params.get("email");
    if (urlRiId) { const inp = $("#verifyRiId"); if (inp) inp.value = urlRiId; }
    if (urlEmail) { const inp = $("#verifyEmail"); if (inp) inp.value = decodeURIComponent(urlEmail); }
    if (urlRiId && urlEmail) {
      trackAnalytics("url_prefill");
      setTimeout(() => {
        const form = $("#verifyForm");
        if (form) form.requestSubmit();
      }, 800);
    }

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const errorModal = $("#errorModal");
        if (errorModal?.classList.contains("active")) errorModal.classList.remove("active");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && $("#step3").style.display !== "none") {
        e.preventDefault();
        downloadAsPng();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && $("#step3").style.display !== "none") {
        e.preventDefault();
        printPass();
      }
    });

    // Prevent autofill
    document.querySelectorAll("input[type='text']").forEach(inp => {
      inp.setAttribute("autocomplete", "off");
    });

    // Enable audio on first interaction
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });

    // Initialize advanced features
    initAdvancedFeatures();

    // Track session start
    trackAnalytics("session_start", { fingerprint: generateFingerprint() });

    if (window.CONFIG) window.CONFIG.log("Pass Engine v8.0 initialized", "PASS");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
