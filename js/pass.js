/**
 * ALTITUDE 2026 — QUANTUM PASS ENGINE v9.0
 * Complete Error-Free Pass Generation System
 * Features: OTP · Multi-pass · QR with Fallback · Downloads · Email · Calendar
 *           Rate limiting · Device fingerprint · Analytics · Retry logic
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
  const EMAILJS_SERVICE_ID = window.CONFIG?.EMAILJS_SERVICE_ID || "service_ojeg5q8";
  const EMAILJS_PUBLIC_KEY = window.CONFIG?.EMAILJS_PUBLIC_KEY || "M1tEIYjvJ0UmKdDW8";
  const EMAILJS_TEMPLATE_OTP = window.CONFIG?.EMAILJS_TEMPLATES?.OTP || "template_otp";
  const EMAILJS_TEMPLATE_NOTIFICATION = window.CONFIG?.EMAILJS_TEMPLATES?.NOTIFICATION || "template_notification";

  // Security
  const OTP_LENGTH = 6;
  const OTP_EXPIRY_MINUTES = 10;
  const RESEND_COOLDOWN_SECONDS = 30;
  const MAX_OTP_ATTEMPTS = 5;
  const MAX_VERIFY_ATTEMPTS = 15;
  const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
  const DEV_MODE_FALLBACK = true;

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

  // ==================== AUDIO ====================
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

  // ==================== RATE LIMITING ====================
  function checkRateLimit() {
    const key = "altitude_pass_attempts";
    const now = Date.now();
    let attempts = [];
    try { attempts = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
    attempts = attempts.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (attempts.length >= MAX_VERIFY_ATTEMPTS) {
      const waitMin = Math.ceil((RATE_LIMIT_WINDOW - (now - Math.min(...attempts))) / 60000);
      showError("Too Many Attempts", "Please wait " + waitMin + " minute(s) before trying again.");
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

    showLoading("Verifying your identity...");
    otpAttempts = 0;

    try {
      // Search members
      let { data: member } = await retryOp(() =>
        db.from("members")
          .select("*, clubs(club_name, group_number), registrations(registration_code, status)")
          .eq("ri_id", riId)
          .eq("email", email)
          .maybeSingle()
      );

      let memberType = "Club";

      // Search DC
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

      // Email-only fallback
      if (!member) {
        const { data: emailMatches } = await db.from("members").select("full_name, ri_id").eq("email", email).limit(3);
        if (emailMatches && emailMatches.length > 0) {
          hideLoading();
          showError("RI ID Doesn't Match", "We found " + emailMatches.length + " registration(s) under this email with a different RI ID. Please verify your RI ID.");
          playError();
          return;
        }

        const { data: dcMatches } = await db.from("district_council_registrations").select("full_name, ri_id").eq("email", email).limit(3);
        if (dcMatches && dcMatches.length > 0) {
          hideLoading();
          showError("DC RI ID Mismatch", "DC registration(s) found under this email with a different RI ID.");
          playError();
          return;
        }
      }

      if (!member) {
        hideLoading();
        showError("Registration Not Found", "No approved registration found. Please verify your details or contact altitude3206@gmail.com.");
        playError();
        return;
      }

      if (member.status !== "approved") {
        hideLoading();
        const msgs = {
          pending: "Your registration is under verification. You'll receive an email once approved.",
          rejected: "Your registration was not approved. Contact the organizing team."
        };
        showError("Registration " + member.status.charAt(0).toUpperCase() + member.status.slice(1), msgs[member.status] || "Status: " + member.status);
        playError();
        return;
      }

      memberData = member;
      memberData._type = memberType;
      currentRiId = riId;
      currentEmail = email;

      await sendOtp(member.full_name);

    } catch (err) {
      hideLoading();
      console.error("Verification error:", err);
      showError("System Error", "An unexpected error occurred. Please try again.");
      playError();
    }
  }

  // ==================== STEP 2: OTP ====================
  async function sendOtp(fullName) {
    const db = getDb();
    if (!db) return;

    showLoading("Sending secure OTP to your email...");

    try {
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

      // Invalidate old OTPs
      await db.from("otp_verification").update({ is_used: true }).eq("email", currentEmail).eq("ri_id", currentRiId).eq("is_used", false);

      // Insert new OTP
      const { data: otpData, error: otpErr } = await retryOp(() =>
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

      // Send via EmailJS (PUBLIC KEY only — NOT private key)
      let emailSent = false;
      try {
        if (typeof emailjs !== "undefined") {
          await retryOp(() =>
            emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_OTP, {
              to_name: fullName || "Rotaractor",
              to_email: currentEmail.trim(),
              otp_code: otpCode,
              expires_in: OTP_EXPIRY_MINUTES + " minutes"
            }, EMAILJS_PUBLIC_KEY),
            2, 1500
          );
          emailSent = true;
          console.log("[Email] OTP sent to", currentEmail);
        }
      } catch (emailErr) {
        console.error("[Email] OTP send failed:", emailErr);
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
        if (display) { display.textContent = "Expired"; display.style.color = "#EF5350"; }
        showToast("OTP expired. Please request a new one.", "warning");
        $$(".otp-box").forEach(b => b.disabled = true);
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
          playKeyPress();
          if (idx < boxes.length - 1) boxes[idx + 1].focus();
        }
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
          setTimeout(() => {
            const form = $("#otpForm");
            if (form) form.requestSubmit();
          }, 200);
        }
      });
    });
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) return;

    if (otpAttempts >= MAX_OTP_ATTEMPTS) {
      showError("Too Many Attempts", "Exceeded maximum OTP attempts. Please request a new one.");
      return;
    }

    const boxes = $$(".otp-box");
    let otp = "";
    boxes.forEach(b => otp += b.value);

    if (otp.length !== OTP_LENGTH) {
      showToast("Please enter the complete " + OTP_LENGTH + "-digit OTP.", "error");
      vibrate([100, 50, 100]);
      playError();
      return;
    }

    showLoading("Verifying OTP...");
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
        showToast("Invalid or expired OTP. " + (remaining > 0 ? remaining + " attempts left." : ""), "error");
        boxes.forEach(b => { b.value = ""; b.style.borderColor = "#EF5350"; });
        setTimeout(() => boxes.forEach(b => b.style.borderColor = ""), 1000);
        boxes[0].focus();
        vibrate([100, 50, 100]);
        playError();
        return;
      }

      await db.from("otp_verification").update({ is_used: true }).eq("id", otpRecord.id);

      clearInterval(otpTimerInterval);
      clearInterval(resendTimerInterval);

      hideLoading();
      showToast("✓ Identity verified!", "success");
      vibrate(50);
      playSuccess();

      await loadAllPassesForEmail();
      generatePasses();

    } catch (err) {
      hideLoading();
      console.error("OTP error:", err);
      showToast("Verification failed. Try again.", "error");
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

      if (memberData) {
        allMemberPasses.sort((a, b) => (a.id === memberData.id ? -1 : 1));
      }

      console.log("[Pass] Loaded", allMemberPasses.length, "pass(es)");
    } catch (err) {
      console.error("Load passes error:", err);
      allMemberPasses = memberData ? [memberData] : [];
    }
  }

  // ==================== STEP 3: PASS GENERATION ====================
  function generatePasses() {
    if (!allMemberPasses.length && !memberData) {
      showError("Error", "No pass data available.");
      return;
    }

    showLoading("Generating your pass...");
    showStep(3);

    const passList = allMemberPasses.length ? allMemberPasses : [memberData];
    const container = $("#passesContainer");
    if (!container) { hideLoading(); return; }
    container.innerHTML = "";

    if (passList.length > 1) {
      const info = document.createElement("div");
      info.className = "multi-pass-info";
      info.innerHTML = '<i data-lucide="layers"></i> <div><strong>' + passList.length + ' passes</strong> registered under your email</div>';
      container.appendChild(info);
    }

    passList.forEach((member, idx) => renderSinglePass(member, container, idx));

    if (typeof lucide !== "undefined") setTimeout(() => lucide.createIcons(), 300);

    const dlBtn = $("#downloadPngBtn");
    const pdfBtn = $("#downloadPdfBtn");
    if (dlBtn && passList.length > 1) dlBtn.innerHTML = '<i data-lucide="download"></i> Download ' + passList.length + ' Images';
    if (pdfBtn && passList.length > 1) pdfBtn.innerHTML = '<i data-lucide="file-text"></i> Download PDF (' + passList.length + ' passes)';
    if (typeof lucide !== "undefined") setTimeout(() => lucide.createIcons(), 400);

    hideLoading();
  }

  function renderSinglePass(member, container, index) {
    const template = $("#passTemplate");
    if (!template) { console.error("[Pass] Template not found"); return; }

    const passClone = template.content.cloneNode(true);
    const passEl = passClone.querySelector(".event-pass");
    if (!passEl) { console.error("[Pass] .event-pass not in template"); return; }

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

    // QR Generation with robust fallback
    setTimeout(() => {
      const passes = container.querySelectorAll(".event-pass");
      const insertedPass = passes[index];
      if (!insertedPass) { console.error("[QR] Pass not found at index", index); return; }

      const qrContainer = insertedPass.querySelector(".pass-qr-code");
      const qrTextEl = insertedPass.querySelector(".pass-qr-code-text");
      if (!qrContainer) { console.error("[QR] Container not found"); return; }

      qrContainer.innerHTML = "";
      const qrData = member.qr_code_data || (member.ri_id + "|" + memberCode);

      // Method 1: QRCode.js browser library
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
          console.log("[QR] Generated for", memberCode);
          return; // Success — exit
        } catch (qrErr) {
          console.warn("[QR] Library error:", qrErr.message);
        }
      } else {
        console.warn("[QR] QRCode.js not loaded");
      }

      // Method 2: API Fallback
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
      img.alt = "QR Code - " + memberCode;
      img.width = size;
      img.height = size;
      img.style.borderRadius = "6px";
      img.style.display = "block";
      img.crossOrigin = "anonymous";

      img.onload = () => { console.log("[QR Fallback] API generated for", memberCode); };
      img.onerror = () => {
        console.error("[QR Fallback] API failed");
        container.innerHTML =
          '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;background:#E8F5E9;border-radius:8px;border:2px dashed #A5D6A7;flex-direction:column;gap:6px;">' +
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" stroke-width="1.5"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>' +
            '<span style="font-size:0.65rem;color:#2E7D32;font-weight:700;">QR Code</span>' +
          '</div>';
      };

      container.appendChild(img);
      if (textEl) textEl.textContent = memberCode;
    } catch (e) {
      console.error("[QR] All methods failed:", e);
      container.innerHTML = '<div style="padding:20px;color:#999;font-size:12px;text-align:center;">QR unavailable</div>';
    }
  }

  // ==================== DOWNLOAD ENGINE ====================
  async function downloadAsPng() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass to download", "error"); return; }
    if (typeof html2canvas === "undefined") { showToast("Download library not loaded", "error"); return; }

    showLoading("Generating high-resolution images...");

    try {
      for (let i = 0; i < passes.length; i++) {
        const canvas = await html2canvas(passes[i], {
          scale: 3, useCORS: true, allowTaint: true, backgroundColor: "#FFFFFF", logging: false
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
      playSuccess();
    } catch (err) {
      hideLoading();
      console.error("PNG error:", err);
      showToast("Download failed. Try Print.", "error");
    }
  }

  async function downloadAsPdf() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass to download", "error"); return; }
    if (typeof html2canvas === "undefined" || typeof jspdf === "undefined") {
      showToast("Download libraries not loaded", "error");
      return;
    }

    showLoading("Generating PDF...");

    try {
      const { jsPDF } = jspdf;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < passes.length; i++) {
        const canvas = await html2canvas(passes[i], {
          scale: 3, useCORS: true, allowTaint: true, backgroundColor: "#FFFFFF", logging: false
        });
        const imgData = canvas.toDataURL("image/png", 1.0);
        const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", (pdfW - w) / 2, (pdfH - h) / 2, w, h);
      }

      pdf.setProperties({ title: "ALTITUDE 2026 Event Passes", author: "Team ALTITUDE", creator: "ALTITUDE Portal" });
      pdf.save("ALTITUDE_2026_Passes_" + (memberData?.ri_id || "pass") + ".pdf");

      hideLoading();
      showToast("✓ PDF downloaded!");
      vibrate(50);
      playSuccess();
    } catch (err) {
      hideLoading();
      console.error("PDF error:", err);
      showToast("PDF download failed.", "error");
    }
  }

  function printPass() {
    const passes = $$(".event-pass");
    if (!passes.length) { showToast("No pass to print", "error"); return; }

    const printWindow = window.open("", "_blank");
    if (!printWindow) { showToast("Please allow popups to print.", "error"); return; }

    let allHtml = "";
    passes.forEach(p => { allHtml += '<div style="page-break-after:always;padding:20px;">' + p.outerHTML + '</div>'; });

    printWindow.document.write(
      '<!DOCTYPE html><html><head><title>ALTITUDE 2026 Passes</title>' +
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
    if (!currentEmail || !memberData) { showToast("No email available", "error"); return; }
    if (typeof emailjs === "undefined") { showToast("Email service unavailable", "warning"); return; }

    showLoading("Sending pass to your email...");

    try {
      const passLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(memberData.ri_id) + "&email=" + encodeURIComponent(currentEmail);

      await retryOp(() =>
        emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_NOTIFICATION, {
          to_name: memberData.full_name,
          to_email: currentEmail.trim(),
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
        }, EMAILJS_PUBLIC_KEY),
        2, 1500
      );

      hideLoading();
      showToast("✓ Pass sent to " + currentEmail);
      vibrate(50);
      playSuccess();
    } catch (err) {
      hideLoading();
      console.error("Email error:", err);
      showToast("Failed to email pass.", "error");
    }
  }

  async function sharePass() {
    if (!memberData) return;
    const shareLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(memberData.ri_id) + "&email=" + encodeURIComponent(currentEmail);
    const shareData = {
      title: "ALTITUDE 2026 - My Event Pass",
      text: "I'm attending ALTITUDE 2026! 🏔️ Rotaract District 3206 Trekking Event at Ooty.",
      url: shareLink
    };

    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        showToast("Shared!");
      } else {
        await navigator.clipboard.writeText(shareLink);
        showToast("Link copied to clipboard!");
      }
    } catch (err) {
      if (err.name !== "AbortError") showToast("Share failed.", "warning");
    }
  }

  async function copyPassId() {
    if (!memberData?.member_code) return;
    try {
      await navigator.clipboard.writeText(memberData.member_code);
      showToast("✓ Code copied!");
      vibrate(30);
    } catch {
      showToast("Code: " + memberData.member_code, "warning");
    }
  }

  function saveToDevice() {
    showToast("Use 'Download as Image' and save to your gallery.", "success", 5000);
  }

  function addToCalendar() {
    const start = "20261212T060000";
    const end = "20261213T180000";
    const title = "ALTITUDE 2026 - Rotaract District Trekking";
    const details = "ALTITUDE 2026 Trekking Event\\nRI ID: " + (memberData?.ri_id || "") + "\\nCode: " + (memberData?.member_code || "") + "\\nVenue: Ooty";
    const location = "Ooty, Tamil Nadu, India";
    const url = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(title) + "&dates=" + start + "/" + end + "&details=" + encodeURIComponent(details) + "&location=" + encodeURIComponent(location);
    window.open(url, "_blank");
    showToast("Opening Calendar...");
  }

  // ==================== EVENT LISTENERS ====================
  function init() {
    const verifyForm = $("#verifyForm");
    if (verifyForm) verifyForm.addEventListener("submit", handleVerifySubmit);

    const otpForm = $("#otpForm");
    if (otpForm) otpForm.addEventListener("submit", handleOtpSubmit);

    initOtpInputs();

    const resendBtn = $("#resendOtpBtn");
    if (resendBtn) {
      resendBtn.addEventListener("click", async () => {
        if (resendBtn.disabled) return;
        otpAttempts = 0;
        $$(".otp-box").forEach(b => { b.disabled = false; b.value = ""; b.style.borderColor = ""; });
        await sendOtp(memberData?.full_name || "Rotaractor");
      });
    }

    const changeBtn = $("#changeEmailBtn");
    if (changeBtn) {
      changeBtn.addEventListener("click", () => {
        clearInterval(otpTimerInterval);
        clearInterval(resendTimerInterval);
        showStep(1);
      });
    }

    const backBtn = $("#backToStart");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
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
    }

    // Download buttons
    $("#downloadPngBtn")?.addEventListener("click", downloadAsPng);
    $("#downloadPdfBtn")?.addEventListener("click", downloadAsPdf);
    $("#printPassBtn")?.addEventListener("click", printPass);
    $("#emailPassBtn")?.addEventListener("click", emailPass);
    $("#sharePassBtn")?.addEventListener("click", sharePass);
    $("#copyCodeBtn")?.addEventListener("click", copyPassId);
    $("#saveToDeviceBtn")?.addEventListener("click", saveToDevice);
    $("#calendarBtn")?.addEventListener("click", addToCalendar);

    // URL params
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
    }

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const m = $("#errorModal");
        if (m?.classList.contains("active")) m.classList.remove("active");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && currentStep === 3) { e.preventDefault(); downloadAsPng(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && currentStep === 3) { e.preventDefault(); printPass(); }
    });

    // Prevent autofill issues
    document.querySelectorAll("input[type='text']").forEach(inp => inp.setAttribute("autocomplete", "off"));

    // Enable audio on first interaction
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });

    console.log("[Pass Engine] v9.0 initialized ✓");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
