/**
 * ============================================================
 * ALTITUDE - QUANTUM ADMIN CONSOLE v8.0 ENTERPRISE RBAC EDITION
 * ============================================================
 * Role-Based Access Control | Treasury Isolation
 * Gmail Webhook Integration | Command Terminal v2.0
 * Direct Supabase Realtime | CA-Grade Audit Trail
 * ============================================================
 */

(function () {
  "use strict";

  // ==================== DATABASE ACCESS ====================
  function getDb() { return window.db || null; }

  function waitForDb(callback, maxWait = 8000) {
    if (getDb()) { callback(getDb()); return; }
    let done = false;
    let timer = null;
    let onReady = null;
    const finish = (db) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      window.removeEventListener("dbReady", onReady);
      if (db) callback(db);
    };
    onReady = (e) => finish((e.detail && e.detail.db) || getDb());
    const startTime = Date.now();
    timer = setInterval(() => {
      if (getDb()) finish(getDb());
      else if (Date.now() - startTime > maxWait) finish(null);
    }, 200);
    window.addEventListener("dbReady", onReady);
  }

  // ==================== CONFIG ====================
  const GMAIL_API_URL = "https://script.google.com/macros/s/AKfycbysZVY8bD1dY2UuqikOODnqLFcjC7h9ZfndZyuMe0CVDRVYJ0sXsGwnQ32wHHA4SgJ9yw/exec";
  const SESSION_HOURS = 8;
  const AUTO_REFRESH_INTERVAL = 30000;
  const REALTIME_ENABLED = true;
  const REGISTRATION_FEE = 3000; // INR per approved delegate (used by revenue sync)

  // ==================== RBAC ROLE REGISTRY ====================
  const ROLES = {
    SUPER_ADMIN: "super_admin",
    ADMIN: "admin",
    EVENT_TREASURER: "event_treasurer",
    EVENT_SECRETARY: "event_secretary",
    SCANNER: "scanner",
    VIEWER: "viewer"
  };

  const PERMISSION_MATRIX = {
    dashboard:      [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_TREASURER, ROLES.EVENT_SECRETARY, ROLES.SCANNER, ROLES.VIEWER],
    clubReg:        [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    dcReg:          [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    members:        [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY, ROLES.EVENT_TREASURER],
    clubs:          [ROLES.SUPER_ADMIN, ROLES.EVENT_SECRETARY],
    attendance:     [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY, ROLES.SCANNER],
    scanner:        [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SCANNER],
    treasury:       [ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER, ROLES.EVENT_SECRETARY],
    siteContent:    [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    agenda:         [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    colourHunt:     [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    treasure:       [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    leaders:        [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    food:           [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    announcements:  [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    faqs:           [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    admins:         [ROLES.SUPER_ADMIN],
    activity:       [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY, ROLES.EVENT_TREASURER]
  };

  const ACTION_PERMISSIONS = {
    approve_registration:   [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    reject_registration:    [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY],
    delete_registration:    [ROLES.SUPER_ADMIN],
    create_transaction:     [ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER],
    edit_transaction:       [ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER],
    verify_transaction:     [ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER, ROLES.EVENT_SECRETARY],
    delete_transaction:     [ROLES.SUPER_ADMIN],
    sync_revenue:           [ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER],
    export_treasury:        [ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER, ROLES.EVENT_SECRETARY],
    manage_admins:          [ROLES.SUPER_ADMIN],
    bulk_club_update:       [ROLES.SUPER_ADMIN, ROLES.EVENT_SECRETARY],
    edit_site_content:      [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    checkin_member:         [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.SCANNER, ROLES.EVENT_SECRETARY],
    export_data:            [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.EVENT_SECRETARY, ROLES.EVENT_TREASURER]
  };

  const ROLE_LABELS = {
    [ROLES.SUPER_ADMIN]: "Super Administrator",
    [ROLES.ADMIN]: "Administrator",
    [ROLES.EVENT_TREASURER]: "Event Treasurer",
    [ROLES.EVENT_SECRETARY]: "Event Secretary",
    [ROLES.SCANNER]: "Scanner Operator",
    [ROLES.VIEWER]: "Read-Only Viewer"
  };

  const ROLE_BADGE_COLORS = {
    [ROLES.SUPER_ADMIN]: "green",
    [ROLES.ADMIN]: "blue",
    [ROLES.EVENT_TREASURER]: "purple",
    [ROLES.EVENT_SECRETARY]: "orange",
    [ROLES.SCANNER]: "yellow",
    [ROLES.VIEWER]: "gray"
  };

  // ==================== STATE ====================
  let currentAdmin = null;
  let html5QrCode = null;
  let isScanning = false;
  let autoRefreshTimer = null;
  let realtimeChannels = [];
  let commandPaletteOpen = false;
  let scanBusy = false;
  let scannerStarting = false;
  let toastTimer = null;
  let shortcutsBound = false;
  const animTimers = {};
  const pendingBindings = [];

  window._cache = {
    members: [],
    clubs: [],
    registrations: [],
    dcRegistrations: [],
    attendance: [],
    treasury: [],
    stats: {}
  };

  // ==================== PERMISSION ENGINE ====================
  function hasPermission(module) {
    if (!currentAdmin) return false;
    const allowed = PERMISSION_MATRIX[module];
    return allowed ? allowed.includes(currentAdmin.role) : false;
  }

  function hasActionPermission(action) {
    if (!currentAdmin) return false;
    const allowed = ACTION_PERMISSIONS[action];
    return allowed ? allowed.includes(currentAdmin.role) : false;
  }

  function isSuperAdmin() {
    return currentAdmin?.role === ROLES.SUPER_ADMIN;
  }

  function getRoleLabel(role) {
    const r = String(role || "unknown");
    return ROLE_LABELS[r] || r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function getRoleBadgeColor(role) {
    return ROLE_BADGE_COLORS[role] || "gray";
  }

  function denyAccess(moduleName) {
    showToast("Access Denied: Insufficient clearance for " + (moduleName || "this module") + ".", "error");
  }

  // ==================== DOM HELPERS ====================
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  // Register a listener for a static element; attached once the DOM is ready (see init()).
  function bind(selector, eventName, handler) {
    pendingBindings.push({ selector, eventName, handler });
  }

  function applyBindings() {
    pendingBindings.forEach(b => { $(b.selector)?.addEventListener(b.eventName, b.handler); });
  }

  // Supabase does not throw on failure - it returns { error }. Make that throw so try/catch works.
  function chk(res) {
    if (res && res.error) throw res.error;
    return res;
  }

  // Null-safe lower-casing for search filters
  function lc(v) { return String(v === null || v === undefined ? "" : v).toLowerCase(); }

  // Escape a value for use inside a single-quoted JS string within an HTML attribute (inline onclick)
  function jsArg(v) {
    return esc(String(v === null || v === undefined ? "" : v)
      .replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r"));
  }

  // Only allow http(s) URLs for images / links coming from the database
  function safeUrl(u) {
    if (!u || typeof u !== "string") return "";
    const s = u.trim();
    return /^https?:\/\//i.test(s) ? s : "";
  }

  function showToast(msg, type = "success", duration = 3500) {
    const t = $("#toast");
    const m = $("#toastMessage");
    if (!t || !m) return;
    m.textContent = msg;
    t.className = "toast " + type + " show";
    const icon = t.querySelector(".toast-icon");
    if (icon) icon.setAttribute("data-lucide", type === "error" ? "alert-circle" : type === "warning" ? "alert-triangle" : "check-circle");
    if (typeof lucide !== "undefined") lucide.createIcons();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), duration);
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

  function openModal(title, bodyHtml, footerHtml = "", size = "default") {
    const modal = $("#adminModal");
    if (!modal) return;
    const content = modal.querySelector(".modal-content");
    if (content) {
      content.classList.remove("modal-large", "modal-xl");
      if (size === "large") content.classList.add("modal-large");
      if (size === "xl") content.classList.add("modal-xl");
    }
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHtml;
    $("#modalFooter").innerHTML = footerHtml;
    modal.classList.add("active");
    if (typeof lucide !== "undefined") setTimeout(() => lucide.createIcons(), 100);
  }

  window.closeModal = function () {
    $("#adminModal")?.classList.remove("active");
    // Reset anything the command palette may have changed, so the next modal renders normally
    commandPaletteOpen = false;
    const mt = $("#modalTitle"); if (mt) mt.style.display = "";
    const mf = $("#modalFooter"); if (mf) mf.style.display = "";
    const mb = $("#modalBody"); if (mb) mb.style.padding = "";
  };

  function confirmAction(title, message, callback, danger = false) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    $("#confirmDialog").classList.add("active");
    const btn = $("#confirmActionBtn");
    btn.classList.toggle("btn-danger", !!danger);
    const nb = btn.cloneNode(true);
    btn.parentNode.replaceChild(nb, btn);
    nb.id = "confirmActionBtn";
    nb.addEventListener("click", () => {
      $("#confirmDialog").classList.remove("active");
      callback();
    });
  }

  window.closeConfirm = function () { $("#confirmDialog").classList.remove("active"); };

  // ==================== AUDIT ENGINE ====================
  function logAction(actionType, entityType, entityId, description) {
    const db = getDb();
    if (!db || !currentAdmin) return Promise.resolve();
    return db.from("activity_log").insert({
      admin_id: currentAdmin.id,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      description: "[" + String(currentAdmin.role || "").toUpperCase() + "] " + description
    }).then(() => {}, () => {});
  }

  // ==================== UTILITY ====================
  function formatDate(d, includeTime = true) {
    if (!d) return "—";
    try {
      const opts = { day: "2-digit", month: "short", year: "numeric" };
      if (includeTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return "—";
      return dt.toLocaleDateString("en-IN", opts);
    } catch { return "—"; }
  }

  function timeAgo(d) {
    if (!d) return "";
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    if (hrs < 24) return hrs + "h ago";
    return days + "d ago";
  }

  function statusBadge(s) {
    const c = { pending: "yellow", approved: "green", rejected: "red", partial: "orange", income: "green", expense: "red", adjustment: "blue" };
    return '<span class="status-badge ' + (c[s] || "gray") + '">' + esc(s) + '</span>';
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debounce(fn, delay = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else { // plain-http / older webviews
        const ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand("copy"); ta.remove();
        if (!ok) throw new Error("copy failed");
      }
      showToast("Copied to clipboard.");
    } catch {
      showToast("Copy failed.", "error");
    }
  }
  window.copyToClipboard = copyToClipboard;

  // ==================== EMAIL DISPATCH ENGINE ====================
  async function dispatchEmail(payload) {
    if (!GMAIL_API_URL) return false;
    try {
      await fetch(GMAIL_API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (err) {
      console.warn("[DISPATCH NOTICE]", err);
      return false;
    }
  }

  async function sendApprovalEmail(member, clubName) {
    if (!member || !member.email) return false;
    const passLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(member.ri_id) + "&email=" + encodeURIComponent(member.email);
    return await dispatchEmail({
      template: "APPROVAL",
      to_email: member.email.trim(),
      to_name: member.full_name,
      ri_id: member.ri_id,
      club_name: clubName || "District Council",
      food_preference: member.food_preference || "Standard",
      pass_url: passLink
    });
  }

  async function sendRejectionEmail(member, reason) {
    if (!member || !member.email) return false;
    return await dispatchEmail({
      template: "REJECTION",
      to_email: member.email.trim(),
      to_name: member.full_name,
      ri_id: member.ri_id,
      reason: reason || "Verification could not be completed."
    });
  }

  // ==================== AUTHENTICATION ====================
  async function handleLogin(e) {
    e.preventDefault();
    const db = getDb();
    if (!db) { showToast("System initializing...", "warning"); return; }

    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    const errEl = $("#loginError");

    if (!email || !password) {
      errEl.textContent = "Enter credentials.";
      errEl.style.display = "block";
      return;
    }

    showLoading("Authenticating...");
    errEl.style.display = "none";

    try {
      const { data, error } = await db.rpc("verify_admin", { p_email: email.toLowerCase(), p_password: password });
      if (error || !data || !data.length) throw new Error("Invalid credentials.");

      const row = data[0];
      // Keep only what the console needs - never persist anything else the RPC may return
      currentAdmin = { id: row.id, email: row.email, full_name: row.full_name, role: row.role };
      currentAdmin.timestamp = Date.now();
      currentAdmin._fingerprint = getFingerprint();

      localStorage.setItem("altitude_admin", JSON.stringify(currentAdmin));

      // Supabase queries are lazy: they only run once .then() is called
      db.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", currentAdmin.id).then(() => {}, () => {});
      logAction("LOGIN", "admin_users", currentAdmin.id, "Session initiated");

      hideLoading();
      showDashboard();
      showToast("Authenticated: " + currentAdmin.full_name + " [" + getRoleLabel(currentAdmin.role) + "]");
    } catch (err) {
      hideLoading();
      errEl.textContent = err.message;
      errEl.style.display = "block";
    }
  }

  function getFingerprint() {
    const raw = navigator.userAgent + screen.width + screen.height;
    try { return btoa(raw); } catch { return btoa(encodeURIComponent(raw)); }
  }

  function checkSession() {
    const raw = localStorage.getItem("altitude_admin");
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      if (!s || !s.id || !s.role || !s.timestamp || Date.now() - s.timestamp > SESSION_HOURS * 3600 * 1000) {
        localStorage.removeItem("altitude_admin");
        return false;
      }
      if (s._fingerprint && s._fingerprint !== getFingerprint()) {
        localStorage.removeItem("altitude_admin");
        return false;
      }
      currentAdmin = s;
      return true;
    } catch {
      localStorage.removeItem("altitude_admin");
      return false;
    }
  }

  function showDashboard() {
    $("#loginScreen").style.display = "none";
    $("#adminApp").style.display = "flex";
    $("#adminName").textContent = currentAdmin.full_name;
    $("#adminRole").textContent = getRoleLabel(currentAdmin.role);

    applyRolePermissions();
    navigateTo("dashboard");
    startAutoRefresh();
    initRealtimeSubscriptions();
    injectAdvancedUI();
    initKeyboardShortcuts();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function applyRolePermissions() {
    $$(".sidebar-link").forEach(link => {
      const view = link.dataset.view;
      if (view && !hasPermission(view)) {
        link.style.display = "none";
      } else {
        link.style.display = "";
      }
    });

    $$(".sidebar-divider").forEach(divider => {
      let nextEl = divider.nextElementSibling;
      let hasVisible = false;
      while (nextEl && !nextEl.classList.contains("sidebar-divider")) {
        if (nextEl.classList.contains("sidebar-link") && nextEl.style.display !== "none") {
          hasVisible = true;
          break;
        }
        nextEl = nextEl.nextElementSibling;
      }
      divider.style.display = hasVisible ? "" : "none";
    });

    const roleDisplay = $("#adminRole");
    if (roleDisplay) {
      roleDisplay.textContent = getRoleLabel(currentAdmin.role);
    }
  }

  async function logout() {
    // Give the audit entry a moment to be sent before the page reloads
    try {
      await Promise.race([
        logAction("LOGOUT", "admin_users", currentAdmin?.id, "Session terminated"),
        new Promise(resolve => setTimeout(resolve, 800))
      ]);
    } catch (e) {}
    stopAutoRefresh();
    stopRealtimeSubscriptions();
    localStorage.removeItem("altitude_admin");
    location.reload();
  }

  // ==================== ADVANCED UI ====================
  function injectAdvancedUI() {
    const topbarActions = $(".topbar-actions");
    if (topbarActions && !$("#cmdPaletteBtn")) {
      let html = '<button class="btn-icon" id="cmdPaletteBtn" title="Command Terminal (Ctrl+K)"><i data-lucide="command"></i></button>';
      html += '<div class="role-chip" style="display:flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.25);border-radius:6px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1B5E20;white-space:nowrap;">' +
        '<span style="width:6px;height:6px;background:' + (currentAdmin.role === ROLES.SUPER_ADMIN ? '#4CAF50' : currentAdmin.role === ROLES.EVENT_TREASURER ? '#AB47BC' : '#FF9800') + ';border-radius:50%;display:inline-block;"></span>' +
        esc(getRoleLabel(currentAdmin.role)) +
      '</div>';
      topbarActions.insertAdjacentHTML("afterbegin", html);
      $("#cmdPaletteBtn")?.addEventListener("click", openCommandPalette);
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  function initKeyboardShortcuts() {
    if (shortcutsBound) return;
    shortcutsBound = true;
    document.addEventListener("keydown", (e) => {
      if (!currentAdmin) return;
      const key = String(e.key || "").toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        openCommandPalette();
      }
      else if (mod && key === "/") {
        e.preventDefault();
        const searchInputs = ["membersSearch", "clubRegSearch", "dcRegSearch", "clubsSearch", "trsSearch", "attSearch"];
        for (const id of searchInputs) {
          const el = document.getElementById(id);
          if (el && el.offsetParent !== null) { el.focus(); break; }
        }
      }
      else if (mod && e.shiftKey && key === "r") {
        e.preventDefault();
        const view = $(".view.active")?.id?.replace("view-", "");
        if (view) navigateTo(view);
      }
      else if (key === "escape") {
        const modal = $("#adminModal");
        const confirm = $("#confirmDialog");
        if (modal?.classList.contains("active")) closeModal();
        else if (confirm?.classList.contains("active")) closeConfirm();
      }
    });
  }

  // ==================== REALTIME ====================
  function initRealtimeSubscriptions() {
    if (!REALTIME_ENABLED) return;
    const db = getDb();
    if (!db) return;
    try {
      if (hasPermission("clubReg")) {
        const regChannel = db.channel("registrations-changes")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "registrations" }, () => {
            showToast("New registration record received.", "success");
            if ($(".view.active")?.id === "view-dashboard") loadDashboard();
            if ($(".view.active")?.id === "view-clubReg") loadClubRegistrations();
          }).subscribe();
        realtimeChannels.push(regChannel);
      }
      if (hasPermission("dcReg")) {
        const dcChannel = db.channel("dc-changes")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "district_council_registrations" }, () => {
            showToast("New DC submission received.", "success");
            if ($(".view.active")?.id === "view-dcReg") loadDcRegistrations();
          }).subscribe();
        realtimeChannels.push(dcChannel);
      }
      if (hasPermission("treasury")) {
        const trsChannel = db.channel("treasury-changes")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "treasury_transactions" }, () => {
            showToast("Treasury ledger updated.", "success");
            if ($(".view.active")?.id === "view-treasury") loadTreasury();
          }).subscribe();
        realtimeChannels.push(trsChannel);
      }
    } catch (e) {}
  }

  function stopRealtimeSubscriptions() {
    const db = getDb();
    realtimeChannels.forEach(ch => { try { db?.removeChannel(ch); } catch {} });
    realtimeChannels = [];
  }

  // ==================== AUTO REFRESH ====================
  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (document.hidden) return; // don't poll while the tab is in the background
      const activeView = $(".view.active")?.id?.replace("view-", "");
      if (activeView === "dashboard") loadDashboard();
      if (activeView === "treasury" && hasPermission("treasury")) loadTreasury(true);
    }, AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  }

  // ==================== NAVIGATION ====================
  function navigateTo(view) {
    if (!hasPermission(view)) {
      denyAccess(view);
      const fallback = Object.keys(PERMISSION_MATRIX).find(v => hasPermission(v)) || "dashboard";
      if (fallback !== view) navigateTo(fallback);
      return;
    }

    if (view !== "scanner" && isScanning) stopScanner();

    $$(".view").forEach(v => v.classList.remove("active"));
    $$(".sidebar-link").forEach(l => l.classList.remove("active"));
    const target = $("#view-" + view);
    const link = $('[data-view="' + view + '"]');
    if (target) target.classList.add("active");
    if (link) link.classList.add("active");

    const titles = {
      dashboard: "Dashboard Overview", clubReg: "Club Registrations", dcReg: "District Council",
      members: "All Members Ledger", clubs: "Clubs Management", attendance: "Attendance Roster",
      scanner: "Access Scanner", treasury: "Treasury & Accounts", siteContent: "Content Architecture",
      agenda: "Agenda Configuration", colourHunt: "Colour Hunt Module", treasure: "Treasure Hunt Module",
      leaders: "Group Leaders", food: "Catering Management", announcements: "Announcements",
      faqs: "Knowledge Base", admins: "System Administrators", activity: "System Audit Trail"
    };
    const viewTitleEl = $("#viewTitle");
    if (viewTitleEl) viewTitleEl.textContent = titles[view] || "Dashboard";

    const loaders = {
      dashboard: loadDashboard, clubReg: loadClubRegistrations, dcReg: loadDcRegistrations,
      members: loadAllMembers, clubs: loadClubsManagement, attendance: loadAttendance,
      treasury: loadTreasury, siteContent: loadSiteContentEditor, agenda: loadAgendaEditor,
      colourHunt: loadColourHuntEditor, treasure: loadTreasureEditor, leaders: loadLeadersEditor,
      food: loadFoodEditor, announcements: loadAnnouncementsEditor, faqs: loadFaqsEditor,
      admins: loadAdminsEditor, activity: loadActivityLog
    };
    if (loaders[view]) loaders[view]();
  }

  // ==================== DASHBOARD ====================
  async function loadDashboard() {
    const db = getDb();
    if (!db) return;
    try {
      const { data } = await db.from("dashboard_stats").select("*").single();
      if (!data) return;
      window._cache.stats = data;

      const animateNum = (id, val) => {
        const el = $("#" + id);
        if (!el) return;
        const target = Number(val) || 0;
        let cur = parseInt(el.textContent.replace(/[^\d]/g, "")) || 0;
        const step = Math.max(1, Math.ceil(Math.abs(target - cur) / 20));
        clearInterval(animTimers[id]);
        const timer = animTimers[id] = setInterval(() => {
          if (target > cur) cur = Math.min(cur + step, target);
          else cur = Math.max(cur - step, target);
          el.textContent = cur;
          if (cur === target) clearInterval(timer);
        }, 30);
      };

      animateNum("dashApproved", data.total_approved);
      animateNum("dashPending", data.total_pending);
      animateNum("dashRejected", data.total_rejected);
      animateNum("dashAttended", data.total_attended);
      animateNum("dashDcApproved", data.dc_approved);
      animateNum("dashClubs", data.clubs_registered);
      animateNum("dashVeg", data.total_veg);
      animateNum("dashNonVeg", data.total_nonveg);
      animateNum("dashBoard", data.total_board_members);
      const totalRev = (Number(data.total_revenue_members) || 0) + (Number(data.total_revenue_dc) || 0);
      const revEl = $("#dashRevenue");
      if (revEl) revEl.textContent = "₹" + totalRev.toLocaleString("en-IN");

      loadGroupDistribution().catch(console.error);
      loadTopClubs().catch(console.error);
      loadRecentActivity().catch(console.error);
    } catch (err) { console.error(err); }
  }

  async function loadGroupDistribution() {
    const c = $("#groupDistribution");
    const db = getDb();
    if (!c || !db) return;
    try {
      const rows = await Promise.all([1, 2, 3, 4].map(async (g) => {
        const { data: clubs } = await db.from("clubs").select("id").eq("group_number", g);
        const ids = (clubs || []).map(x => x.id);
        let count = 0;
        if (ids.length) {
          const { count: ct } = await db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved").in("club_id", ids);
          count = ct || 0;
        }
        return { g, count };
      }));
      c.innerHTML = rows.map(({ g, count }) => {
        const pct = Math.min(Math.round((count / 75) * 100), 100);
        return '<div class="group-bar"><div class="group-bar-label">Group ' + g + '</div><div class="group-bar-track"><div class="group-bar-fill" style="width:' + pct + '%"></div></div><div class="group-bar-count">' + count + '</div></div>';
      }).join("");
    } catch (err) { console.error(err); }
  }

  async function loadTopClubs() {
    const c = $("#topClubsList");
    const db = getDb();
    if (!c || !db) return;
    const { data } = await db.from("clubs").select("club_name,current_registrations,max_registrations").eq("is_active", true).order("current_registrations", { ascending: false }).limit(10);
    if (!data) return;
    c.innerHTML = data.map((x, i) => {
      const pct = x.max_registrations > 0 ? Math.round((x.current_registrations / x.max_registrations) * 100) : 0;
      const cls = pct >= 80 ? "danger" : pct >= 60 ? "warning" : "success";
      return '<div class="top-club-row"><span class="top-club-rank">#' + (i + 1) + '</span><span class="top-club-name">' + esc(x.club_name) + '</span><span class="top-club-count ' + cls + '">' + x.current_registrations + '/' + x.max_registrations + '</span></div>';
    }).join("");
  }

  async function loadRecentActivity() {
    const c = $("#recentActivity");
    const db = getDb();
    if (!c || !db) return;
    const { data } = await db.from("activity_log").select("*,admin_users(full_name)").order("created_at", { ascending: false }).limit(15);
    if (!data || !data.length) {
      c.innerHTML = '<p style="color:#999;text-align:center;padding:14px;">No system events logged.</p>';
      return;
    }
    c.innerHTML = data.map(a =>
      '<div class="activity-item">' +
        '<div class="activity-action">' + esc(a.action_type) + '</div>' +
        '<div class="activity-desc">' + esc(a.description) + '</div>' +
        '<div class="activity-time">' + timeAgo(a.created_at) + '</div>' +
      '</div>'
    ).join("");
  }

  // ==================== PART 2: REGISTRATIONS, MEMBERS, CLUBS, ATTENDANCE & SCANNER ====================

  // ==================== CLUB REGISTRATIONS ====================
  async function loadClubRegistrations() {
    if (!hasPermission("clubReg")) { denyAccess("clubReg"); return; }
    const db = getDb();
    if (!db) return;
    showLoading("Loading registrations...");
    try {
      const { data, error } = await db.from("registrations")
        .select("*,clubs(club_name,group_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      window._cache.registrations = data || [];
      renderClubRegTable(window._cache.registrations);
    } catch (err) {
      console.error(err);
      showToast("Could not load registrations: " + (err.message || "error"), "error");
    }
    hideLoading();
  }

  function renderClubRegTable(data) {
    const tb = $("#clubRegTable tbody");
    if (!tb) return;
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--gray-400,#9aa3ad);padding:var(--space-xl,32px);">No registrations found</td></tr>';
      return;
    }

    const canApprove = hasActionPermission("approve_registration");
    const canReject = hasActionPermission("reject_registration");
    const canDelete = hasActionPermission("delete_registration");

    tb.innerHTML = data.map(r => {
      let actions = '<button class="btn-sm blue" onclick="window.viewRegDetails(\'' + r.id + '\')" title="View details"><i data-lucide="eye"></i></button>';
      
      if (r.status === "pending") {
        if (canApprove) actions += '<button class="btn-sm green" onclick="window.approveReg(\'' + r.id + '\',\'club\')" title="Approve"><i data-lucide="check"></i></button>';
        if (canReject) actions += '<button class="btn-sm red" onclick="window.rejectReg(\'' + r.id + '\',\'club\')" title="Reject"><i data-lucide="x"></i></button>';
      } else {
        if (canDelete) actions += '<button class="btn-sm red" onclick="window.deleteReg(\'' + r.id + '\',\'club\')" title="Delete"><i data-lucide="trash-2"></i></button>';
      }

      return '<tr><td><code onclick="copyToClipboard(\'' + jsArg(r.registration_code) + '\')" style="cursor:pointer;" title="Click to copy">' + esc(r.registration_code) + '</code></td>' +
        '<td>' + esc(r.clubs?.club_name || "—") + '<br><small>Group ' + (r.clubs?.group_number || "—") + '</small></td>' +
        '<td>' + esc(r.registrant_name) + '<br><small>' + esc(r.registrant_email) + '</small></td>' +
        '<td>' + esc(r.registrant_role) + '</td>' +
        '<td><strong>' + esc(r.total_members) + '</strong></td>' +
        '<td>₹' + (Number(r.total_amount) || 0).toLocaleString("en-IN") + '</td>' +
        '<td><code>' + esc(r.transaction_id) + '</code></td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td>' + formatDate(r.created_at, false) + '</td>' +
        '<td><div class="action-btns">' + actions + '</div></td></tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.viewRegDetails = async function (id) {
    const db = getDb();
    if (!db) return;
    showLoading("Loading details...");
    let r, m;
    try {
      ({ data: r } = await db.from("registrations").select("*,clubs(club_name)").eq("id", id).single());
      ({ data: m } = await db.from("members").select("*").eq("registration_id", id));
    } catch (err) {
      console.error(err);
    } finally {
      hideLoading();
    }
    if (!r) { showToast("Could not load registration details.", "error"); return; }

    let h = '<div class="detail-grid">' +
      '<div><strong>Code:</strong> ' + esc(r.registration_code) + '</div>' +
      '<div><strong>Club:</strong> ' + esc(r.clubs?.club_name) + '</div>' +
      '<div><strong>Registrant:</strong> ' + esc(r.registrant_name) + ' (' + esc(r.registrant_role) + ')</div>' +
      '<div><strong>Email:</strong> ' + esc(r.registrant_email) + '</div>' +
      '<div><strong>Phone:</strong> ' + esc(r.registrant_phone) + '</div>' +
      '<div><strong>RI ID:</strong> ' + esc(r.registrant_ri_id) + '</div>' +
      '<div><strong>Amount:</strong> ₹' + (Number(r.total_amount) || 0).toLocaleString("en-IN") + '</div>' +
      '<div><strong>Txn ID:</strong> ' + esc(r.transaction_id) + '</div>' +
      '<div><strong>Status:</strong> ' + statusBadge(r.status) + '</div>' +
      '<div><strong>Registered:</strong> ' + formatDate(r.created_at) + '</div>' +
      (r.verified_at ? '<div><strong>Verified:</strong> ' + formatDate(r.verified_at) + '</div>' : '') +
      (r.rejection_reason ? '<div class="full-width"><strong>Rejection Reason:</strong> ' + esc(r.rejection_reason) + '</div>' : '') +
      '</div>';

    const shot = safeUrl(r.payment_screenshot_url);
    if (shot) {
      h += '<div style="margin-top:16px;"><strong>Payment Screenshot:</strong><br><a href="' + esc(shot) + '" target="_blank" rel="noopener"><img src="' + esc(shot) + '" style="max-width:100%;max-height:400px;border-radius:8px;margin-top:8px;border:1px solid var(--gray-200,#e0e4e8);cursor:pointer;" alt="Payment"/></a><br><small>Click to open full size</small></div>';
    }

    if (m && m.length) {
      h += '<h4 style="margin-top:20px;">Members (' + m.length + ')</h4>' +
        '<table class="admin-table compact" style="margin-top:8px;"><thead><tr><th>Name</th><th>RI ID</th><th>Contact</th><th>Food</th><th>Board</th><th>Status</th></tr></thead><tbody>';
      m.forEach(x => {
        h += '<tr><td>' + esc(x.full_name) + '</td>' +
          '<td>' + esc(x.ri_id) + '</td>' +
          '<td>' + esc(x.email) + '<br><small>' + esc(x.contact_number) + '</small></td>' +
          '<td>' + esc(x.food_preference) + '</td>' +
          '<td>' + (x.is_board_member ? "Yes" : "No") + '</td>' +
          '<td>' + statusBadge(x.status) + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    openModal("Registration Details — " + r.registration_code, h, "", "large");
  };

  window.approveReg = async function (id, type) {
    if (!hasActionPermission("approve_registration")) { denyAccess("approve_registration"); return; }
    confirmAction("Approve Registration", "Approve this registration? Members will receive confirmation emails automatically.", async () => {
      showLoading("Approving & sending emails...");
      const db = getDb();
      try {
        let emailsSent = 0, emailsFailed = 0;
        if (type === "club") {
          const { data: reg } = await db.from("registrations").select("*,clubs(club_name)").eq("id", id).single();
          if (!reg) throw new Error("Not found");

          chk(await db.from("registrations").update({ status: "approved", verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id));
          chk(await db.from("members").update({ status: "approved" }).eq("registration_id", id));

          const { data: members } = await db.from("members").select("*").eq("registration_id", id);
          if (members) {
            for (const m of members) {
              const ok = await sendApprovalEmail(m, reg.clubs?.club_name);
              ok ? emailsSent++ : emailsFailed++;
            }
          }
        } else {
          const { data: dc } = await db.from("district_council_registrations").select("*").eq("id", id).single();
          if (!dc) throw new Error("Not found");
          chk(await db.from("district_council_registrations").update({ status: "approved", verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id));
          const ok = await sendApprovalEmail(dc, dc.portfolio || "District Council");
          ok ? emailsSent++ : emailsFailed++;
        }

        logAction("APPROVE", type, id, "Approved. Emails sent: " + emailsSent);
        hideLoading();
        showToast("Approved! " + emailsSent + " email(s) dispatched" + (emailsFailed ? ", " + emailsFailed + " failed" : ""));
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        hideLoading();
        showToast("Failed: " + err.message, "error");
      }
    });
  };

  // In-app dialog instead of window.prompt(), which is blocked or unusable in many mobile webviews
  window.rejectReg = function (id, type) {
    if (!hasActionPermission("reject_registration")) { denyAccess("reject_registration"); return; }
    openModal("Reject Registration",
      '<div class="form-group"><label for="rejectReason">Reason (this is sent to the applicant)</label><textarea id="rejectReason" rows="4" maxlength="500" placeholder="Explain why this registration is being rejected"></textarea></div>',
      '<button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button><button type="button" class="btn btn-danger" onclick="window.confirmReject(\'' + jsArg(id) + '\',\'' + jsArg(type) + '\')">Reject &amp; Notify</button>');
    setTimeout(() => $("#rejectReason")?.focus(), 150);
  };

  window.confirmReject = function (id, type) {
    const reason = ($("#rejectReason")?.value || "").trim();
    if (!reason) { showToast("Please enter a rejection reason.", "warning"); return; }
    closeModal();
    runReject(id, type, reason);
  };

  function runReject(id, type, reason) {
    confirmAction("Reject Registration", "Reject this registration? Members will receive notification emails.", async () => {
      showLoading("Rejecting & notifying...");
      const db = getDb();
      try {
        let emailsSent = 0, emailsFailed = 0;
        if (type === "club") {
          chk(await db.from("registrations").update({ status: "rejected", rejection_reason: reason, verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id));
          chk(await db.from("members").update({ status: "rejected" }).eq("registration_id", id));
          const { data: members } = await db.from("members").select("*").eq("registration_id", id);
          if (members) {
            for (const m of members) {
              const ok = await sendRejectionEmail(m, reason);
              ok ? emailsSent++ : emailsFailed++;
            }
          }
        } else {
          const { data: dc } = await db.from("district_council_registrations").select("*").eq("id", id).single();
          chk(await db.from("district_council_registrations").update({ status: "rejected", rejection_reason: reason, verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id));
          if (dc) {
            const ok = await sendRejectionEmail(dc, reason);
            ok ? emailsSent++ : emailsFailed++;
          }
        }

        logAction("REJECT", type, id, "Rejected: " + reason);
        hideLoading();
        showToast("Rejected. " + emailsSent + " email(s) dispatched" + (emailsFailed ? ", " + emailsFailed + " failed" : ""));
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        hideLoading();
        showToast("Failed: " + err.message, "error");
      }
    }, true);
  };

  window.deleteReg = function (id, type) {
    if (!hasActionPermission("delete_registration")) { denyAccess("delete_registration"); return; }
    confirmAction("Delete Permanently", "This will permanently delete this registration and all associated members. Cannot be undone.", async () => {
      const db = getDb();
      try {
        if (type === "club") {
          chk(await db.from("members").delete().eq("registration_id", id));
          chk(await db.from("registrations").delete().eq("id", id));
        } else {
          chk(await db.from("district_council_registrations").delete().eq("id", id));
        }
        logAction("DELETE", type, id, "Permanently deleted");
        showToast("Deleted successfully.");
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        showToast("Delete failed: " + err.message, "error");
      }
    }, true);
  };

  // ==================== DC REGISTRATIONS ====================
  async function loadDcRegistrations() {
    if (!hasPermission("dcReg")) { denyAccess("dcReg"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    try {
      const { data, error } = await db.from("district_council_registrations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      window._cache.dcRegistrations = data || [];
      renderDcRegTable(window._cache.dcRegistrations);
    } catch (err) {
      console.error(err);
      showToast("Could not load DC registrations: " + (err.message || "error"), "error");
    } finally {
      hideLoading();
    }
  }

  function renderDcRegTable(data) {
    const tb = $("#dcRegTable tbody");
    if (!tb) return;
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--gray-400,#9aa3ad);padding:var(--space-xl,32px);">No DC registrations</td></tr>';
      return;
    }
    const canApprove = hasActionPermission("approve_registration");
    const canReject = hasActionPermission("reject_registration");
    const canDelete = hasActionPermission("delete_registration");

    tb.innerHTML = data.map(r => {
      let actions = '<button class="btn-sm blue" onclick="window.viewDcDetails(\'' + r.id + '\')"><i data-lucide="eye"></i></button>';
      if (r.status === "pending") {
        if (canApprove) actions += '<button class="btn-sm green" onclick="window.approveReg(\'' + r.id + '\',\'dc\')"><i data-lucide="check"></i></button>';
        if (canReject) actions += '<button class="btn-sm red" onclick="window.rejectReg(\'' + r.id + '\',\'dc\')"><i data-lucide="x"></i></button>';
      } else {
        if (canDelete) actions += '<button class="btn-sm red" onclick="window.deleteReg(\'' + r.id + '\',\'dc\')"><i data-lucide="trash-2"></i></button>';
      }
      return '<tr><td><code>' + esc(r.registration_code) + '</code></td>' +
        '<td>' + esc(r.full_name) + '</td>' +
        '<td>' + esc(r.ri_id) + '</td>' +
        '<td>' + esc(r.portfolio) + '</td>' +
        '<td>' + esc(r.contact_number) + '<br><small>' + esc(r.email) + '</small></td>' +
        '<td>' + esc(r.food_preference) + '</td>' +
        '<td><code>' + esc(r.transaction_id) + '</code></td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td><div class="action-btns">' + actions + '</div></td></tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.viewDcDetails = async function (id) {
    const db = getDb();
    const { data } = await db.from("district_council_registrations").select("*").eq("id", id).single();
    if (!data) return;
    let h = '<div class="detail-grid">' +
      '<div><strong>Code:</strong> ' + esc(data.registration_code) + '</div>' +
      '<div><strong>Name:</strong> ' + esc(data.full_name) + '</div>' +
      '<div><strong>RI ID:</strong> ' + esc(data.ri_id) + '</div>' +
      '<div><strong>Portfolio:</strong> ' + esc(data.portfolio) + '</div>' +
      '<div><strong>Home Club:</strong> ' + esc(data.club_name || "—") + '</div>' +
      '<div><strong>Email:</strong> ' + esc(data.email) + '</div>' +
      '<div><strong>Phone:</strong> ' + esc(data.contact_number) + '</div>' +
      '<div><strong>Food:</strong> ' + esc(data.food_preference) + '</div>' +
      '<div><strong>Fee:</strong> ₹' + (Number(data.registration_fee) || 0) + '</div>' +
      '<div><strong>Transaction:</strong> ' + esc(data.transaction_id) + '</div>' +
      '<div><strong>Status:</strong> ' + statusBadge(data.status) + '</div>' +
      '<div><strong>Registered:</strong> ' + formatDate(data.created_at) + '</div>' +
      (data.expectations ? '<div class="full-width"><strong>Expectations:</strong> ' + esc(data.expectations) + '</div>' : '') +
      (data.rejection_reason ? '<div class="full-width"><strong>Rejection Reason:</strong> ' + esc(data.rejection_reason) + '</div>' : '') +
      '</div>';
    const dcShot = safeUrl(data.payment_screenshot_url);
    if (dcShot) {
      h += '<div style="margin-top:16px;"><strong>Payment Screenshot:</strong><br><a href="' + esc(dcShot) + '" target="_blank" rel="noopener"><img src="' + esc(dcShot) + '" style="max-width:100%;max-height:400px;border-radius:8px;margin-top:8px;border:1px solid var(--gray-200,#e0e4e8);"/></a></div>';
    }
    openModal("DC Registration — " + data.registration_code, h, "", "large");
  };

  // ==================== ALL MEMBERS ====================
  async function loadAllMembers() {
    if (!hasPermission("members")) { denyAccess("members"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    try {
      const { data, error } = await db.from("members")
        .select("*,clubs(club_name,group_number),registrations(registration_code)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      window._cache.members = data || [];
      renderMembersTable(window._cache.members);
    } catch (err) {
      console.error(err);
      showToast("Could not load members: " + (err.message || "error"), "error");
    } finally {
      hideLoading();
    }
  }

  function renderMembersTable(data) {
    const tb = $("#membersTable tbody");
    if (!tb) return;
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--gray-400,#9aa3ad);padding:var(--space-xl,32px);">No members found</td></tr>';
      return;
    }
    tb.innerHTML = data.map(m =>
      '<tr>' +
        '<td><code onclick="copyToClipboard(\'' + jsArg(m.member_code) + '\')" style="cursor:pointer;" title="Copy">' + esc(m.member_code) + '</code></td>' +
        '<td>' + esc(m.full_name) + '</td>' +
        '<td>' + esc(m.ri_id) + '</td>' +
        '<td>' + esc(m.clubs?.club_name || "—") + '</td>' +
        '<td>Group ' + (m.clubs?.group_number || "—") + '</td>' +
        '<td><span class="food-badge ' + (m.food_preference === "VEG" ? "veg" : "nonveg") + '">' + esc(m.food_preference) + '</span></td>' +
        '<td>' + (m.is_board_member ? "Yes" : "No") + '</td>' +
        '<td>' + statusBadge(m.status) + '</td>' +
        '<td>' + (m.attendance_checked ? '<span class="status-badge green">Present</span>' : '<span class="status-badge gray">Absent</span>') + '</td>' +
        '<td><button class="btn-sm blue" onclick="window.viewMemberDetail(\'' + m.id + '\')"><i data-lucide="eye"></i></button></td>' +
      '</tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.viewMemberDetail = async function (id) {
    const db = getDb();
    if (!db) return;
    const { data: m } = await db.from("members").select("*,clubs(club_name,group_number)").eq("id", id).single();
    if (!m) return;
    openModal("Member — " + m.full_name,
      '<div class="detail-grid">' +
        '<div><strong>Code:</strong> ' + esc(m.member_code) + '</div>' +
        '<div><strong>Name:</strong> ' + esc(m.full_name) + '</div>' +
        '<div><strong>RI ID:</strong> ' + esc(m.ri_id) + '</div>' +
        '<div><strong>Email:</strong> ' + esc(m.email) + '</div>' +
        '<div><strong>Phone:</strong> ' + esc(m.contact_number) + '</div>' +
        '<div><strong>Club:</strong> ' + esc(m.clubs?.club_name) + '</div>' +
        '<div><strong>Group:</strong> Group ' + (m.clubs?.group_number ?? "—") + '</div>' +
        '<div><strong>Food:</strong> ' + esc(m.food_preference) + '</div>' +
        '<div><strong>Board:</strong> ' + (m.is_board_member ? "Yes" : "No") + '</div>' +
        '<div><strong>Status:</strong> ' + statusBadge(m.status) + '</div>' +
        '<div><strong>Attendance:</strong> ' + (m.attendance_checked ? formatDate(m.attendance_checked_at) : "Not checked") + '</div>' +
        '<div class="full-width"><strong>Expectations:</strong> ' + esc(m.expectations || "—") + '</div>' +
      '</div>');
  };

  // ==================== CLUBS MANAGEMENT ====================
  async function loadClubsManagement() {
    if (!hasPermission("clubs")) { denyAccess("clubs"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    try {
      const { data, error } = await db.from("clubs").select("*").order("group_number").order("club_name");
      if (error) throw error;
      window._cache.clubs = data || [];
      renderClubsTable(window._cache.clubs);
    } catch (err) {
      console.error(err);
      showToast("Could not load clubs: " + (err.message || "error"), "error");
    } finally {
      hideLoading();
    }
  }

  function renderClubsTable(data) {
    const tb = $("#clubsTable tbody");
    if (!tb) return;
    const canUpdate = hasActionPermission("bulk_club_update");

    tb.innerHTML = data.map(c => {
      const av = c.max_registrations - c.current_registrations;
      const cls = av <= 0 ? "text-red" : av <= 2 ? "text-orange" : "";
      return '<tr>' +
        '<td>' + esc(c.club_name) + '</td>' +
        '<td>Group ' + c.group_number + '</td>' +
        '<td><input type="number" class="inline-input" value="' + c.max_registrations + '" data-club-id="' + c.id + '" min="0" max="50" onchange="window.updateClubLimit(this)" ' + (!canUpdate ? "disabled" : "") + '/></td>' +
        '<td>' + c.current_registrations + '</td>' +
        '<td class="' + cls + '">' + av + '</td>' +
        '<td>' + (c.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge red">Inactive</span>') + '</td>' +
        '<td><button class="btn-sm blue" onclick="window.toggleClubActive(\'' + c.id + '\',' + !c.is_active + ')" ' + (!canUpdate ? "disabled style='opacity:0.5; cursor:not-allowed;'" : "") + '><i data-lucide="' + (c.is_active ? "eye-off" : "eye") + '"></i></button></td>' +
      '</tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.updateClubLimit = async function (el) {
    if (!hasActionPermission("bulk_club_update")) { denyAccess("bulk_club_update"); return; }
    const v = parseInt(el.value);
    if (isNaN(v) || v < 0) return;
    const db = getDb();
    chk(await db.from("clubs").update({ max_registrations: v }).eq("id", el.dataset.clubId));
    logAction("UPDATE", "clubs", el.dataset.clubId, "Max limit -> " + v);
    showToast("Quota limit updated successfully.");
  };

  window.toggleClubActive = async function (id, active) {
    if (!hasActionPermission("bulk_club_update")) { denyAccess("bulk_club_update"); return; }
    const db = getDb();
    chk(await db.from("clubs").update({ is_active: active }).eq("id", id));
    showToast(active ? "Club activated." : "Club deactivated.");
    loadClubsManagement();
  };

  bind("#bulkUpdateLimit", "click", () => {
    if (!hasActionPermission("bulk_club_update")) { denyAccess("bulk_club_update"); return; }
    openModal("Bulk Update Club Quotas",
      '<div class="form-group"><label>New Allocation Cap</label><input type="number" id="bulkLimitVal" min="0" max="50" value="10" /></div>' +
      '<div class="form-group"><label>Filter by Target Group (Optional)</label><select id="bulkLimitGroup"><option value="">All Groups</option><option value="1">Group 1</option><option value="2">Group 2</option><option value="3">Group 3</option><option value="4">Group 4</option></select></div>',
      '<button class="btn btn-primary" onclick="window.bulkApplyLimit()">Apply Quotas</button>');
  });

  window.bulkApplyLimit = async function () {
    const val = parseInt($("#bulkLimitVal").value);
    const grp = $("#bulkLimitGroup").value;
    if (isNaN(val) || val < 0) { showToast("Invalid allocation value.", "error"); return; }
    confirmAction("Confirm Bulk Allocation", "Apply " + val + " seats quota to " + (grp ? "Group " + grp : "ALL clubs") + "?", async () => {
      const db = getDb();
      try {
        let q = db.from("clubs").update({ max_registrations: val });
        if (grp) q = q.eq("group_number", parseInt(grp));
        else q = q.gte("group_number", 1);
        chk(await q);
        logAction("BULK_UPDATE", "clubs", null, "Bulk quota assignment: " + val + " for " + (grp ? "Group " + grp : "all"));
        closeModal();
        showToast("Bulk allocations applied.");
        loadClubsManagement();
      } catch (e) { showToast("Operation failed.", "error"); }
    });
  };

  // ==================== ATTENDANCE ====================
  async function loadAttendance() {
    if (!hasPermission("attendance")) { denyAccess("attendance"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    try {
      const { data: m, error: e1 } = await db.from("members").select("*,clubs(club_name)").eq("status", "approved").order("full_name");
      if (e1) throw e1;
      const { data: d, error: e2 } = await db.from("district_council_registrations").select("*").eq("status", "approved");
      if (e2) throw e2;
      const all = [
        ...(m || []).map(x => ({ ...x, type: "Club", club: x.clubs?.club_name })),
        ...(d || []).map(x => ({ ...x, type: "DC", club: x.portfolio, member_code: x.member_code, full_name: x.full_name, ri_id: x.ri_id }))
      ];
      window._cache.attendance = all;
      renderAttendanceTable(all);
      const ck = all.filter(a => a.attendance_checked).length;
      const tot = all.length;
      const summary = $("#attSummary");
      if (summary) summary.innerHTML =
        '<div class="att-stat"><strong>' + tot + '</strong> Total</div>' +
        '<div class="att-stat green"><strong>' + ck + '</strong> Present</div>' +
        '<div class="att-stat orange"><strong>' + (tot - ck) + '</strong> Absent</div>' +
        '<div class="att-stat blue"><strong>' + (tot ? Math.round(ck / tot * 100) : 0) + '%</strong> Yield</div>';
    } catch (err) {
      console.error(err);
      showToast("Could not load attendance: " + (err.message || "error"), "error");
    } finally {
      hideLoading();
    }
  }

  function renderAttendanceTable(data) {
    const tb = $("#attendanceTable tbody");
    if (!tb) return;
    tb.innerHTML = data.map(a =>
      '<tr class="' + (a.attendance_checked ? "row-checked" : "") + '">' +
        '<td><code>' + esc(a.member_code || "—") + '</code></td>' +
        '<td>' + esc(a.full_name) + '</td>' +
        '<td>' + esc(a.ri_id) + '</td>' +
        '<td>' + esc(a.club || "—") + '</td>' +
        '<td>' + a.type + '</td>' +
        '<td>' + (a.attendance_checked ? '<span class="status-badge green">Present</span>' : '<span class="status-badge gray">Absent</span>') + '</td>' +
        '<td>' + (a.attendance_checked ? formatDate(a.attendance_checked_at) : "—") + '</td>' +
      '</tr>'
    ).join("");
  }

  // ==================== ACCESS SCANNER ====================
  async function startScanner() {
    if (!hasActionPermission("checkin_member")) { denyAccess("checkin_member"); return; }
    if (isScanning || scannerStarting) return;
    if (typeof Html5Qrcode === "undefined") { showToast("Scanner library not loaded.", "error"); return; }
    scannerStarting = true;
    try {
      html5QrCode = new Html5Qrcode("qrReader");
      await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: (w, h) => { const s = Math.max(50, Math.floor(Math.min(w, h) * 0.8)); return { width: s, height: s }; } }, onScanSuccess, () => {});
      isScanning = true;
      const startBtn = $("#startScanBtn"), stopBtn = $("#stopScanBtn");
      if (startBtn) startBtn.style.display = "none";
      if (stopBtn) stopBtn.style.display = "inline-flex";
    } catch (err) {
      showToast("Camera initialization failed: " + (err?.message || err), "error");
    } finally {
      scannerStarting = false;
    }
  }

  async function stopScanner() {
    if (html5QrCode && isScanning) {
      try { await html5QrCode.stop(); } catch (e) {}
      try { html5QrCode.clear(); } catch (e) {}
      isScanning = false;
      const startBtn = $("#startScanBtn"), stopBtn = $("#stopScanBtn");
      if (startBtn) startBtn.style.display = "inline-flex";
      if (stopBtn) stopBtn.style.display = "none";
    }
  }

  // Persistent on-screen result (a 3-second toast is easy to miss at a busy check-in desk)
  function showScanResult(kind, title, detail) {
    const el = $("#scanResult"); if (!el) return;
    const icon = kind === "ok" ? "check-circle" : kind === "warn" ? "alert-triangle" : "x-circle";
    const cls = kind === "ok" ? "success" : kind === "warn" ? "warn" : "fail";
    el.innerHTML = '<div class="scan-result-card ' + cls + '"><i data-lucide="' + icon + '"></i><h3>' + esc(title) + '</h3><p>' + esc(detail || "") + '</p></div>';
    if (typeof lucide !== "undefined") lucide.createIcons();
    try { navigator.vibrate && navigator.vibrate(kind === "ok" ? 60 : [80, 60, 80]); } catch (e) {}
  }

  async function onScanSuccess(rawText) {
    if (scanBusy) return; // the camera fires repeatedly - process one scan at a time
    const db = getDb();
    const text = String(rawText || "").trim();
    if (!db || !text) return;
    scanBusy = true;
    try {
      await stopScanner();
      showLoading("Verifying delegate token...");
      let { data: m, error: e1 } = await db.from("members").select("*,clubs(club_name,group_number)").eq("qr_code_data", text).maybeSingle();
      if (e1) throw e1;
      let tbl = "members";
      if (!m) {
        const { data: d, error: e2 } = await db.from("district_council_registrations").select("*").eq("qr_code_data", text).maybeSingle();
        if (e2) throw e2;
        if (d) { m = { ...d, clubs: { club_name: d.portfolio, group_number: "DC" } }; tbl = "district_council_registrations"; }
      }
      if (!m) { showToast("Token not recognized.", "error"); showScanResult("fail", "Token not recognized", "This QR code is not registered."); return; }
      if (m.attendance_checked) { showToast("Delegate already checked in.", "warning"); showScanResult("warn", "Already checked in", m.full_name); return; }
      if (m.status !== "approved") { showToast("Registration status not approved.", "error"); showScanResult("fail", "Not approved", m.full_name + " is not an approved delegate."); return; }

      chk(await db.from(tbl).update({ attendance_checked: true, attendance_checked_at: new Date().toISOString(), attendance_checked_by: currentAdmin.id }).eq("id", m.id));
      logAction("CHECK_IN", tbl, m.id, m.full_name + " access check-in successful.");
      showToast("Access Granted: " + m.full_name);
      showScanResult("ok", "Access Granted", m.full_name + " \u00b7 " + (m.clubs?.club_name || ""));
    } catch (err) {
      console.error(err);
      showToast("Access validation failed.", "error");
      showScanResult("fail", "Check-in failed", "Please try again.");
    } finally {
      hideLoading();
      scanBusy = false;
    }
  }

  // ==================== PART 3: TREASURY MODULE & COMMAND TERMINAL v2.0 ====================

  // ==================== TREASURY & ACCOUNTS ====================
  async function loadTreasury(silent = false) {
    if (!hasPermission("treasury")) { denyAccess("Treasury & Accounts"); return; }
    const db = getDb();
    if (!db) return;
    if (!silent) showLoading("Reconciling financial ledger...");
    try {
      const { data: summary } = await db.from("treasury_summary").select("*").single();
      if (summary) {
        const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN");
        const setText = (id, v) => { const el = $("#" + id); if (el) el.textContent = v; };
        setText("trsIncome", fmt(summary.total_income));
        setText("trsExpense", fmt(summary.total_expense));
        setText("trsBalance", fmt(summary.net_balance));
        setText("trsGst", fmt(summary.total_gst));
        setText("trsTds", fmt(summary.total_tds));
        setText("trsRegRev", fmt(summary.registration_revenue));
      }
      const { data: txns, error: txErr } = await db.from("treasury_transactions").select("*").order("transaction_date", { ascending: false });
      if (txErr) throw txErr;
      window._cache.treasury = txns || [];
      renderTreasuryTable(window._cache.treasury);
      await loadBudgetVariance();
    } catch (err) {
      console.error("[TREASURY ERROR]", err);
      if (!silent) showToast("Could not load treasury: " + (err.message || "error"), "error");
    }
    hideLoading();
  }

  function renderTreasuryTable(data) {
    const tb = $("#treasuryTable tbody");
    if (!tb) return;
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--gray-400,#9aa3ad);padding:var(--space-xl,32px);">No ledger entries recorded.</td></tr>';
      return;
    }
    const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN");
    const canEdit = hasActionPermission("edit_transaction");
    const canVerify = hasActionPermission("verify_transaction");
    const canDelete = hasActionPermission("delete_transaction");

    tb.innerHTML = data.map(t => {
      const typeLabel = (t.transaction_type || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      let actions = '<button class="btn-sm blue" onclick="window.viewTransaction(\'' + t.id + '\')" title="View"><i data-lucide="eye"></i></button>';
      if (canEdit) actions += '<button class="btn-sm blue" onclick="window.editTransaction(\'' + t.id + '\')" title="Edit"><i data-lucide="edit-3"></i></button>';
      if (!t.is_verified && canVerify) actions += '<button class="btn-sm green" onclick="window.verifyTransaction(\'' + t.id + '\')" title="Verify"><i data-lucide="check"></i></button>';
      if (canDelete) actions += '<button class="btn-sm red" onclick="window.deleteItem(\'treasury_transactions\',\'' + t.id + '\')" title="Delete"><i data-lucide="trash-2"></i></button>';

      return '<tr>' +
        '<td>' + formatDate(t.transaction_date, false) + '</td>' +
        '<td><strong>' + esc(t.description) + '</strong>' + (t.vendor_name ? '<br><small>' + esc(t.vendor_name) + '</small>' : '') + '</td>' +
        '<td><small>' + typeLabel + '</small></td>' +
        '<td>' + statusBadge((t.category || "").toLowerCase()) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;' + (t.category === "INCOME" ? "color:#2E7D32;" : t.category === "EXPENSE" ? "color:#C62828;" : "") + '">' + fmt(t.amount) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;">' + (t.gst_amount > 0 ? fmt(t.gst_amount) : "—") + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;">' + fmt(t.net_amount) + '</td>' +
        '<td><small>' + esc((t.payment_method || "—").replace(/_/g, " ")) + '</small></td>' +
        '<td>' + (t.is_verified ? '<span class="status-badge green">Verified</span>' : '<span class="status-badge yellow">Pending</span>') + '</td>' +
        '<td><div class="action-btns">' + actions + '</div></td></tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  async function loadBudgetVariance() {
    const db = getDb();
    if (!db) return;
    const { data: heads } = await db.from("budget_heads").select("*").order("sort_order");
    const { data: txns } = await db.from("treasury_transactions").select("budget_head,net_amount");
    if (!heads) return;
    const actualByHead = {};
    (txns || []).forEach(t => {
      if (t.budget_head) actualByHead[t.budget_head] = (actualByHead[t.budget_head] || 0) + Math.abs(Number(t.net_amount));
    });
    const container = $("#budgetVarianceTable");
    if (!container) return;
    const fmt = (v) => "₹" + Math.abs(Number(v) || 0).toLocaleString("en-IN");
    let html = '<table class="budget-variance-table"><thead><tr><th>Budget Head</th><th>Class</th><th>Allocated</th><th>Actual</th><th>Variance</th><th>Utilization</th></tr></thead><tbody>';
    heads.forEach(h => {
      const allocated = Number(h.allocated_amount) || 0;
      const actual = Math.abs(actualByHead[h.head_name] || 0);
      const variance = allocated - actual;
      const pct = allocated > 0 ? Math.round((actual / allocated) * 100) : 0;
      const isOver = variance < 0;
      const catBadge = h.category === "INCOME" ? '<span class="status-badge green">Income</span>' : '<span class="status-badge red">Expense</span>';
      html += '<tr>' +
        '<td><strong>' + esc(h.head_name) + '</strong></td>' +
        '<td>' + catBadge + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;">' + fmt(allocated) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;">' + fmt(actual) + '</td>' +
        '<td class="' + (isOver ? "variance-negative" : "variance-positive") + '">' + (isOver ? "-" : "+") + fmt(variance) + '</td>' +
        '<td><div class="variance-bar"><div class="variance-bar-fill ' + (pct > 100 ? "over" : "under") + '" style="width:' + Math.min(pct, 100) + '%"></div></div><small>' + pct + '%</small></td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ==================== TRANSACTION FORM ====================
  function getTransactionFormHtml(d) {
    const types = ['REGISTRATION_FEE','SPONSOR','DONATION','REFUND','VENUE_EXPENSE','FOOD_EXPENSE','TRANSPORT_EXPENSE','MERCHANDISE_EXPENSE','EQUIPMENT_EXPENSE','MARKETING_EXPENSE','PERMIT_EXPENSE','INSURANCE_EXPENSE','MISCELLANEOUS_EXPENSE','PRIZE_EXPENSE','CERTIFICATE_EXPENSE','OTHER_INCOME','OTHER_EXPENSE','ADVANCE_RECEIVED','ADVANCE_PAID','ADJUSTMENT'];
    const methods = ['BANK_TRANSFER','UPI','CASH','CHEQUE','CARD','ONLINE','INTERNAL'];
    return '<div class="trs-form-grid">' +
      '<div class="form-group"><label>Transaction Class *</label><select id="trsType" onchange="window.autoCategory()">' +
        types.map(t => '<option value="' + t + '"' + (d?.transaction_type === t ? " selected" : "") + '>' + t.replace(/_/g, " ") + '</option>').join("") +
      '</select></div>' +
      '<div class="form-group"><label>Ledger Category</label><select id="trsCat" onchange="window.calcNetAmount()">' +
        ["INCOME","EXPENSE","ADJUSTMENT"].map(c => '<option value="' + c + '"' + (d?.category === c ? " selected" : "") + '>' + c + '</option>').join("") +
      '</select></div>' +
      '<div class="form-group full-width"><label>Particulars *</label><input id="trsDesc" value="' + esc(d?.description || "") + '" placeholder="Transaction description"/></div>' +
      '<div class="form-group"><label>Base Amount (₹) *</label><input type="number" id="trsAmount" value="' + (d?.amount || "") + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>GST (₹)</label><input type="number" id="trsGstAmt" value="' + (d?.gst_amount || 0) + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>TDS (₹)</label><input type="number" id="trsTdsAmt" value="' + (d?.tds_amount || 0) + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>Net Settlement (₹)</label><input type="number" id="trsNetAmt" value="' + (d?.net_amount || "") + '" readonly style="font-weight:900;color:#2E7D32;"/></div>' +
      '<div class="form-group"><label>Payment Method</label><select id="trsMethod"><option value="">Select</option>' +
        methods.map(m => '<option value="' + m + '"' + (d?.payment_method === m ? " selected" : "") + '>' + m.replace(/_/g, " ") + '</option>').join("") +
      '</select></div>' +
      '<div class="form-group"><label>Banking Ref / UTR</label><input id="trsPayRef" value="' + esc(d?.payment_reference || "") + '"/></div>' +
      '<div class="form-group"><label>Voucher Ref</label><input id="trsRefNum" value="' + esc(d?.reference_number || "") + '"/></div>' +
      '<div class="form-group"><label>Budget Head</label><select id="trsBudgetHead"><option value="">Select</option></select></div>' +
      '<div class="form-group"><label>Counterparty</label><input id="trsVendor" value="' + esc(d?.vendor_name || "") + '"/></div>' +
      '<div class="form-group"><label>Contact</label><input id="trsVendorContact" value="' + esc(d?.vendor_contact || "") + '"/></div>' +
      '<div class="form-group"><label>Invoice No</label><input id="trsInvoice" value="' + esc(d?.invoice_number || "") + '"/></div>' +
      '<div class="form-group"><label>Value Date</label><input type="date" id="trsDate" value="' + (d?.transaction_date ? d.transaction_date.substring(0,10) : new Date().toISOString().substring(0,10)) + '"/></div>' +
      '<div class="form-group full-width"><label>Audit Notes</label><textarea id="trsNotes" rows="2">' + esc(d?.notes || "") + '</textarea></div>' +
    '</div><div class="trs-amount-preview"><div class="label">Net Settlement</div><div class="value" id="trsNetPreview">₹0.00</div></div>';
  }

  window.autoCategory = function () {
    const type = $("#trsType").value;
    const cat = $("#trsCat");
    if (type.includes("EXPENSE") || type === "REFUND" || type === "ADVANCE_PAID") cat.value = "EXPENSE";
    else if (type === "ADJUSTMENT") cat.value = "ADJUSTMENT";
    else cat.value = "INCOME";
    window.calcNetAmount();
  };

  window.calcNetAmount = function () {
    const amount = parseFloat($("#trsAmount")?.value) || 0;
    const gst = parseFloat($("#trsGstAmt")?.value) || 0;
    const tds = parseFloat($("#trsTdsAmt")?.value) || 0;
    const net = amount + gst - tds;
    const el = $("#trsNetAmt"); if (el) el.value = net.toFixed(2);
    const preview = $("#trsNetPreview"); if (preview) preview.textContent = "₹" + net.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  };

  async function loadBudgetHeadOptions(selected) {
    const db = getDb(); if (!db) return;
    const { data } = await db.from("budget_heads").select("head_name").order("sort_order");
    const sel = $("#trsBudgetHead");
    if (sel && data) sel.innerHTML = '<option value="">Select</option>' + data.map(h => '<option value="' + esc(h.head_name) + '"' + (selected === h.head_name ? " selected" : "") + '>' + esc(h.head_name) + '</option>').join("");
  }

  bind("#addTransactionBtn", "click", () => {
    if (!hasActionPermission("create_transaction")) { denyAccess("New Transaction"); return; }
    openModal("New Ledger Voucher", getTransactionFormHtml(), '<button class="btn btn-primary" onclick="window.saveNewTransaction()">Commit Entry</button>', "large");
    setTimeout(() => { loadBudgetHeadOptions(); window.calcNetAmount(); }, 100);
  });

  window.saveNewTransaction = async function () {
    if (!hasActionPermission("create_transaction")) return;
    const db = getDb(); if (!db) return;
    window.calcNetAmount();
    const desc = $("#trsDesc").value.trim();
    const amount = parseFloat($("#trsAmount").value);
    if (!desc || isNaN(amount) || amount <= 0) { showToast("Enter description and amount.", "error"); return; }
    showLoading("Committing...");
    try {
      chk(await db.from("treasury_transactions").insert({
        transaction_type: $("#trsType").value, category: $("#trsCat").value, description: desc,
        reference_number: $("#trsRefNum").value || null, amount, gst_amount: parseFloat($("#trsGstAmt").value) || 0,
        tds_amount: parseFloat($("#trsTdsAmt").value) || 0, net_amount: parseFloat($("#trsNetAmt").value) || amount,
        payment_method: $("#trsMethod").value || null, payment_reference: $("#trsPayRef").value || null,
        vendor_name: $("#trsVendor").value || null, vendor_contact: $("#trsVendorContact").value || null,
        invoice_number: $("#trsInvoice").value || null, budget_head: $("#trsBudgetHead").value || null,
        notes: $("#trsNotes").value || null,
        transaction_date: $("#trsDate").value ? new Date($("#trsDate").value).toISOString() : new Date().toISOString(),
        created_by: currentAdmin.id
      }));
      logAction("CREATE", "treasury", null, desc + " ₹" + amount);
      closeModal(); hideLoading(); showToast("Voucher posted."); loadTreasury();
    } catch (err) { hideLoading(); showToast("Failed: " + err.message, "error"); }
  };

  window.editTransaction = async function (id) {
    if (!hasActionPermission("edit_transaction")) { denyAccess("Edit Transaction"); return; }
    const db = getDb();
    const { data } = await db.from("treasury_transactions").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Voucher", getTransactionFormHtml(data), '<button class="btn btn-primary" onclick="window.updateTransaction(\'' + id + '\')">Save Revisions</button>', "large");
    setTimeout(() => { loadBudgetHeadOptions(data.budget_head); window.calcNetAmount(); }, 100);
  };

  window.updateTransaction = async function (id) {
    if (!hasActionPermission("edit_transaction")) return;
    const db = getDb(); if (!db) return;
    window.calcNetAmount();
    const newAmount = parseFloat($("#trsAmount").value);
    if (!$("#trsDesc").value.trim() || isNaN(newAmount) || newAmount <= 0) { showToast("Enter description and amount.", "error"); return; }
    showLoading();
    try {
      chk(await db.from("treasury_transactions").update({
        transaction_type: $("#trsType").value, category: $("#trsCat").value, description: $("#trsDesc").value,
        reference_number: $("#trsRefNum").value || null, amount: parseFloat($("#trsAmount").value),
        gst_amount: parseFloat($("#trsGstAmt").value) || 0, tds_amount: parseFloat($("#trsTdsAmt").value) || 0,
        net_amount: parseFloat($("#trsNetAmt").value), payment_method: $("#trsMethod").value || null,
        payment_reference: $("#trsPayRef").value || null, vendor_name: $("#trsVendor").value || null,
        vendor_contact: $("#trsVendorContact").value || null, invoice_number: $("#trsInvoice").value || null,
        budget_head: $("#trsBudgetHead").value || null, notes: $("#trsNotes").value || null,
        transaction_date: $("#trsDate").value ? new Date($("#trsDate").value).toISOString() : undefined
      }).eq("id", id));
      logAction("UPDATE", "treasury", id, "Voucher updated.");
      closeModal(); hideLoading(); showToast("Saved."); loadTreasury();
    } catch (err) { hideLoading(); showToast("Failed: " + (err.message || "error"), "error"); }
  };

  window.viewTransaction = async function (id) {
    const db = getDb();
    const { data: t } = await db.from("treasury_transactions").select("*").eq("id", id).single();
    if (!t) return;
    const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
    openModal("Voucher Details",
      '<div class="detail-grid">' +
        '<div><strong>Date:</strong> ' + formatDate(t.transaction_date) + '</div><div><strong>Class:</strong> ' + esc((t.transaction_type || "").replace(/_/g, " ")) + '</div>' +
        '<div><strong>Category:</strong> ' + statusBadge((t.category || "").toLowerCase()) + '</div><div><strong>Base:</strong> ' + fmt(t.amount) + '</div>' +
        '<div><strong>GST:</strong> ' + fmt(t.gst_amount) + '</div><div><strong>TDS:</strong> ' + fmt(t.tds_amount) + '</div>' +
        '<div><strong>Net:</strong> <span style="font-weight:900;color:#2E7D32;">' + fmt(t.net_amount) + '</span></div>' +
        '<div><strong>Instrument:</strong> ' + esc((t.payment_method || "—").replace(/_/g, " ")) + '</div>' +
        '<div><strong>Banking Ref:</strong> ' + esc(t.payment_reference || "—") + '</div><div><strong>Voucher:</strong> ' + esc(t.reference_number || "—") + '</div>' +
        '<div><strong>Party:</strong> ' + esc(t.vendor_name || "—") + '</div><div><strong>Invoice:</strong> ' + esc(t.invoice_number || "—") + '</div>' +
        '<div><strong>Budget Head:</strong> ' + esc(t.budget_head || "—") + '</div>' +
        '<div><strong>Audit:</strong> ' + (t.is_verified ? "Verified " + formatDate(t.verified_at) : "Pending") + '</div>' +
        (t.notes ? '<div class="full-width"><strong>Notes:</strong> ' + esc(t.notes) + '</div>' : '') +
      '</div>', "", "large");
  };

  window.verifyTransaction = async function (id) {
    if (!hasActionPermission("verify_transaction")) { denyAccess("Verify Transaction"); return; }
    const db = getDb();
    chk(await db.from("treasury_transactions").update({ is_verified: true, verified_by: currentAdmin.id, verified_at: new Date().toISOString() }).eq("id", id));
    logAction("VERIFY", "treasury", id, "Voucher audited.");
    showToast("Verified."); loadTreasury();
  };

  // ==================== REVENUE SYNC ====================
  bind("#syncRegRevenue", "click", () => {
    if (!hasActionPermission("sync_revenue")) { denyAccess("Revenue Sync"); return; }
    const db = getDb();
    if (!db) return;
    confirmAction("Reconcile Revenue", "Aggregate approved registrations into income ledger?", async () => {
      showLoading("Calculating...");
      try {
        const { count: mc, error: mcErr } = await db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved");
        if (mcErr) throw mcErr;
        const { count: dc, error: dcErr } = await db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved");
        if (dcErr) throw dcErr;
        const total = ((mc || 0) + (dc || 0)) * REGISTRATION_FEE;
        const { data: existing, error: exErr } = await db.from("treasury_transactions").select("id").eq("transaction_type", "REGISTRATION_FEE").eq("reference_number", "AUTO_SYNC").limit(1).maybeSingle();
        if (exErr) throw exErr;
        const txnData = { transaction_type: "REGISTRATION_FEE", category: "INCOME", description: "Approved: " + (mc || 0) + " delegates + " + (dc || 0) + " DC x ₹" + REGISTRATION_FEE.toLocaleString("en-IN"), reference_number: "AUTO_SYNC", amount: total, net_amount: total, payment_method: "BANK_TRANSFER", budget_head: "Registration Fees", is_verified: true, verified_by: currentAdmin.id, verified_at: new Date().toISOString(), created_by: currentAdmin.id };
        if (existing) chk(await db.from("treasury_transactions").update(txnData).eq("id", existing.id));
        else chk(await db.from("treasury_transactions").insert(txnData));
        logAction("SYNC", "treasury", null, "Revenue: ₹" + total.toLocaleString("en-IN"));
        hideLoading(); showToast("Synced: ₹" + total.toLocaleString("en-IN")); loadTreasury();
      } catch (err) { hideLoading(); showToast("Sync failed: " + (err.message || "error"), "error"); }
    });
  });

  // ==================== TREASURY FILTERS ====================
  const filterTreasury = debounce(() => {
    if (!window._cache.treasury) return;
    const q = ($("#trsSearch")?.value || "").toLowerCase();
    const cat = $("#trsCategoryFilter")?.value || "";
    const ver = $("#trsVerifiedFilter")?.value || "";
    renderTreasuryTable(window._cache.treasury.filter(t =>
      (!q || lc(t.description).includes(q) || (t.vendor_name || "").toLowerCase().includes(q)) &&
      (!cat || t.category === cat) && (!ver || String(t.is_verified) === ver)
    ));
  }, 200);
  bind("#trsSearch", "input", filterTreasury);
  bind("#trsCategoryFilter", "change", filterTreasury);
  bind("#trsVerifiedFilter", "change", filterTreasury);

  bind("#exportTreasuryBtn", "click", (e) => {
    if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; }
    e.stopPropagation();
    const dd = $("#exportDropdown");
    if (dd) dd.style.display = dd.style.display === "block" ? "none" : "block";
  });

  document.addEventListener("click", (e) => {
    const dd = $("#exportDropdown");
    const btn = $("#exportTreasuryBtn");
    if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) dd.style.display = "none";
  });

  // ==================== TREASURY EXPORT FUNCTIONS ====================
  async function ensureTreasuryLoaded() {
    if (window._cache.treasury && window._cache.treasury.length) return;
    const db = getDb();
    if (!db) return;
    const { data, error } = await db.from("treasury_transactions").select("*").order("transaction_date", { ascending: false });
    if (error) { showToast("Could not load ledger.", "error"); return; }
    window._cache.treasury = data || [];
  }

  window.exportLedger = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); exportExcel((window._cache.treasury || []).map(t => ({ Date: formatDate(t.transaction_date, false), Type: t.transaction_type, Category: t.category, Description: t.description, Vendor: t.vendor_name || "", Amount: t.amount, GST: t.gst_amount, TDS: t.tds_amount, Net: t.net_amount, Method: t.payment_method || "", Verified: t.is_verified ? "Yes" : "No" })), "Master_Ledger"); };

  window.exportIncomeStatement = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); const inc = (window._cache.treasury || []).filter(t => t.category === "INCOME"); const exp = (window._cache.treasury || []).filter(t => t.category === "EXPENSE"); const ti = inc.reduce((s, t) => s + Number(t.net_amount), 0); const te = exp.reduce((s, t) => s + Number(t.net_amount), 0); exportExcel([...inc.map(t => ({ Category: "INCOME", Type: t.transaction_type, Description: t.description, Amount: t.net_amount })), { Category: "", Type: "", Description: "TOTAL INCOME", Amount: ti }, ...exp.map(t => ({ Category: "EXPENSE", Type: t.transaction_type, Description: t.description, Amount: t.net_amount })), { Category: "", Type: "", Description: "TOTAL EXPENSE", Amount: te }, { Category: "", Type: "", Description: "NET SURPLUS/(DEFICIT)", Amount: ti - te }], "Income_Statement"); };

  window.exportExpenseReport = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); const expenses = (window._cache.treasury || []).filter(t => t.category === "EXPENSE"); const byType = {}; expenses.forEach(t => { if (!byType[t.transaction_type]) byType[t.transaction_type] = { count: 0, total: 0 }; byType[t.transaction_type].count++; byType[t.transaction_type].total += Number(t.net_amount); }); exportExcel([...Object.entries(byType).map(([k, v]) => ({ "Expense Type": k.replace(/_/g, " "), Vouchers: v.count, Total: v.total })), { "Expense Type": "GRAND TOTAL", Vouchers: expenses.length, Total: expenses.reduce((s, t) => s + Number(t.net_amount), 0) }], "Expense_Summary"); };

  window.exportBudgetVariance = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } const db = getDb(); if (!db) return; const { data: heads } = await db.from("budget_heads").select("*").order("sort_order"); const { data: txns } = await db.from("treasury_transactions").select("budget_head,net_amount"); const m = {}; (txns || []).forEach(t => { if (t.budget_head) m[t.budget_head] = (m[t.budget_head] || 0) + Math.abs(Number(t.net_amount)); }); exportExcel((heads || []).map(h => ({ Head: h.head_name, Category: h.category, Allocated: Number(h.allocated_amount), Actual: m[h.head_name] || 0, Variance: Number(h.allocated_amount) - (m[h.head_name] || 0), "Util %": Number(h.allocated_amount) > 0 ? Math.round(((m[h.head_name] || 0) / Number(h.allocated_amount)) * 100) : 0 })), "Budget_Variance"); };

  window.exportCashFlow = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); const byMonth = {}; (window._cache.treasury || []).forEach(t => { const month = new Date(t.transaction_date).toLocaleDateString("en-IN", { month: "short", year: "numeric" }); if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 }; if (t.category === "INCOME") byMonth[month].income += Number(t.net_amount); else if (t.category === "EXPENSE") byMonth[month].expense += Number(t.net_amount); }); exportExcel(Object.entries(byMonth).map(([m, v]) => ({ Period: m, Receipts: v.income, Outflows: v.expense, Net: v.income - v.expense })), "Cash_Flow"); };

  window.exportGSTReport = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); const txns = (window._cache.treasury || []).filter(t => Number(t.gst_amount) > 0); exportExcel([...txns.map(t => ({ Date: formatDate(t.transaction_date, false), Description: t.description, Base: t.amount, GST: t.gst_amount, Invoice: t.invoice_number || "" })), { Date: "", Description: "TOTAL GST", Base: "", GST: txns.reduce((s, t) => s + Number(t.gst_amount), 0), Invoice: "" }], "GST_Audit"); };

  window.exportTDSReport = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); const txns = (window._cache.treasury || []).filter(t => Number(t.tds_amount) > 0); exportExcel([...txns.map(t => ({ Date: formatDate(t.transaction_date, false), Particulars: t.description, Deductee: t.vendor_name || "", Gross: t.amount, TDS: t.tds_amount, Net: t.net_amount })), { Date: "", Particulars: "TOTAL TDS", Deductee: "", Gross: "", TDS: txns.reduce((s, t) => s + Number(t.tds_amount), 0), Net: "" }], "TDS_Report"); };

  window.exportReconciliation = async function () { if (!hasActionPermission("export_treasury")) { denyAccess("Export Treasury"); return; } await ensureTreasuryLoaded(); const data = (window._cache.treasury || []).map(t => ({ Date: formatDate(t.transaction_date, false), Particulars: t.description, Instrument: (t.payment_method || "").replace(/_/g, " "), Ref: t.payment_reference || "", Debit: t.category === "EXPENSE" ? t.net_amount : "", Credit: t.category === "INCOME" ? t.net_amount : "", Audited: t.is_verified ? "Yes" : "No" })); let bal = 0; data.forEach(d => { if (d.Credit) bal += Number(d.Credit); if (d.Debit) bal -= Number(d.Debit); d["Balance"] = bal; }); exportExcel(data, "Reconciliation"); };

  // ==================== COMMAND TERMINAL v2.0 ====================
  function openCommandPalette() {
    if (commandPaletteOpen) { closeCommandPalette(); return; } // Ctrl+K toggles
    commandPaletteOpen = true;

    const allCommands = [
      { name: "Dashboard Overview", icon: "layout-dashboard", view: "dashboard", category: "Navigation", shortcut: "" },
      { name: "Club Registrations", icon: "users-round", view: "clubReg", category: "Navigation", shortcut: "" },
      { name: "District Council", icon: "crown", view: "dcReg", category: "Navigation", shortcut: "" },
      { name: "All Members Ledger", icon: "user-check", view: "members", category: "Navigation", shortcut: "" },
      { name: "Clubs Management", icon: "building-2", view: "clubs", category: "Navigation", shortcut: "" },
      { name: "Attendance Roster", icon: "clipboard-check", view: "attendance", category: "Navigation", shortcut: "" },
      { name: "QR Access Scanner", icon: "scan-line", view: "scanner", category: "Navigation", shortcut: "" },
      { name: "Treasury & Accounts", icon: "indian-rupee", view: "treasury", category: "Finance", shortcut: "" },
      { name: "Sync Registration Revenue", icon: "refresh-cw", view: "treasury", category: "Finance", shortcut: "", action: () => $("#syncRegRevenue")?.click() },
      { name: "Export Master Ledger", icon: "file-spreadsheet", view: "treasury", category: "Finance", shortcut: "", action: () => window.exportLedger && window.exportLedger() },
      { name: "Export Income Statement", icon: "trending-up", view: "treasury", category: "Finance", shortcut: "", action: () => window.exportIncomeStatement && window.exportIncomeStatement() },
      { name: "Export Expense Report", icon: "trending-down", view: "treasury", category: "Finance", shortcut: "", action: () => window.exportExpenseReport && window.exportExpenseReport() },
      { name: "Export Cash Flow", icon: "activity", view: "treasury", category: "Finance", shortcut: "", action: () => window.exportCashFlow && window.exportCashFlow() },
      { name: "Export GST Audit", icon: "receipt", view: "treasury", category: "Finance", shortcut: "", action: () => window.exportGSTReport && window.exportGSTReport() },
      { name: "Content Architecture", icon: "file-text", view: "siteContent", category: "Content", shortcut: "" },
      { name: "Agenda Configuration", icon: "calendar-clock", view: "agenda", category: "Content", shortcut: "" },
      { name: "Colour Hunt Module", icon: "palette", view: "colourHunt", category: "Content", shortcut: "" },
      { name: "Treasure Hunt Module", icon: "map", view: "treasure", category: "Content", shortcut: "" },
      { name: "Group Leaders", icon: "shield", view: "leaders", category: "Content", shortcut: "" },
      { name: "Catering Management", icon: "utensils", view: "food", category: "Content", shortcut: "" },
      { name: "Announcements", icon: "megaphone", view: "announcements", category: "Content", shortcut: "" },
      { name: "Knowledge Base (FAQ)", icon: "help-circle", view: "faqs", category: "Content", shortcut: "" },
      { name: "System Administrators", icon: "users-round", view: "admins", category: "System", shortcut: "" },
      { name: "System Audit Trail", icon: "activity", view: "activity", category: "System", shortcut: "" },
      { name: "Export Members Roster", icon: "download", view: "members", category: "Actions", shortcut: "", action: () => $("#exportMembers")?.click() },
      { name: "Export Attendance Audit", icon: "download", view: "attendance", category: "Actions", shortcut: "", action: () => $("#exportAttendance")?.click() },
      { name: "Refresh Current View", icon: "refresh-cw", view: "dashboard", category: "Actions", shortcut: "Ctrl+Shift+R", stay: true, action: () => { const v = $(".view.active")?.id?.replace("view-", ""); if (v) navigateTo(v); } },
      { name: "Terminate Session", icon: "log-out", view: "dashboard", category: "Actions", shortcut: "", stay: true, action: logout },
    ];

    const commands = allCommands.filter(c => hasPermission(c.view));
    let recentCmds = [];
    try { recentCmds = JSON.parse(localStorage.getItem("altitude_recent_cmds") || "[]"); } catch {}

    const categoryIcons = { Navigation: "compass", Finance: "indian-rupee", Content: "file-text", System: "settings", Actions: "zap" };
    const categoryOrder = ["Navigation", "Finance", "Content", "System", "Actions"];

    function renderResults(filtered, query) {
      const results = $("#cmdResults");
      if (!results) return;

      if (!filtered.length) {
        results.innerHTML = '<div class="cmd-empty"><i data-lucide="search-x"></i><p>No matching commands found</p><small>Try a different keyword or check your access level</small></div>';
        if (typeof lucide !== "undefined") lucide.createIcons();
        return;
      }

      let html = '';

      if (!query && recentCmds.length > 0) {
        const recentItems = recentCmds.map(name => commands.find(c => c.name === name)).filter(Boolean).slice(0, 3);
        if (recentItems.length > 0) {
          html += '<div class="cmd-category"><div class="cmd-category-label"><i data-lucide="clock"></i><span>Recent</span></div></div>';
          recentItems.forEach((c, i) => { html += buildCmdItem(c, commands.indexOf(c), i === 0 && !query); });
          html += '<div class="cmd-separator"></div>';
        }
      }

      if (query) {
        filtered.forEach((c, i) => { html += buildCmdItem(c, commands.indexOf(c), i === 0); });
      } else {
        categoryOrder.forEach(cat => {
          const catItems = filtered.filter(c => c.category === cat);
          if (!catItems.length) return;
          html += '<div class="cmd-category"><div class="cmd-category-label"><i data-lucide="' + (categoryIcons[cat] || "folder") + '"></i><span>' + cat + '</span><span class="cmd-category-count">' + catItems.length + '</span></div></div>';
          catItems.forEach((c) => { html += buildCmdItem(c, commands.indexOf(c), false); });
        });
      }

      results.innerHTML = html;
      if (typeof lucide !== "undefined") lucide.createIcons();

      const firstItem = results.querySelector(".cmd-item");
      if (firstItem) firstItem.classList.add("active");

      $$(".cmd-item").forEach(item => {
        item.addEventListener("click", () => { const idx = parseInt(item.dataset.idx); executeCommand(commands[idx]); });
        item.addEventListener("mouseenter", () => { $$(".cmd-item").forEach(i => i.classList.remove("active")); item.classList.add("active"); });
      });
    }

    function buildCmdItem(c, globalIdx, isActive) {
      return '<div class="cmd-item' + (isActive ? " active" : "") + '" data-idx="' + globalIdx + '">' +
        '<div class="cmd-item-icon"><i data-lucide="' + c.icon + '"></i></div>' +
        '<div class="cmd-item-info"><span class="cmd-item-name">' + esc(c.name) + '</span><span class="cmd-item-cat">' + esc(c.category) + '</span></div>' +
        (c.shortcut ? '<kbd class="cmd-shortcut">' + c.shortcut + '</kbd>' : '') +
        '<div class="cmd-item-arrow"><i data-lucide="arrow-right"></i></div></div>';
    }

    function executeCommand(cmd) {
      if (!cmd) return;
      recentCmds = [cmd.name, ...recentCmds.filter(n => n !== cmd.name)].slice(0, 5);
      try { localStorage.setItem("altitude_recent_cmds", JSON.stringify(recentCmds)); } catch (e) {}
      closeCommandPalette(); // close first so an action can open its own dialog
      if (cmd.view && !cmd.stay) navigateTo(cmd.view);
      if (cmd.action) cmd.action();
    }

    const html =
      '<div class="cmd-terminal">' +
        '<div class="cmd-header">' +
          '<div class="cmd-search-wrap"><i data-lucide="search" class="cmd-search-icon"></i><input type="text" id="cmdSearch" placeholder="Search commands, modules, actions..." autocomplete="off" spellcheck="false" />' +
            '<div class="cmd-search-hints"><kbd>ESC</kbd> close <kbd class="arrow-key">&#x2191;&#x2193;</kbd> navigate <kbd class="arrow-key">&#x21B5;</kbd> select</div>' +
          '</div>' +
          '<div class="cmd-meta-bar"><div class="cmd-role-badge"><i data-lucide="shield"></i><span>' + esc(getRoleLabel(currentAdmin.role)) + '</span></div><div class="cmd-count" id="cmdCount">' + commands.length + ' commands available</div></div>' +
        '</div>' +
        '<div id="cmdResults" class="cmd-results"></div>' +
        '<div class="cmd-footer"><div class="cmd-footer-hint"><i data-lucide="terminal"></i> ALTITUDE Command Terminal v2.0</div><div class="cmd-footer-shortcut"><kbd>Ctrl</kbd>+<kbd>K</kbd> to toggle</div></div>' +
      '</div>';

    openModal("", html, "", "large");

    const modalTitle = $("#modalTitle"); if (modalTitle) modalTitle.style.display = "none";
    const modalFooter = $("#modalFooter"); if (modalFooter) modalFooter.style.display = "none";
    const modalBody = $("#modalBody"); if (modalBody) modalBody.style.padding = "0";

    setTimeout(() => {
      renderResults(commands, "");
      const search = $("#cmdSearch");
      if (search) {
        search.focus();
        search.addEventListener("input", () => {
          const q = search.value.toLowerCase().trim();
          const filtered = q ? commands.filter(c => c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.icon.toLowerCase().includes(q)) : commands;
          renderResults(filtered, q);
          const countEl = $("#cmdCount");
          if (countEl) countEl.textContent = filtered.length + " of " + commands.length + " commands";
        });
        search.addEventListener("keydown", (e) => handleCmdKeydown(e, commands, executeCommand));
      }
    }, 100);
  }

  function handleCmdKeydown(e, commands, run) {
    if (e.key === "Escape") { e.preventDefault(); closeCommandPalette(); return; }
    const items = $$(".cmd-item");
    if (!items.length) return;
    let activeIdx = Array.from(items).findIndex(i => i.classList.contains("active"));

    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[activeIdx]?.classList.remove("active");
      activeIdx = (activeIdx + 1) % items.length;
      items[activeIdx]?.classList.add("active");
      items[activeIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[activeIdx]?.classList.remove("active");
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      items[activeIdx]?.classList.add("active");
      items[activeIdx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIdx];
      if (item) run(commands[parseInt(item.dataset.idx)]);
    }
  }

  function closeCommandPalette() {
    closeModal(); // closeModal also resets the palette state and any styles the palette changed
  }

  // ==================== PART 4: CONTENT EDITORS, ADMIN MGMT, FILTERS & INIT ====================

  // ==================== SITE CONTENT EDITOR ====================
  async function loadSiteContentEditor() {
    if (!hasPermission("siteContent")) { denyAccess("Content Editor"); return; }
    const db = getDb();
    if (!db) return;
    const { data } = await db.from("site_content").select("*").order("section_key");
    const c = $("#siteContentList");
    if (!c || !data) return;
    c.innerHTML = data.map(s =>
      '<div class="content-editor-card">' +
        '<div class="content-editor-header"><h4>' + esc(s.section_key) + '</h4>' +
        '<button class="btn-sm blue" onclick="window.editSiteContent(\'' + s.id + '\',\'' + jsArg(s.section_key) + '\')"><i data-lucide="edit-3"></i></button></div>' +
        '<p><strong>Title:</strong> ' + esc(s.title || "—") + '</p>' +
        '<p>' + esc((s.content || "").substring(0, 120)) + '...</p>' +
      '</div>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.editSiteContent = async function (id, key) {
    if (!hasActionPermission("edit_site_content")) { denyAccess("Content Edit"); return; }
    const db = getDb();
    const { data } = await db.from("site_content").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Content Block: " + key,
      '<div class="form-group"><label>Header</label><input id="eT" value="' + esc(data.title || "") + '"/></div>' +
      '<div class="form-group"><label>Body Content</label><textarea id="eC" rows="5">' + esc(data.content || "") + '</textarea></div>' +
      '<div class="form-group"><label>JSON Attributes</label><textarea id="eE" rows="6" style="font-family:monospace;">' + esc(JSON.stringify(data.extra_data || {}, null, 2)) + '</textarea></div>',
      '<button class="btn btn-primary" onclick="window.saveSiteContent(\'' + id + '\')">Save</button>', "large");
  };

  window.saveSiteContent = async function (id) {
    let extra = {};
    try { extra = JSON.parse($("#eE").value); } catch { showToast("Invalid JSON string.", "error"); return; }
    const db = getDb();
    chk(await db.from("site_content").update({ title: $("#eT").value, content: $("#eC").value, extra_data: extra, updated_by: currentAdmin.id }).eq("id", id));
    logAction("UPDATE", "site_content", id, "Content updated.");
    closeModal(); showToast("Content saved."); loadSiteContentEditor();
  };

  // ==================== AGENDA EDITOR ====================
  async function loadAgendaEditor() {
    if (!hasPermission("agenda")) return;
    const db = getDb();
    if (!db) return;
    const { data } = await db.from("agenda").select("*").order("day_number").order("sort_order");
    const tb = $("#agendaTable tbody");
    if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>Day ' + a.day_number + '</td><td>' + esc(a.time_slot) + '</td><td>' + esc(a.title) + '</td>' +
      '<td>' + esc(a.location || "—") + '</td><td>' + a.sort_order + '</td>' +
      '<td>' + (a.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge gray">Hidden</span>') + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editAgenda(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'agenda\',\'' + a.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  bind("#addAgendaBtn", "click", () => {
    if (!hasPermission("agenda")) return;
    openModal("Add Event Session",
      '<div class="form-grid"><div class="form-group"><label>Day</label><select id="aD"><option value="1">Day 1</option><option value="2">Day 2</option></select></div>' +
      '<div class="form-group"><label>Time Window</label><input id="aT" placeholder="09:00 AM"/></div>' +
      '<div class="form-group"><label>Session Title</label><input id="aTi" placeholder="Session title"/></div>' +
      '<div class="form-group"><label>Location</label><input id="aL" placeholder="Venue/Location"/></div>' +
      '<div class="form-group full-width"><label>Description</label><textarea id="aDe" rows="3" placeholder="Session details"></textarea></div>' +
      '<div class="form-group"><label>Sort Order</label><input type="number" id="aO" value="0"/></div></div>',
      '<button class="btn btn-primary" onclick="window.createAgenda()">Create Session</button>');
  });

  window.createAgenda = async function () {
    const db = getDb();
    chk(await db.from("agenda").insert({
      day_number: parseInt($("#aD").value), time_slot: $("#aT").value,
      title: $("#aTi").value, location: $("#aL").value, description: $("#aDe").value,
      sort_order: parseInt($("#aO").value) || 0,
      event_date: $("#aD").value === "1" ? "2026-12-12" : "2026-12-13"
    }));
    logAction("CREATE", "agenda", null, "New session: " + $("#aTi").value);
    closeModal(); showToast("Session created."); loadAgendaEditor();
  };

  window.editAgenda = async function (id) {
    const db = getDb();
    const { data } = await db.from("agenda").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Session",
      '<div class="form-grid"><div class="form-group"><label>Day</label><select id="aD"><option value="1"' + (data.day_number === 1 ? " selected" : "") + '>1</option><option value="2"' + (data.day_number === 2 ? " selected" : "") + '>2</option></select></div>' +
      '<div class="form-group"><label>Time Window</label><input id="aT" value="' + esc(data.time_slot) + '"/></div>' +
      '<div class="form-group"><label>Session Title</label><input id="aTi" value="' + esc(data.title) + '"/></div>' +
      '<div class="form-group"><label>Location</label><input id="aL" value="' + esc(data.location || "") + '"/></div>' +
      '<div class="form-group full-width"><label>Description</label><textarea id="aDe" rows="3">' + esc(data.description || "") + '</textarea></div>' +
      '<div class="form-group"><label>Sort Order</label><input type="number" id="aO" value="' + data.sort_order + '"/></div></div>',
      '<button class="btn btn-primary" onclick="window.saveAgenda(\'' + id + '\')">Save Revisions</button>');
  };

  window.saveAgenda = async function (id) {
    const db = getDb();
    chk(await db.from("agenda").update({
      day_number: parseInt($("#aD").value), time_slot: $("#aT").value,
      title: $("#aTi").value, location: $("#aL").value, description: $("#aDe").value,
      sort_order: parseInt($("#aO").value) || 0
    }).eq("id", id));
    logAction("UPDATE", "agenda", id, "Session updated.");
    closeModal(); showToast("Saved."); loadAgendaEditor();
  };

  // ==================== COLOUR HUNT EDITOR ====================
  async function loadColourHuntEditor() {
    if (!hasPermission("colourHunt")) return;
    const db = getDb();
    const { data } = await db.from("colour_hunt").select("*").order("sort_order");
    const c = $("#colourHuntList");
    if (!c) return;
    if (!data?.length) { c.innerHTML = '<p style="text-align:center;padding:24px;color:var(--gray-400,#9aa3ad);">No challenges configured.</p>'; return; }
    c.innerHTML = data.map(x => '<div class="content-editor-card"><h4>' + esc(x.title) + '</h4><p>' + esc((x.description || "").substring(0, 150)) + '...</p><button class="btn-sm blue" onclick="window.editColourHunt(\'' + x.id + '\')"><i data-lucide="edit-3"></i></button></div>').join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  bind("#addColourHuntBtn", "click", () => {
    if (!hasPermission("colourHunt")) return;
    openModal("Add Colour Challenge",
      '<div class="form-group"><label>Title</label><input id="cT" placeholder="Challenge title"/></div>' +
      '<div class="form-group"><label>Description</label><textarea id="cD" rows="4" placeholder="Challenge description"></textarea></div>' +
      '<div class="form-group"><label>Rules</label><textarea id="cR" rows="5" placeholder="Evaluation rules"></textarea></div>' +
      '<div class="form-group"><label>Hashtag Tags</label><input id="cH" placeholder="#Altitude #ColourHunt"/></div>',
      '<button class="btn btn-primary" onclick="window.createColourHunt()">Save Challenge</button>');
  });

  window.createColourHunt = async function () {
    const db = getDb();
    chk(await db.from("colour_hunt").insert({ title: $("#cT").value, description: $("#cD").value, rules: $("#cR").value, hashtags: $("#cH").value }));
    logAction("CREATE", "colour_hunt", null, "Challenge added.");
    closeModal(); showToast("Challenge added."); loadColourHuntEditor();
  };

  window.editColourHunt = async function (id) {
    const db = getDb();
    const { data } = await db.from("colour_hunt").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Colour Challenge",
      '<div class="form-group"><label>Title</label><input id="cT" value="' + esc(data.title) + '"/></div>' +
      '<div class="form-group"><label>Description</label><textarea id="cD" rows="4">' + esc(data.description) + '</textarea></div>' +
      '<div class="form-group"><label>Rules</label><textarea id="cR" rows="5">' + esc(data.rules || "") + '</textarea></div>' +
      '<div class="form-group"><label>Hashtag Tags</label><input id="cH" value="' + esc(data.hashtags || "") + '"/></div>',
      '<button class="btn btn-primary" onclick="window.saveColourHunt(\'' + id + '\')">Save</button>');
  };

  window.saveColourHunt = async function (id) {
    const db = getDb();
    chk(await db.from("colour_hunt").update({ title: $("#cT").value, description: $("#cD").value, rules: $("#cR").value, hashtags: $("#cH").value }).eq("id", id));
    logAction("UPDATE", "colour_hunt", id, "Challenge updated.");
    closeModal(); showToast("Updated."); loadColourHuntEditor();
  };

  // ==================== TREASURE HUNT EDITOR ====================
  async function loadTreasureEditor() {
    if (!hasPermission("treasure")) return;
    const db = getDb();
    const { data } = await db.from("treasure_hunt").select("*").order("sort_order");
    const tb = $("#treasureTable tbody");
    if (!tb) return;
    if (!data?.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No clues configured.</td></tr>'; return; }
    tb.innerHTML = data.map(c =>
      '<tr><td>' + c.clue_number + '</td><td>' + esc(c.clue_title) + '</td><td>Group ' + (c.group_number || "All") + '</td>' +
      '<td>' + esc((c.clue_text || "").substring(0, 60)) + '...</td>' +
      '<td>' + (c.is_revealed ? '<span class="status-badge green">Visible</span>' : '<span class="status-badge gray">Locked</span>') + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm green" onclick="window.toggleClue(\'' + c.id + '\',' + !c.is_revealed + ')"><i data-lucide="' + (c.is_revealed ? "eye-off" : "eye") + '"></i></button>' +
      '<button class="btn-sm blue" onclick="window.editTreasure(\'' + c.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'treasure_hunt\',\'' + c.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  bind("#addTreasureBtn", "click", () => {
    if (!hasPermission("treasure")) return;
    openModal("Add Clue",
      '<div class="form-grid"><div class="form-group"><label>Sequence #</label><input type="number" id="tN" value="1"/></div>' +
      '<div class="form-group"><label>Clue Title</label><input id="tT" placeholder="Clue title"/></div>' +
      '<div class="form-group full-width"><label>Cipher Text</label><textarea id="tX" rows="3" placeholder="The clue content"></textarea></div>' +
      '<div class="form-group"><label>Hint</label><input id="tH" placeholder="Decryption hint"/></div>' +
      '<div class="form-group"><label>Target Group</label><select id="tG"><option value="">All Groups</option><option value="1">Group 1</option><option value="2">Group 2</option><option value="3">Group 3</option><option value="4">Group 4</option></select></div></div>',
      '<button class="btn btn-primary" onclick="window.createTreasure()">Save Clue</button>');
  });

  window.createTreasure = async function () {
    const db = getDb();
    chk(await db.from("treasure_hunt").insert({ clue_number: parseInt($("#tN").value) || 1, clue_title: $("#tT").value, clue_text: $("#tX").value, hint: $("#tH").value, group_number: $("#tG").value ? parseInt($("#tG").value) : null }));
    logAction("CREATE", "treasure_hunt", null, "Clue added.");
    closeModal(); showToast("Clue saved."); loadTreasureEditor();
  };

  window.toggleClue = async function (id, reveal) {
    const db = getDb();
    chk(await db.from("treasure_hunt").update({ is_revealed: reveal }).eq("id", id));
    logAction("UPDATE", "treasure_hunt", id, reveal ? "Clue unlocked." : "Clue locked.");
    showToast(reveal ? "Clue unlocked." : "Clue locked.");
    loadTreasureEditor();
  };

  window.editTreasure = async function (id) {
    const db = getDb();
    const { data } = await db.from("treasure_hunt").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Clue",
      '<div class="form-grid"><div class="form-group"><label>Sequence</label><input type="number" id="tN" value="' + data.clue_number + '"/></div>' +
      '<div class="form-group"><label>Clue Title</label><input id="tT" value="' + esc(data.clue_title) + '"/></div>' +
      '<div class="form-group full-width"><label>Cipher Text</label><textarea id="tX" rows="3">' + esc(data.clue_text) + '</textarea></div>' +
      '<div class="form-group"><label>Hint</label><input id="tH" value="' + esc(data.hint || "") + '"/></div>' +
      '<div class="form-group"><label>Target Group</label><select id="tG"><option value="">All</option>' +
      [1,2,3,4].map(g => '<option value="' + g + '"' + (data.group_number === g ? " selected" : "") + '>Group ' + g + '</option>').join("") +
      '</select></div></div>',
      '<button class="btn btn-primary" onclick="window.saveTreasure(\'' + id + '\')">Commit Changes</button>');
  };

  window.saveTreasure = async function (id) {
    const db = getDb();
    chk(await db.from("treasure_hunt").update({ clue_number: parseInt($("#tN").value), clue_title: $("#tT").value, clue_text: $("#tX").value, hint: $("#tH").value, group_number: $("#tG").value ? parseInt($("#tG").value) : null }).eq("id", id));
    logAction("UPDATE", "treasure_hunt", id, "Clue updated.");
    closeModal(); showToast("Saved."); loadTreasureEditor();
  };

  // ==================== GROUP LEADERS ====================
  async function loadLeadersEditor() {
    if (!hasPermission("leaders")) return;
    const db = getDb();
    const { data } = await db.from("group_leaders").select("*").eq("is_active", true).order("group_number");
    const tb = $("#leadersTable tbody");
    if (!tb) return;
    if (!data?.length) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">No leaders assigned.</td></tr>'; return; }
    tb.innerHTML = data.map(l =>
      '<tr><td>Group ' + l.group_number + '</td><td>' + esc(l.leader_name) + '</td>' +
      '<td>' + esc(l.leader_role) + '</td><td>' + esc(l.leader_club || "—") + '</td>' +
      '<td>' + esc(l.contact_number) + '</td><td>' + (l.is_primary ? "Lead" : "Secondary") + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editLeader(\'' + l.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'group_leaders\',\'' + l.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  bind("#addLeaderBtn", "click", () => {
    if (!hasPermission("leaders")) return;
    openModal("Appoint Group Marshal",
      '<div class="form-grid"><div class="form-group"><label>Group</label><select id="lG"><option value="1">Group 1</option><option value="2">Group 2</option><option value="3">Group 3</option><option value="4">Group 4</option></select></div>' +
      '<div class="form-group"><label>Marshal Name</label><input id="lN" placeholder="Full name"/></div>' +
      '<div class="form-group"><label>Designation</label><input id="lR" placeholder="Role or title"/></div>' +
      '<div class="form-group"><label>Home Club</label><input id="lC" placeholder="Club name"/></div>' +
      '<div class="form-group"><label>Contact Phone</label><input id="lP" placeholder="10-digit number"/></div>' +
      '<div class="form-group"><label>Email</label><input id="lE" type="email" placeholder="email@example.com"/></div></div>',
      '<button class="btn btn-primary" onclick="window.createLeader()">Confirm Appointment</button>');
  });

  window.createLeader = async function () {
    const db = getDb();
    chk(await db.from("group_leaders").insert({ group_number: parseInt($("#lG").value), leader_name: $("#lN").value, leader_role: $("#lR").value, leader_club: $("#lC").value, contact_number: $("#lP").value, email: $("#lE").value }));
    logAction("CREATE", "group_leaders", null, "Marshal appointed: " + $("#lN").value);
    closeModal(); showToast("Marshal appointed."); loadLeadersEditor();
  };

  window.editLeader = async function (id) {
    const db = getDb();
    const { data } = await db.from("group_leaders").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Marshal Assignment",
      '<div class="form-grid"><div class="form-group"><label>Group</label><select id="lG">' +
      [1,2,3,4].map(g => '<option value="' + g + '"' + (data.group_number === g ? " selected" : "") + '>Group ' + g + '</option>').join("") + '</select></div>' +
      '<div class="form-group"><label>Name</label><input id="lN" value="' + esc(data.leader_name) + '"/></div>' +
      '<div class="form-group"><label>Designation</label><input id="lR" value="' + esc(data.leader_role) + '"/></div>' +
      '<div class="form-group"><label>Home Club</label><input id="lC" value="' + esc(data.leader_club || "") + '"/></div>' +
      '<div class="form-group"><label>Phone</label><input id="lP" value="' + esc(data.contact_number) + '"/></div>' +
      '<div class="form-group"><label>Email</label><input id="lE" value="' + esc(data.email || "") + '"/></div></div>',
      '<button class="btn btn-primary" onclick="window.saveLeader(\'' + id + '\')">Save</button>');
  };

  window.saveLeader = async function (id) {
    const db = getDb();
    chk(await db.from("group_leaders").update({ group_number: parseInt($("#lG").value), leader_name: $("#lN").value, leader_role: $("#lR").value, leader_club: $("#lC").value, contact_number: $("#lP").value, email: $("#lE").value }).eq("id", id));
    logAction("UPDATE", "group_leaders", id, "Marshal updated.");
    closeModal(); showToast("Saved."); loadLeadersEditor();
  };

  // ==================== FOOD MENU EDITOR ====================
  async function loadFoodEditor() {
    if (!hasPermission("food")) return;
    const db = getDb();
    const { data } = await db.from("food_menu").select("*").order("day_number").order("sort_order");
    const tb = $("#foodTable tbody");
    if (!tb) return;
    if (!data?.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No menu items listed.</td></tr>'; return; }
    tb.innerHTML = data.map(f =>
      '<tr><td>Day ' + f.day_number + '</td><td>' + esc(f.meal_type) + '</td>' +
      '<td><span class="food-badge ' + (f.food_type === "VEG" ? "veg" : "nonveg") + '">' + esc(f.food_type) + '</span></td>' +
      '<td>' + esc(f.item_name) + '</td><td>' + esc(f.description || "") + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editFood(\'' + f.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'food_menu\',\'' + f.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  const foodFormHtml = (d) => '<div class="form-grid"><div class="form-group"><label>Day</label><select id="fD"><option value="1"' + (d?.day_number === 1 ? " selected" : "") + '>Day 1</option><option value="2"' + (d?.day_number === 2 ? " selected" : "") + '>Day 2</option></select></div><div class="form-group"><label>Service</label><select id="fM">' + ["Breakfast","Lunch","Snacks","Dinner","Beverages"].map(x => '<option' + (d?.meal_type === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div><div class="form-group"><label>Dietary Class</label><select id="fT">' + ["VEG","NON-VEG","COMMON"].map(x => '<option value="' + x + '"' + (d?.food_type === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div><div class="form-group"><label>Menu Item</label><input id="fN" value="' + esc(d?.item_name || "") + '" placeholder="Item name"/></div><div class="form-group full-width"><label>Description</label><input id="fDe" value="' + esc(d?.description || "") + '" placeholder="Brief description"/></div></div>';

  bind("#addFoodBtn", "click", () => { if (!hasPermission("food")) return; openModal("Add Catering Item", foodFormHtml(), '<button class="btn btn-primary" onclick="window.createFood()">Post Item</button>'); });

  window.createFood = async function () { const db = getDb(); chk(await db.from("food_menu").insert({ day_number: parseInt($("#fD").value), meal_type: $("#fM").value, food_type: $("#fT").value, item_name: $("#fN").value, description: $("#fDe").value })); logAction("CREATE", "food_menu", null, "Menu item added."); closeModal(); showToast("Menu posted."); loadFoodEditor(); };

  window.editFood = async function (id) { const db = getDb(); const { data } = await db.from("food_menu").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Menu Item", foodFormHtml(data), '<button class="btn btn-primary" onclick="window.saveFood(\'' + id + '\')">Save Changes</button>'); };

  window.saveFood = async function (id) { const db = getDb(); chk(await db.from("food_menu").update({ day_number: parseInt($("#fD").value), meal_type: $("#fM").value, food_type: $("#fT").value, item_name: $("#fN").value, description: $("#fDe").value }).eq("id", id)); logAction("UPDATE", "food_menu", id, "Menu item updated."); closeModal(); showToast("Saved."); loadFoodEditor(); };

  // ==================== ANNOUNCEMENTS EDITOR ====================
  async function loadAnnouncementsEditor() {
    if (!hasPermission("announcements")) return;
    const db = getDb();
    const { data } = await db.from("announcements").select("*").order("created_at", { ascending: false });
    const c = $("#announcementsList");
    if (!c) return;
    if (!data?.length) { c.innerHTML = '<p style="text-align:center;padding:24px;color:var(--gray-400,#9aa3ad);">No bulletins published.</p>'; return; }
    c.innerHTML = data.map(a =>
      '<div class="content-editor-card"><div class="content-editor-header">' +
      '<h4>' + esc(a.title) + ' <span class="status-badge ' + esc(a.priority) + '">' + esc(String(a.priority || "").toUpperCase()) + '</span></h4>' +
      '<div class="action-btns"><button class="btn-sm blue" onclick="window.editAnnouncement(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'announcements\',\'' + a.id + '\')"><i data-lucide="trash-2"></i></button></div></div>' +
      '<p>' + esc(a.message) + '</p><small>' + (a.is_active ? "Active" : "Archived") + ' | ' + (a.show_on_homepage ? "Public" : "Internal") + '</small></div>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  const annFormHtml = (d) => '<div class="form-group"><label>Bulletin Title</label><input id="anT" value="' + esc(d?.title || "") + '" placeholder="Announcement title"/></div><div class="form-group"><label>Message</label><textarea id="anM" rows="4" placeholder="Announcement body">' + esc(d?.message || "") + '</textarea></div><div class="form-group"><label>Severity</label><select id="anP">' + ["low","normal","high","urgent"].map(p => '<option value="' + p + '"' + (d?.priority === p ? " selected" : "") + '>' + p.toUpperCase() + '</option>').join("") + '</select></div><div class="form-group"><label><input type="checkbox" id="anA"' + (d?.is_active !== false ? " checked" : "") + '/> Broadcast Active</label></div><div class="form-group"><label><input type="checkbox" id="anH"' + (d?.show_on_homepage !== false ? " checked" : "") + '/> Show on Public Portal</label></div>';

  bind("#addAnnouncementBtn", "click", () => { if (!hasPermission("announcements")) return; openModal("Draft Bulletin", annFormHtml(), '<button class="btn btn-primary" onclick="window.createAnnouncement()">Publish</button>'); });

  window.createAnnouncement = async function () { const db = getDb(); chk(await db.from("announcements").insert({ title: $("#anT").value, message: $("#anM").value, priority: $("#anP").value, is_active: $("#anA").checked, show_on_homepage: $("#anH").checked, created_by: currentAdmin.id })); logAction("CREATE", "announcements", null, "Bulletin published."); closeModal(); showToast("Published."); loadAnnouncementsEditor(); };

  window.editAnnouncement = async function (id) { const db = getDb(); const { data } = await db.from("announcements").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Bulletin", annFormHtml(data), '<button class="btn btn-primary" onclick="window.saveAnnouncement(\'' + id + '\')">Save</button>'); };

  window.saveAnnouncement = async function (id) { const db = getDb(); chk(await db.from("announcements").update({ title: $("#anT").value, message: $("#anM").value, priority: $("#anP").value, is_active: $("#anA").checked, show_on_homepage: $("#anH").checked }).eq("id", id)); logAction("UPDATE", "announcements", id, "Bulletin revised."); closeModal(); showToast("Saved."); loadAnnouncementsEditor(); };

  // ==================== FAQ EDITOR ====================
  async function loadFaqsEditor() {
    if (!hasPermission("faqs")) return;
    const db = getDb();
    const { data } = await db.from("faqs").select("*").order("sort_order");
    const tb = $("#faqTable tbody");
    if (!tb) return;
    if (!data?.length) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">No knowledge base articles.</td></tr>'; return; }
    tb.innerHTML = data.map(f =>
      '<tr><td>' + esc(f.question) + '</td><td>' + esc(f.category) + '</td><td>' + f.sort_order + '</td>' +
      '<td>' + (f.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge gray">Archived</span>') + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editFaq(\'' + f.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'faqs\',\'' + f.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  const faqFormHtml = (d) => '<div class="form-group"><label>Question</label><input id="fqQ" value="' + esc(d?.question || "") + '" placeholder="The question"/></div><div class="form-group"><label>Answer</label><textarea id="fqA" rows="4" placeholder="The detailed answer">' + esc(d?.answer || "") + '</textarea></div><div class="form-group"><label>Category</label><input id="fqC" value="' + esc(d?.category || "General") + '" placeholder="Category tag"/></div><div class="form-group"><label>Display Order</label><input type="number" id="fqO" value="' + (d?.sort_order || 0) + '"/></div>';

  bind("#addFaqBtn", "click", () => { if (!hasPermission("faqs")) return; openModal("Add Knowledge Article", faqFormHtml(), '<button class="btn btn-primary" onclick="window.createFaq()">Post</button>'); });

  window.createFaq = async function () { const db = getDb(); chk(await db.from("faqs").insert({ question: $("#fqQ").value, answer: $("#fqA").value, category: $("#fqC").value, sort_order: parseInt($("#fqO").value) || 0 })); logAction("CREATE", "faqs", null, "Article posted."); closeModal(); showToast("Article saved."); loadFaqsEditor(); };

  window.editFaq = async function (id) { const db = getDb(); const { data } = await db.from("faqs").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Knowledge Article", faqFormHtml(data), '<button class="btn btn-primary" onclick="window.saveFaq(\'' + id + '\')">Save</button>'); };

  window.saveFaq = async function (id) { const db = getDb(); chk(await db.from("faqs").update({ question: $("#fqQ").value, answer: $("#fqA").value, category: $("#fqC").value, sort_order: parseInt($("#fqO").value) || 0 }).eq("id", id)); logAction("UPDATE", "faqs", id, "Article revised."); closeModal(); showToast("Saved."); loadFaqsEditor(); };

  // ==================== ADMIN USERS (Super Admin Only) ====================
  async function loadAdminsEditor() {
    if (!hasPermission("admins")) { denyAccess("admins"); return; }
    const db = getDb(); if (!db) return;
    const { data } = await db.from("admin_users").select("id,email,full_name,role,is_active,last_login").order("created_at");
    const tb = $("#adminsTable tbody"); if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>' + esc(a.full_name) + '</td><td>' + esc(a.email) + '</td>' +
      '<td><span class="status-badge ' + getRoleBadgeColor(a.role) + '">' + esc(getRoleLabel(a.role)) + '</span></td>' +
      '<td>' + (a.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge red">Inactive</span>') + '</td>' +
      '<td>' + formatDate(a.last_login) + '</td>' +
      '<td><button class="btn-sm blue" onclick="window.editAdmin(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  bind("#addAdminBtn", "click", () => {
    if (!isSuperAdmin()) { denyAccess("admins"); return; }
    openModal("Provision Operator",
      '<div class="form-group"><label>Full Name</label><input id="adN" placeholder="Operator name"/></div>' +
      '<div class="form-group"><label>Email Address</label><input id="adE" type="email" placeholder="operator@altitude.org"/></div>' +
      '<div class="form-group"><label>Password</label><input id="adP" type="password" placeholder="Min 8 characters"/></div>' +
      '<div class="form-group"><label>Access Role</label><select id="adR">' +
        '<option value="admin">Administrator</option>' +
        '<option value="super_admin">Super Administrator</option>' +
        '<option value="event_treasurer">Event Treasurer</option>' +
        '<option value="event_secretary">Event Secretary</option>' +
        '<option value="scanner">Scanner Operator</option>' +
        '<option value="viewer">Read-Only Viewer</option>' +
      '</select></div>' +
      '<div style="margin-top:12px;padding:10px 14px;background:rgba(76,175,80,0.08);border:1px solid rgba(76,175,80,0.25);border-radius:8px;font-size:11px;color:#1B5E20;line-height:1.6;">' +
        '<strong>Role Access Summary:</strong><br>' +
        'Super Admin: Full system control<br>' +
        'Administrator: Registrations, content, attendance<br>' +
        'Event Treasurer: Treasury, members (read-only)<br>' +
        'Event Secretary: Registrations, clubs, treasury, attendance<br>' +
        'Scanner: QR check-in only<br>' +
        'Viewer: Dashboard read-only' +
      '</div>',
      '<button class="btn btn-primary" onclick="window.createAdmin()">Grant Access</button>');
  });

  window.createAdmin = async function () {
    if (!isSuperAdmin()) return;
    const email = $("#adE").value.trim().toLowerCase();
    const pass = $("#adP").value;
    if (!email || !pass) { showToast("All fields required.", "error"); return; }
    if (pass.length < 8) { showToast("Password must be at least 8 characters.", "error"); return; }
    const db = getDb();
    try {
      const { error } = await db.rpc("create_admin", { p_email: email, p_password: pass, p_name: $("#adN").value, p_role: $("#adR").value });
      if (error) throw error;
      logAction("PROVISION", "admin_users", null, "Provisioned: " + email + " as " + $("#adR").value);
      closeModal(); showToast("Operator provisioned."); loadAdminsEditor();
    } catch (e) { showToast("Provisioning failed: " + e.message, "error"); }
  };

  window.editAdmin = async function (id) {
    if (!isSuperAdmin()) { denyAccess("admins"); return; }
    const db = getDb();
    const { data } = await db.from("admin_users").select("id,email,full_name,role,is_active").eq("id", id).single();
    if (!data) return;
    openModal("Edit Operator Clearance",
      '<div class="form-group"><label>Name</label><input id="adN" value="' + esc(data.full_name) + '"/></div>' +
      '<div class="form-group"><label>Email</label><input id="adE" value="' + esc(data.email) + '"/></div>' +
      '<div class="form-group"><label>Access Role</label><select id="adR">' +
        [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.EVENT_TREASURER, ROLES.EVENT_SECRETARY, ROLES.SCANNER, ROLES.VIEWER].map(r =>
          '<option value="' + r + '"' + (data.role === r ? " selected" : "") + '>' + getRoleLabel(r) + '</option>'
        ).join("") +
      '</select></div>' +
      '<div class="form-group"><label><input type="checkbox" id="adA"' + (data.is_active ? " checked" : "") + '/> Active Clearance</label></div>',
      '<button class="btn btn-primary" onclick="window.saveAdmin(\'' + id + '\')">Update Clearance</button>');
  };

  window.saveAdmin = async function (id) {
    if (!isSuperAdmin()) return;
    const db = getDb();
    const newRole = $("#adR").value;
    if (id === currentAdmin.id && (newRole !== ROLES.SUPER_ADMIN || !$("#adA").checked)) {
      showToast("You cannot remove your own Super Admin access or deactivate your own account.", "warning");
      return;
    }
    chk(await db.from("admin_users").update({ full_name: $("#adN").value.trim(), email: $("#adE").value.trim().toLowerCase(), role: newRole, is_active: $("#adA").checked }).eq("id", id));
    logAction("UPDATE", "admin_users", id, "Access modified: " + getRoleLabel(newRole));
    closeModal(); showToast("Access updated."); loadAdminsEditor();
  };

  // ==================== ACTIVITY LOG ====================
  async function loadActivityLog() {
    if (!hasPermission("activity")) { denyAccess("Audit Trail"); return; }
    const db = getDb(); if (!db) return;
    const { data } = await db.from("activity_log").select("*,admin_users(full_name)").order("created_at", { ascending: false }).limit(200);
    const tb = $("#activityTable tbody"); if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>' + formatDate(a.created_at) + '</td><td>' + esc(a.admin_users?.full_name || "System") + '</td>' +
      '<td><span class="status-badge blue">' + esc(a.action_type) + '</span></td>' +
      '<td>' + esc(a.entity_type) + '</td><td>' + esc(a.description) + '</td></tr>'
    ).join("");
  }

  // ==================== GENERIC DELETE ====================
  window.deleteItem = function (table, id) {
    const guards = {
      treasury_transactions: () => hasActionPermission("delete_transaction"),
      agenda: () => hasPermission("agenda"),
      treasure_hunt: () => hasPermission("treasure"),
      group_leaders: () => hasPermission("leaders"),
      food_menu: () => hasPermission("food"),
      announcements: () => hasPermission("announcements"),
      faqs: () => hasPermission("faqs")
    };
    if (!guards[table] || !guards[table]()) { denyAccess("Delete"); return; }
    confirmAction("Delete Record", "This action is irrevocable. Proceed?", async () => {
      const db = getDb();
      try {
        chk(await db.from(table).delete().eq("id", id));
        logAction("DELETE", table, id, "Record purged from " + table);
        showToast("Record removed.");
        const v = $(".view.active")?.id?.replace("view-", "");
        if (v) navigateTo(v);
      } catch (err) { showToast("Delete failed: " + (err.message || "error"), "error"); }
    }, true);
  };

  // ==================== EXCEL EXPORT ENGINE ====================
  // SheetJS is ~1 MB, so it is fetched on first export instead of blocking every page load
  let xlsxPromise = null;
  function ensureXlsx() {
    if (typeof XLSX !== "undefined") return Promise.resolve(true);
    if (!xlsxPromise) xlsxPromise = new Promise(resolve => {
      const s = document.createElement("script");
      s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
      s.onload = () => resolve(typeof XLSX !== "undefined");
      s.onerror = () => { xlsxPromise = null; resolve(false); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  async function exportExcel(data, name) {
    if (!hasActionPermission("export_data") && !hasActionPermission("export_treasury")) { denyAccess("Export"); return; }
    if (!data?.length) { showToast("No data to export.", "warning"); return; }
    if (!(await ensureXlsx())) { showToast("Export module could not be loaded. Check your connection.", "error"); return; }
    try {
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-width columns
      const colWidths = Object.keys(data[0]).map(key => {
        const maxLen = Math.max(key.length, ...data.map(row => String(row[key] || "").length));
        return { wch: Math.min(maxLen + 2, 40) };
      });
      ws['!cols'] = colWidths;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "AuditData");
      const ts = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, "ALTITUDE_" + name + "_" + ts + ".xlsx");
      showToast("Exported: " + data.length + " rows.");
      logAction("EXPORT", "system", null, "Exported " + name + " (" + data.length + " rows)");
    } catch (e) { showToast("Export failed.", "error"); }
  }

  // ==================== SEARCH & FILTER ENGINE ====================
  function initFilters() {
    // Members filter
    const ms = $("#membersSearch"), mst = $("#membersStatusFilter"), mf = $("#membersFoodFilter"), mg = $("#membersGroupFilter");
    const filterMembers = debounce(() => {
      if (!window._cache.members) return;
      const q = (ms?.value || "").toLowerCase();
      const st = mst?.value || "", fd = mf?.value || "", gp = mg?.value || "";
      renderMembersTable(window._cache.members.filter(m =>
        (!q || lc(m.full_name).includes(q) || lc(m.ri_id).includes(q) || (m.clubs?.club_name || "").toLowerCase().includes(q)) &&
        (!st || m.status === st) && (!fd || m.food_preference === fd) && (!gp || String(m.clubs?.group_number) === gp)
      ));
    }, 200);
    ms?.addEventListener("input", filterMembers);
    mst?.addEventListener("change", filterMembers);
    mf?.addEventListener("change", filterMembers);
    mg?.addEventListener("change", filterMembers);

    // Club Registrations filter
    const cs = $("#clubRegSearch"), cst = $("#clubRegStatusFilter");
    const filterCR = debounce(() => {
      if (!window._cache.registrations) return;
      const q = (cs?.value || "").toLowerCase();
      const st = cst?.value || "";
      renderClubRegTable(window._cache.registrations.filter(r =>
        (!q || lc(r.registrant_name).includes(q) || (r.clubs?.club_name || "").toLowerCase().includes(q) || lc(r.transaction_id).includes(q)) &&
        (!st || r.status === st)
      ));
    }, 200);
    cs?.addEventListener("input", filterCR);
    cst?.addEventListener("change", filterCR);

    // DC Registrations filter
    const ds = $("#dcRegSearch"), dst = $("#dcRegStatusFilter");
    const filterDC = debounce(() => {
      if (!window._cache.dcRegistrations) return;
      const q = (ds?.value || "").toLowerCase();
      const st = dst?.value || "";
      renderDcRegTable(window._cache.dcRegistrations.filter(r =>
        (!q || lc(r.full_name).includes(q) || lc(r.ri_id).includes(q) || (r.portfolio || "").toLowerCase().includes(q)) &&
        (!st || r.status === st)
      ));
    }, 200);
    ds?.addEventListener("input", filterDC);
    dst?.addEventListener("change", filterDC);

    // Clubs filter
    const cls = $("#clubsSearch"), clg = $("#clubsGroupFilter");
    const filterClubs = debounce(() => {
      if (!window._cache.clubs) return;
      const q = (cls?.value || "").toLowerCase();
      const gp = clg?.value || "";
      renderClubsTable(window._cache.clubs.filter(c =>
        (!q || lc(c.club_name).includes(q)) && (!gp || String(c.group_number) === gp)
      ));
    }, 200);
    cls?.addEventListener("input", filterClubs);
    clg?.addEventListener("change", filterClubs);

    // Attendance filter
    const ats = $("#attSearch"), atf = $("#attFilter");
    const filterAtt = debounce(() => {
      if (!window._cache.attendance) return;
      const q = (ats?.value || "").toLowerCase();
      const stat = atf?.value || "";
      renderAttendanceTable(window._cache.attendance.filter(a =>
        (!q || lc(a.full_name).includes(q) || lc(a.ri_id).includes(q)) &&
        (!stat || (stat === "attended" ? a.attendance_checked : !a.attendance_checked))
      ));
    }, 200);
    ats?.addEventListener("input", filterAtt);
    atf?.addEventListener("change", filterAtt);
  }

  // ==================== SAFE HANDLER WRAPPER ====================
  // These handlers run from inline onclick attributes. If a database call fails they would otherwise
  // fail silently (or leave the dialog in a confusing state) - report the problem instead.
  function wrapSafeHandlers() {
    [
      "updateClubLimit", "toggleClubActive", "verifyTransaction", "saveSiteContent",
      "createAgenda", "saveAgenda", "createColourHunt", "saveColourHunt",
      "createTreasure", "toggleClue", "saveTreasure",
      "createLeader", "saveLeader", "createFood", "saveFood",
      "createAnnouncement", "saveAnnouncement", "createFaq", "saveFaq", "saveAdmin"
    ].forEach(name => {
      const orig = window[name];
      if (typeof orig !== "function") return;
      window[name] = async function (...args) {
        try {
          return await orig.apply(this, args);
        } catch (err) {
          hideLoading();
          console.error("[" + name + "]", err);
          showToast("Action failed: " + (err && err.message ? err.message : "unknown error"), "error");
        }
      };
    });
  }

  // ==================== MOBILE TABLE LABELS ====================
  // Copies each column heading onto its cells (data-label) so CSS can render tables as stacked cards on phones.
  function initTableLabels() {
    const label = (table) => {
      const heads = Array.from(table.querySelectorAll("thead th")).map(th => th.textContent.trim());
      table.querySelectorAll("tbody tr").forEach(tr => {
        Array.from(tr.children).forEach((td, i) => {
          if (td.tagName === "TD" && !td.hasAttribute("colspan") && !td.hasAttribute("data-label")) td.setAttribute("data-label", heads[i] || "");
        });
      });
    };
    let queued = false;
    const run = () => { queued = false; $$(".admin-table").forEach(label); };
    new MutationObserver(muts => {
      if (queued || !muts.some(m => m.addedNodes.length)) return;
      queued = true; requestAnimationFrame(run);
    }).observe(document.body, { childList: true, subtree: true });
    run();
  }

  // ==================== INITIALIZATION ====================
  function init() {
    $("#loginForm")?.addEventListener("submit", handleLogin);
    $("#logoutBtn")?.addEventListener("click", logout);

    $$(".sidebar-link").forEach(link => {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        const v = this.dataset.view;
        if (v) navigateTo(v);
      });
    });

    $("#startScanBtn")?.addEventListener("click", startScanner);
    $("#stopScanBtn")?.addEventListener("click", stopScanner);

    // Export buttons
    $("#exportMembers")?.addEventListener("click", async () => {
      if (!hasActionPermission("export_data")) { denyAccess("Export"); return; }
      if (!window._cache.members || !window._cache.members.length) await loadAllMembers();
      exportExcel((window._cache.members || []).map(m => ({
        Code: m.member_code, Name: m.full_name, "RI ID": m.ri_id,
        Club: m.clubs?.club_name, Group: m.clubs?.group_number,
        Email: m.email, Phone: m.contact_number,
        Food: m.food_preference, Board: m.is_board_member ? "Yes" : "No",
        Status: m.status, Attended: m.attendance_checked ? "Yes" : "No",
        Registered: formatDate(m.created_at)
      })), "Members_Roster");
    });

    $("#exportAttendance")?.addEventListener("click", async () => {
      if (!hasActionPermission("export_data")) { denyAccess("Export"); return; }
      if (!window._cache.attendance || !window._cache.attendance.length) await loadAttendance();
      exportExcel((window._cache.attendance || []).map(a => ({
        Code: a.member_code, Name: a.full_name, "RI ID": a.ri_id, Club: a.club, Type: a.type,
        Attended: a.attendance_checked ? "Yes" : "No", Time: a.attendance_checked_at ? formatDate(a.attendance_checked_at) : ""
      })), "Attendance_Audit");
    });

    $("#exportClubReg")?.addEventListener("click", async () => {
      if (!hasActionPermission("export_data")) { denyAccess("Export"); return; }
      if (!window._cache.registrations || !window._cache.registrations.length) await loadClubRegistrations();
      exportExcel((window._cache.registrations || []).map(r => ({
        Code: r.registration_code, Club: r.clubs?.club_name, Registrant: r.registrant_name,
        Role: r.registrant_role, Email: r.registrant_email, Phone: r.registrant_phone,
        Members: r.total_members, Amount: r.total_amount, TxnID: r.transaction_id,
        Status: r.status, Date: formatDate(r.created_at)
      })), "Club_Submissions");
    });

    $("#exportDcReg")?.addEventListener("click", async () => {
      if (!hasActionPermission("export_data")) { denyAccess("Export"); return; }
      if (!window._cache.dcRegistrations || !window._cache.dcRegistrations.length) await loadDcRegistrations();
      exportExcel((window._cache.dcRegistrations || []).map(r => ({
        Code: r.registration_code, Name: r.full_name, "RI ID": r.ri_id,
        Portfolio: r.portfolio, Email: r.email, Phone: r.contact_number,
        Food: r.food_preference, TxnID: r.transaction_id, Status: r.status
      })), "DC_Submissions");
    });

    applyBindings();
    initFilters();
    initTableLabels();
    wrapSafeHandlers();
    if (typeof lucide !== "undefined") lucide.createIcons();

    // Resume an existing session only after everything is wired up
    if (checkSession()) waitForDb(() => showDashboard());

    console.log("[ALTITUDE CONSOLE v8.0] Enterprise RBAC Edition initialized.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
