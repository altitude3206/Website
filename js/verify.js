/**
 * ALTITUDE 2026 — QUANTUM VERIFY SCANNER v7.0
 * Futuristic Attendance Verification System
 * Real-time sync · Offline queue · Multi-camera · Sound analytics · Duplicate detection
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
  const SESSION_HOURS = 8;
  const STATS_REFRESH_INTERVAL = 20000;
  const SCAN_COOLDOWN_MS = 2500;
  const OFFLINE_SYNC_INTERVAL = 15000;

  // ==================== STATE ====================
  let currentScanner = null;
  let html5QrCode = null;
  let isScanning = false;
  let scanCooldown = false;
  let recentScans = [];
  let currentFacingMode = "environment";
  let availableCameras = [];
  let selectedCameraId = null;
  let statsRefreshTimer = null;
  let realtimeChannel = null;
  let offlineQueue = [];
  let audioContext = null;
  let scanCount = 0;
  let sessionStartTime = null;
  let lastScannedText = null;
  let lastScannedAt = 0;

  // ==================== HELPERS ====================
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  function showToast(msg, type = "success", duration = 3500) {
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

  function showLoading(text = "Verifying...") {
    const o = $("#loadingOverlay");
    const t = $("#loadingText");
    if (o) o.classList.add("active");
    if (t) t.textContent = text;
  }

  function hideLoading() {
    const o = $("#loadingOverlay");
    if (o) o.classList.remove("active");
  }

  function formatDate(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
      });
    } catch { return "—"; }
  }

  function timeAgo(d) {
    if (!d) return "";
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(diff / 3600000);
    if (hrs < 24) return hrs + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ==================== ADVANCED AUDIO ENGINE ====================
  function initAudio() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
    } catch (e) {}
  }

  function playTone(frequency = 800, duration = 100, type = "sine", volume = 0.15) {
    try {
      if (!audioContext) initAudio();
      if (!audioContext) return;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.frequency.value = frequency;
      osc.type = type;
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

  function playWarningSound() {
    playTone(600, 120);
    setTimeout(() => playTone(600, 120), 200);
  }

  function playScanBeep() {
    playTone(1200, 50, "square", 0.08);
  }

  function vibrate(pattern = 50) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  // ==================== AUTHENTICATION ====================
  async function handleScannerLogin(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) { showToast("System initializing...", "warning"); return; }

    const email = $("#scannerEmail").value.trim().toLowerCase();
    const password = $("#scannerPassword").value;
    const errEl = $("#scannerLoginError");

    if (!email || !password) {
      errEl.textContent = "Please enter credentials.";
      errEl.style.display = "block";
      return;
    }

    showLoading("Authenticating scanner...");
    errEl.style.display = "none";

    try {
      const { data, error } = await db.rpc("verify_admin", { p_email: email, p_password: password });
      if (error || !data || !data.length) throw new Error("Invalid credentials.");

      const user = data[0];
      if (!["scanner", "admin", "super_admin"].includes(user.role)) {
        throw new Error("Your account does not have scanner access.");
      }

      currentScanner = user;
      currentScanner.timestamp = Date.now();
      localStorage.setItem("altitude_scanner", JSON.stringify(currentScanner));

      db.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", user.id);
      db.from("activity_log").insert({
        admin_id: user.id,
        action_type: "SCANNER_LOGIN",
        entity_type: "admin_users",
        entity_id: user.id,
        description: "Scanner logged in — device: " + navigator.userAgent.substring(0, 80)
      });

      hideLoading();
      showScannerApp();
      showToast("✓ Welcome, " + user.full_name);
      playSuccessSound();
      initAudio();
    } catch (err) {
      hideLoading();
      errEl.textContent = err.message;
      errEl.style.display = "block";
      playErrorSound();
    }
  }

  function checkScannerSession() {
    const raw = localStorage.getItem("altitude_scanner");
    if (!raw) return false;
    try {
      const session = JSON.parse(raw);
      if (Date.now() - session.timestamp > SESSION_HOURS * 3600 * 1000) {
        localStorage.removeItem("altitude_scanner");
        return false;
      }
      currentScanner = session;
      return true;
    } catch {
      localStorage.removeItem("altitude_scanner");
      return false;
    }
  }

  function showScannerApp() {
    $("#scannerLoginScreen").style.display = "none";
    $("#scannerApp").style.display = "flex";
    $("#scannerUserName").textContent = currentScanner.full_name + " · " + currentScanner.role;
    sessionStartTime = Date.now();
    loadStats();
    startStatsRefresh();
    initRealtimeSync();
    detectCameras();
    initOfflineSync();
    loadRecentScansFromStorage();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function scannerLogout() {
    if (isScanning) stopScanning();
    stopStatsRefresh();
    stopRealtimeSync();
    localStorage.removeItem("altitude_scanner");
    location.reload();
  }

  // ==================== REAL-TIME SYNC ====================
  function initRealtimeSync() {
    const db = getDb();
    if (!db) return;
    try {
      realtimeChannel = db
        .channel("attendance-live")
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "members", filter: "attendance_checked=eq.true" },
          () => { loadStats(); }
        )
        .subscribe();
    } catch (e) {}
  }

  function stopRealtimeSync() {
    const db = getDb();
    if (realtimeChannel && db) {
      try { db.removeChannel(realtimeChannel); } catch (e) {}
      realtimeChannel = null;
    }
  }

  // ==================== OFFLINE QUEUE ====================
  function initOfflineSync() {
    try {
      offlineQueue = JSON.parse(localStorage.getItem("altitude_offline_queue") || "[]");
    } catch { offlineQueue = []; }

    window.addEventListener("online", processOfflineQueue);
    window.addEventListener("offline", () => {
      showToast("You are offline. Scans will be queued.", "warning");
    });

    setInterval(processOfflineQueue, OFFLINE_SYNC_INTERVAL);
  }

  async function processOfflineQueue() {
    if (!navigator.onLine || !offlineQueue.length) return;
    const db = getDb();
    if (!db) return;

    const toSync = [...offlineQueue];
    for (const item of toSync) {
      try {
        await db.from(item.table).update({
          attendance_checked: true,
          attendance_checked_at: item.timestamp,
          attendance_checked_by: currentScanner.id
        }).eq("id", item.memberId);

        offlineQueue = offlineQueue.filter(q => q.id !== item.id);
        localStorage.setItem("altitude_offline_queue", JSON.stringify(offlineQueue));
      } catch (e) {}
    }

    if (toSync.length > 0) {
      showToast("✓ Synced " + toSync.length + " offline scan(s)");
      loadStats();
    }
  }

  function queueOfflineScan(memberId, table) {
    offlineQueue.push({
      id: Date.now() + "-" + Math.random(),
      memberId, table,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem("altitude_offline_queue", JSON.stringify(offlineQueue));
  }

  // ==================== STATS ====================
  async function loadStats() {
    const db = getDb();
    if (!db) return;
    try {
      const [membersApproved, dcApproved, membersChecked, dcChecked] = await Promise.all([
        db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved"),
        db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved"),
        db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved").eq("attendance_checked", true),
        db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved").eq("attendance_checked", true)
      ]);

      const totalApproved = (membersApproved.count || 0) + (dcApproved.count || 0);
      const totalChecked = (membersChecked.count || 0) + (dcChecked.count || 0);
      const pending = totalApproved - totalChecked;
      const percent = totalApproved > 0 ? Math.round((totalChecked / totalApproved) * 100) : 0;

      animateStatNum("totalCheckedIn", totalChecked);
      animateStatNum("totalApproved", totalApproved);
      animateStatNum("pendingCheckin", pending);
      const percentEl = $("#checkinPercent");
      if (percentEl) percentEl.textContent = percent + "%";
    } catch (err) {}
  }

  function animateStatNum(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const target = Number(val) || 0;
    const current = parseInt(el.textContent.replace(/[^\d]/g, "")) || 0;
    if (current === target) return;
    const step = Math.max(1, Math.ceil(Math.abs(target - current) / 15));
    let cur = current;
    const timer = setInterval(() => {
      if (target > cur) cur = Math.min(cur + step, target);
      else cur = Math.max(cur - step, target);
      el.textContent = cur;
      if (cur === target) clearInterval(timer);
    }, 30);
  }

  function startStatsRefresh() {
    stopStatsRefresh();
    statsRefreshTimer = setInterval(loadStats, STATS_REFRESH_INTERVAL);
  }

  function stopStatsRefresh() {
    if (statsRefreshTimer) clearInterval(statsRefreshTimer);
  }

  // ==================== CAMERA DETECTION ====================
  async function detectCameras() {
    if (typeof Html5Qrcode === "undefined") return;
    try {
      availableCameras = await Html5Qrcode.getCameras();
      if (availableCameras.length > 1) {
        const switchBtn = $("#switchCameraBtn");
        if (switchBtn) switchBtn.style.display = "inline-flex";
      }
    } catch (e) {}
  }

  // ==================== QR SCANNER ====================
  async function startScanning() {
    if (isScanning) return;
    if (typeof Html5Qrcode === "undefined") {
      showToast("QR Scanner library not loaded. Please refresh.", "error");
      return;
    }

    try {
      html5QrCode = new Html5Qrcode("qrReader");
      const config = {
        fps: 15,
        qrbox: (vw, vh) => {
          const min = Math.min(vw, vh);
          const size = Math.floor(min * 0.75);
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
        disableFlip: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      };

      const cameraConfig = selectedCameraId
        ? { deviceId: { exact: selectedCameraId } }
        : { facingMode: currentFacingMode };

      await html5QrCode.start(cameraConfig, config, onScanSuccess, () => {});

      isScanning = true;
      $("#startScanBtn").style.display = "none";
      $("#stopScanBtn").style.display = "inline-flex";
      if (availableCameras.length > 1) {
        $("#switchCameraBtn").style.display = "inline-flex";
      }
      $("#scannerHint").innerHTML = '<i data-lucide="scan-line"></i> <span>🎯 Scanning active — hold QR code steady in frame</span>';
      if (typeof lucide !== "undefined") lucide.createIcons();
      initAudio();
      showToast("Scanner ready — point at QR code");
    } catch (err) {
      showToast("Camera error: " + err.message, "error");
      playErrorSound();
    }
  }

  async function stopScanning() {
    if (html5QrCode && isScanning) {
      try { await html5QrCode.stop(); html5QrCode.clear(); } catch (e) {}
      isScanning = false;
      $("#startScanBtn").style.display = "inline-flex";
      $("#stopScanBtn").style.display = "none";
      $("#switchCameraBtn").style.display = "none";
      $("#scannerHint").innerHTML = '<i data-lucide="info"></i> <span>Click "Start Scanner" to begin</span>';
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  async function switchCamera() {
    if (!availableCameras.length) return;
    const currentIdx = availableCameras.findIndex(c => c.id === selectedCameraId);
    const nextIdx = (currentIdx + 1) % availableCameras.length;
    selectedCameraId = availableCameras[nextIdx].id;
    currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
    if (isScanning) {
      await stopScanning();
      setTimeout(() => startScanning(), 400);
    }
    showToast("Switched to " + (availableCameras[nextIdx].label || "camera " + (nextIdx + 1)));
  }

  async function onScanSuccess(decodedText) {
    // Duplicate scan protection
    const now = Date.now();
    if (lastScannedText === decodedText && now - lastScannedAt < SCAN_COOLDOWN_MS) return;
    if (scanCooldown) return;

    scanCooldown = true;
    lastScannedText = decodedText;
    lastScannedAt = now;

    playScanBeep();
    vibrate(60);

    if (isScanning && html5QrCode) {
      try { await html5QrCode.pause(); } catch (e) {}
    }

    await processVerification(decodedText, "QR Scan");

    setTimeout(() => {
      scanCooldown = false;
      if (isScanning && html5QrCode) {
        try { html5QrCode.resume(); } catch (e) {}
      }
    }, SCAN_COOLDOWN_MS);
  }

  // ==================== MANUAL ENTRY ====================
  async function handleManualSubmit(e) {
    e.preventDefault();
    const input = $("#manualInput").value.trim();
    if (!input) {
      showToast("Please enter a member code or RI ID.", "error");
      return;
    }
    showLoading("Verifying...");
    await processVerification(input, "Manual Entry");
  }

  // ==================== CORE VERIFICATION LOGIC ====================
  async function processVerification(query, source) {
    const db = getDb();
    if (!db) {
      // Offline mode
      if (!navigator.onLine) {
        hideLoading();
        showResult("warning", "Offline Mode", "You are offline. This scan will be queued for sync when connection returns.", query);
        return;
      }
      showToast("Database not connected.", "error");
      hideLoading();
      return;
    }

    scanCount++;

    try {
      let member = null;
      let memberType = "Club";
      let tableName = "members";

      // Strategy 1: QR match in members
      let { data: qrMatch } = await db
        .from("members")
        .select("*, clubs(club_name, group_number)")
        .eq("qr_code_data", query)
        .maybeSingle();
      if (qrMatch) member = qrMatch;

      // Strategy 2: Member code
      if (!member) {
        let { data: codeMatch } = await db
          .from("members").select("*, clubs(club_name, group_number)")
          .eq("member_code", query).maybeSingle();
        if (codeMatch) member = codeMatch;
      }

      // Strategy 3: RI ID
      if (!member) {
        let { data: riMatch } = await db
          .from("members").select("*, clubs(club_name, group_number)")
          .eq("ri_id", query).maybeSingle();
        if (riMatch) member = riMatch;
      }

      // Strategy 4: DC lookups
      if (!member) {
        let { data: dcQr } = await db
          .from("district_council_registrations").select("*")
          .or("qr_code_data.eq." + query + ",member_code.eq." + query + ",ri_id.eq." + query)
          .maybeSingle();
        if (dcQr) {
          member = { ...dcQr, clubs: { club_name: dcQr.portfolio || "District Council", group_number: "DC" } };
          memberType = "District Council";
          tableName = "district_council_registrations";
        }
      }

      if (!member) {
        hideLoading();
        showResult("error", "Not Recognized", "No matching registration found. Please verify the QR code or manually enter the correct member code / RI ID.", query);
        playErrorSound();
        vibrate([100, 50, 100]);
        return;
      }

      if (member.status !== "approved") {
        hideLoading();
        showResult("warning", "Not Approved",
          member.full_name + "'s registration status is \"" + member.status + "\". Only approved members can be checked in.",
          query);
        playWarningSound();
        vibrate([80, 40, 80]);
        return;
      }

      if (member.attendance_checked) {
        hideLoading();
        showResult("warning", "Already Checked In",
          member.full_name + " already checked in " + timeAgo(member.attendance_checked_at) + ".",
          query, member, memberType);
        playWarningSound();
        vibrate([80, 40, 80]);
        return;
      }

      // Mark attendance
      const timestamp = new Date().toISOString();
      const { error: updateErr } = await db
        .from(tableName)
        .update({
          attendance_checked: true,
          attendance_checked_at: timestamp,
          attendance_checked_by: currentScanner.id
        })
        .eq("id", member.id);

      if (updateErr) {
        // Queue offline
        queueOfflineScan(member.id, tableName);
        hideLoading();
        showResult("warning", "Queued Offline",
          member.full_name + " scan queued. Will sync when online.", query, member, memberType);
        return;
      }

      // Log activity
      db.from("activity_log").insert({
        admin_id: currentScanner.id,
        action_type: "CHECK_IN",
        entity_type: tableName,
        entity_id: member.id,
        description: member.full_name + " (" + member.ri_id + ") checked in via " + source
      }).then(() => {});

      hideLoading();
      showResult("success", "Checked In Successfully", "", query, member, memberType);
      playSuccessSound();
      vibrate([50, 30, 100]);

      // Add to recent scans
      addRecentScan(member, memberType, source);
      loadStats();

      const manualInput = $("#manualInput");
      if (manualInput) manualInput.value = "";

    } catch (err) {
      hideLoading();
      showResult("error", "System Error", "An unexpected error occurred: " + err.message, query);
      playErrorSound();
    }
  }

  // ==================== RESULT DISPLAY ====================
  function showResult(type, title, message, query, member, memberType) {
    const panel = $("#resultPanel");
    const card = $("#resultCard");
    const content = $("#resultContent");
    if (!panel || !content) return;

    const icons = { success: "check-circle-2", warning: "alert-triangle", error: "x-circle" };
    const colors = { success: "#4CAF50", warning: "#F57C00", error: "#D32F2F" };
    const bgColors = { success: "rgba(76,175,80,0.15)", warning: "rgba(245,124,0,0.15)", error: "rgba(211,47,47,0.15)" };

    let html =
      '<div class="result-icon" style="background:' + bgColors[type] + ';color:' + colors[type] + ';">' +
        '<i data-lucide="' + icons[type] + '"></i>' +
      '</div>' +
      '<h3 style="color:' + colors[type] + ';">' + escapeHtml(title) + '</h3>';

    if (member) {
      const groupDisplay = member.clubs?.group_number === "DC" ? "DC" : "Group " + member.clubs?.group_number;
      html +=
        '<div class="result-details">' +
          '<div class="result-name">' + escapeHtml(member.full_name) + '</div>' +
          '<div class="result-info-grid">' +
            '<div><span class="lbl">RI ID</span><span class="val">' + escapeHtml(member.ri_id) + '</span></div>' +
            '<div><span class="lbl">Club</span><span class="val">' + escapeHtml(member.clubs?.club_name || memberType) + '</span></div>' +
            '<div><span class="lbl">Group</span><span class="val">' + groupDisplay + '</span></div>' +
            '<div><span class="lbl">Food</span><span class="val">' + escapeHtml(member.food_preference) + '</span></div>' +
            '<div><span class="lbl">Board</span><span class="val">' + (member.is_board_member ? "Yes" : "No") + '</span></div>' +
            '<div><span class="lbl">Type</span><span class="val">' + escapeHtml(memberType) + '</span></div>' +
            '<div><span class="lbl">Code</span><span class="val">' + escapeHtml(member.member_code || "—") + '</span></div>' +
            '<div><span class="lbl">Time</span><span class="val">' + new Date().toLocaleTimeString() + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="result-actions">' +
          '<button class="btn-continue" onclick="closeResult()"><i data-lucide="check"></i> Continue Scanning</button>' +
        '</div>';
    } else {
      html += '<p>' + escapeHtml(message) + '</p>';
      if (query) html += '<p class="result-query">Query: <code>' + escapeHtml(query) + '</code></p>';
      html += '<div class="result-actions"><button class="btn-continue" onclick="closeResult()"><i data-lucide="x"></i> Close</button></div>';
    }

    content.innerHTML = html;
    card.className = "result-card " + type;
    panel.style.display = "flex";
    if (typeof lucide !== "undefined") lucide.createIcons();

    // Auto-hide success after 4 seconds
    if (type === "success") {
      setTimeout(() => {
        if (panel.style.display === "flex") panel.style.display = "none";
      }, 4000);
    }
  }

  // ==================== RECENT SCANS ====================
  function addRecentScan(member, type, source) {
    const scan = {
      id: Date.now() + "-" + Math.random(),
      name: member.full_name,
      riId: member.ri_id,
      club: member.clubs?.club_name || type,
      food: member.food_preference,
      time: new Date().toLocaleTimeString(),
      timestamp: new Date().toISOString(),
      type: type,
      source: source
    };
    recentScans.unshift(scan);
    if (recentScans.length > 30) recentScans.pop();
    saveRecentScansToStorage();
    renderRecentScans();
  }

  function saveRecentScansToStorage() {
    try {
      localStorage.setItem("altitude_recent_scans", JSON.stringify(recentScans));
    } catch {}
  }

  function loadRecentScansFromStorage() {
    try {
      const raw = localStorage.getItem("altitude_recent_scans");
      if (raw) recentScans = JSON.parse(raw);
      renderRecentScans();
    } catch {}
  }

  function renderRecentScans() {
    const container = $("#recentScansList");
    const countEl = $("#recentCount");
    if (!container) return;
    if (countEl) countEl.textContent = recentScans.length;

    if (!recentScans.length) {
      container.innerHTML =
        '<div class="no-scans">' +
          '<i data-lucide="scan-line"></i>' +
          '<p>No scans yet. Start scanning to see check-ins here.</p>' +
        '</div>';
      if (typeof lucide !== "undefined") lucide.createIcons();
      return;
    }

    container.innerHTML = recentScans.map(s =>
      '<div class="recent-scan-item">' +
        '<div class="recent-scan-icon"><i data-lucide="user-check"></i></div>' +
        '<div class="recent-scan-info">' +
          '<div class="recent-scan-name">' + escapeHtml(s.name) + '</div>' +
          '<div class="recent-scan-meta">' + escapeHtml(s.riId) + ' · ' + escapeHtml(s.club) + ' · ' + escapeHtml(s.food || "N/A") + '</div>' +
        '</div>' +
        '<div class="recent-scan-time" title="' + escapeHtml(s.time) + '">' + timeAgo(s.timestamp) + '</div>' +
      '</div>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.clearRecentScans = function () {
    if (confirm("Clear all recent scans from history?")) {
      recentScans = [];
      saveRecentScansToStorage();
      renderRecentScans();
      showToast("Recent scans cleared");
    }
  };

  // ==================== MODE TOGGLE ====================
  function initModeToggle() {
    $$(".scan-mode-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        $$(".scan-mode-btn").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        const mode = this.dataset.mode;
        if (mode === "camera") {
          $("#cameraPanel").classList.add("active");
          $("#manualPanel").classList.remove("active");
        } else {
          $("#cameraPanel").classList.remove("active");
          $("#manualPanel").classList.add("active");
          if (isScanning) stopScanning();
          setTimeout(() => $("#manualInput")?.focus(), 200);
        }
      });
    });
  }

  // ==================== SESSION ANALYTICS ====================
  window.showSessionSummary = function () {
    const sessionMins = Math.floor((Date.now() - sessionStartTime) / 60000);
    const scansPerMin = sessionMins > 0 ? (scanCount / sessionMins).toFixed(1) : "0";
    alert(
      "📊 Session Summary\n\n" +
      "Volunteer: " + currentScanner.full_name + "\n" +
      "Duration: " + sessionMins + " minutes\n" +
      "Total Scans: " + scanCount + "\n" +
      "Rate: " + scansPerMin + " scans/min\n" +
      "Offline Queue: " + offlineQueue.length + " pending"
    );
  };

  // ==================== INIT ====================
  function init() {
    if (checkScannerSession()) showScannerApp();

    $("#scannerLoginForm")?.addEventListener("submit", handleScannerLogin);
    $("#scannerLogoutBtn")?.addEventListener("click", scannerLogout);
    $("#startScanBtn")?.addEventListener("click", startScanning);
    $("#stopScanBtn")?.addEventListener("click", stopScanning);
    $("#switchCameraBtn")?.addEventListener("click", switchCamera);
    $("#manualForm")?.addEventListener("submit", handleManualSubmit);

    initModeToggle();

    // Click outside result to close
    const resultPanel = $("#resultPanel");
    if (resultPanel) {
      resultPanel.addEventListener("click", function (e) {
        if (e.target === this) this.style.display = "none";
      });
    }

    // Enhanced keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if ($("#scannerLoginScreen").style.display !== "none") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          if (isScanning) stopScanning();
          else startScanning();
          break;
        case "c":
          if (availableCameras.length > 1) switchCamera();
          break;
        case "m":
          document.querySelector('.scan-mode-btn[data-mode="manual"]')?.click();
          break;
        case "k":
          document.querySelector('.scan-mode-btn[data-mode="camera"]')?.click();
          break;
        case "s":
          $("#toggleStatsBtn")?.click();
          break;
        case "r":
          window.toggleDrawer && window.toggleDrawer();
          break;
        case "escape":
          if (window.closeResult) window.closeResult();
          break;
        case "?":
          window.showSessionSummary();
          break;
      }
    });

    // Prevent zoom on mobile double-tap
    document.addEventListener("touchend", (e) => {
      if (e.target.tagName === "BUTTON") e.preventDefault();
    });

    // Enable audio on first user interaction
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });

    if (window.CONFIG) window.CONFIG.log("Verify Scanner v7.0 initialized", "SCANNER");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();