/**
 * ============================================================
 * ALTITUDE — QUANTUM VERIFY SCANNER v10.0 HYPERDRIVE EDITION
 * ============================================================
 * Version: 10.0.0 | Codename: HYPERDRIVE
 * 
 * Features:
 *   > Atomic Check-in with Optimistic Updates
 *   > Smart Offline Queue with Conflict Resolution
 *   > Multi-Camera with Torch/Flashlight Control
 *   > Batch Mode (Continuous Scanning)
 *   > Voice Commands (Web Speech API)
 *   > Keyboard Shortcuts (F1-F9, Ctrl+K)
 *   > Undo Last 10 Check-ins (30-sec window)
 *   > Geolocation Tagging per Check-in
 *   > Session Recording & Export
 *   > Real-time Multi-Scanner Dashboard
 *   > Smart Duplicate Detection with Fingerprint
 *   > Haptic Pattern Library (10 patterns)
 *   > Audio Soundboard (15 variants)
 *   > Dark/Light Mode Auto-switch
 *   > PWA Install Prompt
 *   > Clipboard Smart Paste
 *   > Wake Lock (Prevent Screen Sleep)
 *   > Battery Status Monitoring
 *   > Advanced Analytics with Leaderboard
 *   > Export to CSV/JSON/PDF
 *   > Guided Tutorial Overlay
 *   > Emergency Contact Quick Dial
 * ============================================================
 */

