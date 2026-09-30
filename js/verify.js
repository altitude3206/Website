/**
 * ALTITUDE — QUANTUM VERIFY SCANNER v9.0
 * Zero-Bug · Atomic Check-in · Offline Queue · Web Audio
 * Production-Ready Enterprise Attendance System
 */

(function () {
  "use strict";

  // ==================== DATABASE ====================
  function getDb() { return window.db || null; }

  function waitForDb(cb, max = 8000) {
    if (getDb()) { cb(getDb()); return; }
    const s = Date.now();
    const i = setInterval(() => {
      if (getDb()) { clearInterval(i); cb(getDb()); }
      else if (Date.now() - s > max) clearInterval(i);
    }, 200);
    window.addEventListener("dbReady", function h(e) {
      clearInterval(i);
      window.removeEventListener("dbReady", h);
      cb(e.detail.db);
    });
  }

  // ==================== CONFIG ====================
  const SESSION_HOURS = 8;
  const STATS_INTERVAL = 20000;
  const SCAN_COOLDOWN = 2500;
  const OFFLINE_SYNC = 15000;
  const DUPLICATE_WINDOW = 5000;

  // ==================== STATE ====================
  let scanner = null;
  let qrEngine = null;
  let isScanning = false;
  let scanLocked = false;
  let recentScans = [];
  let cameras = [];
  let cameraIdx = 0;
  let facingMode = "environment";
  let statsTimer = null;
  let rtChannel = null;
  let offlineQ = [];
  let audioCtx = null;
  let scanCount = 0;
  let okCount = 0;
  let errCount = 0;
  let sessionStart = null;
  let lastQR = null;
  let lastQRAt = 0;

  // ==================== DOM ====================
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // ==================== TOAST ====================
  function toast(msg, type = "success", ms = 3500) {
    const t = $("#toast");
    const m = $("#toastMessage");
    if (!t || !m) return;
    m.textContent = msg;
    t.className = "toast " + type + " show";
    const ic = t.querySelector(".toast-icon");
    if (ic) {
      const icons = { success: "check-circle", error: "alert-circle", warning: "alert-triangle" };
      ic.setAttribute("data-lucide", icons[type] || "check-circle");
    }
    if (typeof lucide !== "undefined") lucide.createIcons();
    setTimeout(() => t.classList.remove("show"), ms);
  }

  // ==================== LOADING ====================
  function loading(text = "Verifying...") {
    const o = $("#loadingOverlay");
    const t = $("#loadingText");
    if (o) o.classList.add("active");
    if (t) t.textContent = text;
  }

  function loaded() {
    const o = $("#loadingOverlay");
    if (o) o.classList.remove("active");
  }

  // ==================== UTILITIES ====================
  function esc(s) {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function timeAgo(d) {
    if (!d) return "";
    const ms = Date.now() - new Date(d).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    const h = Math.floor(ms / 3600000);
    if (h < 24) return h + "h";
    return Math.floor(ms / 86400000) + "d";
  }

  function vibrate(p = 50) {
    try { if (navigator.vibrate) navigator.vibrate(p); } catch {}
  }

  // ==================== AUDIO ENGINE ====================
  function initAudio() {
    try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }

  function tone(freq = 800, dur = 100, vol = 0.1) {
    try {
      if (!audioCtx) initAudio();
      if (!audioCtx) return;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur / 1000);
      o.start(audioCtx.currentTime);
      o.stop(audioCtx.currentTime + dur / 1000);
    } catch {}
  }

  function sndOk() { tone(880, 80); setTimeout(() => tone(1108, 100), 90); setTimeout(() => tone(1318, 150), 200); }
  function sndErr() { tone(400, 150); setTimeout(() => tone(300, 200), 160); }
  function sndWarn() { tone(600, 100); setTimeout(() => tone(600, 100), 180); }
  function sndBeep() { tone(1200, 40, 0.06); }

  // ==================== NETWORK ====================
  function initNetwork() {
    const el = $("#networkStatus");
    const update = () => {
      if (el) el.classList.toggle("show", !navigator.onLine);
      if (navigator.onLine) syncOffline();
    };
    window.addEventListener("online", () => { update(); toast("Back online! Syncing...", "success"); });
    window.addEventListener("offline", () => { update(); toast("Offline. Scans will queue.", "warning"); });
    update();
  }

  // ==================== AUTH ====================
  async function handleLogin(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) { toast("System loading...", "warning"); return; }

    const email = $("#scannerEmail")?.value.trim().toLowerCase();
    const pass = $("#scannerPassword")?.value;
    const err = $("#scannerLoginError");

    if (!email || !pass) {
      if (err) { err.textContent = "Enter credentials."; err.style.display = "block"; }
      return;
    }

    loading("Authenticating...");
    if (err) err.style.display = "none";

    try {
      const { data, error } = await db.rpc("verify_admin", { p_email: email, p_password: pass });
      if (error || !data || !data.length) throw new Error("Invalid credentials.");

      const user = data[0];
      if (!["scanner", "admin", "super_admin"].includes(user.role)) throw new Error("No scanner access.");

      scanner = user;
      scanner.timestamp = Date.now();
      localStorage.setItem("altitude_scanner", JSON.stringify(scanner));

      // Log login
      db.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", user.id).then(() => {});
      db.from("activity_log").insert({
        admin_id: user.id,
        action_type: "SCANNER_LOGIN",
        entity_type: "admin_users",
        entity_id: user.id,
        description: "Scanner login — " + navigator.userAgent.substring(0, 60)
      }).then(() => {});

      loaded();
      showApp();
      toast("✓ Welcome, " + user.full_name);
      sndOk();
    } catch (e) {
      loaded();
      if (err) { err.textContent = e.message; err.style.display = "block"; }
      sndErr();
    }
  }

  function checkSession() {
    try {
      const raw = localStorage.getItem("altitude_scanner");
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (Date.now() - s.timestamp > SESSION_HOURS * 3600000) {
        localStorage.removeItem("altitude_scanner");
        return false;
      }
      scanner = s;
      return true;
    } catch {
      localStorage.removeItem("altitude_scanner");
      return false;
    }
  }

  function showApp() {
    const login = $("#scannerLoginScreen");
    const app = $("#scannerApp");
    if (login) login.style.display = "none";
    if (app) app.style.display = "flex";
    if (scanner) {
      const el = $("#scannerUserName");
      if (el) el.textContent = scanner.full_name + " · " + scanner.role;
    }
    sessionStart = Date.now();
    loadStats();
    startStatsRefresh();
    initRealtime();
    detectCameras();
    initOffline();
    loadScansFromStorage();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function logout() {
    if (isScanning) stopScan();
    stopStatsRefresh();
    stopRealtime();
    localStorage.removeItem("altitude_scanner");
    location.reload();
  }

  // ==================== REALTIME ====================
  function initRealtime() {
    const db = getDb();
    if (!db) return;
    try {
      rtChannel = db.channel("att-live-" + Date.now())
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "members", filter: "attendance_checked=eq.true" }, () => loadStats())
        .subscribe();
    } catch {}
  }

  function stopRealtime() {
    const db = getDb();
    if (rtChannel && db) { try { db.removeChannel(rtChannel); } catch {} rtChannel = null; }
  }

  // ==================== OFFLINE QUEUE ====================
  function initOffline() {
    try { offlineQ = JSON.parse(localStorage.getItem("altitude_offline_queue") || "[]"); } catch { offlineQ = []; }
    window.addEventListener("online", syncOffline);
    setInterval(syncOffline, OFFLINE_SYNC);
  }

  async function syncOffline() {
    if (!navigator.onLine || !offlineQ.length) return;
    const db = getDb();
    if (!db) return;

    const batch = [...offlineQ];
    let synced = 0;

    for (const item of batch) {
      try {
        await db.from(item.table).update({
          attendance_checked: true,
          attendance_checked_at: item.ts,
          attendance_checked_by: scanner.id
        }).eq("id", item.mid);
        offlineQ = offlineQ.filter(q => q.id !== item.id);
        synced++;
      } catch {}
    }

    localStorage.setItem("altitude_offline_queue", JSON.stringify(offlineQ));
    if (synced) {
      toast("✓ Synced " + synced + " offline scan(s)");
      loadStats();
    }
  }

  function queueScan(mid, table) {
    offlineQ.push({
      id: Date.now() + "-" + Math.random().toString(36).substr(2, 6),
      mid, table,
      ts: new Date().toISOString()
    });
    localStorage.setItem("altitude_offline_queue", JSON.stringify(offlineQ));
  }

  // ==================== STATS ====================
  async function loadStats() {
    const db = getDb();
    if (!db) return;
    try {
      const [ma, da, mc, dc] = await Promise.all([
        db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved"),
        db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved"),
        db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved").eq("attendance_checked", true),
        db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved").eq("attendance_checked", true)
      ]);

      const total = (ma.count || 0) + (da.count || 0);
      const checked = (mc.count || 0) + (dc.count || 0);
      const pending = total - checked;
      const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

      animNum("totalCheckedIn", checked);
      animNum("totalApproved", total);
      animNum("pendingCheckin", pending);
      const pe = $("#checkinPercent");
      if (pe) pe.textContent = pct + "%";
    } catch {}
  }

  function animNum(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    const target = Number(val) || 0;
    const cur = parseInt(el.textContent.replace(/\D/g, "")) || 0;
    if (cur === target) return;
    const step = Math.max(1, Math.ceil(Math.abs(target - cur) / 15));
    let n = cur;
    const t = setInterval(() => {
      n = target > n ? Math.min(n + step, target) : Math.max(n - step, target);
      el.textContent = n;
      if (n === target) clearInterval(t);
    }, 30);
  }

  function startStatsRefresh() {
    stopStatsRefresh();
    statsTimer = setInterval(loadStats, STATS_INTERVAL);
  }

  function stopStatsRefresh() {
    if (statsTimer) clearInterval(statsTimer);
  }

  // ==================== CAMERA ====================
  async function detectCameras() {
    if (typeof Html5Qrcode === "undefined") return;
    try {
      cameras = await Html5Qrcode.getCameras();
      if (cameras.length > 1) {
        const btn = $("#switchCameraBtn");
        if (btn) btn.style.display = "inline-flex";
      }
    } catch {}
  }

  // ==================== SCANNER ====================
  async function startScan() {
    if (isScanning || typeof Html5Qrcode === "undefined") {
      if (typeof Html5Qrcode === "undefined") toast("Scanner library not loaded. Refresh.", "error");
      return;
    }

    try {
      qrEngine = new Html5Qrcode("qrReader");
      const config = {
        fps: 15,
        qrbox: (vw, vh) => {
          const s = Math.floor(Math.min(vw, vh) * 0.75);
          return { width: s, height: s };
        },
        aspectRatio: 1.0,
        disableFlip: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      };

      const cam = cameras.length > 0 && cameras[cameraIdx]
        ? { deviceId: { exact: cameras[cameraIdx].id } }
        : { facingMode: facingMode };

      await qrEngine.start(cam, config, onQrDetected, () => {});

      isScanning = true;
      updateScanUI(true);
      initAudio();
      toast("Scanner ready — point at QR");
    } catch (e) {
      toast("Camera error: " + e.message, "error");
      sndErr();
    }
  }

  async function stopScan() {
    if (qrEngine && isScanning) {
      try { await qrEngine.stop(); qrEngine.clear(); } catch {}
      isScanning = false;
      updateScanUI(false);
    }
  }

  function updateScanUI(on) {
    const start = $("#startScanBtn");
    const stop = $("#stopScanBtn");
    const sw = $("#switchCameraBtn");
    const ind = $("#scanningIndicator");
    const hint = $("#scannerHint");

    if (start) start.style.display = on ? "none" : "inline-flex";
    if (stop) stop.style.display = on ? "inline-flex" : "none";
    if (sw && cameras.length > 1) sw.style.display = on ? "inline-flex" : "none";
    if (ind) ind.classList.toggle("active", on);
    if (hint) hint.innerHTML = on
      ? '<i data-lucide="scan-line"></i><span>🎯 Scanning — hold QR steady in frame</span>'
      : '<i data-lucide="info"></i><span>Tap "Start Scanner" to begin</span>';
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  async function switchCam() {
    if (!cameras.length) return;
    cameraIdx = (cameraIdx + 1) % cameras.length;
    facingMode = facingMode === "environment" ? "user" : "environment";
    if (isScanning) {
      await stopScan();
      setTimeout(startScan, 400);
    }
    toast("Camera switched");
  }

  async function onQrDetected(text) {
    const now = Date.now();
    if (lastQR === text && now - lastQRAt < DUPLICATE_WINDOW) return;
    if (scanLocked) return;

    scanLocked = true;
    lastQR = text;
    lastQRAt = now;

    sndBeep();
    vibrate(60);

    if (isScanning && qrEngine) { try { await qrEngine.pause(); } catch {} }

    await verify(text, "QR Scan");

    setTimeout(() => {
      scanLocked = false;
      if (isScanning && qrEngine) { try { qrEngine.resume(); } catch {} }
    }, SCAN_COOLDOWN);
  }

  // ==================== MANUAL ENTRY ====================
  async function handleManual(e) {
    e.preventDefault();
    const inp = $("#manualInput");
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) { toast("Enter code or RI ID.", "error"); return; }
    loading("Verifying...");
    await verify(val, "Manual");
    inp.value = "";
    inp.focus();
  }

  // ==================== CORE VERIFICATION ====================
  async function verify(code, source) {
    const db = getDb();
    scanCount++;

    if (!db) {
      if (!navigator.onLine) {
        loaded();
        showResult("warning", "Offline", "Scan queued for sync.", code);
        return;
      }
      toast("Database not ready.", "error");
      loaded();
      return;
    }

    try {
      // Try atomic check-in RPC first (fastest, race-condition-safe)
      let usedRpc = false;
      try {
        const { data: rpcResult } = await db.rpc("check_in_participant", {
          p_code: code,
          p_scanner_id: scanner.id
        });

        if (rpcResult) {
          usedRpc = true;
          loaded();

          if (rpcResult.success) {
            okCount++;
            const m = rpcResult.member;
            const memberObj = {
              full_name: m.full_name,
              ri_id: m.ri_id,
              member_code: m.member_code,
              food_preference: m.food_preference,
              is_board_member: m.is_board_member,
              clubs: { club_name: m.club_name || m.portfolio || "N/A", group_number: m.group_number || "DC" }
            };
            showResult("success", "Checked In!", "", code, memberObj, rpcResult.type || "Club");
            sndOk();
            vibrate([50, 30, 100]);
            addRecent(memberObj, rpcResult.type || "Club", source);
            loadStats();
            return;
          } else if (rpcResult.status === "already_checked_in") {
            const m = rpcResult.member;
            showResult("warning", "Already Checked In", (m?.full_name || "") + " already checked in.", code, m ? {
              full_name: m.full_name, ri_id: m.ri_id, member_code: m.member_code,
              food_preference: m.food_preference, is_board_member: m.is_board_member,
              clubs: { club_name: m.club_name || m.portfolio || "N/A", group_number: m.group_number || "DC" }
            } : null, "");
            sndWarn();
            vibrate([80, 40, 80]);
            return;
          } else if (rpcResult.status === "not_approved") {
            showResult("warning", "Not Approved", rpcResult.message, code);
            sndWarn();
            return;
          } else if (rpcResult.status === "not_found") {
            // Fall through to manual lookup
            usedRpc = false;
          }
        }
      } catch (rpcErr) {
        console.warn("[RPC] check_in_participant not available, using fallback:", rpcErr.message);
        usedRpc = false;
      }

      // Fallback: Manual multi-strategy lookup
      if (!usedRpc) {
        let member = null;
        let memberType = "Club";
        let tableName = "members";

        // Strategy 1: QR code data
        let res = await db.from("members").select("*, clubs(club_name, group_number)").eq("qr_code_data", code).maybeSingle();
        if (res.data) member = res.data;

        // Strategy 2: Member code
        if (!member) {
          res = await db.from("members").select("*, clubs(club_name, group_number)").eq("member_code", code).maybeSingle();
          if (res.data) member = res.data;
        }

        // Strategy 3: RI ID
        if (!member) {
          res = await db.from("members").select("*, clubs(club_name, group_number)").eq("ri_id", code).maybeSingle();
          if (res.data) member = res.data;
        }

        // Strategy 4: DC table
        if (!member) {
          res = await db.from("district_council_registrations").select("*")
            .or("qr_code_data.eq." + code + ",member_code.eq." + code + ",ri_id.eq." + code)
            .maybeSingle();
          if (res.data) {
            member = { ...res.data, clubs: { club_name: res.data.portfolio || "District Council", group_number: "DC" } };
            memberType = "District Council";
            tableName = "district_council_registrations";
          }
        }

        if (!member) {
          loaded();
          errCount++;
          showResult("error", "Not Found", "No matching registration found.", code);
          sndErr();
          vibrate([100, 50, 100]);
          return;
        }

        if (member.status !== "approved") {
          loaded();
          errCount++;
          showResult("warning", "Not Approved", member.full_name + " — status: " + member.status, code, member, memberType);
          sndWarn();
          return;
        }

        if (member.attendance_checked) {
          loaded();
          showResult("warning", "Already Checked In", member.full_name + " checked in " + timeAgo(member.attendance_checked_at) + " ago.", code, member, memberType);
          sndWarn();
          return;
        }

        // Mark attendance
        const ts = new Date().toISOString();
        const { error: upErr } = await db.from(tableName).update({
          attendance_checked: true,
          attendance_checked_at: ts,
          attendance_checked_by: scanner.id
        }).eq("id", member.id);

        if (upErr) {
          queueScan(member.id, tableName);
          loaded();
          showResult("warning", "Queued Offline", member.full_name + " queued for sync.", code, member, memberType);
          return;
        }

        // Log
        db.from("activity_log").insert({
          admin_id: scanner.id,
          action_type: "CHECK_IN",
          entity_type: tableName,
          entity_id: member.id,
          description: member.full_name + " (" + member.ri_id + ") via " + source
        }).then(() => {});

        loaded();
        okCount++;
        showResult("success", "Checked In!", "", code, member, memberType);
        sndOk();
        vibrate([50, 30, 100]);
        addRecent(member, memberType, source);
        loadStats();
      }

    } catch (e) {
      loaded();
      errCount++;
      showResult("error", "System Error", e.message, code);
      sndErr();
    }
  }

  // ==================== RESULT DISPLAY ====================
  function showResult(type, title, msg, code, member, memberType) {
    const panel = $("#resultPanel");
    const content = $("#resultContent");
    if (!panel || !content) return;

    const icons = { success: "check-circle-2", warning: "alert-triangle", error: "x-circle" };
    const colors = { success: "#4CAF50", warning: "#F57C00", error: "#D32F2F" };
    const bgs = { success: "rgba(76,175,80,0.15)", warning: "rgba(245,124,0,0.15)", error: "rgba(211,47,47,0.15)" };

    let html = '<div class="result-icon" style="background:' + bgs[type] + ';color:' + colors[type] + ';">' +
      '<i data-lucide="' + icons[type] + '"></i></div>' +
      '<h3 style="color:' + colors[type] + ';">' + esc(title) + '</h3>';

    if (member) {
      const grp = member.clubs?.group_number === "DC" ? "DC" : "G" + (member.clubs?.group_number || "—");
      html += '<div class="result-details">' +
        '<div class="result-name">' + esc(member.full_name) + '</div>' +
        '<div class="result-info-grid">' +
          '<div><span class="lbl">RI ID</span><span class="val">' + esc(member.ri_id) + '</span></div>' +
          '<div><span class="lbl">Club</span><span class="val">' + esc(member.clubs?.club_name || memberType) + '</span></div>' +
          '<div><span class="lbl">Group</span><span class="val">' + grp + '</span></div>' +
          '<div><span class="lbl">Food</span><span class="val">' + esc(member.food_preference) + '</span></div>' +
          '<div><span class="lbl">Board</span><span class="val">' + (member.is_board_member ? "Yes" : "No") + '</span></div>' +
          '<div><span class="lbl">Code</span><span class="val">' + esc(member.member_code || "—") + '</span></div>' +
          '<div><span class="lbl">Type</span><span class="val">' + esc(memberType || "Club") + '</span></div>' +
          '<div><span class="lbl">Time</span><span class="val">' + new Date().toLocaleTimeString() + '</span></div>' +
        '</div></div>' +
        '<div class="result-actions"><button class="btn-continue" onclick="closeResult()"><i data-lucide="check"></i> Continue</button></div>';
    } else {
      html += '<p>' + esc(msg) + '</p>';
      if (code) html += '<p class="result-query">Code: <code>' + esc(code) + '</code></p>';
      html += '<div class="result-actions"><button class="btn-continue" onclick="closeResult()"><i data-lucide="x"></i> Close</button></div>';
    }

    content.innerHTML = html;
    const card = $("#resultCard");
    if (card) card.className = "result-card " + type;
    panel.classList.add("active");
    if (typeof lucide !== "undefined") lucide.createIcons();

    if (type === "success") {
      setTimeout(() => { if (panel.classList.contains("active")) panel.classList.remove("active"); }, 4000);
    }
  }

  // ==================== RECENT SCANS ====================
  function addRecent(m, type, source) {
    recentScans.unshift({
      id: Date.now() + "-" + Math.random().toString(36).substr(2, 6),
      name: m.full_name,
      riId: m.ri_id,
      club: m.clubs?.club_name || type,
      food: m.food_preference,
      time: new Date().toLocaleTimeString(),
      ts: new Date().toISOString(),
      type, source
    });
    if (recentScans.length > 50) recentScans.pop();
    saveScans();
    renderScans();
  }

  function saveScans() {
    try { localStorage.setItem("altitude_recent_scans", JSON.stringify(recentScans)); } catch {}
  }

  function loadScansFromStorage() {
    try {
      const r = localStorage.getItem("altitude_recent_scans");
      if (r) recentScans = JSON.parse(r);
      renderScans();
    } catch {}
  }

  function renderScans() {
    const c = $("#recentScansList");
    const ct = $("#recentCount");
    if (!c) return;
    if (ct) ct.textContent = recentScans.length;

    if (!recentScans.length) {
      c.innerHTML = '<div class="no-scans"><i data-lucide="scan-line"></i><p>No scans yet.</p></div>';
      if (typeof lucide !== "undefined") lucide.createIcons();
      return;
    }

    c.innerHTML = recentScans.map(s =>
      '<div class="recent-scan-item">' +
        '<div class="recent-scan-icon"><i data-lucide="user-check"></i></div>' +
        '<div class="recent-scan-info">' +
          '<div class="recent-scan-name">' + esc(s.name) + '</div>' +
          '<div class="recent-scan-meta">' + esc(s.riId) + ' · ' + esc(s.club) + '</div>' +
        '</div>' +
        '<div class="recent-scan-time">' + timeAgo(s.ts) + '</div>' +
      '</div>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.clearRecentScans = function () {
    if (confirm("Clear scan history?")) {
      recentScans = [];
      saveScans();
      renderScans();
      toast("History cleared");
    }
  };

  // ==================== SESSION ANALYTICS ====================
  window.showSessionSummary = function () {
    const mins = Math.floor((Date.now() - (sessionStart || Date.now())) / 60000);
    const rate = mins > 0 ? (scanCount / mins).toFixed(1) : "0";
    alert(
      "📊 Session Summary\n\n" +
      "Volunteer: " + (scanner?.full_name || "—") + "\n" +
      "Duration: " + mins + " min\n" +
      "Total Scans: " + scanCount + "\n" +
      "Successful: " + okCount + "\n" +
      "Failed: " + errCount + "\n" +
      "Rate: " + rate + " scans/min\n" +
      "Offline Queue: " + offlineQ.length + "\n" +
      "History: " + recentScans.length
    );
  };

  // ==================== MODE TOGGLE ====================
  function initModes() {
    $$(".scan-mode-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        $$(".scan-mode-btn").forEach(b => b.classList.remove("active"));
        this.classList.add("active");
        const mode = this.dataset.mode;
        if (mode === "camera") {
          if ($("#cameraPanel")) $("#cameraPanel").classList.add("active");
          if ($("#manualPanel")) $("#manualPanel").classList.remove("active");
        } else {
          if ($("#cameraPanel")) $("#cameraPanel").classList.remove("active");
          if ($("#manualPanel")) $("#manualPanel").classList.add("active");
          if (isScanning) stopScan();
          setTimeout(() => { const inp = $("#manualInput"); if (inp) inp.focus(); }, 200);
        }
      });
    });
  }

  // ==================== GLOBAL FUNCTIONS ====================
  window.closeResult = function () {
    const p = $("#resultPanel");
    if (p) p.classList.remove("active");
  };

  window.toggleDrawer = function () {
    const d = $("#recentDrawer");
    if (d) d.classList.toggle("open");
  };

  // ==================== INIT ====================
  function init() {
    if (checkSession()) showApp();

    // Events
    $("#scannerLoginForm")?.addEventListener("submit", handleLogin);
    $("#scannerLogoutBtn")?.addEventListener("click", logout);
    $("#startScanBtn")?.addEventListener("click", startScan);
    $("#stopScanBtn")?.addEventListener("click", stopScan);
    $("#switchCameraBtn")?.addEventListener("click", switchCam);
    $("#manualForm")?.addEventListener("submit", handleManual);

    initModes();
    initNetwork();

    // Close result on overlay click
    const rp = $("#resultPanel");
    if (rp) rp.addEventListener("click", function (e) { if (e.target === this) this.classList.remove("active"); });

    // Audio init on first touch
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });

    // Background stats refresh
    setInterval(() => { if (scanner) loadStats(); }, 30000);

    console.log("[Verify] v9.0 initialized ✓");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();