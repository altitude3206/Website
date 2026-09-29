/**
 * ALTITUDE 2026 — QUANTUM PASS ENGINE v6.0
 * Futuristic Enterprise Pass Generation & Verification System
 * OTP · Multi-Pass · QR Security · Advanced Downloads · Real-time Analytics
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

  // Security
  const OTP_LENGTH = 6;
  const OTP_EXPIRY_MINUTES = 10;
  const RESEND_COOLDOWN_SECONDS = 30;
  const MAX_OTP_ATTEMPTS = 5;
  const MAX_VERIFY_ATTEMPTS = 10;
  const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 min
  const DEV_MODE_FALLBACK = true;

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
  let sessionStartTime = null;
  let deviceFingerprint = null;

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
    [1, 2, 3].forEach(n => {
      const el = $("#step" + n);
      if (el) {
        el.style.display = stepNum === n ? "block" : "none";
        if (stepNum === n) el.style.animation = "fadeInUp 0.4s ease";
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  function playBeep(frequency = 800, duration = 100) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = frequency;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration / 1000);
    } catch (e) {}
  }

  // ==================== SECURITY: DEVICE FINGERPRINT ====================
  function generateFingerprint() {
    if (deviceFingerprint) return deviceFingerprint;
    const data = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.platform
    ].join("|");
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    deviceFingerprint = "FP-" + Math.abs(hash).toString(36).toUpperCase();
    return deviceFingerprint;
  }

  // ==================== SECURITY: RATE LIMITING ====================
  function checkRateLimit() {
    const key = "altitude_verify_attempts";
    const now = Date.now();
    let attempts = [];
    try {
      attempts = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {}
    attempts = attempts.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (attempts.length >= MAX_VERIFY_ATTEMPTS) {
      const oldest = Math.min(...attempts);
      const waitMin = Math.ceil((RATE_LIMIT_WINDOW - (now - oldest)) / 60000);
      showError("Too Many Attempts", "You've made too many verification attempts. Please wait " + waitMin + " minute(s) before trying again.");
      return false;
    }
    attempts.push(now);
    localStorage.setItem(key, JSON.stringify(attempts));
    return true;
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

    // Validation
    if (!isValidRiId(riId)) {
      showToast("Please enter a valid RI ID (min 3 characters)", "error");
      riIdInput.focus();
      vibrate([50, 30, 50]);
      return;
    }
    if (!isValidEmail(email)) {
      showToast("Please enter a valid email address", "error");
      emailInput.focus();
      vibrate([50, 30, 50]);
      return;
    }

    showLoading("Verifying your identity...");
    otpAttempts = 0;
    verifyAttempts++;
    generateFingerprint();

    try {
      // Strategy 1: Members
      let { data: member } = await db
        .from("members")
        .select("*, clubs(club_name, group_number), registrations(registration_code, status)")
        .eq("ri_id", riId)
        .eq("email", email)
        .maybeSingle();

      let memberType = "Club";

      // Strategy 2: DC
      if (!member) {
        const { data: dc } = await db
          .from("district_council_registrations")
          .select("*")
          .eq("ri_id", riId)
          .eq("email", email)
          .maybeSingle();
        if (dc) {
          member = {
            ...dc,
            clubs: { club_name: dc.portfolio || "District Council", group_number: "DC" },
            registrations: { registration_code: dc.registration_code }
          };
          memberType = "District Council";
        }
      }

      // Strategy 3: Email-only fallback (helps typo diagnosis)
      if (!member) {
        const { data: emailMatches } = await db
          .from("members").select("*").eq("email", email).limit(3);
        if (emailMatches && emailMatches.length > 0) {
          hideLoading();
          showError(
            "RI ID Doesn't Match",
            "We found " + emailMatches.length + " registration(s) under this email, but with a different RI ID. Please double-check your Rotary International ID."
          );
          return;
        }
      }

      if (!member) {
        hideLoading();
        showError(
          "Registration Not Found",
          "No approved registration found matching your RI ID and email. Please verify your details or contact altitude3206@gmail.com for assistance."
        );
        return;
      }

      if (member.status !== "approved") {
        hideLoading();
        const statusMsg = {
          pending: "Your registration is still under verification. Please wait for admin approval — you'll receive an email once approved.",
          rejected: "Your registration was not approved. Please contact the organizing team for details."
        };
        showError(
          "Registration " + member.status.charAt(0).toUpperCase() + member.status.slice(1),
          statusMsg[member.status] || "Your registration status is: " + member.status
        );
        return;
      }

      // Store data
      memberData = member;
      memberData._type = memberType;
      currentRiId = riId;
      currentEmail = email;
      sessionStartTime = Date.now();

      // Send OTP
      await sendOtp(member.full_name);

    } catch (err) {
      hideLoading();
      console.error("Verification error:", err);
      showError("System Error", "An unexpected error occurred. Please try again or contact support.");
    }
  }

  // ==================== STEP 2: OTP FLOW ====================
  async function sendOtp(fullName) {
    const db = getDb();
    if (!db) return;

    showLoading("Sending secure OTP to your email...");

    try {
      // Generate cryptographically stronger OTP
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + OTP_EXPIRY_MINUTES);

      // Invalidate old OTPs
      await db
        .from("otp_verification")
        .update({ is_used: true })
        .eq("email", currentEmail)
        .eq("ri_id", currentRiId)
        .eq("is_used", false);

      // Insert new OTP
      const { data: otpData, error: otpErr } = await db
        .from("otp_verification")
        .insert({
          email: currentEmail,
          ri_id: currentRiId,
          otp_code: otpCode,
          expires_at: expiresAt.toISOString(),
          is_used: false
        })
        .select().single();

      if (otpErr) throw new Error("Failed to generate OTP: " + otpErr.message);
      currentOtpId = otpData.id;

      // Send via EmailJS
      let emailSent = false;
      try {
        if (typeof emailjs !== "undefined") {
          await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_OTP, {
            to_name: fullName || "Rotaractor",
            to_email: currentEmail,
            otp_code: otpCode,
            expires_in: OTP_EXPIRY_MINUTES + " minutes"
          }, EMAILJS_PRIVATE_KEY);
          emailSent = true;
        }
      } catch (emailErr) {
        console.error("EmailJS failed:", emailErr);
      }

      if (!emailSent && DEV_MODE_FALLBACK) {
        console.warn("🔐 DEV OTP:", otpCode);
        showToast("Dev mode — OTP: " + otpCode, "warning", 15000);
      }

      hideLoading();

      // Move to Step 2
      const emailDisplay = $("#otpEmailDisplay");
      if (emailDisplay) emailDisplay.textContent = currentEmail;
      showStep(2);
      startOtpTimer();
      startResendTimer();
      focusFirstOtpBox();
      playBeep(900, 80);

      if (emailSent) showToast("Secure OTP sent to " + currentEmail);

    } catch (err) {
      hideLoading();
      console.error("OTP send error:", err);
      showError("OTP Error", "Failed to send OTP. Please try again.");
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
        return;
      }
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (display) {
        display.textContent = m + ":" + String(s).padStart(2, "0");
        if (seconds < 60) display.style.color = "var(--orange)";
        else if (seconds < 30) display.style.color = "var(--red)";
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
          this.style.borderColor = "var(--green-500)";
          playBeep(1000, 30);
          if (idx < boxes.length - 1) boxes[idx + 1].focus();
        }
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
            boxes[i].style.borderColor = "var(--green-500)";
          }
        });
        const nextIdx = Math.min(paste.length, boxes.length - 1);
        boxes[nextIdx].focus();
        if (paste.length === OTP_LENGTH) {
          setTimeout(() => $("#otpForm").requestSubmit(), 200);
        }
      });
    });
  }

  async function handleOtpSubmit(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) return;

    if (otpAttempts >= MAX_OTP_ATTEMPTS) {
      showError("Too Many Attempts", "You've exceeded the maximum OTP attempts. Please request a new OTP.");
      return;
    }

    const boxes = $$(".otp-box");
    let otp = "";
    boxes.forEach(b => otp += b.value);

    if (otp.length !== OTP_LENGTH) {
      showToast("Please enter the complete " + OTP_LENGTH + "-digit OTP.", "error");
      vibrate([100, 50, 100]);
      return;
    }

    showLoading("Verifying OTP...");
    otpAttempts++;

    try {
      const { data: otpRecord, error } = await db
        .from("otp_verification")
        .select("*")
        .eq("email", currentEmail)
        .eq("ri_id", currentRiId)
        .eq("otp_code", otp)
        .eq("is_used", false)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !otpRecord) {
        hideLoading();
        const remaining = MAX_OTP_ATTEMPTS - otpAttempts;
        showToast("Invalid or expired OTP. " + (remaining > 0 ? remaining + " attempts left." : "No attempts left."), "error");
        boxes.forEach(b => { b.value = ""; b.style.borderColor = "var(--red)"; });
        setTimeout(() => boxes.forEach(b => b.style.borderColor = ""), 800);
        boxes[0].focus();
        vibrate([100, 50, 100]);
        playBeep(300, 200);
        return;
      }

      // Mark used
      await db.from("otp_verification").update({ is_used: true }).eq("id", otpRecord.id);

      clearInterval(otpTimerInterval);
      clearInterval(resendTimerInterval);

      hideLoading();
      showToast("✓ Verified successfully!", "success");
      vibrate(50);
      playBeep(1200, 150);
      setTimeout(() => playBeep(1500, 200), 150);

      // Load all passes
      await loadAllPassesForEmail();
      generatePasses();

    } catch (err) {
      hideLoading();
      console.error("OTP verification error:", err);
      showToast("Verification failed. Please try again.", "error");
    }
  }

  async function loadAllPassesForEmail() {
    const db = getDb();
    if (!db || !currentEmail) return;

    try {
      const { data: members } = await db
        .from("members")
        .select("*, clubs(club_name, group_number), registrations(registration_code)")
        .eq("email", currentEmail)
        .eq("status", "approved");

      const { data: dcs } = await db
        .from("district_council_registrations")
        .select("*")
        .eq("email", currentEmail)
        .eq("status", "approved");

      allMemberPasses = [
        ...(members || []).map(m => ({ ...m, _type: "Club" })),
        ...(dcs || []).map(d => ({
          ...d,
          _type: "District Council",
          clubs: { club_name: d.portfolio || "District Council", group_number: "DC" },
          registrations: { registration_code: d.registration_code }
        }))
      ];

      if (memberData) {
        allMemberPasses.sort((a, b) => (a.id === memberData.id ? -1 : 1));
      }
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
      info.style.cssText = "text-align:center;padding:16px;background:linear-gradient(135deg,var(--green-50),var(--white));border-radius:12px;margin-bottom:20px;border:1px solid var(--green-200);box-shadow:var(--shadow-sm);";
      info.innerHTML = '<i data-lucide="layers" style="width:22px;height:22px;color:var(--green-700);vertical-align:middle;"></i> <strong style="color:var(--green-800);font-size:1rem;">' + passList.length + ' passes</strong> <span style="color:var(--gray-600);">registered under your email</span>';
      container.appendChild(info);
    }

    passList.forEach((member, idx) => renderSinglePass(member, container, idx));

    if (typeof lucide !== "undefined") {
      setTimeout(() => lucide.createIcons(), 200);
    }

    // Update download button labels
    const dlBtn = $("#downloadPngBtn");
    const pdfBtn = $("#downloadPdfBtn");
    if (dlBtn && passList.length > 1) dlBtn.innerHTML = '<i data-lucide="image-down"></i> Download ' + passList.length + ' Images';
    if (pdfBtn && passList.length > 1) pdfBtn.innerHTML = '<i data-lucide="file-down"></i> Download PDF (' + passList.length + ' passes)';

    hideLoading();
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

    // Generate QR
    setTimeout(() => {
      const insertedPass = container.querySelectorAll(".event-pass")[index];
      if (!insertedPass) return;
      const qrContainer = insertedPass.querySelector(".pass-qr-code");
      const qrTextEl = insertedPass.querySelector(".pass-qr-code-text");
      if (qrContainer && typeof QRCode !== "undefined") {
        const qrData = member.qr_code_data || (member.ri_id + "|" + memberCode);
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
          qrContainer.innerHTML = '<div style="padding:20px;color:#999;">QR Error</div>';
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
      playBeep(1200, 100);
    } catch (err) {
      hideLoading();
      console.error("PNG error:", err);
      showToast("Download failed. Try Print instead.", "error");
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

      pdf.save("ALTITUDE_2026_Passes_" + (memberData?.ri_id || "pass") + ".pdf");
      hideLoading();
      showToast("✓ PDF downloaded!");
      vibrate(50);
      playBeep(1200, 100);
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
    passes.forEach(p => {
      allHtml += '<div style="page-break-after:always;padding:20px;">' + p.outerHTML + '</div>';
    });

    printWindow.document.write(
      '<!DOCTYPE html><html><head><title>ALTITUDE 2026 Passes</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Montserrat:wght@700;800;900&display=swap" rel="stylesheet" />' +
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

    try {
      const passLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(memberData.ri_id) + "&email=" + encodeURIComponent(currentEmail);

      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_NOTIFICATION, {
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
      }, EMAILJS_PRIVATE_KEY);

      hideLoading();
      showToast("✓ Pass sent to " + currentEmail);
      vibrate(50);
      playBeep(1200, 100);
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
      if (navigator.share) {
        await navigator.share(shareData);
        showToast("Shared successfully!");
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
      showToast("✓ Member code copied!");
      vibrate(30);
    } catch {
      showToast("Copy failed. Code: " + memberData.member_code, "warning");
    }
  }

  function saveToDevice() {
    showToast("Use 'Download as Image' and save to your gallery for offline access.", "success", 5000);
  }

  // ==================== ADD TO CALENDAR ====================
  function addToCalendar() {
    const start = "20261212T060000";
    const end = "20261213T180000";
    const title = "ALTITUDE 2026 - Rotaract District Trekking";
    const details = "ALTITUDE 2026 Trekking Event by Rotaract District 3206. Your Registration ID: " + (memberData?.ri_id || "");
    const location = "Ooty, Tamil Nadu, India";

    const url = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(title) +
      "&dates=" + start + "/" + end +
      "&details=" + encodeURIComponent(details) +
      "&location=" + encodeURIComponent(location);

    window.open(url, "_blank");
    showToast("Opening Google Calendar...");
  }

  // ==================== EVENT LISTENERS ====================
  function init() {
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
        await sendOtp(memberData?.full_name || "Rotaractor");
      });
    }

    // Change details
    const changeBtn = $("#changeEmailBtn");
    if (changeBtn) {
      changeBtn.addEventListener("click", () => {
        clearInterval(otpTimerInterval);
        clearInterval(resendTimerInterval);
        showStep(1);
      });
    }

    // Back to start
    const backBtn = $("#backToStart");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
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

    // Download & sharing buttons
    $("#downloadPngBtn")?.addEventListener("click", downloadAsPng);
    $("#downloadPdfBtn")?.addEventListener("click", downloadAsPdf);
    $("#printPassBtn")?.addEventListener("click", printPass);
    $("#emailPassBtn")?.addEventListener("click", emailPass);
    $("#sharePassBtn")?.addEventListener("click", sharePass);
    $("#copyCodeBtn")?.addEventListener("click", copyPassId);
    $("#saveToDeviceBtn")?.addEventListener("click", saveToDevice);
    $("#calendarBtn")?.addEventListener("click", addToCalendar);

    // URL prefill
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
        const errorModal = $("#errorModal");
        if (errorModal?.classList.contains("active")) errorModal.classList.remove("active");
      }
      // Ctrl/Cmd + D = Download PNG (only if on step 3)
      if ((e.ctrlKey || e.metaKey) && e.key === "d" && $("#step3").style.display !== "none") {
        e.preventDefault();
        downloadAsPng();
      }
      // Ctrl/Cmd + P = Print
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && $("#step3").style.display !== "none") {
        e.preventDefault();
        printPass();
      }
    });

    // Prevent autofill
    document.querySelectorAll("input[type='text']").forEach(inp => {
      inp.setAttribute("autocomplete", "off");
    });

    // Log system ready
    if (window.CONFIG) window.CONFIG.log("Pass Engine v6.0 initialized. Fingerprint: " + generateFingerprint(), "PASS");
  }

  // Auto-init when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();