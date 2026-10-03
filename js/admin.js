/**
 * ============================================================
 * ALTITUDE — QUANTUM ADMIN CONSOLE v8.0 ENTERPRISE RBAC EDITION
 * ============================================================
 * Advanced Role-Based Access Control · Treasury Isolation
 * Features:
 *   > 6-Tier Role Permission Matrix
 *   > Treasury restricted to: EVENT_TREASURER, EVENT_SECRETARY, SUPER_ADMIN
 *   > Registration Mgmt restricted to: EVENT_SECRETARY, ADMIN, SUPER_ADMIN
 *   > Scanner role limited to: QR Scanner + Attendance only
 *   > Viewer role: Read-only dashboard access
 *   > Dynamic sidebar injection based on permissions
 *   > Session fingerprinting & tamper detection
 *   > Audit trail with role context
 *   > Command palette filtered by permissions
 *   > Direct Gmail Webhook Integration (No Emojis)
 *   > Treasury Module with CA-Grade Reporting
 *   > Progressive UI with permission-gated actions
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
  const SESSION_HOURS = 8;
  const AUTO_REFRESH_INTERVAL = 30000;
  const REALTIME_ENABLED = true;

  // ==================== ROLE-BASED ACCESS CONTROL ====================
  const ROLES = {
    SUPER_ADMIN: "super_admin",
    ADMIN: "admin",
    EVENT_TREASURER: "event_treasurer",
    EVENT_SECRETARY: "event_secretary",
    SCANNER: "scanner",
    VIEWER: "viewer"
  };

  // Permission Matrix: Which roles can access which modules
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

  // Action-level permissions
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

  // Human-readable role labels
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
    const role = currentAdmin.role;
    const allowed = PERMISSION_MATRIX[module];
    return allowed ? allowed.includes(role) : false;
  }

  function hasActionPermission(action) {
    if (!currentAdmin) return false;
    const role = currentAdmin.role;
    const allowed = ACTION_PERMISSIONS[action];
    return allowed ? allowed.includes(role) : false;
  }

  function isSuperAdmin() {
    return currentAdmin?.role === ROLES.SUPER_ADMIN;
  }

  function getRoleLabel(role) {
    return ROLE_LABELS[role] || role.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function getRoleBadgeColor(role) {
    return ROLE_BADGE_COLORS[role] || "gray";
  }

  function denyAccess(moduleName) {
    showToast("Access Denied: You lack clearance for " + (moduleName || "this module") + ".", "error");
  }

  // ==================== DOM HELPERS ====================
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }

  // ==================== UI FEEDBACK ====================
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
    const content = modal?.querySelector(".modal-content");
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

  window.closeModal = function () { $("#adminModal").classList.remove("active"); };

  function confirmAction(title, message, callback, danger = false) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    $("#confirmDialog").classList.add("active");
    const btn = $("#confirmActionBtn");
    if (danger) btn.classList.add("btn-danger");
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
    if (!db || !currentAdmin) return;
    db.from("activity_log").insert({
      admin_id: currentAdmin.id,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      description: "[" + currentAdmin.role.toUpperCase() + "] " + description
    }).then(() => {}).catch(() => {});
  }

  // ==================== UTILITY ====================
  function formatDate(d, includeTime = true) {
    if (!d) return "—";
    try {
      const opts = { day: "2-digit", month: "short", year: "numeric" };
      if (includeTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
      return new Date(d).toLocaleDateString("en-IN", opts);
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
    return '<span class="status-badge ' + (c[s] || "gray") + '">' + s + '</span>';
  }

  function esc(str) {
    if (str === null || str === undefined) return "";
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
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
      await navigator.clipboard.writeText(text);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      console.log("[MAIL DISPATCHED]", payload.template, "->", payload.to_email);
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

      currentAdmin = data[0];
      currentAdmin.timestamp = Date.now();

      // Session fingerprint
      currentAdmin._fingerprint = btoa(navigator.userAgent + screen.width + screen.height);

      localStorage.setItem("altitude_admin", JSON.stringify(currentAdmin));

      db.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", currentAdmin.id);
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

  function checkSession() {
    const raw = localStorage.getItem("altitude_admin");
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      if (Date.now() - s.timestamp > SESSION_HOURS * 3600 * 1000) {
        localStorage.removeItem("altitude_admin");
        return false;
      }
      // Verify fingerprint
      const currentFP = btoa(navigator.userAgent + screen.width + screen.height);
      if (s._fingerprint && s._fingerprint !== currentFP) {
        console.warn("[SECURITY] Session fingerprint mismatch. Possible hijack.");
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

  // ==================== ROLE-BASED UI ENFORCEMENT ====================
  function applyRolePermissions() {
    const role = currentAdmin.role;

    // Hide sidebar links the user cannot access
    $$(".sidebar-link").forEach(link => {
      const view = link.dataset.view;
      if (view && !hasPermission(view)) {
        link.style.display = "none";
      } else {
        link.style.display = "";
      }
    });

    // Hide sidebar dividers that have no visible links after them
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

    // Role badge in sidebar footer
    const roleDisplay = $("#adminRole");
    if (roleDisplay) {
      roleDisplay.textContent = getRoleLabel(role);
      roleDisplay.style.color = role === ROLES.EVENT_TREASURER ? "#CE93D8" : 
                                 role === ROLES.EVENT_SECRETARY ? "#FFB74D" :
                                 role === ROLES.SCANNER ? "#FFF176" :
                                 role === ROLES.VIEWER ? "#90A4AE" : "#81C784";
    }

    console.log("[RBAC] Applied permissions for:", role, "->", getRoleLabel(role));
  }

  function logout() {
    logAction("LOGOUT", "admin_users", currentAdmin?.id, "Session terminated");
    stopAutoRefresh();
    stopRealtimeSubscriptions();
    localStorage.removeItem("altitude_admin");
    location.reload();
  }

  // ==================== ADVANCED UI INJECTION ====================
  function injectAdvancedUI() {
    const topbarActions = $(".topbar-actions");
    if (topbarActions && !$("#cmdPaletteBtn")) {
      let html = '<button class="btn-icon" id="cmdPaletteBtn" title="Command Terminal (Ctrl+K)"><i data-lucide="command"></i></button>';
      
      // Role indicator badge
      html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 12px;background:rgba(76,175,80,0.1);border:1px solid rgba(76,175,80,0.25);border-radius:6px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#A5D6A7;white-space:nowrap;" title="Current Access Level">' +
        '<span style="width:6px;height:6px;background:' + (currentAdmin.role === ROLES.SUPER_ADMIN ? '#4CAF50' : currentAdmin.role === ROLES.EVENT_TREASURER ? '#AB47BC' : '#FF9800') + ';border-radius:50%;display:inline-block;"></span>' +
        getRoleLabel(currentAdmin.role) +
      '</div>';
      
      topbarActions.insertAdjacentHTML("afterbegin", html);
      $("#cmdPaletteBtn")?.addEventListener("click", openCommandPalette);
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  // ==================== COMMAND PALETTE (Permission-Filtered) ====================
  function openCommandPalette() {
    if (commandPaletteOpen) return;
    commandPaletteOpen = true;

    const allCommands = [
      { name: "Dashboard Overview", icon: "layout-dashboard", view: "dashboard", action: () => navigateTo("dashboard") },
      { name: "Club Registrations", icon: "users-round", view: "clubReg", action: () => navigateTo("clubReg") },
      { name: "District Council", icon: "crown", view: "dcReg", action: () => navigateTo("dcReg") },
      { name: "All Members Ledger", icon: "user-check", view: "members", action: () => navigateTo("members") },
      { name: "Clubs Management", icon: "building-2", view: "clubs", action: () => navigateTo("clubs") },
      { name: "Attendance Roster", icon: "clipboard-check", view: "attendance", action: () => navigateTo("attendance") },
      { name: "QR Access Scanner", icon: "scan-line", view: "scanner", action: () => navigateTo("scanner") },
      { name: "Treasury & Accounts", icon: "indian-rupee", view: "treasury", action: () => navigateTo("treasury") },
      { name: "Content Architecture", icon: "file-text", view: "siteContent", action: () => navigateTo("siteContent") },
      { name: "Agenda Configuration", icon: "calendar-clock", view: "agenda", action: () => navigateTo("agenda") },
      { name: "System Audit Trail", icon: "activity", view: "activity", action: () => navigateTo("activity") },
      { name: "Export Financial Ledger", icon: "file-spreadsheet", view: "treasury", action: () => window.exportLedger && window.exportLedger() },
      { name: "Sync Registration Revenue", icon: "refresh-cw", view: "treasury", action: () => $("#syncRegRevenue")?.click() },
      { name: "Terminate Session", icon: "log-out", view: "dashboard", action: logout }
    ];

    // Filter commands by user permissions
    const commands = allCommands.filter(c => hasPermission(c.view));

    const html =
      '<div class="cmd-palette-search"><i data-lucide="search"></i><input type="text" id="cmdSearch" placeholder="Execute command..." autocomplete="off" /></div>' +
      '<div style="padding:4px 0 8px 14px;"><span style="font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.3);">ACCESS LEVEL: ' + getRoleLabel(currentAdmin.role).toUpperCase() + '</span></div>' +
      '<div id="cmdResults" class="cmd-results">' +
        commands.map((c, i) =>
          '<div class="cmd-item ' + (i === 0 ? "active" : "") + '" data-idx="' + i + '"><i data-lucide="' + c.icon + '"></i><span>' + c.name + '</span></div>'
        ).join("") +
      '</div>';

    openModal("Command Terminal", html, '<small style="color:var(--gray-400);">Arrow Keys to navigate | Enter to select | Esc to close</small>');

    setTimeout(() => {
      const search = $("#cmdSearch");
      if (search) {
        search.focus();
        search.addEventListener("input", () => filterCommands(commands));
        search.addEventListener("keydown", (e) => handleCmdKeydown(e, commands));
      }
      $$(".cmd-item").forEach(item => {
        item.addEventListener("click", () => {
          const idx = parseInt(item.dataset.idx);
          if (commands[idx]) { commands[idx].action(); closeCommandPalette(); }
        });
      });
    }, 100);
  }

  function filterCommands(commands) {
    const q = $("#cmdSearch").value.toLowerCase();
    const filtered = q ? commands.filter(c => c.name.toLowerCase().includes(q)) : commands;
    const results = $("#cmdResults");
    if (results) {
      results.innerHTML = filtered.length
        ? filtered.map((c, i) => '<div class="cmd-item ' + (i === 0 ? "active" : "") + '" data-idx="' + commands.indexOf(c) + '"><i data-lucide="' + c.icon + '"></i><span>' + c.name + '</span></div>').join("")
        : '<div style="text-align:center;padding:16px;color:var(--gray-400);">No authorized instructions matched.</div>';
      if (typeof lucide !== "undefined") lucide.createIcons();
      $$(".cmd-item").forEach(item => {
        item.addEventListener("click", () => {
          const idx = parseInt(item.dataset.idx);
          if (commands[idx]) { commands[idx].action(); closeCommandPalette(); }
        });
      });
    }
  }

  function handleCmdKeydown(e, commands) {
    const items = $$(".cmd-item");
    let activeIdx = Array.from(items).findIndex(i => i.classList.contains("active"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[activeIdx]?.classList.remove("active");
      activeIdx = (activeIdx + 1) % items.length;
      items[activeIdx]?.classList.add("active");
      items[activeIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[activeIdx]?.classList.remove("active");
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      items[activeIdx]?.classList.add("active");
      items[activeIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIdx];
      if (item) {
        const idx = parseInt(item.dataset.idx);
        if (commands[idx]) { commands[idx].action(); closeCommandPalette(); }
      }
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  }

  function closeCommandPalette() {
    commandPaletteOpen = false;
    closeModal();
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  function initKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
      if ($("#loginScreen").style.display !== "none") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        openCommandPalette();
      }
      else if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        const searchInputs = ["membersSearch", "clubRegSearch", "dcRegSearch", "clubsSearch", "trsSearch", "attSearch"];
        for (const id of searchInputs) {
          const el = document.getElementById(id);
          if (el && el.offsetParent !== null) { el.focus(); break; }
        }
      }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "R") {
        e.preventDefault();
        const view = $(".view.active")?.id?.replace("view-", "");
        if (view) navigateTo(view);
      }
      else if (e.key === "Escape") {
        const modal = $("#adminModal");
        const confirm = $("#confirmDialog");
        if (modal?.classList.contains("active")) closeModal();
        else if (confirm?.classList.contains("active")) closeConfirm();
      }
    });
  }

  // ==================== REALTIME SUBSCRIPTIONS ====================
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
    } catch (e) {
      console.error("[REALTIME ERROR]", e);
    }
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
      const activeView = $(".view.active")?.id?.replace("view-", "");
      if (activeView === "dashboard") loadDashboard();
      if (activeView === "treasury" && hasPermission("treasury")) loadTreasury();
    }, AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  }

  // ==================== NAVIGATION (Permission-Gated) ====================
  function navigateTo(view) {
    // Permission check
    if (!hasPermission(view)) {
      denyAccess(view);
      // Redirect to first allowed view
      const fallback = Object.keys(PERMISSION_MATRIX).find(v => hasPermission(v)) || "dashboard";
      if (fallback !== view) navigateTo(fallback);
      return;
    }

    $$(".view").forEach(v => v.classList.remove("active"));
    $$(".sidebar-link").forEach(l => l.classList.remove("active"));
    const target = $("#view-" + view);
    const link = $('[data-view="' + view + '"]');
    if (target) target.classList.add("active");
    if (link) link.classList.add("active");

    const titles = {
      dashboard: "Dashboard Overview",
      clubReg: "Club Registrations",
      dcReg: "District Council",
      members: "All Members Ledger",
      clubs: "Clubs Management",
      attendance: "Attendance Roster",
      scanner: "Access Scanner",
      treasury: "Treasury & Accounts",
      siteContent: "Content Architecture",
      agenda: "Agenda Configuration",
      colourHunt: "Colour Hunt Module",
      treasure: "Treasure Hunt Module",
      leaders: "Group Leaders",
      food: "Catering Management",
      announcements: "Announcements",
      faqs: "Knowledge Base",
      admins: "System Administrators",
      activity: "System Audit Trail"
    };
    $("#viewTitle").textContent = titles[view] || "Dashboard";

    const loaders = {
      dashboard: loadDashboard,
      clubReg: loadClubRegistrations,
      dcReg: loadDcRegistrations,
      members: loadAllMembers,
      clubs: loadClubsManagement,
      attendance: loadAttendance,
      treasury: loadTreasury,
      siteContent: loadSiteContentEditor,
      agenda: loadAgendaEditor,
      colourHunt: loadColourHuntEditor,
      treasure: loadTreasureEditor,
      leaders: loadLeadersEditor,
      food: loadFoodEditor,
      announcements: loadAnnouncementsEditor,
      faqs: loadFaqsEditor,
      admins: loadAdminsEditor,
      activity: loadActivityLog
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
        const timer = setInterval(() => {
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

      loadGroupDistribution();
      loadTopClubs();
      loadRecentActivity();
    } catch (err) { console.error(err); }
  }

  async function loadGroupDistribution() {
    const c = $("#groupDistribution");
    const db = getDb();
    if (!c || !db) return;
    let html = "";
    for (const g of [1, 2, 3, 4]) {
      const { data: clubs } = await db.from("clubs").select("id").eq("group_number", g);
      const ids = (clubs || []).map(x => x.id);
      let count = 0;
      if (ids.length) {
        const { count: ct } = await db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved").in("club_id", ids);
        count = ct || 0;
      }
      const pct = Math.min(Math.round((count / 75) * 100), 100);
      html += '<div class="group-bar"><div class="group-bar-label">Group ' + g + '</div><div class="group-bar-track"><div class="group-bar-fill" style="width:' + pct + '%"></div></div><div class="group-bar-count">' + count + '</div></div>';
    }
    c.innerHTML = html;
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

  // ==================== CLUB REGISTRATIONS (Permission-Gated Actions) ====================
  async function loadClubRegistrations() {
    if (!hasPermission("clubReg")) { denyAccess("Club Registrations"); return; }
    const db = getDb();
    if (!db) return;
    showLoading("Loading registration records...");
    try {
      const { data } = await db.from("registrations").select("*,clubs(club_name,group_number)").order("created_at", { ascending: false });
      window._cache.registrations = data || [];
      renderClubRegTable(window._cache.registrations);
    } catch (err) { console.error(err); }
    hideLoading();
  }

  function renderClubRegTable(data) {
    const tb = $("#clubRegTable tbody");
    if (!tb) return;
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No registrations recorded.</td></tr>';
      return;
    }
    const canApprove = hasActionPermission("approve_registration");
    const canReject = hasActionPermission("reject_registration");
    const canDelete = hasActionPermission("delete_registration");

    tb.innerHTML = data.map(r => {
      let actions = '<button class="btn-sm blue" onclick="window.viewRegDetails(\'' + r.id + '\')" title="View"><i data-lucide="eye"></i></button>';
      
      if (r.status === "pending") {
        if (canApprove) actions += '<button class="btn-sm green" onclick="window.approveReg(\'' + r.id + '\',\'club\')" title="Approve"><i data-lucide="check"></i></button>';
        if (canReject) actions += '<button class="btn-sm red" onclick="window.rejectReg(\'' + r.id + '\',\'club\')" title="Reject"><i data-lucide="x"></i></button>';
      } else {
        if (canDelete) actions += '<button class="btn-sm red" onclick="window.deleteReg(\'' + r.id + '\',\'club\')" title="Delete"><i data-lucide="trash-2"></i></button>';
      }

      return '<tr><td><code onclick="copyToClipboard(\'' + r.registration_code + '\')">' + esc(r.registration_code) + '</code></td>' +
        '<td>' + esc(r.clubs?.club_name || "—") + '<br><small>Group ' + (r.clubs?.group_number || "—") + '</small></td>' +
        '<td>' + esc(r.registrant_name) + '<br><small>' + esc(r.registrant_email) + '</small></td>' +
        '<td>' + r.registrant_role + '</td>' +
        '<td><strong>' + r.total_members + '</strong></td>' +
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
    showLoading();
    const { data: r } = await db.from("registrations").select("*,clubs(club_name)").eq("id", id).single();
    const { data: m } = await db.from("members").select("*").eq("registration_id", id);
    hideLoading();
    if (!r) return;
    let h = '<div class="detail-grid">' +
      '<div><strong>Code:</strong> ' + r.registration_code + '</div>' +
      '<div><strong>Club:</strong> ' + esc(r.clubs?.club_name) + '</div>' +
      '<div><strong>Registrant:</strong> ' + esc(r.registrant_name) + ' (' + r.registrant_role + ')</div>' +
      '<div><strong>Email:</strong> ' + esc(r.registrant_email) + '</div>' +
      '<div><strong>Phone:</strong> ' + r.registrant_phone + '</div>' +
      '<div><strong>RI ID:</strong> ' + r.registrant_ri_id + '</div>' +
      '<div><strong>Amount:</strong> ₹' + (Number(r.total_amount) || 0).toLocaleString("en-IN") + '</div>' +
      '<div><strong>Txn ID:</strong> ' + esc(r.transaction_id) + '</div>' +
      '<div><strong>Status:</strong> ' + statusBadge(r.status) + '</div>' +
      '<div><strong>Registered:</strong> ' + formatDate(r.created_at) + '</div>' +
      (r.verified_at ? '<div><strong>Verified:</strong> ' + formatDate(r.verified_at) + '</div>' : '') +
      (r.rejection_reason ? '<div class="full-width"><strong>Rejection:</strong> ' + esc(r.rejection_reason) + '</div>' : '') +
      '</div>';
    if (r.payment_screenshot_url && !r.payment_screenshot_url.startsWith("upload_failed")) {
      h += '<div style="margin-top:16px;"><strong>Payment Proof:</strong><br><a href="' + r.payment_screenshot_url + '" target="_blank"><img src="' + r.payment_screenshot_url + '" style="max-width:100%;max-height:400px;border-radius:8px;margin-top:8px;border:1px solid #e0e4e8;"/></a></div>';
    }
    if (m && m.length) {
      h += '<h4 style="margin-top:20px;">Enrolled Delegates (' + m.length + ')</h4><div style="overflow-x:auto;"><table class="admin-table compact" style="margin-top:8px;min-width:600px;"><thead><tr><th>Name</th><th>RI ID</th><th>Contact</th><th>Food</th><th>Board</th><th>Status</th></tr></thead><tbody>';
      m.forEach(x => {
        h += '<tr><td>' + esc(x.full_name) + '</td><td>' + x.ri_id + '</td><td>' + esc(x.email) + '<br><small>' + x.contact_number + '</small></td><td>' + x.food_preference + '</td><td>' + (x.is_board_member ? "Yes" : "No") + '</td><td>' + statusBadge(x.status) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    openModal("Registration Dossier — " + r.registration_code, h, "", "large");
  };

  window.approveReg = function (id, type) {
    if (!hasActionPermission("approve_registration")) { denyAccess("Approve Registration"); return; }
    confirmAction("Authorize Registration", "Approve submission? Delegates will receive event pass credentials.", async () => {
      showLoading("Authorizing & dispatching passes...");
      const db = getDb();
      try {
        let emailsSent = 0, emailsFailed = 0;
        if (type === "club") {
          const { data: reg } = await db.from("registrations").select("*,clubs(club_name)").eq("id", id).single();
          if (!reg) throw new Error("Record not found.");
          await db.from("registrations").update({ status: "approved", verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          await db.from("members").update({ status: "approved" }).eq("registration_id", id);
          const { data: members } = await db.from("members").select("*").eq("registration_id", id);
          if (members) {
            for (const m of members) {
              const ok = await sendApprovalEmail(m, reg.clubs?.club_name);
              ok ? emailsSent++ : emailsFailed++;
            }
          }
        } else {
          const { data: dc } = await db.from("district_council_registrations").select("*").eq("id", id).single();
          if (!dc) throw new Error("Record not found.");
          await db.from("district_council_registrations").update({ status: "approved", verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          const ok = await sendApprovalEmail(dc, dc.portfolio || "District Council");
          ok ? emailsSent++ : emailsFailed++;
        }
        logAction("APPROVE", type, id, "Authorized. Dispatched: " + emailsSent);
        hideLoading();
        showToast("Approved: " + emailsSent + " credential(s) dispatched.");
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        hideLoading();
        showToast("Authorization failed: " + err.message, "error");
      }
    });
  };

  window.rejectReg = function (id, type) {
    if (!hasActionPermission("reject_registration")) { denyAccess("Reject Registration"); return; }
    const reason = prompt("Enter formal rejection reason:");
    if (!reason || !reason.trim()) return;
    confirmAction("Reject Submission", "Decline this submission and notify applicant?", async () => {
      showLoading("Updating records...");
      const db = getDb();
      try {
        let emailsSent = 0;
        if (type === "club") {
          await db.from("registrations").update({ status: "rejected", rejection_reason: reason, verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          await db.from("members").update({ status: "rejected" }).eq("registration_id", id);
          const { data: members } = await db.from("members").select("*").eq("registration_id", id);
          if (members) for (const m of members) { await sendRejectionEmail(m, reason); emailsSent++; }
        } else {
          const { data: dc } = await db.from("district_council_registrations").select("*").eq("id", id).single();
          await db.from("district_council_registrations").update({ status: "rejected", rejection_reason: reason, verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          if (dc) { await sendRejectionEmail(dc, reason); emailsSent++; }
        }
        logAction("REJECT", type, id, "Declined: " + reason);
        hideLoading();
        showToast("Rejected: " + emailsSent + " notice(s) dispatched.");
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) { hideLoading(); showToast("Operation failed.", "error"); }
    }, true);
  };

  window.deleteReg = function (id, type) {
    if (!hasActionPermission("delete_registration")) { denyAccess("Delete Registration"); return; }
    confirmAction("Irrevocable Deletion", "Permanently purge this record? This action cannot be undone.", async () => {
      const db = getDb();
      try {
        if (type === "club") {
          await db.from("members").delete().eq("registration_id", id);
          await db.from("registrations").delete().eq("id", id);
        } else {
          await db.from("district_council_registrations").delete().eq("id", id);
        }
        logAction("DELETE", type, id, "Permanently purged.");
        showToast("Record removed.");
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) { showToast("Purge failed.", "error"); }
    }, true);
  };

  // ==================== DC REGISTRATIONS ====================
  async function loadDcRegistrations() {
    if (!hasPermission("dcReg")) { denyAccess("District Council"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    const { data } = await db.from("district_council_registrations").select("*").order("created_at", { ascending: false });
    window._cache.dcRegistrations = data || [];
    renderDcRegTable(window._cache.dcRegistrations);
    hideLoading();
  }

  function renderDcRegTable(data) {
    const tb = $("#dcRegTable tbody");
    if (!tb) return;
    if (!data.length) { tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px;">No DC records.</td></tr>'; return; }
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
      return '<tr><td><code>' + esc(r.registration_code) + '</code></td><td>' + esc(r.full_name) + '</td><td>' + r.ri_id + '</td><td>' + esc(r.portfolio) + '</td><td>' + r.contact_number + '<br><small>' + esc(r.email) + '</small></td><td>' + r.food_preference + '</td><td><code>' + esc(r.transaction_id) + '</code></td><td>' + statusBadge(r.status) + '</td><td><div class="action-btns">' + actions + '</div></td></tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.viewDcDetails = async function (id) {
    const db = getDb();
    const { data } = await db.from("district_council_registrations").select("*").eq("id", id).single();
    if (!data) return;
    let h = '<div class="detail-grid">' +
      '<div><strong>Code:</strong> ' + data.registration_code + '</div><div><strong>Name:</strong> ' + esc(data.full_name) + '</div>' +
      '<div><strong>RI ID:</strong> ' + data.ri_id + '</div><div><strong>Portfolio:</strong> ' + esc(data.portfolio) + '</div>' +
      '<div><strong>Club:</strong> ' + esc(data.club_name || "—") + '</div><div><strong>Email:</strong> ' + esc(data.email) + '</div>' +
      '<div><strong>Phone:</strong> ' + data.contact_number + '</div><div><strong>Food:</strong> ' + data.food_preference + '</div>' +
      '<div><strong>Fee:</strong> ₹' + (Number(data.registration_fee) || 0) + '</div><div><strong>Txn:</strong> ' + esc(data.transaction_id) + '</div>' +
      '<div><strong>Status:</strong> ' + statusBadge(data.status) + '</div><div><strong>Date:</strong> ' + formatDate(data.created_at) + '</div>' +
      '</div>';
    if (data.payment_screenshot_url && !data.payment_screenshot_url.startsWith("upload_failed")) {
      h += '<div style="margin-top:16px;"><a href="' + data.payment_screenshot_url + '" target="_blank"><img src="' + data.payment_screenshot_url + '" style="max-width:100%;max-height:400px;border-radius:8px;border:1px solid #e0e4e8;"/></a></div>';
    }
    openModal("DC Dossier — " + data.registration_code, h, "", "large");
  };

  // ==================== MEMBERS ====================
  async function loadAllMembers() {
    if (!hasPermission("members")) { denyAccess("Members Ledger"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    const { data } = await db.from("members").select("*,clubs(club_name,group_number),registrations(registration_code)").order("created_at", { ascending: false });
    window._cache.members = data || [];
    renderMembersTable(window._cache.members);
    hideLoading();
  }

  function renderMembersTable(data) {
    const tb = $("#membersTable tbody");
    if (!tb) return;
    if (!data.length) { tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No delegates enrolled.</td></tr>'; return; }
    tb.innerHTML = data.map(m =>
      '<tr><td><code onclick="copyToClipboard(\'' + m.member_code + '\')">' + esc(m.member_code) + '</code></td>' +
      '<td>' + esc(m.full_name) + '</td><td>' + m.ri_id + '</td>' +
      '<td>' + esc(m.clubs?.club_name || "—") + '</td><td>G' + (m.clubs?.group_number || "—") + '</td>' +
      '<td><span class="food-badge ' + (m.food_preference === "VEG" ? "veg" : "nonveg") + '">' + m.food_preference + '</span></td>' +
      '<td>' + (m.is_board_member ? "Yes" : "No") + '</td><td>' + statusBadge(m.status) + '</td>' +
      '<td>' + (m.attendance_checked ? '<span class="status-badge green">Present</span>' : '<span class="status-badge gray">Absent</span>') + '</td>' +
      '<td><button class="btn-sm blue" onclick="window.viewMemberDetail(\'' + m.id + '\')"><i data-lucide="eye"></i></button></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.viewMemberDetail = async function (id) {
    const db = getDb();
    const { data: m } = await db.from("members").select("*,clubs(club_name,group_number)").eq("id", id).single();
    if (!m) return;
    openModal("Delegate Profile — " + m.full_name,
      '<div class="detail-grid">' +
        '<div><strong>Code:</strong> ' + m.member_code + '</div><div><strong>Name:</strong> ' + esc(m.full_name) + '</div>' +
        '<div><strong>RI ID:</strong> ' + m.ri_id + '</div><div><strong>Email:</strong> ' + esc(m.email) + '</div>' +
        '<div><strong>Phone:</strong> ' + m.contact_number + '</div><div><strong>Club:</strong> ' + esc(m.clubs?.club_name) + '</div>' +
        '<div><strong>Group:</strong> ' + m.clubs?.group_number + '</div><div><strong>Food:</strong> ' + m.food_preference + '</div>' +
        '<div><strong>Board:</strong> ' + (m.is_board_member ? "Yes" : "No") + '</div><div><strong>Status:</strong> ' + statusBadge(m.status) + '</div>' +
        '<div><strong>Attendance:</strong> ' + (m.attendance_checked ? formatDate(m.attendance_checked_at) : "Unchecked") + '</div>' +
        '<div class="full-width"><strong>Expectations:</strong> ' + esc(m.expectations || "—") + '</div></div>');
  };

  // ==================== CLUBS ====================
  async function loadClubsManagement() {
    if (!hasPermission("clubs")) { denyAccess("Clubs Management"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    const { data } = await db.from("clubs").select("*").order("group_number").order("club_name");
    window._cache.clubs = data || [];
    renderClubsTable(window._cache.clubs);
    hideLoading();
  }

  function renderClubsTable(data) {
    const tb = $("#clubsTable tbody");
    if (!tb) return;
    tb.innerHTML = data.map(c => {
      const av = c.max_registrations - c.current_registrations;
      const cls = av <= 0 ? "text-red" : av <= 2 ? "text-orange" : "";
      return '<tr><td>' + esc(c.club_name) + '</td><td>Group ' + c.group_number + '</td>' +
        '<td><input type="number" class="inline-input" value="' + c.max_registrations + '" data-club-id="' + c.id + '" min="0" max="50" onchange="window.updateClubLimit(this)"' + (!hasActionPermission("bulk_club_update") ? " disabled" : "") + '/></td>' +
        '<td>' + c.current_registrations + '</td><td class="' + cls + '">' + av + '</td>' +
        '<td>' + (c.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge red">Inactive</span>') + '</td>' +
        '<td><button class="btn-sm blue" onclick="window.toggleClubActive(\'' + c.id + '\',' + !c.is_active + ')"><i data-lucide="' + (c.is_active ? "eye-off" : "eye") + '"></i></button></td></tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.updateClubLimit = async function (el) {
    if (!hasActionPermission("bulk_club_update")) { denyAccess("Club Quota Update"); return; }
    const v = parseInt(el.value);
    if (isNaN(v) || v < 0) return;
    const db = getDb();
    await db.from("clubs").update({ max_registrations: v }).eq("id", el.dataset.clubId);
    logAction("UPDATE", "clubs", el.dataset.clubId, "Quota: " + v);
    showToast("Quota updated.");
  };

  window.toggleClubActive = async function (id, active) {
    if (!hasActionPermission("bulk_club_update")) { denyAccess("Club Status"); return; }
    const db = getDb();
    await db.from("clubs").update({ is_active: active }).eq("id", id);
    showToast(active ? "Activated." : "Deactivated.");
    loadClubsManagement();
  };

  $("#bulkUpdateLimit")?.addEventListener("click", () => {
    if (!hasActionPermission("bulk_club_update")) { denyAccess("Bulk Club Operations"); return; }
    openModal("Bulk Capacity Override",
      '<div class="form-group"><label>Quota per Club</label><input type="number" id="bulkLimitVal" min="0" max="50" value="10" /></div>' +
      '<div class="form-group"><label>Target Group</label><select id="bulkLimitGroup"><option value="">All Groups</option><option value="1">Group 1</option><option value="2">Group 2</option><option value="3">Group 3</option><option value="4">Group 4</option></select></div>',
      '<button class="btn btn-primary" onclick="window.bulkApplyLimit()">Apply Allocations</button>');
  });

  window.bulkApplyLimit = async function () {
    const val = parseInt($("#bulkLimitVal").value);
    const grp = $("#bulkLimitGroup").value;
    if (isNaN(val) || val < 0) { showToast("Invalid value.", "error"); return; }
    confirmAction("Confirm Allocation", "Apply " + val + " to " + (grp ? "Group " + grp : "all clubs") + "?", async () => {
      const db = getDb();
      try {
        let q = db.from("clubs").update({ max_registrations: val });
        if (grp) q = q.eq("group_number", parseInt(grp));
        else q = q.gte("group_number", 1);
        await q;
        logAction("BULK_UPDATE", "clubs", null, "Bulk: " + val);
        closeModal(); showToast("Applied."); loadClubsManagement();
      } catch (e) { showToast("Failed.", "error"); }
    });
  };

  // ==================== ATTENDANCE ====================
  async function loadAttendance() {
    if (!hasPermission("attendance")) { denyAccess("Attendance"); return; }
    const db = getDb();
    if (!db) return;
    showLoading();
    const { data: m } = await db.from("members").select("*,clubs(club_name)").eq("status", "approved").order("full_name");
    const { data: d } = await db.from("district_council_registrations").select("*").eq("status", "approved");
    const all = [
      ...(m || []).map(x => ({ ...x, type: "Club", club: x.clubs?.club_name })),
      ...(d || []).map(x => ({ ...x, type: "DC", club: x.portfolio }))
    ];
    window._cache.attendance = all;
    renderAttendanceTable(all);
    const ck = all.filter(a => a.attendance_checked).length;
    const tot = all.length;
    const summaryEl = $("#attSummary");
    if (summaryEl) summaryEl.innerHTML =
      '<div class="att-stat"><strong>' + tot + '</strong> Registered</div>' +
      '<div class="att-stat green"><strong>' + ck + '</strong> Checked In</div>' +
      '<div class="att-stat orange"><strong>' + (tot - ck) + '</strong> Pending</div>' +
      '<div class="att-stat blue"><strong>' + (tot ? Math.round(ck / tot * 100) : 0) + '%</strong> Yield</div>';
    hideLoading();
  }

  function renderAttendanceTable(data) {
    const tb = $("#attendanceTable tbody");
    if (!tb) return;
    tb.innerHTML = data.map(a =>
      '<tr class="' + (a.attendance_checked ? "row-checked" : "") + '"><td><code>' + (a.member_code || "—") + '</code></td>' +
      '<td>' + esc(a.full_name) + '</td><td>' + a.ri_id + '</td><td>' + esc(a.club || "—") + '</td><td>' + a.type + '</td>' +
      '<td>' + (a.attendance_checked ? '<span class="status-badge green">Present</span>' : '<span class="status-badge gray">Absent</span>') + '</td>' +
      '<td>' + (a.attendance_checked ? formatDate(a.attendance_checked_at) : "—") + '</td></tr>'
    ).join("");
  }

  // ==================== QR SCANNER ====================
  async function startScanner() {
    if (!hasActionPermission("checkin_member")) { denyAccess("Scanner"); return; }
    if (isScanning || typeof Html5Qrcode === "undefined") return;
    try {
      html5QrCode = new Html5Qrcode("qrReader");
      await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, () => {});
      isScanning = true;
      $("#startScanBtn").style.display = "none";
      $("#stopScanBtn").style.display = "inline-flex";
    } catch (err) { showToast("Camera initialization failed.", "error"); }
  }

  async function stopScanner() {
    if (html5QrCode && isScanning) {
      try { await html5QrCode.stop(); } catch (e) {}
      isScanning = false;
      $("#startScanBtn").style.display = "inline-flex";
      $("#stopScanBtn").style.display = "none";
    }
  }

  async function onScanSuccess(text) {
    const db = getDb();
    if (!db) return;
    await stopScanner();
    showLoading("Validating credential...");
    try {
      let { data: m } = await db.from("members").select("*,clubs(club_name,group_number)").eq("qr_code_data", text).maybeSingle();
      let tbl = "members";
      if (!m) {
        const { data: d } = await db.from("district_council_registrations").select("*").eq("qr_code_data", text).maybeSingle();
        if (d) { m = { ...d, clubs: { club_name: d.portfolio, group_number: "DC" } }; tbl = "district_council_registrations"; }
      }
      if (!m) { hideLoading(); showToast("Invalid credential token.", "error"); return; }
      if (m.attendance_checked) { hideLoading(); showToast("Delegate already checked in.", "warning"); return; }
      if (m.status !== "approved") { hideLoading(); showToast("Registration not cleared.", "error"); return; }
      await db.from(tbl).update({ attendance_checked: true, attendance_checked_at: new Date().toISOString(), attendance_checked_by: currentAdmin.id }).eq("id", m.id);
      logAction("CHECK_IN", tbl, m.id, m.full_name + " access verified.");
      hideLoading();
      showToast("Access Granted: " + m.full_name);
    } catch (err) { hideLoading(); showToast("Validation error.", "error"); }
  }

  // ==================== TREASURY (Permission-Gated) ====================
  async function loadTreasury() {
    if (!hasPermission("treasury")) { denyAccess("Treasury & Accounts"); return; }
    const db = getDb();
    if (!db) return;
    showLoading("Reconciling financial ledger...");
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
      const { data: txns } = await db.from("treasury_transactions").select("*").order("transaction_date", { ascending: false });
      window._cache.treasury = txns || [];
      renderTreasuryTable(window._cache.treasury);
      await loadBudgetVariance();
    } catch (err) { console.error("[TREASURY ERROR]", err); }
    hideLoading();
  }

  function renderTreasuryTable(data) {
    const tb = $("#treasuryTable tbody");
    if (!tb) return;
    if (!data.length) { tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No ledger entries.</td></tr>'; return; }
    const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN");
    const canEdit = hasActionPermission("edit_transaction");
    const canVerify = hasActionPermission("verify_transaction");
    const canDelete = hasActionPermission("delete_transaction");

    tb.innerHTML = data.map(t => {
      const typeLabel = t.transaction_type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      let actions = '<button class="btn-sm blue" onclick="window.viewTransaction(\'' + t.id + '\')" title="View"><i data-lucide="eye"></i></button>';
      if (canEdit) actions += '<button class="btn-sm blue" onclick="window.editTransaction(\'' + t.id + '\')" title="Edit"><i data-lucide="edit-3"></i></button>';
      if (!t.is_verified && canVerify) actions += '<button class="btn-sm green" onclick="window.verifyTransaction(\'' + t.id + '\')" title="Verify"><i data-lucide="check"></i></button>';
      if (canDelete) actions += '<button class="btn-sm red" onclick="window.deleteItem(\'treasury_transactions\',\'' + t.id + '\')" title="Delete"><i data-lucide="trash-2"></i></button>';

      return '<tr><td>' + formatDate(t.transaction_date, false) + '</td>' +
        '<td><strong>' + esc(t.description) + '</strong>' + (t.vendor_name ? '<br><small>' + esc(t.vendor_name) + '</small>' : '') + '</td>' +
        '<td><small>' + typeLabel + '</small></td><td>' + statusBadge(t.category.toLowerCase()) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;' + (t.category === "INCOME" ? "color:#2E7D32;" : t.category === "EXPENSE" ? "color:#C62828;" : "") + '">' + fmt(t.amount) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;">' + (t.gst_amount > 0 ? fmt(t.gst_amount) : "—") + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;">' + fmt(t.net_amount) + '</td>' +
        '<td><small>' + (t.payment_method || "—").replace(/_/g, " ") + '</small></td>' +
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
    (txns || []).forEach(t => { if (t.budget_head) actualByHead[t.budget_head] = (actualByHead[t.budget_head] || 0) + Math.abs(Number(t.net_amount)); });
    const container = $("#budgetVarianceTable");
    if (!container) return;
    const fmt = (v) => "₹" + Math.abs(Number(v) || 0).toLocaleString("en-IN");
    let html = '<table class="budget-variance-table"><thead><tr><th>Head</th><th>Class</th><th>Allocated</th><th>Actual</th><th>Variance</th><th>Utilization</th></tr></thead><tbody>';
    heads.forEach(h => {
      const allocated = Number(h.allocated_amount) || 0;
      const actual = Math.abs(actualByHead[h.head_name] || 0);
      const variance = allocated - actual;
      const pct = allocated > 0 ? Math.round((actual / allocated) * 100) : 0;
      html += '<tr><td><strong>' + esc(h.head_name) + '</strong></td><td>' + (h.category === "INCOME" ? '<span class="status-badge green">Income</span>' : '<span class="status-badge red">Expense</span>') + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;">' + fmt(allocated) + '</td><td style="font-family:JetBrains Mono,monospace;font-weight:700;">' + fmt(actual) + '</td>' +
        '<td class="' + (variance < 0 ? "variance-negative" : "variance-positive") + '">' + (variance < 0 ? "-" : "+") + fmt(variance) + '</td>' +
        '<td><div class="variance-bar"><div class="variance-bar-fill ' + (pct > 100 ? "over" : "under") + '" style="width:' + Math.min(pct, 100) + '%"></div></div><small>' + pct + '%</small></td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function getTransactionFormHtml(d) {
    const types = ['REGISTRATION_FEE','SPONSOR','DONATION','REFUND','VENUE_EXPENSE','FOOD_EXPENSE','TRANSPORT_EXPENSE','MERCHANDISE_EXPENSE','EQUIPMENT_EXPENSE','MARKETING_EXPENSE','PERMIT_EXPENSE','INSURANCE_EXPENSE','MISCELLANEOUS_EXPENSE','PRIZE_EXPENSE','CERTIFICATE_EXPENSE','OTHER_INCOME','OTHER_EXPENSE','ADVANCE_RECEIVED','ADVANCE_PAID','ADJUSTMENT'];
    const methods = ['BANK_TRANSFER','UPI','CASH','CHEQUE','CARD','ONLINE','INTERNAL'];
    return '<div class="trs-form-grid">' +
      '<div class="form-group"><label>Transaction Class *</label><select id="trsType" onchange="window.autoCategory()">' + types.map(t => '<option value="' + t + '"' + (d?.transaction_type === t ? " selected" : "") + '>' + t.replace(/_/g, " ") + '</option>').join("") + '</select></div>' +
      '<div class="form-group"><label>Ledger Category</label><select id="trsCat" onchange="window.calcNetAmount()">' + ["INCOME","EXPENSE","ADJUSTMENT"].map(c => '<option value="' + c + '"' + (d?.category === c ? " selected" : "") + '>' + c + '</option>').join("") + '</select></div>' +
      '<div class="form-group full-width"><label>Particulars *</label><input id="trsDesc" value="' + esc(d?.description || "") + '" placeholder="Transaction description"/></div>' +
      '<div class="form-group"><label>Base Amount (₹) *</label><input type="number" id="trsAmount" value="' + (d?.amount || "") + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>GST (₹)</label><input type="number" id="trsGstAmt" value="' + (d?.gst_amount || 0) + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>TDS (₹)</label><input type="number" id="trsTdsAmt" value="' + (d?.tds_amount || 0) + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>Net Settlement (₹)</label><input type="number" id="trsNetAmt" value="' + (d?.net_amount || "") + '" readonly style="font-weight:900;color:#2E7D32;"/></div>' +
      '<div class="form-group"><label>Payment Method</label><select id="trsMethod"><option value="">Select</option>' + methods.map(m => '<option value="' + m + '"' + (d?.payment_method === m ? " selected" : "") + '>' + m.replace(/_/g, " ") + '</option>').join("") + '</select></div>' +
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
    if (sel && data) sel.innerHTML = '<option value="">Select</option>' + data.map(h => '<option value="' + h.head_name + '"' + (selected === h.head_name ? " selected" : "") + '>' + h.head_name + '</option>').join("");
  }

  $("#addTransactionBtn")?.addEventListener("click", () => {
    if (!hasActionPermission("create_transaction")) { denyAccess("New Transaction"); return; }
    openModal("New Ledger Voucher", getTransactionFormHtml(), '<button class="btn btn-primary" onclick="window.saveNewTransaction()">Commit Entry</button>', "large");
    setTimeout(() => { loadBudgetHeadOptions(); window.calcNetAmount(); }, 100);
  });

  window.saveNewTransaction = async function () {
    if (!hasActionPermission("create_transaction")) { denyAccess("Create Transaction"); return; }
    const db = getDb(); if (!db) return;
    const desc = $("#trsDesc").value.trim();
    const amount = parseFloat($("#trsAmount").value);
    if (!desc || isNaN(amount) || amount <= 0) { showToast("Enter description and amount.", "error"); return; }
    showLoading("Committing...");
    try {
      await db.from("treasury_transactions").insert({
        transaction_type: $("#trsType").value, category: $("#trsCat").value, description: desc,
        reference_number: $("#trsRefNum").value || null, amount, gst_amount: parseFloat($("#trsGstAmt").value) || 0,
        tds_amount: parseFloat($("#trsTdsAmt").value) || 0, net_amount: parseFloat($("#trsNetAmt").value) || amount,
        payment_method: $("#trsMethod").value || null, payment_reference: $("#trsPayRef").value || null,
        vendor_name: $("#trsVendor").value || null, vendor_contact: $("#trsVendorContact").value || null,
        invoice_number: $("#trsInvoice").value || null, budget_head: $("#trsBudgetHead").value || null,
        notes: $("#trsNotes").value || null,
        transaction_date: $("#trsDate").value ? new Date($("#trsDate").value).toISOString() : new Date().toISOString(),
        created_by: currentAdmin.id
      });
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
    if (!hasActionPermission("edit_transaction")) { denyAccess("Edit Transaction"); return; }
    const db = getDb(); if (!db) return;
    showLoading();
    try {
      await db.from("treasury_transactions").update({
        transaction_type: $("#trsType").value, category: $("#trsCat").value, description: $("#trsDesc").value,
        reference_number: $("#trsRefNum").value || null, amount: parseFloat($("#trsAmount").value),
        gst_amount: parseFloat($("#trsGstAmt").value) || 0, tds_amount: parseFloat($("#trsTdsAmt").value) || 0,
        net_amount: parseFloat($("#trsNetAmt").value), payment_method: $("#trsMethod").value || null,
        payment_reference: $("#trsPayRef").value || null, vendor_name: $("#trsVendor").value || null,
        vendor_contact: $("#trsVendorContact").value || null, invoice_number: $("#trsInvoice").value || null,
        budget_head: $("#trsBudgetHead").value || null, notes: $("#trsNotes").value || null,
        transaction_date: $("#trsDate").value ? new Date($("#trsDate").value).toISOString() : undefined
      }).eq("id", id);
      logAction("UPDATE", "treasury", id, "Voucher updated.");
      closeModal(); hideLoading(); showToast("Saved."); loadTreasury();
    } catch (err) { hideLoading(); showToast("Failed.", "error"); }
  };

  window.viewTransaction = async function (id) {
    const db = getDb();
    const { data: t } = await db.from("treasury_transactions").select("*").eq("id", id).single();
    if (!t) return;
    const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
    openModal("Voucher Details",
      '<div class="detail-grid">' +
        '<div><strong>Date:</strong> ' + formatDate(t.transaction_date) + '</div><div><strong>Class:</strong> ' + t.transaction_type.replace(/_/g, " ") + '</div>' +
        '<div><strong>Category:</strong> ' + statusBadge(t.category.toLowerCase()) + '</div><div><strong>Base:</strong> ' + fmt(t.amount) + '</div>' +
        '<div><strong>GST:</strong> ' + fmt(t.gst_amount) + '</div><div><strong>TDS:</strong> ' + fmt(t.tds_amount) + '</div>' +
        '<div><strong>Net:</strong> <span style="font-weight:900;color:#2E7D32;">' + fmt(t.net_amount) + '</span></div>' +
        '<div><strong>Instrument:</strong> ' + (t.payment_method || "—").replace(/_/g, " ") + '</div>' +
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
    await db.from("treasury_transactions").update({ is_verified: true, verified_by: currentAdmin.id, verified_at: new Date().toISOString() }).eq("id", id);
    logAction("VERIFY", "treasury", id, "Voucher audited.");
    showToast("Verified."); loadTreasury();
  };

  $("#syncRegRevenue")?.addEventListener("click", () => {
    if (!hasActionPermission("sync_revenue")) { denyAccess("Revenue Sync"); return; }
    const db = getDb();
    if (!db) return;
    confirmAction("Reconcile Revenue", "Aggregate approved registrations into income ledger?", async () => {
      showLoading("Calculating...");
      try {
        const { count: mc } = await db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved");
        const { count: dc } = await db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved");
        const total = ((mc || 0) + (dc || 0)) * 3000;
        const { data: existing } = await db.from("treasury_transactions").select("id").eq("transaction_type", "REGISTRATION_FEE").eq("reference_number", "AUTO_SYNC").maybeSingle();
        const txnData = { transaction_type: "REGISTRATION_FEE", category: "INCOME", description: "Approved: " + (mc || 0) + " delegates + " + (dc || 0) + " DC", reference_number: "AUTO_SYNC", amount: total, net_amount: total, payment_method: "BANK_TRANSFER", budget_head: "Registration Fees", is_verified: true, verified_by: currentAdmin.id, verified_at: new Date().toISOString(), created_by: currentAdmin.id };
        if (existing) await db.from("treasury_transactions").update(txnData).eq("id", existing.id);
        else await db.from("treasury_transactions").insert(txnData);
        logAction("SYNC", "treasury", null, "Revenue: ₹" + total.toLocaleString("en-IN"));
        hideLoading(); showToast("Synced: ₹" + total.toLocaleString("en-IN")); loadTreasury();
      } catch (err) { hideLoading(); showToast("Sync failed.", "error"); }
    });
  });

  // Treasury Filters
  const trsSearch = $("#trsSearch"), trsCatF = $("#trsCategoryFilter"), trsVerF = $("#trsVerifiedFilter");
  const filterTreasury = debounce(() => {
    if (!window._cache.treasury) return;
    const q = (trsSearch?.value || "").toLowerCase();
    const cat = trsCatF?.value || "";
    const ver = trsVerF?.value || "";
    renderTreasuryTable(window._cache.treasury.filter(t =>
      (!q || t.description.toLowerCase().includes(q) || (t.vendor_name || "").toLowerCase().includes(q)) &&
      (!cat || t.category === cat) && (!ver || String(t.is_verified) === ver)
    ));
  }, 200);
  trsSearch?.addEventListener("input", filterTreasury);
  trsCatF?.addEventListener("change", filterTreasury);
  trsVerF?.addEventListener("change", filterTreasury);

  $("#exportTreasuryBtn")?.addEventListener("click", (e) => {
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

  // ==================== EXPORT FUNCTIONS ====================
  window.exportLedger = function () { if (!hasActionPermission("export_treasury")) return; exportExcel((window._cache.treasury || []).map(t => ({ Date: formatDate(t.transaction_date, false), Type: t.transaction_type, Category: t.category, Description: t.description, Vendor: t.vendor_name || "", Amount: t.amount, GST: t.gst_amount, TDS: t.tds_amount, Net: t.net_amount, Method: t.payment_method || "", Verified: t.is_verified ? "Yes" : "No" })), "Master_Ledger"); };
  window.exportIncomeStatement = function () { if (!hasActionPermission("export_treasury")) return; const inc = (window._cache.treasury || []).filter(t => t.category === "INCOME"); const exp = (window._cache.treasury || []).filter(t => t.category === "EXPENSE"); const ti = inc.reduce((s, t) => s + Number(t.net_amount), 0); const te = exp.reduce((s, t) => s + Number(t.net_amount), 0); exportExcel([...inc.map(t => ({ Category: "INCOME", Type: t.transaction_type, Description: t.description, Amount: t.net_amount })), { Category: "", Type: "", Description: "TOTAL INCOME", Amount: ti }, ...exp.map(t => ({ Category: "EXPENSE", Type: t.transaction_type, Description: t.description, Amount: t.net_amount })), { Category: "", Type: "", Description: "TOTAL EXPENSE", Amount: te }, { Category: "", Type: "", Description: "NET SURPLUS/(DEFICIT)", Amount: ti - te }], "Income_Statement"); };
  window.exportExpenseReport = function () { if (!hasActionPermission("export_treasury")) return; const expenses = (window._cache.treasury || []).filter(t => t.category === "EXPENSE"); const byType = {}; expenses.forEach(t => { if (!byType[t.transaction_type]) byType[t.transaction_type] = { count: 0, total: 0 }; byType[t.transaction_type].count++; byType[t.transaction_type].total += Number(t.net_amount); }); exportExcel([...Object.entries(byType).map(([k, v]) => ({ "Expense Type": k.replace(/_/g, " "), Vouchers: v.count, Total: v.total })), { "Expense Type": "GRAND TOTAL", Vouchers: expenses.length, Total: expenses.reduce((s, t) => s + Number(t.net_amount), 0) }], "Expense_Summary"); };
  window.exportBudgetVariance = async function () { if (!hasActionPermission("export_treasury")) return; const db = getDb(); const { data: heads } = await db.from("budget_heads").select("*").order("sort_order"); const { data: txns } = await db.from("treasury_transactions").select("budget_head,net_amount"); const m = {}; (txns || []).forEach(t => { if (t.budget_head) m[t.budget_head] = (m[t.budget_head] || 0) + Math.abs(Number(t.net_amount)); }); exportExcel((heads || []).map(h => ({ Head: h.head_name, Category: h.category, Allocated: Number(h.allocated_amount), Actual: m[h.head_name] || 0, Variance: Number(h.allocated_amount) - (m[h.head_name] || 0), "Util %": Number(h.allocated_amount) > 0 ? Math.round(((m[h.head_name] || 0) / Number(h.allocated_amount)) * 100) : 0 })), "Budget_Variance"); };
  window.exportCashFlow = function () { if (!hasActionPermission("export_treasury")) return; const byMonth = {}; (window._cache.treasury || []).forEach(t => { const month = new Date(t.transaction_date).toLocaleDateString("en-IN", { month: "short", year: "numeric" }); if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 }; if (t.category === "INCOME") byMonth[month].income += Number(t.net_amount); else if (t.category === "EXPENSE") byMonth[month].expense += Number(t.net_amount); }); exportExcel(Object.entries(byMonth).map(([m, v]) => ({ Period: m, Receipts: v.income, Outflows: v.expense, Net: v.income - v.expense })), "Cash_Flow"); };
  window.exportGSTReport = function () { if (!hasActionPermission("export_treasury")) return; const txns = (window._cache.treasury || []).filter(t => Number(t.gst_amount) > 0); exportExcel([...txns.map(t => ({ Date: formatDate(t.transaction_date, false), Description: t.description, Base: t.amount, GST: t.gst_amount, Invoice: t.invoice_number || "" })), { Date: "", Description: "TOTAL GST", Base: "", GST: txns.reduce((s, t) => s + Number(t.gst_amount), 0), Invoice: "" }], "GST_Audit"); };
  window.exportTDSReport = function () { if (!hasActionPermission("export_treasury")) return; const txns = (window._cache.treasury || []).filter(t => Number(t.tds_amount) > 0); exportExcel([...txns.map(t => ({ Date: formatDate(t.transaction_date, false), Particulars: t.description, Deductee: t.vendor_name || "", Gross: t.amount, TDS: t.tds_amount, Net: t.net_amount })), { Date: "", Particulars: "TOTAL TDS", Deductee: "", Gross: "", TDS: txns.reduce((s, t) => s + Number(t.tds_amount), 0), Net: "" }], "TDS_Report"); };
  window.exportReconciliation = function () { if (!hasActionPermission("export_treasury")) return; const data = (window._cache.treasury || []).map(t => ({ Date: formatDate(t.transaction_date, false), Particulars: t.description, Instrument: (t.payment_method || "").replace(/_/g, " "), Ref: t.payment_reference || "", Debit: t.category === "EXPENSE" ? t.net_amount : "", Credit: t.category === "INCOME" ? t.net_amount : "", Audited: t.is_verified ? "Yes" : "No" })); let bal = 0; data.forEach(d => { if (d.Credit) bal += Number(d.Credit); if (d.Debit) bal -= Number(d.Debit); d["Balance"] = bal; }); exportExcel(data, "Reconciliation"); };

  // ==================== SIMPLE EDITORS ====================
  async function loadSiteContentEditor() {
    if (!hasPermission("siteContent")) { denyAccess("Content Editor"); return; }
    const db = getDb(); const { data } = await db.from("site_content").select("*").order("section_key"); const c = $("#siteContentList"); if (!c || !data) return;
    c.innerHTML = data.map(s => '<div class="content-editor-card"><div class="content-editor-header"><h4>' + esc(s.section_key) + '</h4><button class="btn-sm blue" onclick="window.editSiteContent(\'' + s.id + '\',\'' + s.section_key + '\')"><i data-lucide="edit-3"></i></button></div><p><strong>Title:</strong> ' + esc(s.title || "—") + '</p><p>' + esc((s.content || "").substring(0, 120)) + '...</p></div>').join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.editSiteContent = async function (id, key) {
    if (!hasActionPermission("edit_site_content")) { denyAccess("Content Edit"); return; }
    const db = getDb(); const { data } = await db.from("site_content").select("*").eq("id", id).single(); if (!data) return;
    openModal("Edit: " + key, '<div class="form-group"><label>Header</label><input id="eT" value="' + esc(data.title || "") + '"/></div><div class="form-group"><label>Body</label><textarea id="eC" rows="5">' + esc(data.content || "") + '</textarea></div><div class="form-group"><label>JSON Attributes</label><textarea id="eE" rows="6" style="font-family:monospace;">' + JSON.stringify(data.extra_data || {}, null, 2) + '</textarea></div>', '<button class="btn btn-primary" onclick="window.saveSiteContent(\'' + id + '\')">Save</button>', "large");
  };

  window.saveSiteContent = async function (id) {
    let extra = {}; try { extra = JSON.parse($("#eE").value); } catch { showToast("Invalid JSON.", "error"); return; }
    const db = getDb(); await db.from("site_content").update({ title: $("#eT").value, content: $("#eC").value, extra_data: extra, updated_by: currentAdmin.id }).eq("id", id);
    logAction("UPDATE", "site_content", id, "Content updated."); closeModal(); showToast("Saved."); loadSiteContentEditor();
  };

  async function loadAgendaEditor() { if (!hasPermission("agenda")) return; const db = getDb(); const { data } = await db.from("agenda").select("*").order("day_number").order("sort_order"); const tb = $("#agendaTable tbody"); if (!tb) return; tb.innerHTML = (data || []).map(a => '<tr><td>Day ' + a.day_number + '</td><td>' + a.time_slot + '</td><td>' + esc(a.title) + '</td><td>' + esc(a.location || "—") + '</td><td>' + a.sort_order + '</td><td>' + (a.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge gray">Hidden</span>') + '</td><td><div class="action-btns"><button class="btn-sm blue" onclick="window.editAgenda(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button><button class="btn-sm red" onclick="window.deleteItem(\'agenda\',\'' + a.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  $("#addAgendaBtn")?.addEventListener("click", () => { if (!hasPermission("agenda")) return; openModal("Add Session", '<div class="form-grid"><div class="form-group"><label>Day</label><select id="aD"><option value="1">Day 1</option><option value="2">Day 2</option></select></div><div class="form-group"><label>Time</label><input id="aT"/></div><div class="form-group"><label>Title</label><input id="aTi"/></div><div class="form-group"><label>Location</label><input id="aL"/></div><div class="form-group full-width"><label>Details</label><textarea id="aDe" rows="3"></textarea></div><div class="form-group"><label>Order</label><input type="number" id="aO" value="0"/></div></div>', '<button class="btn btn-primary" onclick="window.createAgenda()">Create</button>'); });
  window.createAgenda = async function () { const db = getDb(); await db.from("agenda").insert({ day_number: parseInt($("#aD").value), time_slot: $("#aT").value, title: $("#aTi").value, location: $("#aL").value, description: $("#aDe").value, sort_order: parseInt($("#aO").value) || 0, event_date: $("#aD").value === "1" ? "2026-12-12" : "2026-12-13" }); closeModal(); showToast("Created."); loadAgendaEditor(); };
  window.editAgenda = async function (id) { const db = getDb(); const { data } = await db.from("agenda").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Session", '<div class="form-grid"><div class="form-group"><label>Day</label><select id="aD"><option value="1"' + (data.day_number === 1 ? " selected" : "") + '>1</option><option value="2"' + (data.day_number === 2 ? " selected" : "") + '>2</option></select></div><div class="form-group"><label>Time</label><input id="aT" value="' + data.time_slot + '"/></div><div class="form-group"><label>Title</label><input id="aTi" value="' + esc(data.title) + '"/></div><div class="form-group"><label>Location</label><input id="aL" value="' + esc(data.location || "") + '"/></div><div class="form-group full-width"><label>Details</label><textarea id="aDe" rows="3">' + esc(data.description || "") + '</textarea></div><div class="form-group"><label>Order</label><input type="number" id="aO" value="' + data.sort_order + '"/></div></div>', '<button class="btn btn-primary" onclick="window.saveAgenda(\'' + id + '\')">Save</button>'); };
  window.saveAgenda = async function (id) { const db = getDb(); await db.from("agenda").update({ day_number: parseInt($("#aD").value), time_slot: $("#aT").value, title: $("#aTi").value, location: $("#aL").value, description: $("#aDe").value, sort_order: parseInt($("#aO").value) || 0 }).eq("id", id); closeModal(); showToast("Saved."); loadAgendaEditor(); };

  async function loadColourHuntEditor() { if (!hasPermission("colourHunt")) return; const db = getDb(); const { data } = await db.from("colour_hunt").select("*").order("sort_order"); const c = $("#colourHuntList"); if (!c) return; if (!data?.length) { c.innerHTML = '<p style="text-align:center;padding:24px;color:#999;">No challenges.</p>'; return; } c.innerHTML = data.map(x => '<div class="content-editor-card"><h4>' + esc(x.title) + '</h4><p>' + esc((x.description || "").substring(0, 150)) + '...</p><button class="btn-sm blue" onclick="window.editColourHunt(\'' + x.id + '\')"><i data-lucide="edit-3"></i></button></div>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  $("#addColourHuntBtn")?.addEventListener("click", () => { openModal("Add Challenge", '<div class="form-group"><label>Title</label><input id="cT"/></div><div class="form-group"><label>Description</label><textarea id="cD" rows="4"></textarea></div><div class="form-group"><label>Rules</label><textarea id="cR" rows="5"></textarea></div><div class="form-group"><label>Tags</label><input id="cH"/></div>', '<button class="btn btn-primary" onclick="window.createColourHunt()">Save</button>'); });
  window.createColourHunt = async function () { const db = getDb(); await db.from("colour_hunt").insert({ title: $("#cT").value, description: $("#cD").value, rules: $("#cR").value, hashtags: $("#cH").value }); closeModal(); showToast("Added."); loadColourHuntEditor(); };
  window.editColourHunt = async function (id) { const db = getDb(); const { data } = await db.from("colour_hunt").select("*").eq("id", id).single(); if (!data) return; openModal("Edit", '<div class="form-group"><label>Title</label><input id="cT" value="' + esc(data.title) + '"/></div><div class="form-group"><label>Description</label><textarea id="cD" rows="4">' + esc(data.description) + '</textarea></div><div class="form-group"><label>Rules</label><textarea id="cR" rows="5">' + esc(data.rules || "") + '</textarea></div><div class="form-group"><label>Tags</label><input id="cH" value="' + esc(data.hashtags || "") + '"/></div>', '<button class="btn btn-primary" onclick="window.saveColourHunt(\'' + id + '\')">Save</button>'); };
  window.saveColourHunt = async function (id) { const db = getDb(); await db.from("colour_hunt").update({ title: $("#cT").value, description: $("#cD").value, rules: $("#cR").value, hashtags: $("#cH").value }).eq("id", id); closeModal(); showToast("Updated."); loadColourHuntEditor(); };

  async function loadTreasureEditor() { if (!hasPermission("treasure")) return; const db = getDb(); const { data } = await db.from("treasure_hunt").select("*").order("sort_order"); const tb = $("#treasureTable tbody"); if (!tb) return; if (!data?.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No clues.</td></tr>'; return; } tb.innerHTML = data.map(c => '<tr><td>' + c.clue_number + '</td><td>' + esc(c.clue_title) + '</td><td>Group ' + (c.group_number || "All") + '</td><td>' + esc((c.clue_text || "").substring(0, 60)) + '...</td><td>' + (c.is_revealed ? '<span class="status-badge green">Visible</span>' : '<span class="status-badge gray">Locked</span>') + '</td><td><div class="action-btns"><button class="btn-sm green" onclick="window.toggleClue(\'' + c.id + '\',' + !c.is_revealed + ')"><i data-lucide="' + (c.is_revealed ? "eye-off" : "eye") + '"></i></button><button class="btn-sm blue" onclick="window.editTreasure(\'' + c.id + '\')"><i data-lucide="edit-3"></i></button><button class="btn-sm red" onclick="window.deleteItem(\'treasure_hunt\',\'' + c.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  $("#addTreasureBtn")?.addEventListener("click", () => { openModal("Add Clue", '<div class="form-grid"><div class="form-group"><label>#</label><input type="number" id="tN" value="1"/></div><div class="form-group"><label>Title</label><input id="tT"/></div><div class="form-group full-width"><label>Text</label><textarea id="tX" rows="3"></textarea></div><div class="form-group"><label>Hint</label><input id="tH"/></div><div class="form-group"><label>Group</label><select id="tG"><option value="">All</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div></div>', '<button class="btn btn-primary" onclick="window.createTreasure()">Save</button>'); });
  window.createTreasure = async function () { const db = getDb(); await db.from("treasure_hunt").insert({ clue_number: parseInt($("#tN").value) || 1, clue_title: $("#tT").value, clue_text: $("#tX").value, hint: $("#tH").value, group_number: $("#tG").value ? parseInt($("#tG").value) : null }); closeModal(); showToast("Saved."); loadTreasureEditor(); };
  window.toggleClue = async function (id, reveal) { const db = getDb(); await db.from("treasure_hunt").update({ is_revealed: reveal }).eq("id", id); showToast(reveal ? "Unlocked." : "Locked."); loadTreasureEditor(); };
  window.editTreasure = async function (id) { const db = getDb(); const { data } = await db.from("treasure_hunt").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Clue", '<div class="form-grid"><div class="form-group"><label>#</label><input type="number" id="tN" value="' + data.clue_number + '"/></div><div class="form-group"><label>Title</label><input id="tT" value="' + esc(data.clue_title) + '"/></div><div class="form-group full-width"><label>Text</label><textarea id="tX" rows="3">' + esc(data.clue_text) + '</textarea></div><div class="form-group"><label>Hint</label><input id="tH" value="' + esc(data.hint || "") + '"/></div><div class="form-group"><label>Group</label><select id="tG"><option value="">All</option>' + [1,2,3,4].map(g => '<option value="' + g + '"' + (data.group_number === g ? " selected" : "") + '>' + g + '</option>').join("") + '</select></div></div>', '<button class="btn btn-primary" onclick="window.saveTreasure(\'' + id + '\')">Save</button>'); };
  window.saveTreasure = async function (id) { const db = getDb(); await db.from("treasure_hunt").update({ clue_number: parseInt($("#tN").value), clue_title: $("#tT").value, clue_text: $("#tX").value, hint: $("#tH").value, group_number: $("#tG").value ? parseInt($("#tG").value) : null }).eq("id", id); closeModal(); showToast("Saved."); loadTreasureEditor(); };

  async function loadLeadersEditor() { if (!hasPermission("leaders")) return; const db = getDb(); const { data } = await db.from("group_leaders").select("*").eq("is_active", true).order("group_number"); const tb = $("#leadersTable tbody"); if (!tb) return; if (!data?.length) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">No leaders.</td></tr>'; return; } tb.innerHTML = data.map(l => '<tr><td>Group ' + l.group_number + '</td><td>' + esc(l.leader_name) + '</td><td>' + esc(l.leader_role) + '</td><td>' + esc(l.leader_club || "—") + '</td><td>' + l.contact_number + '</td><td>' + (l.is_primary ? "Lead" : "Secondary") + '</td><td><div class="action-btns"><button class="btn-sm blue" onclick="window.editLeader(\'' + l.id + '\')"><i data-lucide="edit-3"></i></button><button class="btn-sm red" onclick="window.deleteItem(\'group_leaders\',\'' + l.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  $("#addLeaderBtn")?.addEventListener("click", () => { openModal("Appoint Leader", '<div class="form-grid"><div class="form-group"><label>Group</label><select id="lG"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div><div class="form-group"><label>Name</label><input id="lN"/></div><div class="form-group"><label>Role</label><input id="lR"/></div><div class="form-group"><label>Club</label><input id="lC"/></div><div class="form-group"><label>Phone</label><input id="lP"/></div><div class="form-group"><label>Email</label><input id="lE" type="email"/></div></div>', '<button class="btn btn-primary" onclick="window.createLeader()">Confirm</button>'); });
  window.createLeader = async function () { const db = getDb(); await db.from("group_leaders").insert({ group_number: parseInt($("#lG").value), leader_name: $("#lN").value, leader_role: $("#lR").value, leader_club: $("#lC").value, contact_number: $("#lP").value, email: $("#lE").value }); closeModal(); showToast("Appointed."); loadLeadersEditor(); };
  window.editLeader = async function (id) { const db = getDb(); const { data } = await db.from("group_leaders").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Leader", '<div class="form-grid"><div class="form-group"><label>Group</label><select id="lG">' + [1,2,3,4].map(g => '<option value="' + g + '"' + (data.group_number === g ? " selected" : "") + '>' + g + '</option>').join("") + '</select></div><div class="form-group"><label>Name</label><input id="lN" value="' + esc(data.leader_name) + '"/></div><div class="form-group"><label>Role</label><input id="lR" value="' + esc(data.leader_role) + '"/></div><div class="form-group"><label>Club</label><input id="lC" value="' + esc(data.leader_club || "") + '"/></div><div class="form-group"><label>Phone</label><input id="lP" value="' + data.contact_number + '"/></div><div class="form-group"><label>Email</label><input id="lE" value="' + esc(data.email || "") + '"/></div></div>', '<button class="btn btn-primary" onclick="window.saveLeader(\'' + id + '\')">Save</button>'); };
  window.saveLeader = async function (id) { const db = getDb(); await db.from("group_leaders").update({ group_number: parseInt($("#lG").value), leader_name: $("#lN").value, leader_role: $("#lR").value, leader_club: $("#lC").value, contact_number: $("#lP").value, email: $("#lE").value }).eq("id", id); closeModal(); showToast("Saved."); loadLeadersEditor(); };

  async function loadFoodEditor() { if (!hasPermission("food")) return; const db = getDb(); const { data } = await db.from("food_menu").select("*").order("day_number").order("sort_order"); const tb = $("#foodTable tbody"); if (!tb) return; if (!data?.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No items.</td></tr>'; return; } tb.innerHTML = data.map(f => '<tr><td>Day ' + f.day_number + '</td><td>' + f.meal_type + '</td><td><span class="food-badge ' + (f.food_type === "VEG" ? "veg" : "nonveg") + '">' + f.food_type + '</span></td><td>' + esc(f.item_name) + '</td><td>' + esc(f.description || "") + '</td><td><div class="action-btns"><button class="btn-sm blue" onclick="window.editFood(\'' + f.id + '\')"><i data-lucide="edit-3"></i></button><button class="btn-sm red" onclick="window.deleteItem(\'food_menu\',\'' + f.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  const foodFormHtml = (d) => '<div class="form-grid"><div class="form-group"><label>Day</label><select id="fD"><option value="1"' + (d?.day_number === 1 ? " selected" : "") + '>1</option><option value="2"' + (d?.day_number === 2 ? " selected" : "") + '>2</option></select></div><div class="form-group"><label>Meal</label><select id="fM">' + ["Breakfast","Lunch","Snacks","Dinner","Beverages"].map(x => '<option' + (d?.meal_type === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div><div class="form-group"><label>Type</label><select id="fT">' + ["VEG","NON-VEG","COMMON"].map(x => '<option value="' + x + '"' + (d?.food_type === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div><div class="form-group"><label>Item</label><input id="fN" value="' + esc(d?.item_name || "") + '"/></div><div class="form-group full-width"><label>Details</label><input id="fDe" value="' + esc(d?.description || "") + '"/></div></div>';
  $("#addFoodBtn")?.addEventListener("click", () => { openModal("Add Menu Item", foodFormHtml(), '<button class="btn btn-primary" onclick="window.createFood()">Post</button>'); });
  window.createFood = async function () { const db = getDb(); await db.from("food_menu").insert({ day_number: parseInt($("#fD").value), meal_type: $("#fM").value, food_type: $("#fT").value, item_name: $("#fN").value, description: $("#fDe").value }); closeModal(); showToast("Posted."); loadFoodEditor(); };
  window.editFood = async function (id) { const db = getDb(); const { data } = await db.from("food_menu").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Item", foodFormHtml(data), '<button class="btn btn-primary" onclick="window.saveFood(\'' + id + '\')">Save</button>'); };
  window.saveFood = async function (id) { const db = getDb(); await db.from("food_menu").update({ day_number: parseInt($("#fD").value), meal_type: $("#fM").value, food_type: $("#fT").value, item_name: $("#fN").value, description: $("#fDe").value }).eq("id", id); closeModal(); showToast("Saved."); loadFoodEditor(); };

  async function loadAnnouncementsEditor() { if (!hasPermission("announcements")) return; const db = getDb(); const { data } = await db.from("announcements").select("*").order("created_at", { ascending: false }); const c = $("#announcementsList"); if (!c) return; if (!data?.length) { c.innerHTML = '<p style="text-align:center;padding:24px;color:#999;">No bulletins.</p>'; return; } c.innerHTML = data.map(a => '<div class="content-editor-card"><div class="content-editor-header"><h4>' + esc(a.title) + ' <span class="status-badge ' + a.priority + '">' + a.priority.toUpperCase() + '</span></h4><div class="action-btns"><button class="btn-sm blue" onclick="window.editAnnouncement(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button><button class="btn-sm red" onclick="window.deleteItem(\'announcements\',\'' + a.id + '\')"><i data-lucide="trash-2"></i></button></div></div><p>' + esc(a.message) + '</p><small>' + (a.is_active ? "Active" : "Archived") + ' · ' + (a.show_on_homepage ? "Public" : "Internal") + '</small></div>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  const annFormHtml = (d) => '<div class="form-group"><label>Title</label><input id="anT" value="' + esc(d?.title || "") + '"/></div><div class="form-group"><label>Message</label><textarea id="anM" rows="4">' + esc(d?.message || "") + '</textarea></div><div class="form-group"><label>Severity</label><select id="anP">' + ["low","normal","high","urgent"].map(p => '<option value="' + p + '"' + (d?.priority === p ? " selected" : "") + '>' + p.toUpperCase() + '</option>').join("") + '</select></div><div class="form-group"><label><input type="checkbox" id="anA"' + (d?.is_active !== false ? " checked" : "") + '/> Active</label></div><div class="form-group"><label><input type="checkbox" id="anH"' + (d?.show_on_homepage !== false ? " checked" : "") + '/> Public Portal</label></div>';
  $("#addAnnouncementBtn")?.addEventListener("click", () => { openModal("Draft Bulletin", annFormHtml(), '<button class="btn btn-primary" onclick="window.createAnnouncement()">Publish</button>'); });
  window.createAnnouncement = async function () { const db = getDb(); await db.from("announcements").insert({ title: $("#anT").value, message: $("#anM").value, priority: $("#anP").value, is_active: $("#anA").checked, show_on_homepage: $("#anH").checked, created_by: currentAdmin.id }); closeModal(); showToast("Published."); loadAnnouncementsEditor(); };
  window.editAnnouncement = async function (id) { const db = getDb(); const { data } = await db.from("announcements").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Bulletin", annFormHtml(data), '<button class="btn btn-primary" onclick="window.saveAnnouncement(\'' + id + '\')">Save</button>'); };
  window.saveAnnouncement = async function (id) { const db = getDb(); await db.from("announcements").update({ title: $("#anT").value, message: $("#anM").value, priority: $("#anP").value, is_active: $("#anA").checked, show_on_homepage: $("#anH").checked }).eq("id", id); closeModal(); showToast("Saved."); loadAnnouncementsEditor(); };

  async function loadFaqsEditor() { if (!hasPermission("faqs")) return; const db = getDb(); const { data } = await db.from("faqs").select("*").order("sort_order"); const tb = $("#faqTable tbody"); if (!tb) return; if (!data?.length) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">No articles.</td></tr>'; return; } tb.innerHTML = data.map(f => '<tr><td>' + esc(f.question) + '</td><td>' + f.category + '</td><td>' + f.sort_order + '</td><td>' + (f.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge gray">Archived</span>') + '</td><td><div class="action-btns"><button class="btn-sm blue" onclick="window.editFaq(\'' + f.id + '\')"><i data-lucide="edit-3"></i></button><button class="btn-sm red" onclick="window.deleteItem(\'faqs\',\'' + f.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>').join(""); if (typeof lucide !== "undefined") lucide.createIcons(); }
  const faqFormHtml = (d) => '<div class="form-group"><label>Question</label><input id="fqQ" value="' + esc(d?.question || "") + '"/></div><div class="form-group"><label>Answer</label><textarea id="fqA" rows="4">' + esc(d?.answer || "") + '</textarea></div><div class="form-group"><label>Category</label><input id="fqC" value="' + (d?.category || "General") + '"/></div><div class="form-group"><label>Order</label><input type="number" id="fqO" value="' + (d?.sort_order || 0) + '"/></div>';
  $("#addFaqBtn")?.addEventListener("click", () => { openModal("Add Article", faqFormHtml(), '<button class="btn btn-primary" onclick="window.createFaq()">Post</button>'); });
  window.createFaq = async function () { const db = getDb(); await db.from("faqs").insert({ question: $("#fqQ").value, answer: $("#fqA").value, category: $("#fqC").value, sort_order: parseInt($("#fqO").value) || 0 }); closeModal(); showToast("Posted."); loadFaqsEditor(); };
  window.editFaq = async function (id) { const db = getDb(); const { data } = await db.from("faqs").select("*").eq("id", id).single(); if (!data) return; openModal("Edit Article", faqFormHtml(data), '<button class="btn btn-primary" onclick="window.saveFaq(\'' + id + '\')">Save</button>'); };
  window.saveFaq = async function (id) { const db = getDb(); await db.from("faqs").update({ question: $("#fqQ").value, answer: $("#fqA").value, category: $("#fqC").value, sort_order: parseInt($("#fqO").value) || 0 }).eq("id", id); closeModal(); showToast("Saved."); loadFaqsEditor(); };

  // ==================== ADMIN USERS (Super Admin Only) ====================
  async function loadAdminsEditor() {
    if (!hasPermission("admins")) { denyAccess("Admin Management"); return; }
    const db = getDb(); if (!db) return;
    const { data } = await db.from("admin_users").select("id,email,full_name,role,is_active,last_login").order("created_at");
    const tb = $("#adminsTable tbody"); if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>' + esc(a.full_name) + '</td><td>' + a.email + '</td>' +
      '<td><span class="status-badge ' + getRoleBadgeColor(a.role) + '">' + getRoleLabel(a.role) + '</span></td>' +
      '<td>' + (a.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge red">Inactive</span>') + '</td>' +
      '<td>' + formatDate(a.last_login) + '</td>' +
      '<td><button class="btn-sm blue" onclick="window.editAdmin(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  $("#addAdminBtn")?.addEventListener("click", () => {
    if (!isSuperAdmin()) { denyAccess("Admin Provisioning"); return; }
    openModal("Provision Operator",
      '<div class="form-group"><label>Full Name</label><input id="adN"/></div>' +
      '<div class="form-group"><label>Email Address</label><input id="adE" type="email"/></div>' +
      '<div class="form-group"><label>Password</label><input id="adP" type="password"/></div>' +
      '<div class="form-group"><label>Access Role</label><select id="adR">' +
        '<option value="admin">Administrator</option>' +
        '<option value="super_admin">Super Administrator</option>' +
        '<option value="event_treasurer">Event Treasurer</option>' +
        '<option value="event_secretary">Event Secretary</option>' +
        '<option value="scanner">Scanner Operator</option>' +
        '<option value="viewer">Read-Only Viewer</option>' +
      '</select></div>' +
      '<div style="margin-top:12px;padding:10px 14px;background:rgba(76,175,80,0.08);border:1px solid rgba(76,175,80,0.25);border-radius:8px;font-size:11px;color:#A5D6A7;line-height:1.6;">' +
        '<strong>Role Access Summary:</strong><br>' +
        'Super Admin: Full system control<br>' +
        'Administrator: Registrations, content, attendance<br>' +
        'Event Treasurer: Treasury, members (read)<br>' +
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
    const db = getDb();
    try {
      const { error } = await db.rpc("create_admin", { p_email: email, p_password: pass, p_name: $("#adN").value, p_role: $("#adR").value });
      if (error) throw error;
      logAction("PROVISION", "admin_users", null, "Provisioned: " + email + " as " + $("#adR").value);
      closeModal(); showToast("Operator provisioned."); loadAdminsEditor();
    } catch (e) { showToast("Provisioning failed: " + e.message, "error"); }
  };

  window.editAdmin = async function (id) {
    if (!isSuperAdmin()) { denyAccess("Edit Administrator"); return; }
    const db = getDb();
    const { data } = await db.from("admin_users").select("id,email,full_name,role,is_active").eq("id", id).single();
    if (!data) return;
    openModal("Edit Operator Clearance",
      '<div class="form-group"><label>Name</label><input id="adN" value="' + esc(data.full_name) + '"/></div>' +
      '<div class="form-group"><label>Email</label><input id="adE" value="' + data.email + '"/></div>' +
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
    await db.from("admin_users").update({ full_name: $("#adN").value, email: $("#adE").value, role: newRole, is_active: $("#adA").checked }).eq("id", id);
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
      '<td><span class="status-badge blue">' + a.action_type + '</span></td>' +
      '<td>' + a.entity_type + '</td><td>' + esc(a.description) + '</td></tr>'
    ).join("");
  }

  // ==================== GENERIC DELETE ====================
  window.deleteItem = function (table, id) {
    if (!isSuperAdmin() && table === "treasury_transactions" && !hasActionPermission("delete_transaction")) { denyAccess("Delete"); return; }
    confirmAction("Delete Record", "This action is irrevocable. Proceed?", async () => {
      const db = getDb();
      try {
        await db.from(table).delete().eq("id", id);
        logAction("DELETE", table, id, "Record purged.");
        showToast("Removed.");
        const v = $(".view.active")?.id?.replace("view-", "");
        if (v) navigateTo(v);
      } catch (err) { showToast("Failed.", "error"); }
    }, true);
  };

  function exportExcel(data, name) {
    if (!hasActionPermission("export_data") && !hasActionPermission("export_treasury")) { denyAccess("Export"); return; }
    if (typeof XLSX === "undefined") { showToast("Export module missing.", "error"); return; }
    if (!data?.length) { showToast("Empty dataset.", "warning"); return; }
    try {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "AuditData");
      XLSX.writeFile(wb, "ALTITUDE_" + name + "_" + new Date().toISOString().slice(0, 10) + ".xlsx");
      showToast("Exported: " + data.length + " rows.");
    } catch (e) { showToast("Export failed.", "error"); }
  }

  // ==================== FILTERS ====================
  function initFilters() {
    const ms = $("#membersSearch"), mst = $("#membersStatusFilter"), mf = $("#membersFoodFilter"), mg = $("#membersGroupFilter");
    const filterMembers = debounce(() => { if (!window._cache.members) return; const q = (ms?.value || "").toLowerCase(); const st = mst?.value || ""; const fd = mf?.value || ""; const gp = mg?.value || ""; renderMembersTable(window._cache.members.filter(m => (!q || m.full_name.toLowerCase().includes(q) || m.ri_id.toLowerCase().includes(q) || (m.clubs?.club_name || "").toLowerCase().includes(q)) && (!st || m.status === st) && (!fd || m.food_preference === fd) && (!gp || String(m.clubs?.group_number) === gp))); }, 200);
    ms?.addEventListener("input", filterMembers); mst?.addEventListener("change", filterMembers); mf?.addEventListener("change", filterMembers); mg?.addEventListener("change", filterMembers);

    const cs = $("#clubRegSearch"), cst = $("#clubRegStatusFilter");
    const filterCR = debounce(() => { if (!window._cache.registrations) return; const q = (cs?.value || "").toLowerCase(); const st = cst?.value || ""; renderClubRegTable(window._cache.registrations.filter(r => (!q || r.registrant_name.toLowerCase().includes(q) || (r.clubs?.club_name || "").toLowerCase().includes(q) || r.transaction_id.toLowerCase().includes(q)) && (!st || r.status === st))); }, 200);
    cs?.addEventListener("input", filterCR); cst?.addEventListener("change", filterCR);

    const ds = $("#dcRegSearch"), dst = $("#dcRegStatusFilter");
    const filterDC = debounce(() => { if (!window._cache.dcRegistrations) return; const q = (ds?.value || "").toLowerCase(); const st = dst?.value || ""; renderDcRegTable(window._cache.dcRegistrations.filter(r => (!q || r.full_name.toLowerCase().includes(q) || r.ri_id.toLowerCase().includes(q) || (r.portfolio || "").toLowerCase().includes(q)) && (!st || r.status === st))); }, 200);
    ds?.addEventListener("input", filterDC); dst?.addEventListener("change", filterDC);

    const cls = $("#clubsSearch"), clg = $("#clubsGroupFilter");
    const filterClubs = debounce(() => { if (!window._cache.clubs) return; const q = (cls?.value || "").toLowerCase(); const gp = clg?.value || ""; renderClubsTable(window._cache.clubs.filter(c => (!q || c.club_name.toLowerCase().includes(q)) && (!gp || String(c.group_number) === gp))); }, 200);
    cls?.addEventListener("input", filterClubs); clg?.addEventListener("change", filterClubs);

    const ats = $("#attSearch"), atf = $("#attFilter");
    const filterAtt = debounce(() => { if (!window._cache.attendance) return; const q = (ats?.value || "").toLowerCase(); const stat = atf?.value || ""; renderAttendanceTable(window._cache.attendance.filter(a => (!q || a.full_name.toLowerCase().includes(q) || a.ri_id.toLowerCase().includes(q)) && (!stat || (stat === "attended" ? a.attendance_checked : !a.attendance_checked)))); }, 200);
    ats?.addEventListener("input", filterAtt); atf?.addEventListener("change", filterAtt);
  }

  // ==================== INIT ====================
  function init() {
    if (checkSession()) showDashboard();

    $("#loginForm")?.addEventListener("submit", handleLogin);
    $("#logoutBtn")?.addEventListener("click", logout);

    $$(".sidebar-link").forEach(link => {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        navigateTo(this.dataset.view);
      });
    });

    $("#startScanBtn")?.addEventListener("click", startScanner);
    $("#stopScanBtn")?.addEventListener("click", stopScanner);

    $("#exportMembers")?.addEventListener("click", () => { if (!hasActionPermission("export_data")) return; exportExcel((window._cache.members || []).map(m => ({ Code: m.member_code, Name: m.full_name, "RI ID": m.ri_id, Club: m.clubs?.club_name, Group: m.clubs?.group_number, Email: m.email, Phone: m.contact_number, Food: m.food_preference, Board: m.is_board_member ? "Yes" : "No", Status: m.status, Attended: m.attendance_checked ? "Yes" : "No", Registered: formatDate(m.created_at) })), "Members_Roster"); });
    $("#exportAttendance")?.addEventListener("click", () => { if (!hasActionPermission("export_data")) return; exportExcel((window._cache.attendance || []).map(a => ({ Code: a.member_code, Name: a.full_name, "RI ID": a.ri_id, Club: a.club, Type: a.type, Attended: a.attendance_checked ? "Yes" : "No", Time: a.attendance_checked_at ? formatDate(a.attendance_checked_at) : "" })), "Attendance_Audit"); });
    $("#exportClubReg")?.addEventListener("click", () => { if (!hasActionPermission("export_data")) return; exportExcel((window._cache.registrations || []).map(r => ({ Code: r.registration_code, Club: r.clubs?.club_name, Registrant: r.registrant_name, Role: r.registrant_role, Email: r.registrant_email, Phone: r.registrant_phone, Members: r.total_members, Amount: r.total_amount, TxnID: r.transaction_id, Status: r.status, Date: formatDate(r.created_at) })), "Club_Submissions"); });
    $("#exportDcReg")?.addEventListener("click", () => { if (!hasActionPermission("export_data")) return; exportExcel((window._cache.dcRegistrations || []).map(r => ({ Code: r.registration_code, Name: r.full_name, "RI ID": r.ri_id, Portfolio: r.portfolio, Email: r.email, Phone: r.contact_number, Food: r.food_preference, TxnID: r.transaction_id, Status: r.status })), "DC_Submissions"); });

    initFilters();
    if (typeof lucide !== "undefined") lucide.createIcons();

    console.log("[ALTITUDE CONSOLE v8.0] Enterprise RBAC Edition initialized.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