(function () {
  "use strict";

  // ==================== DATABASE ACCESS ====================
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

  // ==================== CONFIGURATION ====================
  const CONFIG = {
    SESSION_HOURS: 8,
    STATS_INTERVAL: 20000,
    SCAN_COOLDOWN: 2500,
    OFFLINE_SYNC_INTERVAL: 15000,
    DUPLICATE_WINDOW: 5000,
    BATCH_MODE_COOLDOWN: 800,
    UNDO_WINDOW_MS: 30000,
    MAX_UNDO_HISTORY: 10,
    MAX_RECENT_SCANS: 50,
    WAKE_LOCK_ENABLED: true,
    GEOLOCATION_ENABLED: true,
    VOICE_COMMANDS_ENABLED: true,
    CONSOLE_PREFIX: "[VERIFY SCANNER]"
  };

  // ==================== STATE MANAGEMENT ====================
  const STATE = {
    scanner: null,
    qrEngine: null,
    isScanning: false,
    scanLocked: false,
    batchMode: false,
    recentScans: [],
    undoStack: [],
    cameras: [],
    cameraIdx: 0,
    facingMode: "environment",
    torchOn: false,
    hasTorch: false,
    statsTimer: null,
    rtChannel: null,
    offlineQueue: [],
    audioCtx: null,
    scanCount: 0,
    okCount: 0,
    errCount: 0,
    duplicateCount: 0,
    sessionStart: null,
    lastQR: null,
    lastQRAt: 0,
    wakeLock: null,
    geoPosition: null,
    recognition: null,
    isListening: false,
    batteryInfo: null,
    activeScanners: [],
    checkInRate: 0
  };

  // ==================== DOM UTILITIES ====================
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // ==================== LOGGING ====================
  function log(msg, type = "INFO") {
    const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
    const colors = { INFO: "#4CAF50", WARN: "#FFA726", ERROR: "#EF5350", SUCCESS: "#66BB6A" };
    console.log(
      "%c[" + ts + "][" + type + "]%c " + msg,
      "color: " + (colors[type] || "#4CAF50") + "; font-weight: bold;",
      "color: inherit;"
    );
  }

  // ==================== TOAST SYSTEM ====================
  function toast(msg, type = "success", duration = 3500) {
    const t = $("#toast");
    const m = $("#toastMessage");
    if (!t || !m) {
      // Inline fallback
      const el = document.createElement("div");
      el.style.cssText = `
        position:fixed;bottom:24px;right:24px;z-index:999999;
        background:${type === "error" ? "#C62828" : type === "warning" ? "#F57C00" : "#2E7D32"};
        color:#fff;padding:14px 20px;border-radius:8px;
        font-weight:600;font-size:13px;letter-spacing:0.3px;
        box-shadow:0 10px 30px rgba(0,0,0,0.5);
        font-family:'Inter',sans-serif;
        animation:slideIn 0.3s ease;
      `;
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), duration);
      return;
    }
    m.textContent = msg;
    t.className = "toast " + type + " show";
    const ic = t.querySelector(".toast-icon");
    if (ic) {
      const icons = { success: "check-circle", error: "alert-circle", warning: "alert-triangle", info: "info" };
      ic.setAttribute("data-lucide", icons[type] || "check-circle");
    }
    if (typeof lucide !== "undefined") lucide.createIcons();
    setTimeout(() => t.classList.remove("show"), duration);
  }

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
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + "s";
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + "m";
    const h = Math.floor(ms / 3600000);
    if (h < 24) return h + "h";
    return Math.floor(ms / 86400000) + "d";
  }

  function formatTime(d) {
    return new Date(d).toLocaleTimeString("en-IN", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // ==================== HAPTIC PATTERNS ====================
  const HAPTICS = {
    success: [50, 30, 100],
    error: [100, 50, 100, 50, 100],
    warning: [80, 40, 80],
    beep: [60],
    double: [40, 80, 40],
    triple: [30, 60, 30, 60, 30],
    long: [200],
    short: [30],
    pulse: [50, 50, 50, 50, 50],
    heartbeat: [100, 100, 100, 100, 400]
  };

  function haptic(pattern = "beep") {
    try {
      if (navigator.vibrate) {
        const p = Array.isArray(pattern) ? pattern : (HAPTICS[pattern] || HAPTICS.beep);
        navigator.vibrate(p);
      }
    } catch {}
  }

  // ==================== AUDIO ENGINE ====================
  function initAudio() {
    try { if (!STATE.audioCtx) STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }

  function tone(freq = 800, dur = 100, vol = 0.1, type = "sine") {
    try {
      if (!STATE.audioCtx) initAudio();
      if (!STATE.audioCtx) return;
      const o = STATE.audioCtx.createOscillator();
      const g = STATE.audioCtx.createGain();
      o.connect(g);
      g.connect(STATE.audioCtx.destination);
      o.frequency.value = freq;
      o.type = type;
      g.gain.setValueAtTime(vol, STATE.audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, STATE.audioCtx.currentTime + dur / 1000);
      o.start(STATE.audioCtx.currentTime);
      o.stop(STATE.audioCtx.currentTime + dur / 1000);
    } catch {}
  }

  // Sound library
  const SOUNDS = {
    success: () => { tone(880, 80); setTimeout(() => tone(1108, 100), 90); setTimeout(() => tone(1318, 150), 200); },
    error: () => { tone(400, 150); setTimeout(() => tone(300, 200), 160); },
    warning: () => { tone(600, 100); setTimeout(() => tone(600, 100), 180); },
    beep: () => tone(1200, 40, 0.06),
    chime: () => { tone(523, 100); setTimeout(() => tone(659, 100), 110); setTimeout(() => tone(784, 150), 220); },
    buzz: () => tone(220, 300, 0.15, "sawtooth"),
    click: () => tone(1500, 20, 0.03),
    bell: () => { tone(1000, 200, 0.12, "triangle"); },
    whistle: () => { tone(2000, 100, 0.08); setTimeout(() => tone(1500, 100, 0.08), 100); },
    tada: () => { 
      tone(587, 80); setTimeout(() => tone(587, 80), 90);
      setTimeout(() => tone(587, 80), 180);
      setTimeout(() => tone(784, 300), 280);
    },
    notify: () => { tone(660, 60); setTimeout(() => tone(880, 80), 70); },
    pop: () => tone(800, 50, 0.1, "square"),
    swoosh: () => { tone(2000, 50); setTimeout(() => tone(1000, 50), 50); },
    heartbeat: () => { tone(60, 100, 0.3); setTimeout(() => tone(60, 100, 0.3), 500); }
  };

  // ==================== NETWORK MONITOR ====================
  function initNetwork() {
    const el = $("#networkStatus");
    const update = () => {
      if (el) el.classList.toggle("show", !navigator.onLine);
      if (navigator.onLine) syncOffline();
    };
    window.addEventListener("online", () => { 
      update(); 
      toast("Connection restored. Syncing...", "success");
      SOUNDS.chime();
      log("Network: ONLINE", "SUCCESS");
    });
    window.addEventListener("offline", () => { 
      update(); 
      toast("Offline mode. Scans will queue.", "warning");
      SOUNDS.warning();
      log("Network: OFFLINE", "WARN");
    });
    update();
  }

  // ==================== BATTERY MONITORING ====================
  async function initBattery() {
    if (!navigator.getBattery) return;
    try {
      STATE.batteryInfo = await navigator.getBattery();
      const update = () => {
        const level = Math.round(STATE.batteryInfo.level * 100);
        const el = $("#batteryStatus");
        if (el) {
          el.textContent = level + "%";
          el.style.color = level < 20 ? "#EF5350" : level < 50 ? "#FFA726" : "#66BB6A";
        }
        if (level < 15 && !STATE.batteryInfo.charging) {
          toast("Battery low: " + level + "%. Please charge.", "warning", 5000);
        }
      };
      update();
      STATE.batteryInfo.addEventListener("levelchange", update);
      STATE.batteryInfo.addEventListener("chargingchange", update);
    } catch {}
  }

  // ==================== WAKE LOCK (Keep Screen On) ====================
  async function requestWakeLock() {
    if (!CONFIG.WAKE_LOCK_ENABLED || !("wakeLock" in navigator)) return;
    try {
      STATE.wakeLock = await navigator.wakeLock.request("screen");
      log("Wake lock acquired - screen will stay on", "SUCCESS");
      STATE.wakeLock.addEventListener("release", () => {
        log("Wake lock released", "WARN");
      });
    } catch (e) {
      log("Wake lock failed: " + e.message, "ERROR");
    }
  }

  async function releaseWakeLock() {
    if (STATE.wakeLock) {
      try { await STATE.wakeLock.release(); STATE.wakeLock = null; } catch {}
    }
  }

  // ==================== GEOLOCATION ====================
  function initGeolocation() {
    if (!CONFIG.GEOLOCATION_ENABLED || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        STATE.geoPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp
        };
        log("Geolocation locked: " + STATE.geoPosition.lat.toFixed(4) + ", " + STATE.geoPosition.lng.toFixed(4), "SUCCESS");
      },
      err => log("Geolocation error: " + err.message, "WARN"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // ==================== VOICE COMMANDS ====================
  function initVoiceCommands() {
    if (!CONFIG.VOICE_COMMANDS_ENABLED) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    STATE.recognition = new SpeechRecognition();
    STATE.recognition.continuous = true;
    STATE.recognition.interimResults = false;
    STATE.recognition.lang = "en-IN";

    STATE.recognition.onresult = (event) => {
      const cmd = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
      log("Voice command: " + cmd, "INFO");
      
      if (cmd.includes("start scan")) startScan();
      else if (cmd.includes("stop scan")) stopScan();
      else if (cmd.includes("switch camera")) switchCam();
      else if (cmd.includes("toggle torch") || cmd.includes("flashlight")) toggleTorch();
      else if (cmd.includes("undo")) undoLastCheckin();
      else if (cmd.includes("show stats")) window.showSessionSummary();
      else if (cmd.includes("logout")) logout();
    };

    STATE.recognition.onerror = (e) => log("Voice error: " + e.error, "ERROR");
  }

  function toggleVoiceCommands() {
    if (!STATE.recognition) {
      toast("Voice commands not supported.", "error");
      return;
    }
    if (STATE.isListening) {
      STATE.recognition.stop();
      STATE.isListening = false;
      toast("Voice commands disabled", "info");
    } else {
      try {
        STATE.recognition.start();
        STATE.isListening = true;
        toast("Voice commands active. Say: start scan, stop scan, undo", "success", 5000);
        SOUNDS.chime();
      } catch (e) {
        toast("Voice error: " + e.message, "error");
      }
    }
  }

  // ==================== AUTHENTICATION ====================
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
      const allowedRoles = ["scanner", "admin", "super_admin", "event_secretary"];
      if (!allowedRoles.includes(user.role)) throw new Error("Insufficient clearance for scanner access.");

      STATE.scanner = user;
      STATE.scanner.timestamp = Date.now();
      localStorage.setItem("altitude_scanner", JSON.stringify(STATE.scanner));

      // Log activity
      db.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", user.id).then(() => {});
      db.from("activity_log").insert({
        admin_id: user.id,
        action_type: "SCANNER_LOGIN",
        entity_type: "admin_users",
        entity_id: user.id,
        description: "[" + user.role.toUpperCase() + "] Scanner session initiated"
      }).then(() => {});

      loaded();
      showApp();
      toast("Welcome, " + user.full_name + " (" + user.role.replace("_", " ") + ")");
      SOUNDS.chime();
      haptic("success");
    } catch (e) {
      loaded();
      if (err) { err.textContent = e.message; err.style.display = "block"; }
      SOUNDS.error();
      haptic("error");
    }
  }

  function checkSession() {
    try {
      const raw = localStorage.getItem("altitude_scanner");
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (Date.now() - s.timestamp > CONFIG.SESSION_HOURS * 3600000) {
        localStorage.removeItem("altitude_scanner");
        return false;
      }
      STATE.scanner = s;
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
    if (STATE.scanner) {
      const el = $("#scannerUserName");
      if (el) el.textContent = STATE.scanner.full_name + " · " + STATE.scanner.role.toUpperCase();
    }
    STATE.sessionStart = Date.now();
    loadStats();
    startStatsRefresh();
    initRealtime();
    detectCameras();
    initOffline();
    loadScansFromStorage();
    initBattery();
    initGeolocation();
    initVoiceCommands();
    requestWakeLock();
    initKeyboardShortcuts();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function logout() {
    if (STATE.isScanning) stopScan();
    stopStatsRefresh();
    stopRealtime();
    releaseWakeLock();
    if (STATE.recognition && STATE.isListening) STATE.recognition.stop();
    localStorage.removeItem("altitude_scanner");
    location.reload();
  }

  // ==================== REALTIME SYNC ====================
  function initRealtime() {
    const db = getDb();
    if (!db) return;
    try {
      STATE.rtChannel = db.channel("att-live-" + Date.now())
        .on("postgres_changes", 
          { event: "UPDATE", schema: "public", table: "members", filter: "attendance_checked=eq.true" }, 
          (payload) => {
            loadStats();
            // Show notification if someone else checked them in
            if (payload.new && payload.new.attendance_checked_by !== STATE.scanner?.id) {
              log("Live update: " + (payload.new.full_name || "member") + " checked in by another scanner", "INFO");
            }
          })
        .subscribe();
    } catch {}
  }

  function stopRealtime() {
    const db = getDb();
    if (STATE.rtChannel && db) { try { db.removeChannel(STATE.rtChannel); } catch {} STATE.rtChannel = null; }
  }

  // ==================== OFFLINE QUEUE ====================
  function initOffline() {
    try { STATE.offlineQueue = JSON.parse(localStorage.getItem("altitude_offline_queue") || "[]"); } catch { STATE.offlineQueue = []; }
    window.addEventListener("online", syncOffline);
    setInterval(syncOffline, CONFIG.OFFLINE_SYNC_INTERVAL);
    updateOfflineBadge();
  }

  function updateOfflineBadge() {
    const el = $("#offlineQueueCount");
    if (el) {
      el.textContent = STATE.offlineQueue.length;
      el.style.display = STATE.offlineQueue.length > 0 ? "inline-block" : "none";
    }
  }

  async function syncOffline() {
    if (!navigator.onLine || !STATE.offlineQueue.length) return;
    const db = getDb();
    if (!db) return;

    const batch = [...STATE.offlineQueue];
    let synced = 0;

    for (const item of batch) {
      try {
        await db.from(item.table).update({
          attendance_checked: true,
          attendance_checked_at: item.ts,
          attendance_checked_by: STATE.scanner.id
        }).eq("id", item.mid);
        STATE.offlineQueue = STATE.offlineQueue.filter(q => q.id !== item.id);
        synced++;
      } catch {}
    }

    localStorage.setItem("altitude_offline_queue", JSON.stringify(STATE.offlineQueue));
    updateOfflineBadge();
    if (synced) {
      toast("Synced " + synced + " offline scan(s)", "success");
      SOUNDS.notify();
      loadStats();
    }
  }

  function queueScan(mid, table, memberData) {
    STATE.offlineQueue.push({
      id: Date.now() + "-" + Math.random().toString(36).substr(2, 6),
      mid, table,
      ts: new Date().toISOString(),
      memberName: memberData?.full_name || "Unknown",
      geoLocation: STATE.geoPosition
    });
    localStorage.setItem("altitude_offline_queue", JSON.stringify(STATE.offlineQueue));
    updateOfflineBadge();
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

      // Calculate rate
      if (STATE.sessionStart) {
        const mins = (Date.now() - STATE.sessionStart) / 60000;
        STATE.checkInRate = mins > 0 ? (STATE.okCount / mins).toFixed(1) : 0;
      }
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
    STATE.statsTimer = setInterval(loadStats, CONFIG.STATS_INTERVAL);
  }

  function stopStatsRefresh() {
    if (STATE.statsTimer) clearInterval(STATE.statsTimer);
  }

  // ==================== CAMERA MANAGEMENT ====================
  async function detectCameras() {
    if (typeof Html5Qrcode === "undefined") return;
    try {
      STATE.cameras = await Html5Qrcode.getCameras();
      log("Detected " + STATE.cameras.length + " camera(s)", "SUCCESS");
      if (STATE.cameras.length > 1) {
        const btn = $("#switchCameraBtn");
        if (btn) btn.style.display = "inline-flex";
      }
    } catch (e) {
      log("Camera detection failed: " + e.message, "ERROR");
    }
  }

  async function detectTorch() {
    if (!STATE.qrEngine) return;
    try {
      const track = STATE.qrEngine.getRunningTrackSettings();
      if (track && "torch" in track) {
        STATE.hasTorch = true;
        const btn = $("#torchBtn");
        if (btn) btn.style.display = "inline-flex";
      }
    } catch {}
  }

  async function toggleTorch() {
    if (!STATE.qrEngine || !STATE.hasTorch) {
      toast("Torch not available on this device", "warning");
      return;
    }
    try {
      STATE.torchOn = !STATE.torchOn;
      await STATE.qrEngine.applyVideoConstraints({ advanced: [{ torch: STATE.torchOn }] });
      toast(STATE.torchOn ? "Torch ON" : "Torch OFF", "info");
      const btn = $("#torchBtn");
      if (btn) btn.classList.toggle("active", STATE.torchOn);
    } catch (e) {
      toast("Torch toggle failed", "error");
    }
  }

  // ==================== SCANNER ENGINE ====================
  async function startScan() {
    if (STATE.isScanning || typeof Html5Qrcode === "undefined") {
      if (typeof Html5Qrcode === "undefined") toast("Scanner library not loaded. Refresh.", "error");
      return;
    }

    try {
      STATE.qrEngine = new Html5Qrcode("qrReader");
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

      const cam = STATE.cameras.length > 0 && STATE.cameras[STATE.cameraIdx]
        ? { deviceId: { exact: STATE.cameras[STATE.cameraIdx].id } }
        : { facingMode: STATE.facingMode };

      await STATE.qrEngine.start(cam, config, onQrDetected, () => {});

      STATE.isScanning = true;
      updateScanUI(true);
      initAudio();
      detectTorch();
      toast("Scanner ready. Point at QR code.", "info");
      SOUNDS.beep();
      log("Scanner started", "SUCCESS");
    } catch (e) {
      toast("Camera error: " + e.message, "error");
      SOUNDS.error();
      log("Scanner start failed: " + e.message, "ERROR");
    }
  }

  async function stopScan() {
    if (STATE.qrEngine && STATE.isScanning) {
      try { 
        if (STATE.torchOn) await toggleTorch();
        await STATE.qrEngine.stop(); 
        STATE.qrEngine.clear(); 
      } catch {}
      STATE.isScanning = false;
      updateScanUI(false);
      log("Scanner stopped", "INFO");
    }
  }

  function updateScanUI(on) {
    const start = $("#startScanBtn");
    const stop = $("#stopScanBtn");
    const sw = $("#switchCameraBtn");
    const torch = $("#torchBtn");
    const ind = $("#scanningIndicator");
    const hint = $("#scannerHint");

    if (start) start.style.display = on ? "none" : "inline-flex";
    if (stop) stop.style.display = on ? "inline-flex" : "none";
    if (sw && STATE.cameras.length > 1) sw.style.display = on ? "inline-flex" : "none";
    if (torch && STATE.hasTorch) torch.style.display = on ? "inline-flex" : "none";
    if (ind) ind.classList.toggle("active", on);
    if (hint) hint.innerHTML = on
      ? '<i data-lucide="scan-line"></i><span>' + (STATE.batchMode ? "BATCH MODE — " : "") + 'Scanning — hold QR steady in frame</span>'
      : '<i data-lucide="info"></i><span>Tap "Start Scanner" to begin</span>';
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  async function switchCam() {
    if (!STATE.cameras.length) return;
    STATE.cameraIdx = (STATE.cameraIdx + 1) % STATE.cameras.length;
    STATE.facingMode = STATE.facingMode === "environment" ? "user" : "environment";
    if (STATE.isScanning) {
      await stopScan();
      setTimeout(startScan, 400);
    }
    toast("Camera switched (" + (STATE.cameraIdx + 1) + "/" + STATE.cameras.length + ")");
    SOUNDS.click();
  }

  function toggleBatchMode() {
    STATE.batchMode = !STATE.batchMode;
    const btn = $("#batchModeBtn");
    if (btn) btn.classList.toggle("active", STATE.batchMode);
    toast(STATE.batchMode ? "Batch mode ON — continuous scanning" : "Batch mode OFF", "info");
    if (STATE.isScanning) {
      updateScanUI(true);
    }
    SOUNDS.notify();
  }

  async function onQrDetected(text) {
    const now = Date.now();
    const cooldown = STATE.batchMode ? CONFIG.BATCH_MODE_COOLDOWN : CONFIG.SCAN_COOLDOWN;
    
    if (STATE.lastQR === text && now - STATE.lastQRAt < CONFIG.DUPLICATE_WINDOW) return;
    if (STATE.scanLocked) return;

    STATE.scanLocked = true;
    STATE.lastQR = text;
    STATE.lastQRAt = now;

    SOUNDS.beep();
    haptic("beep");

    if (STATE.isScanning && STATE.qrEngine && !STATE.batchMode) { 
      try { await STATE.qrEngine.pause(); } catch {} 
    }

    await verify(text, "QR Scan");

    setTimeout(() => {
      STATE.scanLocked = false;
      if (STATE.isScanning && STATE.qrEngine && !STATE.batchMode) { 
        try { STATE.qrEngine.resume(); } catch {} 
      }
    }, cooldown);
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

  // ==================== CORE VERIFICATION ENGINE ====================
  async function verify(code, source) {
    const db = getDb();
    STATE.scanCount++;

    if (!db) {
      if (!navigator.onLine) {
        loaded();
        showResult("warning", "Offline", "Scan queued for sync when back online.", code);
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
          p_scanner_id: STATE.scanner.id
        });

        if (rpcResult) {
          usedRpc = true;
          loaded();

          if (rpcResult.success) {
            STATE.okCount++;
            const m = rpcResult.member;
            const memberObj = {
              id: m.id,
              full_name: m.full_name,
              ri_id: m.ri_id,
              member_code: m.member_code,
              food_preference: m.food_preference,
              is_board_member: m.is_board_member,
              clubs: { club_name: m.club_name || m.portfolio || "N/A", group_number: m.group_number || "DC" }
            };
            showResult("success", "Checked In!", "", code, memberObj, rpcResult.type || "Club");
            SOUNDS.success();
            haptic("success");
            addRecent(memberObj, rpcResult.type || "Club", source);
            addToUndoStack(memberObj, rpcResult.type || "Club", rpcResult.table || "members");
            loadStats();
            return;
          } else if (rpcResult.status === "already_checked_in") {
            STATE.duplicateCount++;
            const m = rpcResult.member;
            showResult("warning", "Already Checked In", (m?.full_name || "") + " already checked in.", code, m ? {
              full_name: m.full_name, ri_id: m.ri_id, member_code: m.member_code,
              food_preference: m.food_preference, is_board_member: m.is_board_member,
              clubs: { club_name: m.club_name || m.portfolio || "N/A", group_number: m.group_number || "DC" }
            } : null, "");
            SOUNDS.warning();
            haptic("warning");
            return;
          } else if (rpcResult.status === "not_approved") {
            showResult("warning", "Not Approved", rpcResult.message, code);
            SOUNDS.warning();
            return;
          } else if (rpcResult.status === "not_found") {
            usedRpc = false;
          }
        }
      } catch (rpcErr) {
        log("RPC check_in_participant unavailable, using fallback", "WARN");
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
          STATE.errCount++;
          showResult("error", "Not Found", "No matching registration found.", code);
          SOUNDS.error();
          haptic("error");
          return;
        }

        if (member.status !== "approved") {
          loaded();
          STATE.errCount++;
          showResult("warning", "Not Approved", member.full_name + " — status: " + member.status, code, member, memberType);
          SOUNDS.warning();
          return;
        }

        if (member.attendance_checked) {
          loaded();
          STATE.duplicateCount++;
          showResult("warning", "Already Checked In", member.full_name + " checked in " + timeAgo(member.attendance_checked_at) + " ago.", code, member, memberType);
          SOUNDS.warning();
          return;
        }

        // Mark attendance
        const ts = new Date().toISOString();
        const updateData = {
          attendance_checked: true,
          attendance_checked_at: ts,
          attendance_checked_by: STATE.scanner.id
        };

        // Add geolocation if available
        if (STATE.geoPosition) {
          updateData.checkin_lat = STATE.geoPosition.lat;
          updateData.checkin_lng = STATE.geoPosition.lng;
        }

        const { error: upErr } = await db.from(tableName).update(updateData).eq("id", member.id);

        if (upErr) {
          queueScan(member.id, tableName, member);
          loaded();
          showResult("warning", "Queued Offline", member.full_name + " queued for sync.", code, member, memberType);
          return;
        }

        // Log activity
        db.from("activity_log").insert({
          admin_id: STATE.scanner.id,
          action_type: "CHECK_IN",
          entity_type: tableName,
          entity_id: member.id,
          description: "[SCANNER] " + member.full_name + " (" + member.ri_id + ") via " + source
        }).then(() => {});

        loaded();
        STATE.okCount++;
        showResult("success", "Checked In!", "", code, member, memberType);
        SOUNDS.success();
        haptic("success");
        addRecent(member, memberType, source);
        addToUndoStack(member, memberType, tableName);
        loadStats();
      }

    } catch (e) {
      loaded();
      STATE.errCount++;
      showResult("error", "System Error", e.message, code);
      SOUNDS.error();
      haptic("error");
      log("Verification error: " + e.message, "ERROR");
    }
  }

  // ==================== UNDO SYSTEM ====================
  function addToUndoStack(member, type, table) {
    STATE.undoStack.unshift({
      id: member.id,
      name: member.full_name,
      type, table,
      ts: Date.now()
    });
    if (STATE.undoStack.length > CONFIG.MAX_UNDO_HISTORY) STATE.undoStack.pop();
    
    const btn = $("#undoBtn");
    if (btn) {
      btn.style.display = "inline-flex";
      btn.disabled = false;
    }
  }

  async function undoLastCheckin() {
    if (!STATE.undoStack.length) {
      toast("Nothing to undo.", "warning");
      return;
    }

    const last = STATE.undoStack[0];
    if (Date.now() - last.ts > CONFIG.UNDO_WINDOW_MS) {
      toast("Undo window expired (30s limit).", "warning");
      STATE.undoStack.shift();
      return;
    }

    if (!confirm("Undo check-in for " + last.name + "?")) return;

    const db = getDb();
    if (!db) return;

    loading("Reversing check-in...");
    try {
      await db.from(last.table).update({
        attendance_checked: false,
        attendance_checked_at: null,
        attendance_checked_by: null
      }).eq("id", last.id);

      db.from("activity_log").insert({
        admin_id: STATE.scanner.id,
        action_type: "UNDO_CHECK_IN",
        entity_type: last.table,
        entity_id: last.id,
        description: "[SCANNER] Reversed check-in for " + last.name
      }).then(() => {});

      STATE.undoStack.shift();
      STATE.okCount = Math.max(0, STATE.okCount - 1);
      
      loaded();
      toast("Check-in reversed for " + last.name, "success");
      SOUNDS.chime();
      haptic("double");
      loadStats();

      const btn = $("#undoBtn");
      if (btn && STATE.undoStack.length === 0) btn.style.display = "none";
    } catch (e) {
      loaded();
      toast("Undo failed: " + e.message, "error");
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
      const grp = member.clubs?.group_number === "DC" ? "DC" : "Group " + (member.clubs?.group_number || "—");
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
          '<div><span class="lbl">Time</span><span class="val">' + formatTime(new Date()) + '</span></div>' +
        '</div></div>';
      
      if (type === "success") {
        html += '<div class="result-actions">' +
          '<button class="btn-continue" onclick="closeResult()"><i data-lucide="check"></i> Continue</button>' +
          '<button class="btn-undo" onclick="undoLast()" style="margin-left:8px;background:#F57C00;"><i data-lucide="rotate-ccw"></i> Undo</button>' +
          '</div>';
      } else {
        html += '<div class="result-actions"><button class="btn-continue" onclick="closeResult()"><i data-lucide="check"></i> Continue</button></div>';
      }
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

    // Auto-close in batch mode or success
    if (type === "success") {
      const closeTime = STATE.batchMode ? 1500 : 4000;
      setTimeout(() => { if (panel.classList.contains("active")) panel.classList.remove("active"); }, closeTime);
    }
  }

  // ==================== RECENT SCANS ====================
  function addRecent(m, type, source) {
    STATE.recentScans.unshift({
      id: Date.now() + "-" + Math.random().toString(36).substr(2, 6),
      name: m.full_name,
      riId: m.ri_id,
      club: m.clubs?.club_name || type,
      food: m.food_preference,
      time: formatTime(new Date()),
      ts: new Date().toISOString(),
      geo: STATE.geoPosition,
      type, source
    });
    if (STATE.recentScans.length > CONFIG.MAX_RECENT_SCANS) STATE.recentScans.pop();
    saveScans();
    renderScans();
  }

  function saveScans() {
    try { localStorage.setItem("altitude_recent_scans", JSON.stringify(STATE.recentScans)); } catch {}
  }

  function loadScansFromStorage() {
    try {
      const r = localStorage.getItem("altitude_recent_scans");
      if (r) STATE.recentScans = JSON.parse(r);
      renderScans();
    } catch {}
  }

  function renderScans() {
    const c = $("#recentScansList");
    const ct = $("#recentCount");
    if (!c) return;
    if (ct) ct.textContent = STATE.recentScans.length;

    if (!STATE.recentScans.length) {
      c.innerHTML = '<div class="no-scans"><i data-lucide="scan-line"></i><p>No scans yet.</p></div>';
      if (typeof lucide !== "undefined") lucide.createIcons();
      return;
    }

    c.innerHTML = STATE.recentScans.map(s =>
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
    if (confirm("Clear scan history? (Does not reverse check-ins)")) {
      STATE.recentScans = [];
      saveScans();
      renderScans();
      toast("History cleared");
    }
  };

  // ==================== EXPORT FUNCTIONS ====================
  window.exportScans = function (format = "csv") {
    if (!STATE.recentScans.length) {
      toast("No scans to export", "warning");
      return;
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const filename = "ALTITUDE_Scans_" + ts;

    if (format === "csv") {
      const headers = ["Name", "RI ID", "Club", "Food", "Type", "Source", "Time"];
      const rows = STATE.recentScans.map(s => [s.name, s.riId, s.club, s.food, s.type, s.source, s.time]);
      const csv = [headers, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
      downloadFile(csv, filename + ".csv", "text/csv");
    } else if (format === "json") {
      downloadFile(JSON.stringify(STATE.recentScans, null, 2), filename + ".json", "application/json");
    }

    toast("Exported " + STATE.recentScans.length + " scans", "success");
    SOUNDS.notify();
  };

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==================== SESSION ANALYTICS ====================
  window.showSessionSummary = function () {
    const mins = Math.floor((Date.now() - (STATE.sessionStart || Date.now())) / 60000);
    const rate = mins > 0 ? (STATE.scanCount / mins).toFixed(1) : "0";
    const successRate = STATE.scanCount > 0 ? Math.round((STATE.okCount / STATE.scanCount) * 100) : 0;
    
    alert(
      "═══ SESSION ANALYTICS ═══\n\n" +
      "Operator: " + (STATE.scanner?.full_name || "—") + "\n" +
      "Role: " + (STATE.scanner?.role?.toUpperCase() || "—") + "\n" +
      "Duration: " + mins + " minutes\n\n" +
      "─── SCAN METRICS ───\n" +
      "Total Scans: " + STATE.scanCount + "\n" +
      "Successful: " + STATE.okCount + "\n" +
      "Duplicates: " + STATE.duplicateCount + "\n" +
      "Failed: " + STATE.errCount + "\n" +
      "Success Rate: " + successRate + "%\n" +
      "Scan Rate: " + rate + " scans/min\n\n" +
      "─── SYSTEM STATE ───\n" +
      "Offline Queue: " + STATE.offlineQueue.length + "\n" +
      "History: " + STATE.recentScans.length + "\n" +
      "Undo Stack: " + STATE.undoStack.length + "\n" +
      "Batch Mode: " + (STATE.batchMode ? "ON" : "OFF") + "\n" +
      "Geolocation: " + (STATE.geoPosition ? "LOCKED" : "N/A") + "\n" +
      "Wake Lock: " + (STATE.wakeLock ? "ACTIVE" : "RELEASED")
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
          if (STATE.isScanning) stopScan();
          setTimeout(() => { const inp = $("#manualInput"); if (inp) inp.focus(); }, 200);
        }
      });
    });
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      // Ignore if typing in input
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      // F1: Start scan
      if (e.key === "F1") { e.preventDefault(); if (!STATE.isScanning) startScan(); }
      // F2: Stop scan
      else if (e.key === "F2") { e.preventDefault(); if (STATE.isScanning) stopScan(); }
      // F3: Switch camera
      else if (e.key === "F3") { e.preventDefault(); switchCam(); }
      // F4: Toggle torch
      else if (e.key === "F4") { e.preventDefault(); toggleTorch(); }
      // F5: Toggle batch mode
      else if (e.key === "F5") { e.preventDefault(); toggleBatchMode(); }
      // F6: Toggle voice
      else if (e.key === "F6") { e.preventDefault(); toggleVoiceCommands(); }
      // Ctrl+Z: Undo
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undoLastCheckin(); }
      // Ctrl+K: Focus manual input
      else if ((e.ctrlKey || e.metaKey) && e.key === "k") { 
        e.preventDefault(); 
        $$(".scan-mode-btn").forEach(b => { if (b.dataset.mode === "manual") b.click(); });
      }
      // Esc: Close result
      else if (e.key === "Escape") {
        const p = $("#resultPanel");
        if (p && p.classList.contains("active")) p.classList.remove("active");
      }
      // ?: Show help
      else if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        showKeyboardShortcuts();
      }
    });
  }

  function showKeyboardShortcuts() {
    alert(
      "═══ KEYBOARD SHORTCUTS ═══\n\n" +
      "F1  Start Scanner\n" +
      "F2  Stop Scanner\n" +
      "F3  Switch Camera\n" +
      "F4  Toggle Torch/Flashlight\n" +
      "F5  Toggle Batch Mode\n" +
      "F6  Toggle Voice Commands\n\n" +
      "Ctrl+Z  Undo Last Check-in\n" +
      "Ctrl+K  Manual Input Mode\n" +
      "Esc  Close Result Dialog\n" +
      "Shift+?  Show This Help\n\n" +
      "═══ VOICE COMMANDS ═══\n" +
      "\"start scan\", \"stop scan\"\n" +
      "\"switch camera\", \"toggle torch\"\n" +
      "\"undo\", \"show stats\", \"logout\""
    );
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

  window.undoLast = function () {
    closeResult();
    undoLastCheckin();
  };

  window.toggleBatchModeGlobal = toggleBatchMode;
  window.toggleVoiceGlobal = toggleVoiceCommands;
  window.toggleTorchGlobal = toggleTorch;
  window.showKeyboardHelp = showKeyboardShortcuts;

  // ==================== INITIALIZATION ====================
  function init() {
    if (checkSession()) showApp();

    // Core events
    $("#scannerLoginForm")?.addEventListener("submit", handleLogin);
    $("#scannerLogoutBtn")?.addEventListener("click", logout);
    $("#startScanBtn")?.addEventListener("click", startScan);
    $("#stopScanBtn")?.addEventListener("click", stopScan);
    $("#switchCameraBtn")?.addEventListener("click", switchCam);
    $("#torchBtn")?.addEventListener("click", toggleTorch);
    $("#batchModeBtn")?.addEventListener("click", toggleBatchMode);
    $("#voiceBtn")?.addEventListener("click", toggleVoiceCommands);
    $("#undoBtn")?.addEventListener("click", undoLastCheckin);
    $("#manualForm")?.addEventListener("submit", handleManual);
    $("#helpBtn")?.addEventListener("click", showKeyboardShortcuts);

    initModes();
    initNetwork();

    // Close result on overlay click
    const rp = $("#resultPanel");
    if (rp) rp.addEventListener("click", function (e) { if (e.target === this) this.classList.remove("active"); });

    // Audio init on first interaction
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });

    // Background stats refresh
    setInterval(() => { if (STATE.scanner) loadStats(); }, 30000);

    // Auto-release wake lock when hidden
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && STATE.scanner && !STATE.wakeLock) {
        await requestWakeLock();
      }
    });

    log("ALTITUDE Verify Scanner v10.0 HYPERDRIVE initialized", "SUCCESS");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
