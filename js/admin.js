/**
 * ALTITUDE 2026 — QUANTUM ADMIN CONSOLE v7.0
 * Enterprise Management System with Treasury Module
 * Real-time sync · AI Insights · Bulk Ops · Command Palette · Advanced Analytics
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
  const EMAILJS_TEMPLATE_NOTIFICATION = "template_notification";

  const SESSION_HOURS = 8;
  const AUTO_REFRESH_INTERVAL = 30000;
  const REALTIME_ENABLED = true;

  // ==================== STATE ====================
  let currentAdmin = null;
  let html5QrCode = null;
  let isScanning = false;
  let autoRefreshTimer = null;
  let realtimeChannels = [];
  let notifications = [];

  window._cache = {
    members: [],
    clubs: [],
    registrations: [],
    dcRegistrations: [],
    attendance: [],
    treasury: [],
    stats: {}
  };

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

  function showLoading(text = "Loading...") {
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

  function logAction(actionType, entityType, entityId, description) {
    const db = getDb();
    if (!db || !currentAdmin) return;
    db.from("activity_log").insert({
      admin_id: currentAdmin.id,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      description: description
    }).then(() => {}).catch(() => {});
  }

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
      showToast("Copied to clipboard!");
    } catch {
      showToast("Copy failed", "error");
    }
  }
  window.copyToClipboard = copyToClipboard;

  // ==================== EMAIL DISPATCH ====================
  async function sendApprovalEmail(member, clubName) {
    if (typeof emailjs === "undefined" || !member.email) return false;
    try {
      const passLink = window.location.origin + "/pass.html?ri_id=" + encodeURIComponent(member.ri_id) + "&email=" + encodeURIComponent(member.email);
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_NOTIFICATION, {
        to_name: member.full_name,
        to_email: member.email,
        email_subject: "🎉 Registration Approved — ALTITUDE 2026",
        badge_text: "Registration Approved",
        heading: "Welcome to ALTITUDE 2026! 🏔️",
        main_message: "Congratulations! Your registration has been verified and approved. You are confirmed for the trekking event on December 12–13, 2026 at Ooty.",
        detail_1_label: "Registration ID",
        detail_1_val: member.ri_id,
        detail_2_label: "Club / Portfolio",
        detail_2_val: clubName || "N/A",
        detail_3_label: "Food Preference",
        detail_3_val: member.food_preference || "N/A",
        alert_display: "none",
        alert_message: "",
        button_display: "block",
        button_text: "🎫 Download Your Event Pass",
        button_url: passLink
      }, EMAILJS_PRIVATE_KEY);
      return true;
    } catch (e) { return false; }
  }

  async function sendRejectionEmail(member, reason) {
    if (typeof emailjs === "undefined" || !member.email) return false;
    try {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_NOTIFICATION, {
        to_name: member.full_name,
        to_email: member.email,
        email_subject: "⚠️ Registration Update — ALTITUDE 2026",
        badge_text: "Action Required",
        heading: "Registration Status Update",
        main_message: "We regret to inform you that your registration could not be approved at this time.",
        detail_1_label: "RI ID",
        detail_1_val: member.ri_id || "N/A",
        detail_2_label: "Status",
        detail_2_val: "Rejected",
        detail_3_label: "Contact",
        detail_3_val: "altitude3206@gmail.com",
        alert_display: "block",
        alert_message: reason || "Please contact us for details.",
        button_display: "none",
        button_text: "",
        button_url: ""
      }, EMAILJS_PRIVATE_KEY);
      return true;
    } catch (e) { return false; }
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
      errEl.textContent = "Please enter email and password.";
      errEl.style.display = "block";
      return;
    }

    showLoading("Authenticating...");
    errEl.style.display = "none";

    try {
      const { data, error } = await db.rpc("verify_admin", { p_email: email.toLowerCase(), p_password: password });
      if (error || !data || !data.length) throw new Error("Invalid email or password.");

      currentAdmin = data[0];
      currentAdmin.timestamp = Date.now();
      localStorage.setItem("altitude_admin", JSON.stringify(currentAdmin));

      db.from("admin_users").update({ last_login: new Date().toISOString() }).eq("id", currentAdmin.id);
      logAction("LOGIN", "admin_users", currentAdmin.id, "Admin logged in");

      hideLoading();
      showDashboard();
      showToast("Welcome back, " + currentAdmin.full_name);
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
    $("#adminRole").textContent = currentAdmin.role.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());

    if (currentAdmin.role !== "super_admin") {
      const al = $('[data-view="admins"]');
      if (al) al.style.display = "none";
    }

    navigateTo("dashboard");
    startAutoRefresh();
    initRealtimeSubscriptions();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function logout() {
    logAction("LOGOUT", "admin_users", currentAdmin?.id, "Admin logged out");
    stopAutoRefresh();
    stopRealtimeSubscriptions();
    localStorage.removeItem("altitude_admin");
    location.reload();
  }

  // ==================== REALTIME ====================
  function initRealtimeSubscriptions() {
    if (!REALTIME_ENABLED) return;
    const db = getDb();
    if (!db) return;
    try {
      const regChannel = db.channel("registrations-changes")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "registrations" }, () => {
          showToast("🔔 New registration received!", "success");
          if ($(".view.active")?.id === "view-dashboard") loadDashboard();
          if ($(".view.active")?.id === "view-clubReg") loadClubRegistrations();
        }).subscribe();
      realtimeChannels.push(regChannel);
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
      const activeView = $(".view.active")?.id?.replace("view-", "");
      if (activeView === "dashboard") loadDashboard();
      if (activeView === "treasury") loadTreasury();
    }, AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  }

  // ==================== NAVIGATION ====================
  function navigateTo(view) {
    $$(".view").forEach(v => v.classList.remove("active"));
    $$(".sidebar-link").forEach(l => l.classList.remove("active"));
    const target = $("#view-" + view);
    const link = $('[data-view="' + view + '"]');
    if (target) target.classList.add("active");
    if (link) link.classList.add("active");

    const titles = {
      dashboard: "Dashboard",
      clubReg: "Club Registrations",
      dcReg: "District Council",
      members: "All Members",
      clubs: "Clubs Management",
      attendance: "Attendance",
      scanner: "QR Scanner",
      treasury: "Treasury & Accounts",
      siteContent: "Site Content",
      agenda: "Agenda",
      colourHunt: "Colour Hunt",
      treasure: "Treasure Hunt",
      leaders: "Group Leaders",
      food: "Food Menu",
      announcements: "Announcements",
      faqs: "FAQs",
      admins: "Admin Users",
      activity: "Activity Log"
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
        const { count: ct } = await db.from("members").select("*", { count: "exact", head: true })
          .eq("status", "approved").in("club_id", ids);
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
      c.innerHTML = '<p style="color:#999;text-align:center;padding:14px;">No recent activity</p>';
      return;
    }
    c.innerHTML = data.map(a => {
      return '<div class="activity-item">' +
        '<div class="activity-action">' + esc(a.action_type) + '</div>' +
        '<div class="activity-desc">' + esc(a.description) + '</div>' +
        '<div class="activity-time">' + timeAgo(a.created_at) + '</div>' +
      '</div>';
    }).join("");
  }

  // ==================== CLUB REGISTRATIONS ====================
  async function loadClubRegistrations() {
    const db = getDb();
    if (!db) return;
    showLoading("Loading registrations...");
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
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No registrations found</td></tr>';
      return;
    }
    tb.innerHTML = data.map(r => {
      const actions = r.status === "pending"
        ? '<button class="btn-sm blue" onclick="window.viewRegDetails(\'' + r.id + '\')" title="View"><i data-lucide="eye"></i></button>' +
          '<button class="btn-sm green" onclick="window.approveReg(\'' + r.id + '\',\'club\')" title="Approve"><i data-lucide="check"></i></button>' +
          '<button class="btn-sm red" onclick="window.rejectReg(\'' + r.id + '\',\'club\')" title="Reject"><i data-lucide="x"></i></button>'
        : '<button class="btn-sm blue" onclick="window.viewRegDetails(\'' + r.id + '\')" title="View"><i data-lucide="eye"></i></button>' +
          '<button class="btn-sm red" onclick="window.deleteReg(\'' + r.id + '\',\'club\')" title="Delete"><i data-lucide="trash-2"></i></button>';
      return '<tr><td><code onclick="copyToClipboard(\'' + r.registration_code + '\')">' + esc(r.registration_code) + '</code></td>' +
        '<td>' + esc(r.clubs?.club_name || "—") + '<br><small>G' + (r.clubs?.group_number || "—") + '</small></td>' +
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
      (r.rejection_reason ? '<div class="full-width"><strong>Rejection Reason:</strong> ' + esc(r.rejection_reason) + '</div>' : '') +
      '</div>';
    if (r.payment_screenshot_url && !r.payment_screenshot_url.startsWith("upload_failed")) {
      h += '<div style="margin-top:16px;"><strong>Payment Screenshot:</strong><br><a href="' + r.payment_screenshot_url + '" target="_blank"><img src="' + r.payment_screenshot_url + '" style="max-width:100%;max-height:400px;border-radius:8px;margin-top:8px;border:1px solid #e0e4e8;"/></a></div>';
    }
    if (m && m.length) {
      h += '<h4 style="margin-top:20px;">Members (' + m.length + ')</h4><div style="overflow-x:auto;"><table class="admin-table compact" style="margin-top:8px;min-width:600px;"><thead><tr><th>Name</th><th>RI ID</th><th>Contact</th><th>Food</th><th>Board</th><th>Status</th></tr></thead><tbody>';
      m.forEach(x => {
        h += '<tr><td>' + esc(x.full_name) + '</td>' +
          '<td>' + x.ri_id + '</td>' +
          '<td>' + esc(x.email) + '<br><small>' + x.contact_number + '</small></td>' +
          '<td>' + x.food_preference + '</td>' +
          '<td>' + (x.is_board_member ? "Yes" : "No") + '</td>' +
          '<td>' + statusBadge(x.status) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    openModal("Registration — " + r.registration_code, h, "", "large");
  };

  window.approveReg = function (id, type) {
    confirmAction("Approve Registration", "Approve this registration? Members will receive confirmation emails.", async () => {
      showLoading("Approving & sending emails...");
      const db = getDb();
      try {
        let emailsSent = 0, emailsFailed = 0;
        if (type === "club") {
          const { data: reg } = await db.from("registrations").select("*,clubs(club_name)").eq("id", id).single();
          if (!reg) throw new Error("Not found");
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
          if (!dc) throw new Error("Not found");
          await db.from("district_council_registrations").update({ status: "approved", verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          const ok = await sendApprovalEmail(dc, dc.portfolio || "District Council");
          ok ? emailsSent++ : emailsFailed++;
        }
        logAction("APPROVE", type, id, "Approved. Emails: " + emailsSent);
        hideLoading();
        showToast("Approved! " + emailsSent + " email(s) sent" + (emailsFailed ? ", " + emailsFailed + " failed" : ""));
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        hideLoading();
        showToast("Failed: " + err.message, "error");
      }
    });
  };

  window.rejectReg = function (id, type) {
    const reason = prompt("Enter rejection reason (will be sent to member):");
    if (!reason || !reason.trim()) return;
    confirmAction("Reject Registration", "Reject this registration? Members will receive notification emails.", async () => {
      showLoading("Rejecting...");
      const db = getDb();
      try {
        let emailsSent = 0, emailsFailed = 0;
        if (type === "club") {
          await db.from("registrations").update({ status: "rejected", rejection_reason: reason, verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          await db.from("members").update({ status: "rejected" }).eq("registration_id", id);
          const { data: members } = await db.from("members").select("*").eq("registration_id", id);
          if (members) {
            for (const m of members) {
              const ok = await sendRejectionEmail(m, reason);
              ok ? emailsSent++ : emailsFailed++;
            }
          }
        } else {
          const { data: dc } = await db.from("district_council_registrations").select("*").eq("id", id).single();
          await db.from("district_council_registrations").update({ status: "rejected", rejection_reason: reason, verified_at: new Date().toISOString(), verified_by: currentAdmin.id }).eq("id", id);
          if (dc) {
            const ok = await sendRejectionEmail(dc, reason);
            ok ? emailsSent++ : emailsFailed++;
          }
        }
        logAction("REJECT", type, id, "Rejected: " + reason);
        hideLoading();
        showToast("Rejected. " + emailsSent + " email(s) sent");
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        hideLoading();
        showToast("Failed", "error");
      }
    }, true);
  };

  window.deleteReg = function (id, type) {
    confirmAction("Delete Permanently", "This will permanently delete this registration. Cannot be undone.", async () => {
      const db = getDb();
      try {
        if (type === "club") {
          await db.from("members").delete().eq("registration_id", id);
          await db.from("registrations").delete().eq("id", id);
        } else {
          await db.from("district_council_registrations").delete().eq("id", id);
        }
        logAction("DELETE", type, id, "Deleted");
        showToast("Deleted");
        type === "club" ? loadClubRegistrations() : loadDcRegistrations();
      } catch (err) {
        showToast("Delete failed", "error");
      }
    }, true);
  };

  // ==================== DC REGISTRATIONS ====================
  async function loadDcRegistrations() {
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
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:24px;">No DC registrations</td></tr>';
      return;
    }
    tb.innerHTML = data.map(r => {
      const actions = r.status === "pending"
        ? '<button class="btn-sm blue" onclick="window.viewDcDetails(\'' + r.id + '\')"><i data-lucide="eye"></i></button>' +
          '<button class="btn-sm green" onclick="window.approveReg(\'' + r.id + '\',\'dc\')"><i data-lucide="check"></i></button>' +
          '<button class="btn-sm red" onclick="window.rejectReg(\'' + r.id + '\',\'dc\')"><i data-lucide="x"></i></button>'
        : '<button class="btn-sm blue" onclick="window.viewDcDetails(\'' + r.id + '\')"><i data-lucide="eye"></i></button>' +
          '<button class="btn-sm red" onclick="window.deleteReg(\'' + r.id + '\',\'dc\')"><i data-lucide="trash-2"></i></button>';
      return '<tr><td><code>' + esc(r.registration_code) + '</code></td>' +
        '<td>' + esc(r.full_name) + '</td>' +
        '<td>' + r.ri_id + '</td>' +
        '<td>' + esc(r.portfolio) + '</td>' +
        '<td>' + r.contact_number + '<br><small>' + esc(r.email) + '</small></td>' +
        '<td>' + r.food_preference + '</td>' +
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
      '<div><strong>Code:</strong> ' + data.registration_code + '</div>' +
      '<div><strong>Name:</strong> ' + esc(data.full_name) + '</div>' +
      '<div><strong>RI ID:</strong> ' + data.ri_id + '</div>' +
      '<div><strong>Portfolio:</strong> ' + esc(data.portfolio) + '</div>' +
      '<div><strong>Home Club:</strong> ' + esc(data.club_name || "—") + '</div>' +
      '<div><strong>Email:</strong> ' + esc(data.email) + '</div>' +
      '<div><strong>Phone:</strong> ' + data.contact_number + '</div>' +
      '<div><strong>Food:</strong> ' + data.food_preference + '</div>' +
      '<div><strong>Fee:</strong> ₹' + (Number(data.registration_fee) || 0) + '</div>' +
      '<div><strong>Transaction:</strong> ' + esc(data.transaction_id) + '</div>' +
      '<div><strong>Status:</strong> ' + statusBadge(data.status) + '</div>' +
      '<div><strong>Registered:</strong> ' + formatDate(data.created_at) + '</div>' +
      (data.expectations ? '<div class="full-width"><strong>Expectations:</strong> ' + esc(data.expectations) + '</div>' : '') +
      (data.rejection_reason ? '<div class="full-width"><strong>Rejection Reason:</strong> ' + esc(data.rejection_reason) + '</div>' : '') +
      '</div>';
    if (data.payment_screenshot_url && !data.payment_screenshot_url.startsWith("upload_failed")) {
      h += '<div style="margin-top:16px;"><strong>Payment Screenshot:</strong><br><a href="' + data.payment_screenshot_url + '" target="_blank"><img src="' + data.payment_screenshot_url + '" style="max-width:100%;max-height:400px;border-radius:8px;margin-top:8px;border:1px solid #e0e4e8;"/></a></div>';
    }
    openModal("DC — " + data.registration_code, h, "", "large");
  };

  // ==================== MEMBERS ====================
  async function loadAllMembers() {
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
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No members found</td></tr>';
      return;
    }
    tb.innerHTML = data.map(m =>
      '<tr>' +
        '<td><code onclick="copyToClipboard(\'' + m.member_code + '\')">' + esc(m.member_code) + '</code></td>' +
        '<td>' + esc(m.full_name) + '</td>' +
        '<td>' + m.ri_id + '</td>' +
        '<td>' + esc(m.clubs?.club_name || "—") + '</td>' +
        '<td>G' + (m.clubs?.group_number || "—") + '</td>' +
        '<td><span class="food-badge ' + (m.food_preference === "VEG" ? "veg" : "nonveg") + '">' + m.food_preference + '</span></td>' +
        '<td>' + (m.is_board_member ? "Yes" : "No") + '</td>' +
        '<td>' + statusBadge(m.status) + '</td>' +
        '<td>' + (m.attendance_checked ? '<span class="status-badge green">Yes</span>' : '<span class="status-badge gray">No</span>') + '</td>' +
        '<td><button class="btn-sm blue" onclick="window.viewMemberDetail(\'' + m.id + '\')"><i data-lucide="eye"></i></button></td>' +
      '</tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.viewMemberDetail = async function (id) {
    const db = getDb();
    const { data: m } = await db.from("members").select("*,clubs(club_name,group_number)").eq("id", id).single();
    if (!m) return;
    openModal("Member — " + m.full_name,
      '<div class="detail-grid">' +
        '<div><strong>Code:</strong> ' + m.member_code + '</div>' +
        '<div><strong>Name:</strong> ' + esc(m.full_name) + '</div>' +
        '<div><strong>RI ID:</strong> ' + m.ri_id + '</div>' +
        '<div><strong>Email:</strong> ' + esc(m.email) + '</div>' +
        '<div><strong>Phone:</strong> ' + m.contact_number + '</div>' +
        '<div><strong>Club:</strong> ' + esc(m.clubs?.club_name) + '</div>' +
        '<div><strong>Group:</strong> ' + m.clubs?.group_number + '</div>' +
        '<div><strong>Food:</strong> ' + m.food_preference + '</div>' +
        '<div><strong>Board:</strong> ' + (m.is_board_member ? "Yes" : "No") + '</div>' +
        '<div><strong>Status:</strong> ' + statusBadge(m.status) + '</div>' +
        '<div><strong>Attendance:</strong> ' + (m.attendance_checked ? formatDate(m.attendance_checked_at) : "Not checked") + '</div>' +
        '<div class="full-width"><strong>Expectations:</strong> ' + esc(m.expectations || "—") + '</div>' +
      '</div>');
  };

  // ==================== CLUBS ====================
  async function loadClubsManagement() {
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
      return '<tr>' +
        '<td>' + esc(c.club_name) + '</td>' +
        '<td>Group ' + c.group_number + '</td>' +
        '<td><input type="number" class="inline-input" value="' + c.max_registrations + '" data-club-id="' + c.id + '" min="0" max="50" onchange="window.updateClubLimit(this)"/></td>' +
        '<td>' + c.current_registrations + '</td>' +
        '<td class="' + cls + '">' + av + '</td>' +
        '<td>' + (c.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge red">Inactive</span>') + '</td>' +
        '<td><button class="btn-sm blue" onclick="window.toggleClubActive(\'' + c.id + '\',' + !c.is_active + ')"><i data-lucide="' + (c.is_active ? "eye-off" : "eye") + '"></i></button></td>' +
      '</tr>';
    }).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.updateClubLimit = async function (el) {
    const v = parseInt(el.value);
    if (isNaN(v) || v < 0) return;
    const db = getDb();
    await db.from("clubs").update({ max_registrations: v }).eq("id", el.dataset.clubId);
    logAction("UPDATE", "clubs", el.dataset.clubId, "Max → " + v);
    showToast("Updated");
  };

  window.toggleClubActive = async function (id, active) {
    const db = getDb();
    await db.from("clubs").update({ is_active: active }).eq("id", id);
    showToast(active ? "Activated" : "Deactivated");
    loadClubsManagement();
  };

  $("#bulkUpdateLimit")?.addEventListener("click", () => {
    openModal("Bulk Update Club Limits",
      '<div class="form-group"><label>New Max Registration Limit</label><input type="number" id="bulkLimitVal" min="0" max="50" value="10" /></div>' +
      '<div class="form-group"><label>Filter by Group (optional)</label><select id="bulkLimitGroup"><option value="">All Groups</option><option value="1">Group 1</option><option value="2">Group 2</option><option value="3">Group 3</option><option value="4">Group 4</option></select></div>',
      '<button class="btn btn-primary" onclick="window.bulkApplyLimit()">Apply</button>');
  });

  window.bulkApplyLimit = async function () {
    const val = parseInt($("#bulkLimitVal").value);
    const grp = $("#bulkLimitGroup").value;
    if (isNaN(val) || val < 0) { showToast("Invalid number", "error"); return; }
    confirmAction("Confirm", "Apply " + val + " to " + (grp ? "Group " + grp : "ALL clubs") + "?", async () => {
      const db = getDb();
      try {
        let q = db.from("clubs").update({ max_registrations: val });
        if (grp) q = q.eq("group_number", parseInt(grp));
        else q = q.gte("group_number", 1);
        await q;
        logAction("BULK_UPDATE", "clubs", null, "Limit " + val);
        closeModal();
        showToast("Bulk update complete");
        loadClubsManagement();
      } catch (e) { showToast("Failed", "error"); }
    });
  };

  // ==================== ATTENDANCE ====================
  async function loadAttendance() {
    const db = getDb();
    if (!db) return;
    showLoading();
    const { data: m } = await db.from("members").select("*,clubs(club_name)").eq("status", "approved").order("full_name");
    const { data: d } = await db.from("district_council_registrations").select("*").eq("status", "approved");
    const all = [
      ...(m || []).map(x => ({ ...x, type: "Club", club: x.clubs?.club_name })),
      ...(d || []).map(x => ({ ...x, type: "DC", club: x.portfolio, member_code: x.member_code, full_name: x.full_name, ri_id: x.ri_id }))
    ];
    window._cache.attendance = all;
    renderAttendanceTable(all);
    const ck = all.filter(a => a.attendance_checked).length;
    const tot = all.length;
    $("#attSummary").innerHTML =
      '<div class="att-stat"><strong>' + tot + '</strong> Total</div>' +
      '<div class="att-stat green"><strong>' + ck + '</strong> Checked In</div>' +
      '<div class="att-stat orange"><strong>' + (tot - ck) + '</strong> Pending</div>' +
      '<div class="att-stat blue"><strong>' + (tot ? Math.round(ck / tot * 100) : 0) + '%</strong> Rate</div>';
    hideLoading();
  }

  function renderAttendanceTable(data) {
    const tb = $("#attendanceTable tbody");
    if (!tb) return;
    tb.innerHTML = data.map(a =>
      '<tr class="' + (a.attendance_checked ? "row-checked" : "") + '">' +
        '<td><code>' + (a.member_code || "—") + '</code></td>' +
        '<td>' + esc(a.full_name) + '</td>' +
        '<td>' + a.ri_id + '</td>' +
        '<td>' + esc(a.club || "—") + '</td>' +
        '<td>' + a.type + '</td>' +
        '<td>' + (a.attendance_checked ? '<span class="status-badge green">Present</span>' : '<span class="status-badge gray">Absent</span>') + '</td>' +
        '<td>' + (a.attendance_checked ? formatDate(a.attendance_checked_at) : "—") + '</td>' +
      '</tr>'
    ).join("");
  }

  // ==================== QR SCANNER ====================
  async function startScanner() {
    if (isScanning || typeof Html5Qrcode === "undefined") return;
    try {
      html5QrCode = new Html5Qrcode("qrReader");
      await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, () => {});
      isScanning = true;
      $("#startScanBtn").style.display = "none";
      $("#stopScanBtn").style.display = "inline-flex";
    } catch (err) { showToast("Camera error: " + err.message, "error"); }
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
    showLoading("Verifying...");
    try {
      let { data: m } = await db.from("members").select("*,clubs(club_name,group_number)").eq("qr_code_data", text).maybeSingle();
      let type = "Club", tbl = "members";
      if (!m) {
        const { data: d } = await db.from("district_council_registrations").select("*").eq("qr_code_data", text).maybeSingle();
        if (d) { m = { ...d, clubs: { club_name: d.portfolio, group_number: "DC" } }; type = "DC"; tbl = "district_council_registrations"; }
      }
      if (!m) { hideLoading(); showToast("QR not recognized", "error"); return; }
      if (m.attendance_checked) { hideLoading(); showToast("Already checked in", "warning"); return; }
      if (m.status !== "approved") { hideLoading(); showToast("Not approved", "error"); return; }
      await db.from(tbl).update({ attendance_checked: true, attendance_checked_at: new Date().toISOString(), attendance_checked_by: currentAdmin.id }).eq("id", m.id);
      logAction("CHECK_IN", tbl, m.id, m.full_name + " checked in");
      hideLoading();
      showToast(m.full_name + " checked in!");
    } catch (err) { hideLoading(); showToast("Error", "error"); }
  }

  // ==================== TREASURY ====================
  async function loadTreasury() {
    const db = getDb();
    if (!db) return;
    showLoading("Loading treasury...");
    try {
      const { data: summary } = await db.from("treasury_summary").select("*").single();
      if (summary) {
        const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN");
        $("#trsIncome").textContent = fmt(summary.total_income);
        $("#trsExpense").textContent = fmt(summary.total_expense);
        $("#trsBalance").textContent = fmt(summary.net_balance);
        $("#trsGst").textContent = fmt(summary.total_gst);
        $("#trsTds").textContent = fmt(summary.total_tds);
        $("#trsRegRev").textContent = fmt(summary.registration_revenue);
      }
      const { data: txns } = await db.from("treasury_transactions").select("*").order("transaction_date", { ascending: false });
      window._cache.treasury = txns || [];
      renderTreasuryTable(window._cache.treasury);
      await loadBudgetVariance();
    } catch (err) { console.error("Treasury:", err); }
    hideLoading();
  }

  function renderTreasuryTable(data) {
    const tb = $("#treasuryTable tbody");
    if (!tb) return;
    if (!data.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:24px;">No transactions yet</td></tr>';
      return;
    }
    const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN");
    tb.innerHTML = data.map(t => {
      const typeLabel = t.transaction_type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      return '<tr>' +
        '<td>' + formatDate(t.transaction_date, false) + '</td>' +
        '<td><strong>' + esc(t.description) + '</strong>' + (t.vendor_name ? '<br><small>' + esc(t.vendor_name) + '</small>' : '') + '</td>' +
        '<td><small>' + typeLabel + '</small></td>' +
        '<td>' + statusBadge(t.category.toLowerCase()) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;' + (t.category === "INCOME" ? "color:#2E7D32;" : t.category === "EXPENSE" ? "color:#C62828;" : "") + '">' + fmt(t.amount) + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;">' + (t.gst_amount > 0 ? fmt(t.gst_amount) : "—") + '</td>' +
        '<td style="font-family:JetBrains Mono,monospace;font-weight:700;">' + fmt(t.net_amount) + '</td>' +
        '<td><small>' + (t.payment_method || "—").replace(/_/g, " ") + '</small></td>' +
        '<td>' + (t.is_verified ? '<span class="status-badge green">Verified</span>' : '<span class="status-badge yellow">Pending</span>') + '</td>' +
        '<td><div class="action-btns">' +
          '<button class="btn-sm blue" onclick="window.viewTransaction(\'' + t.id + '\')"><i data-lucide="eye"></i></button>' +
          '<button class="btn-sm blue" onclick="window.editTransaction(\'' + t.id + '\')"><i data-lucide="edit-3"></i></button>' +
          (t.is_verified ? '' : '<button class="btn-sm green" onclick="window.verifyTransaction(\'' + t.id + '\')"><i data-lucide="check"></i></button>') +
          '<button class="btn-sm red" onclick="window.deleteItem(\'treasury_transactions\',\'' + t.id + '\')"><i data-lucide="trash-2"></i></button>' +
        '</div></td></tr>';
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
    let html = '<table class="budget-variance-table"><thead><tr><th>Budget Head</th><th>Cat</th><th>Allocated</th><th>Actual</th><th>Variance</th><th>Utilization</th></tr></thead><tbody>';
    heads.forEach(h => {
      const allocated = Number(h.allocated_amount) || 0;
      const actual = Math.abs(actualByHead[h.head_name] || 0);
      const variance = allocated - actual;
      const pct = allocated > 0 ? Math.round((actual / allocated) * 100) : 0;
      const isOver = variance < 0;
      const catBadge = h.category === "INCOME" ? '<span class="status-badge green">Inc</span>' : '<span class="status-badge red">Exp</span>';
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

  function getTransactionFormHtml(d) {
    const types = ['REGISTRATION_FEE','SPONSOR','DONATION','REFUND','VENUE_EXPENSE','FOOD_EXPENSE','TRANSPORT_EXPENSE','MERCHANDISE_EXPENSE','EQUIPMENT_EXPENSE','MARKETING_EXPENSE','PERMIT_EXPENSE','INSURANCE_EXPENSE','MISCELLANEOUS_EXPENSE','PRIZE_EXPENSE','CERTIFICATE_EXPENSE','OTHER_INCOME','OTHER_EXPENSE','ADVANCE_RECEIVED','ADVANCE_PAID','ADJUSTMENT'];
    const methods = ['BANK_TRANSFER','UPI','CASH','CHEQUE','CARD','ONLINE','INTERNAL'];
    return '<div class="trs-form-grid">' +
      '<div class="form-group"><label>Transaction Type *</label><select id="trsType" onchange="window.autoCategory()">' +
        types.map(t => '<option value="' + t + '"' + (d?.transaction_type === t ? " selected" : "") + '>' + t.replace(/_/g, " ") + '</option>').join("") +
      '</select></div>' +
      '<div class="form-group"><label>Category</label><select id="trsCat">' +
        ["INCOME","EXPENSE","ADJUSTMENT"].map(c => '<option value="' + c + '"' + (d?.category === c ? " selected" : "") + '>' + c + '</option>').join("") +
      '</select></div>' +
      '<div class="form-group full-width"><label>Description *</label><input id="trsDesc" value="' + esc(d?.description || "") + '" placeholder="Brief description"/></div>' +
      '<div class="form-group"><label>Amount (₹) *</label><input type="number" id="trsAmount" value="' + (d?.amount || "") + '" step="0.01" min="0" onchange="window.calcNetAmount()" placeholder="0.00"/></div>' +
      '<div class="form-group"><label>GST (₹)</label><input type="number" id="trsGstAmt" value="' + (d?.gst_amount || 0) + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>TDS (₹)</label><input type="number" id="trsTdsAmt" value="' + (d?.tds_amount || 0) + '" step="0.01" min="0" onchange="window.calcNetAmount()"/></div>' +
      '<div class="form-group"><label>Net Amount (₹)</label><input type="number" id="trsNetAmt" value="' + (d?.net_amount || "") + '" readonly style="font-weight:900;color:#2E7D32;"/></div>' +
      '<div class="form-group"><label>Payment Method</label><select id="trsMethod"><option value="">Select</option>' +
        methods.map(m => '<option value="' + m + '"' + (d?.payment_method === m ? " selected" : "") + '>' + m.replace(/_/g, " ") + '</option>').join("") +
      '</select></div>' +
      '<div class="form-group"><label>Payment Ref / UTR</label><input id="trsPayRef" value="' + esc(d?.payment_reference || "") + '"/></div>' +
      '<div class="form-group"><label>Reference No</label><input id="trsRefNum" value="' + esc(d?.reference_number || "") + '"/></div>' +
      '<div class="form-group"><label>Budget Head</label><select id="trsBudgetHead"><option value="">Select</option></select></div>' +
      '<div class="form-group"><label>Vendor</label><input id="trsVendor" value="' + esc(d?.vendor_name || "") + '"/></div>' +
      '<div class="form-group"><label>Vendor Contact</label><input id="trsVendorContact" value="' + esc(d?.vendor_contact || "") + '"/></div>' +
      '<div class="form-group"><label>Invoice No</label><input id="trsInvoice" value="' + esc(d?.invoice_number || "") + '"/></div>' +
      '<div class="form-group"><label>Date</label><input type="date" id="trsDate" value="' + (d?.transaction_date ? d.transaction_date.substring(0,10) : new Date().toISOString().substring(0,10)) + '"/></div>' +
      '<div class="form-group full-width"><label>Notes</label><textarea id="trsNotes" rows="2">' + esc(d?.notes || "") + '</textarea></div>' +
    '</div>' +
    '<div class="trs-amount-preview"><div class="label">Net Amount</div><div class="value" id="trsNetPreview">₹0</div></div>';
  }

  window.autoCategory = function () {
    const type = $("#trsType").value;
    const cat = $("#trsCat");
    if (type.includes("EXPENSE") || type === "REFUND" || type === "ADVANCE_PAID") cat.value = "EXPENSE";
    else if (type === "ADJUSTMENT") cat.value = "ADJUSTMENT";
    else cat.value = "INCOME";
  };

  window.calcNetAmount = function () {
    const amount = parseFloat($("#trsAmount").value) || 0;
    const gst = parseFloat($("#trsGstAmt").value) || 0;
    const tds = parseFloat($("#trsTdsAmt").value) || 0;
    const net = amount + gst - tds;
    $("#trsNetAmt").value = net.toFixed(2);
    const preview = $("#trsNetPreview");
    if (preview) preview.textContent = "₹" + net.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  };

  async function loadBudgetHeadOptions() {
    const db = getDb();
    if (!db) return;
    const { data } = await db.from("budget_heads").select("head_name").order("sort_order");
    const sel = $("#trsBudgetHead");
    if (sel && data) {
      sel.innerHTML = '<option value="">Select Head</option>' + data.map(h => '<option value="' + h.head_name + '">' + h.head_name + '</option>').join("");
    }
  }

  $("#addTransactionBtn")?.addEventListener("click", () => {
    openModal("New Transaction", getTransactionFormHtml(), '<button class="btn btn-primary" onclick="window.saveNewTransaction()">Save</button>', "large");
    setTimeout(() => { loadBudgetHeadOptions(); window.calcNetAmount(); }, 100);
  });

  window.saveNewTransaction = async function () {
    const db = getDb();
    if (!db) return;
    const desc = $("#trsDesc").value.trim();
    const amount = parseFloat($("#trsAmount").value);
    if (!desc || isNaN(amount) || amount <= 0) { showToast("Enter description and amount", "error"); return; }
    showLoading("Saving...");
    try {
      await db.from("treasury_transactions").insert({
        transaction_type: $("#trsType").value,
        category: $("#trsCat").value,
        description: desc,
        reference_number: $("#trsRefNum").value || null,
        amount: amount,
        gst_amount: parseFloat($("#trsGstAmt").value) || 0,
        tds_amount: parseFloat($("#trsTdsAmt").value) || 0,
        net_amount: parseFloat($("#trsNetAmt").value) || amount,
        payment_method: $("#trsMethod").value || null,
        payment_reference: $("#trsPayRef").value || null,
        vendor_name: $("#trsVendor").value || null,
        vendor_contact: $("#trsVendorContact").value || null,
        invoice_number: $("#trsInvoice").value || null,
        budget_head: $("#trsBudgetHead").value || null,
        notes: $("#trsNotes").value || null,
        transaction_date: $("#trsDate").value ? new Date($("#trsDate").value).toISOString() : new Date().toISOString(),
        created_by: currentAdmin.id
      });
      logAction("CREATE", "treasury", null, desc + " ₹" + amount);
      closeModal(); hideLoading(); showToast("Saved!"); loadTreasury();
    } catch (err) { hideLoading(); showToast("Failed: " + err.message, "error"); }
  };

  window.editTransaction = async function (id) {
    const db = getDb();
    const { data } = await db.from("treasury_transactions").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Transaction", getTransactionFormHtml(data),
      '<button class="btn btn-primary" onclick="window.updateTransaction(\'' + id + '\')">Update</button>', "large");
    setTimeout(() => {
      loadBudgetHeadOptions();
      if (data.budget_head) setTimeout(() => { const sel = $("#trsBudgetHead"); if (sel) sel.value = data.budget_head; }, 300);
      window.calcNetAmount();
    }, 100);
  };

  window.updateTransaction = async function (id) {
    const db = getDb();
    if (!db) return;
    showLoading();
    try {
      await db.from("treasury_transactions").update({
        transaction_type: $("#trsType").value,
        category: $("#trsCat").value,
        description: $("#trsDesc").value,
        reference_number: $("#trsRefNum").value || null,
        amount: parseFloat($("#trsAmount").value),
        gst_amount: parseFloat($("#trsGstAmt").value) || 0,
        tds_amount: parseFloat($("#trsTdsAmt").value) || 0,
        net_amount: parseFloat($("#trsNetAmt").value),
        payment_method: $("#trsMethod").value || null,
        payment_reference: $("#trsPayRef").value || null,
        vendor_name: $("#trsVendor").value || null,
        vendor_contact: $("#trsVendorContact").value || null,
        invoice_number: $("#trsInvoice").value || null,
        budget_head: $("#trsBudgetHead").value || null,
        notes: $("#trsNotes").value || null,
        transaction_date: $("#trsDate").value ? new Date($("#trsDate").value).toISOString() : undefined
      }).eq("id", id);
      logAction("UPDATE", "treasury", id, "Updated");
      closeModal(); hideLoading(); showToast("Updated!"); loadTreasury();
    } catch (err) { hideLoading(); showToast("Failed", "error"); }
  };

  window.viewTransaction = async function (id) {
    const db = getDb();
    const { data: t } = await db.from("treasury_transactions").select("*").eq("id", id).single();
    if (!t) return;
    const fmt = (v) => "₹" + (Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 });
    openModal("Transaction Details",
      '<div class="detail-grid">' +
        '<div><strong>Date:</strong> ' + formatDate(t.transaction_date) + '</div>' +
        '<div><strong>Type:</strong> ' + t.transaction_type.replace(/_/g, " ") + '</div>' +
        '<div><strong>Category:</strong> ' + statusBadge(t.category.toLowerCase()) + '</div>' +
        '<div><strong>Amount:</strong> ' + fmt(t.amount) + '</div>' +
        '<div><strong>GST:</strong> ' + fmt(t.gst_amount) + '</div>' +
        '<div><strong>TDS:</strong> ' + fmt(t.tds_amount) + '</div>' +
        '<div><strong>Net:</strong> <span style="font-weight:900;color:#2E7D32;font-size:1.1rem;">' + fmt(t.net_amount) + '</span></div>' +
        '<div><strong>Method:</strong> ' + (t.payment_method || "—").replace(/_/g, " ") + '</div>' +
        '<div><strong>Payment Ref:</strong> ' + esc(t.payment_reference || "—") + '</div>' +
        '<div><strong>Reference:</strong> ' + esc(t.reference_number || "—") + '</div>' +
        '<div><strong>Vendor:</strong> ' + esc(t.vendor_name || "—") + '</div>' +
        '<div><strong>Invoice:</strong> ' + esc(t.invoice_number || "—") + '</div>' +
        '<div><strong>Budget Head:</strong> ' + esc(t.budget_head || "—") + '</div>' +
        '<div><strong>Verified:</strong> ' + (t.is_verified ? "Yes · " + formatDate(t.verified_at) : "No") + '</div>' +
        (t.notes ? '<div class="full-width"><strong>Notes:</strong> ' + esc(t.notes) + '</div>' : '') +
      '</div>', "", "large");
  };

  window.verifyTransaction = async function (id) {
    const db = getDb();
    await db.from("treasury_transactions").update({ is_verified: true, verified_by: currentAdmin.id, verified_at: new Date().toISOString() }).eq("id", id);
    logAction("VERIFY", "treasury", id, "Verified");
    showToast("Verified!"); loadTreasury();
  };

  $("#syncRegRevenue")?.addEventListener("click", () => {
    const db = getDb();
    if (!db) return;
    confirmAction("Sync Registration Revenue", "Calculate approved registrations and create/update income transaction?", async () => {
      showLoading("Syncing...");
      try {
        const { count: memberCount } = await db.from("members").select("*", { count: "exact", head: true }).eq("status", "approved");
        const { count: dcCount } = await db.from("district_council_registrations").select("*", { count: "exact", head: true }).eq("status", "approved");
        const total = ((memberCount || 0) + (dcCount || 0)) * 3000;
        const { data: existing } = await db.from("treasury_transactions").select("id").eq("transaction_type", "REGISTRATION_FEE").eq("reference_number", "AUTO_SYNC").maybeSingle();
        const txnData = {
          transaction_type: "REGISTRATION_FEE",
          category: "INCOME",
          description: "Registration fees — " + (memberCount || 0) + " members + " + (dcCount || 0) + " DC × ₹3,000",
          reference_number: "AUTO_SYNC",
          amount: total,
          net_amount: total,
          payment_method: "BANK_TRANSFER",
          budget_head: "Registration Fees",
          is_verified: true,
          verified_by: currentAdmin.id,
          verified_at: new Date().toISOString(),
          created_by: currentAdmin.id
        };
        if (existing) await db.from("treasury_transactions").update(txnData).eq("id", existing.id);
        else await db.from("treasury_transactions").insert(txnData);
        logAction("SYNC", "treasury", null, "Revenue: ₹" + total.toLocaleString("en-IN"));
        hideLoading(); showToast("Synced! ₹" + total.toLocaleString("en-IN")); loadTreasury();
      } catch (err) { hideLoading(); showToast("Sync failed", "error"); }
    });
  });

  const trsSearch = $("#trsSearch"), trsCatF = $("#trsCategoryFilter"), trsVerF = $("#trsVerifiedFilter");
  const filterTreasury = debounce(() => {
    if (!window._cache.treasury) return;
    const q = (trsSearch?.value || "").toLowerCase();
    const cat = trsCatF?.value || "";
    const ver = trsVerF?.value || "";
    renderTreasuryTable(window._cache.treasury.filter(t =>
      (!q || t.description.toLowerCase().includes(q) || (t.vendor_name || "").toLowerCase().includes(q) || (t.reference_number || "").toLowerCase().includes(q)) &&
      (!cat || t.category === cat) &&
      (!ver || String(t.is_verified) === ver)
    ));
  }, 200);
  trsSearch?.addEventListener("input", filterTreasury);
  trsCatF?.addEventListener("change", filterTreasury);
  trsVerF?.addEventListener("change", filterTreasury);

  $("#exportTreasuryBtn")?.addEventListener("click", () => {
    const dd = $("#exportDropdown");
    if (dd) dd.style.display = dd.style.display === "block" ? "none" : "block";
  });

  document.addEventListener("click", (e) => {
    const dd = $("#exportDropdown");
    const btn = $("#exportTreasuryBtn");
    if (dd && btn && !btn.contains(e.target) && !dd.contains(e.target)) dd.style.display = "none";
  });

  // ==================== EXPORT FUNCTIONS ====================
  window.exportLedger = function () {
    exportExcel((window._cache.treasury || []).map(t => ({
      Date: formatDate(t.transaction_date, false),
      Type: t.transaction_type,
      Category: t.category,
      Description: t.description,
      Vendor: t.vendor_name || "",
      Reference: t.reference_number || "",
      Amount: t.amount,
      GST: t.gst_amount,
      TDS: t.tds_amount,
      "Net Amount": t.net_amount,
      Method: t.payment_method || "",
      "Payment Ref": t.payment_reference || "",
      Invoice: t.invoice_number || "",
      "Budget Head": t.budget_head || "",
      Verified: t.is_verified ? "Yes" : "No",
      Notes: t.notes || ""
    })), "Full_Ledger");
  };

  window.exportIncomeStatement = function () {
    const income = (window._cache.treasury || []).filter(t => t.category === "INCOME");
    const expense = (window._cache.treasury || []).filter(t => t.category === "EXPENSE");
    const totalIncome = income.reduce((s, t) => s + Number(t.net_amount), 0);
    const totalExpense = expense.reduce((s, t) => s + Number(t.net_amount), 0);
    const data = [
      ...income.map(t => ({ Category: "INCOME", Type: t.transaction_type, Description: t.description, Amount: t.net_amount })),
      { Category: "", Type: "", Description: "TOTAL INCOME", Amount: totalIncome },
      ...expense.map(t => ({ Category: "EXPENSE", Type: t.transaction_type, Description: t.description, Amount: t.net_amount })),
      { Category: "", Type: "", Description: "TOTAL EXPENSE", Amount: totalExpense },
      { Category: "", Type: "", Description: "NET SURPLUS / (DEFICIT)", Amount: totalIncome - totalExpense }
    ];
    exportExcel(data, "Income_Statement");
  };

  window.exportExpenseReport = function () {
    const expenses = (window._cache.treasury || []).filter(t => t.category === "EXPENSE");
    const byType = {};
    expenses.forEach(t => {
      const type = t.transaction_type;
      if (!byType[type]) byType[type] = { count: 0, total: 0 };
      byType[type].count++;
      byType[type].total += Number(t.net_amount);
    });
    const data = Object.entries(byType).map(([type, v]) => ({
      "Expense Type": type.replace(/_/g, " "),
      "Count": v.count,
      "Total": v.total
    }));
    data.push({ "Expense Type": "GRAND TOTAL", "Count": expenses.length, "Total": expenses.reduce((s, t) => s + Number(t.net_amount), 0) });
    exportExcel(data, "Expense_Report");
  };

  window.exportBudgetVariance = async function () {
    const db = getDb();
    const { data: heads } = await db.from("budget_heads").select("*").order("sort_order");
    const { data: txns } = await db.from("treasury_transactions").select("budget_head,net_amount");
    const actualByHead = {};
    (txns || []).forEach(t => { if (t.budget_head) actualByHead[t.budget_head] = (actualByHead[t.budget_head] || 0) + Math.abs(Number(t.net_amount)); });
    const data = (heads || []).map(h => {
      const allocated = Number(h.allocated_amount);
      const actual = actualByHead[h.head_name] || 0;
      return {
        "Budget Head": h.head_name,
        Category: h.category,
        Allocated: allocated,
        Actual: actual,
        Variance: allocated - actual,
        "Utilization %": allocated > 0 ? Math.round((actual / allocated) * 100) : 0
      };
    });
    exportExcel(data, "Budget_vs_Actual");
  };

  window.exportCashFlow = function () {
    const txns = window._cache.treasury || [];
    const byMonth = {};
    txns.forEach(t => {
      const month = new Date(t.transaction_date).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
      if (t.category === "INCOME") byMonth[month].income += Number(t.net_amount);
      else if (t.category === "EXPENSE") byMonth[month].expense += Number(t.net_amount);
    });
    const data = Object.entries(byMonth).map(([month, v]) => ({
      Month: month, Income: v.income, Expense: v.expense, "Net Flow": v.income - v.expense
    }));
    exportExcel(data, "Cash_Flow");
  };

  window.exportGSTReport = function () {
    const txns = (window._cache.treasury || []).filter(t => Number(t.gst_amount) > 0);
    const data = txns.map(t => ({
      Date: formatDate(t.transaction_date, false),
      Description: t.description,
      Category: t.category,
      "Base Amount": t.amount,
      "GST Amount": t.gst_amount,
      "Invoice No": t.invoice_number || "",
      Vendor: t.vendor_name || ""
    }));
    data.push({ Date: "", Description: "TOTAL GST", Category: "", "Base Amount": "", "GST Amount": txns.reduce((s, t) => s + Number(t.gst_amount), 0), "Invoice No": "", Vendor: "" });
    exportExcel(data, "GST_Summary");
  };

  window.exportTDSReport = function () {
    const txns = (window._cache.treasury || []).filter(t => Number(t.tds_amount) > 0);
    const data = txns.map(t => ({
      Date: formatDate(t.transaction_date, false),
      Description: t.description,
      Vendor: t.vendor_name || "",
      "Base Amount": t.amount,
      "TDS Amount": t.tds_amount,
      "Net Paid": t.net_amount
    }));
    data.push({ Date: "", Description: "TOTAL TDS", Vendor: "", "Base Amount": "", "TDS Amount": txns.reduce((s, t) => s + Number(t.tds_amount), 0), "Net Paid": "" });
    exportExcel(data, "TDS_Summary");
  };

  window.exportReconciliation = function () {
    const txns = window._cache.treasury || [];
    const data = txns.map(t => ({
      Date: formatDate(t.transaction_date, false),
      Description: t.description,
      "Payment Method": (t.payment_method || "").replace(/_/g, " "),
      "Payment Reference": t.payment_reference || "",
      Debit: t.category === "EXPENSE" ? t.net_amount : "",
      Credit: t.category === "INCOME" ? t.net_amount : "",
      Verified: t.is_verified ? "Yes" : "No"
    }));
    let runningBal = 0;
    data.forEach(d => {
      if (d.Credit) runningBal += Number(d.Credit);
      if (d.Debit) runningBal -= Number(d.Debit);
      d["Running Balance"] = runningBal;
    });
    exportExcel(data, "Bank_Reconciliation");
  };

  // ==================== SIMPLE CRUD SECTIONS ====================
  async function loadSiteContentEditor() {
    const db = getDb();
    const { data } = await db.from("site_content").select("*").order("section_key");
    const c = $("#siteContentList");
    if (!c || !data) return;
    c.innerHTML = data.map(s =>
      '<div class="content-editor-card">' +
        '<div class="content-editor-header"><h4>' + esc(s.section_key) + '</h4>' +
        '<button class="btn-sm blue" onclick="window.editSiteContent(\'' + s.id + '\',\'' + s.section_key + '\')"><i data-lucide="edit-3"></i></button></div>' +
        '<p><strong>Title:</strong> ' + esc(s.title || "—") + '</p>' +
        '<p>' + esc((s.content || "").substring(0, 120)) + '...</p>' +
      '</div>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.editSiteContent = async function (id, key) {
    const db = getDb();
    const { data } = await db.from("site_content").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit: " + key,
      '<div class="form-group"><label>Title</label><input id="eT" value="' + esc(data.title || "") + '"/></div>' +
      '<div class="form-group"><label>Content</label><textarea id="eC" rows="5">' + esc(data.content || "") + '</textarea></div>' +
      '<div class="form-group"><label>Extra JSON</label><textarea id="eE" rows="6" style="font-family:monospace;">' + JSON.stringify(data.extra_data || {}, null, 2) + '</textarea></div>',
      '<button class="btn btn-primary" onclick="window.saveSiteContent(\'' + id + '\')">Save</button>', "large");
  };

  window.saveSiteContent = async function (id) {
    let extra = {};
    try { extra = JSON.parse($("#eE").value); } catch { showToast("Invalid JSON", "error"); return; }
    const db = getDb();
    await db.from("site_content").update({ title: $("#eT").value, content: $("#eC").value, extra_data: extra, updated_by: currentAdmin.id }).eq("id", id);
    logAction("UPDATE", "site_content", id, "Updated");
    closeModal(); showToast("Saved!"); loadSiteContentEditor();
  };

  async function loadAgendaEditor() {
    const db = getDb();
    const { data } = await db.from("agenda").select("*").order("day_number").order("sort_order");
    const tb = $("#agendaTable tbody");
    if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>Day ' + a.day_number + '</td><td>' + a.time_slot + '</td><td>' + esc(a.title) + '</td>' +
      '<td>' + esc(a.location || "—") + '</td><td>' + a.sort_order + '</td>' +
      '<td>' + (a.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge gray">Hidden</span>') + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editAgenda(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'agenda\',\'' + a.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  $("#addAgendaBtn")?.addEventListener("click", () => {
    openModal("Add Agenda",
      '<div class="form-grid"><div class="form-group"><label>Day</label><select id="aD"><option value="1">Day 1</option><option value="2">Day 2</option></select></div>' +
      '<div class="form-group"><label>Time</label><input id="aT"/></div>' +
      '<div class="form-group"><label>Title</label><input id="aTi"/></div>' +
      '<div class="form-group"><label>Location</label><input id="aL"/></div>' +
      '<div class="form-group full-width"><label>Description</label><textarea id="aDe" rows="3"></textarea></div>' +
      '<div class="form-group"><label>Order</label><input type="number" id="aO" value="0"/></div></div>',
      '<button class="btn btn-primary" onclick="window.createAgenda()">Create</button>');
  });

  window.createAgenda = async function () {
    const db = getDb();
    await db.from("agenda").insert({
      day_number: parseInt($("#aD").value), time_slot: $("#aT").value,
      title: $("#aTi").value, location: $("#aL").value, description: $("#aDe").value,
      sort_order: parseInt($("#aO").value) || 0,
      event_date: $("#aD").value === "1" ? "2026-12-12" : "2026-12-13"
    });
    closeModal(); showToast("Added!"); loadAgendaEditor();
  };

  window.editAgenda = async function (id) {
    const db = getDb();
    const { data } = await db.from("agenda").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Agenda",
      '<div class="form-grid"><div class="form-group"><label>Day</label><select id="aD"><option value="1"' + (data.day_number === 1 ? " selected" : "") + '>1</option><option value="2"' + (data.day_number === 2 ? " selected" : "") + '>2</option></select></div>' +
      '<div class="form-group"><label>Time</label><input id="aT" value="' + data.time_slot + '"/></div>' +
      '<div class="form-group"><label>Title</label><input id="aTi" value="' + esc(data.title) + '"/></div>' +
      '<div class="form-group"><label>Location</label><input id="aL" value="' + esc(data.location || "") + '"/></div>' +
      '<div class="form-group full-width"><label>Desc</label><textarea id="aDe" rows="3">' + esc(data.description || "") + '</textarea></div>' +
      '<div class="form-group"><label>Order</label><input type="number" id="aO" value="' + data.sort_order + '"/></div></div>',
      '<button class="btn btn-primary" onclick="window.saveAgenda(\'' + id + '\')">Save</button>');
  };

  window.saveAgenda = async function (id) {
    const db = getDb();
    await db.from("agenda").update({
      day_number: parseInt($("#aD").value), time_slot: $("#aT").value,
      title: $("#aTi").value, location: $("#aL").value, description: $("#aDe").value,
      sort_order: parseInt($("#aO").value) || 0
    }).eq("id", id);
    closeModal(); showToast("Saved!"); loadAgendaEditor();
  };

  async function loadColourHuntEditor() {
    const db = getDb();
    const { data } = await db.from("colour_hunt").select("*").order("sort_order");
    const c = $("#colourHuntList");
    if (!c) return;
    if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:24px;color:#999;">No challenges yet.</p>'; return; }
    c.innerHTML = data.map(x => '<div class="content-editor-card"><h4>' + esc(x.title) + '</h4><p>' + esc((x.description || "").substring(0, 150)) + '...</p><button class="btn-sm blue" onclick="window.editColourHunt(\'' + x.id + '\')"><i data-lucide="edit-3"></i> Edit</button></div>').join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  $("#addColourHuntBtn")?.addEventListener("click", () => {
    openModal("Add Colour Hunt",
      '<div class="form-group"><label>Title</label><input id="cT"/></div>' +
      '<div class="form-group"><label>Description</label><textarea id="cD" rows="4"></textarea></div>' +
      '<div class="form-group"><label>Rules</label><textarea id="cR" rows="5"></textarea></div>' +
      '<div class="form-group"><label>Hashtags</label><input id="cH"/></div>',
      '<button class="btn btn-primary" onclick="window.createColourHunt()">Create</button>');
  });

  window.createColourHunt = async function () {
    const db = getDb();
    await db.from("colour_hunt").insert({ title: $("#cT").value, description: $("#cD").value, rules: $("#cR").value, hashtags: $("#cH").value });
    closeModal(); showToast("Added!"); loadColourHuntEditor();
  };

  window.editColourHunt = async function (id) {
    const db = getDb();
    const { data } = await db.from("colour_hunt").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Colour Hunt",
      '<div class="form-group"><label>Title</label><input id="cT" value="' + esc(data.title) + '"/></div>' +
      '<div class="form-group"><label>Description</label><textarea id="cD" rows="4">' + esc(data.description) + '</textarea></div>' +
      '<div class="form-group"><label>Rules</label><textarea id="cR" rows="5">' + esc(data.rules || "") + '</textarea></div>' +
      '<div class="form-group"><label>Hashtags</label><input id="cH" value="' + esc(data.hashtags || "") + '"/></div>',
      '<button class="btn btn-primary" onclick="window.saveColourHunt(\'' + id + '\')">Save</button>');
  };

  window.saveColourHunt = async function (id) {
    const db = getDb();
    await db.from("colour_hunt").update({ title: $("#cT").value, description: $("#cD").value, rules: $("#cR").value, hashtags: $("#cH").value }).eq("id", id);
    closeModal(); showToast("Saved!"); loadColourHuntEditor();
  };

  async function loadTreasureEditor() {
    const db = getDb();
    const { data } = await db.from("treasure_hunt").select("*").order("sort_order");
    const tb = $("#treasureTable tbody");
    if (!tb) return;
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No clues</td></tr>'; return; }
    tb.innerHTML = data.map(c =>
      '<tr><td>' + c.clue_number + '</td><td>' + esc(c.clue_title) + '</td><td>Group ' + (c.group_number || "All") + '</td>' +
      '<td>' + esc((c.clue_text || "").substring(0, 60)) + '...</td>' +
      '<td>' + (c.is_revealed ? '<span class="status-badge green">Revealed</span>' : '<span class="status-badge gray">Hidden</span>') + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm green" onclick="window.toggleClue(\'' + c.id + '\',' + !c.is_revealed + ')"><i data-lucide="' + (c.is_revealed ? "eye-off" : "eye") + '"></i></button>' +
      '<button class="btn-sm blue" onclick="window.editTreasure(\'' + c.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'treasure_hunt\',\'' + c.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  $("#addTreasureBtn")?.addEventListener("click", () => {
    openModal("Add Clue",
      '<div class="form-grid"><div class="form-group"><label>Clue #</label><input type="number" id="tN" value="1"/></div>' +
      '<div class="form-group"><label>Title</label><input id="tT"/></div>' +
      '<div class="form-group full-width"><label>Text</label><textarea id="tX" rows="3"></textarea></div>' +
      '<div class="form-group"><label>Hint</label><input id="tH"/></div>' +
      '<div class="form-group"><label>Group</label><select id="tG"><option value="">All</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div></div>',
      '<button class="btn btn-primary" onclick="window.createTreasure()">Create</button>');
  });

  window.createTreasure = async function () {
    const db = getDb();
    await db.from("treasure_hunt").insert({
      clue_number: parseInt($("#tN").value) || 1, clue_title: $("#tT").value,
      clue_text: $("#tX").value, hint: $("#tH").value,
      group_number: $("#tG").value ? parseInt($("#tG").value) : null
    });
    closeModal(); showToast("Added!"); loadTreasureEditor();
  };

  window.toggleClue = async function (id, reveal) {
    const db = getDb();
    await db.from("treasure_hunt").update({ is_revealed: reveal }).eq("id", id);
    showToast(reveal ? "Revealed!" : "Hidden");
    loadTreasureEditor();
  };

  window.editTreasure = async function (id) {
    const db = getDb();
    const { data } = await db.from("treasure_hunt").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Clue",
      '<div class="form-grid"><div class="form-group"><label>#</label><input type="number" id="tN" value="' + data.clue_number + '"/></div>' +
      '<div class="form-group"><label>Title</label><input id="tT" value="' + esc(data.clue_title) + '"/></div>' +
      '<div class="form-group full-width"><label>Text</label><textarea id="tX" rows="3">' + esc(data.clue_text) + '</textarea></div>' +
      '<div class="form-group"><label>Hint</label><input id="tH" value="' + esc(data.hint || "") + '"/></div>' +
      '<div class="form-group"><label>Group</label><select id="tG"><option value="">All</option>' +
      [1,2,3,4].map(g => '<option value="' + g + '"' + (data.group_number === g ? " selected" : "") + '>' + g + '</option>').join("") +
      '</select></div></div>',
      '<button class="btn btn-primary" onclick="window.saveTreasure(\'' + id + '\')">Save</button>');
  };

  window.saveTreasure = async function (id) {
    const db = getDb();
    await db.from("treasure_hunt").update({
      clue_number: parseInt($("#tN").value), clue_title: $("#tT").value,
      clue_text: $("#tX").value, hint: $("#tH").value,
      group_number: $("#tG").value ? parseInt($("#tG").value) : null
    }).eq("id", id);
    closeModal(); showToast("Saved!"); loadTreasureEditor();
  };

  async function loadLeadersEditor() {
    const db = getDb();
    const { data } = await db.from("group_leaders").select("*").eq("is_active", true).order("group_number");
    const tb = $("#leadersTable tbody");
    if (!tb) return;
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">No leaders</td></tr>'; return; }
    tb.innerHTML = data.map(l =>
      '<tr><td>Group ' + l.group_number + '</td><td>' + esc(l.leader_name) + '</td>' +
      '<td>' + esc(l.leader_role) + '</td><td>' + esc(l.leader_club || "—") + '</td>' +
      '<td>' + l.contact_number + '</td><td>' + (l.is_primary ? "Yes" : "No") + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editLeader(\'' + l.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'group_leaders\',\'' + l.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  $("#addLeaderBtn")?.addEventListener("click", () => {
    openModal("Add Leader",
      '<div class="form-grid"><div class="form-group"><label>Group</label><select id="lG"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>' +
      '<div class="form-group"><label>Name</label><input id="lN"/></div>' +
      '<div class="form-group"><label>Role</label><input id="lR"/></div>' +
      '<div class="form-group"><label>Club</label><input id="lC"/></div>' +
      '<div class="form-group"><label>Phone</label><input id="lP"/></div>' +
      '<div class="form-group"><label>Email</label><input id="lE" type="email"/></div></div>',
      '<button class="btn btn-primary" onclick="window.createLeader()">Create</button>');
  });

  window.createLeader = async function () {
    const db = getDb();
    await db.from("group_leaders").insert({
      group_number: parseInt($("#lG").value), leader_name: $("#lN").value,
      leader_role: $("#lR").value, leader_club: $("#lC").value,
      contact_number: $("#lP").value, email: $("#lE").value
    });
    closeModal(); showToast("Added!"); loadLeadersEditor();
  };

  window.editLeader = async function (id) {
    const db = getDb();
    const { data } = await db.from("group_leaders").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Leader",
      '<div class="form-grid"><div class="form-group"><label>Group</label><select id="lG">' +
      [1,2,3,4].map(g => '<option value="' + g + '"' + (data.group_number === g ? " selected" : "") + '>' + g + '</option>').join("") + '</select></div>' +
      '<div class="form-group"><label>Name</label><input id="lN" value="' + esc(data.leader_name) + '"/></div>' +
      '<div class="form-group"><label>Role</label><input id="lR" value="' + esc(data.leader_role) + '"/></div>' +
      '<div class="form-group"><label>Club</label><input id="lC" value="' + esc(data.leader_club || "") + '"/></div>' +
      '<div class="form-group"><label>Phone</label><input id="lP" value="' + data.contact_number + '"/></div>' +
      '<div class="form-group"><label>Email</label><input id="lE" value="' + esc(data.email || "") + '"/></div></div>',
      '<button class="btn btn-primary" onclick="window.saveLeader(\'' + id + '\')">Save</button>');
  };

  window.saveLeader = async function (id) {
    const db = getDb();
    await db.from("group_leaders").update({
      group_number: parseInt($("#lG").value), leader_name: $("#lN").value,
      leader_role: $("#lR").value, leader_club: $("#lC").value,
      contact_number: $("#lP").value, email: $("#lE").value
    }).eq("id", id);
    closeModal(); showToast("Saved!"); loadLeadersEditor();
  };

  async function loadFoodEditor() {
    const db = getDb();
    const { data } = await db.from("food_menu").select("*").order("day_number").order("sort_order");
    const tb = $("#foodTable tbody");
    if (!tb) return;
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;">No items</td></tr>'; return; }
    tb.innerHTML = data.map(f =>
      '<tr><td>Day ' + f.day_number + '</td><td>' + f.meal_type + '</td>' +
      '<td><span class="food-badge ' + (f.food_type === "VEG" ? "veg" : "nonveg") + '">' + f.food_type + '</span></td>' +
      '<td>' + esc(f.item_name) + '</td><td>' + esc(f.description || "") + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editFood(\'' + f.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'food_menu\',\'' + f.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  const foodFormHtml = (d) => (
    '<div class="form-grid"><div class="form-group"><label>Day</label><select id="fD">' +
    '<option value="1"' + (d?.day_number === 1 ? " selected" : "") + '>1</option>' +
    '<option value="2"' + (d?.day_number === 2 ? " selected" : "") + '>2</option></select></div>' +
    '<div class="form-group"><label>Meal</label><select id="fM">' +
    ["Breakfast","Lunch","Snacks","Dinner","Beverages"].map(x => '<option' + (d?.meal_type === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div>' +
    '<div class="form-group"><label>Type</label><select id="fT">' +
    ["VEG","NON-VEG","COMMON"].map(x => '<option value="' + x + '"' + (d?.food_type === x ? " selected" : "") + '>' + x + '</option>').join("") + '</select></div>' +
    '<div class="form-group"><label>Item</label><input id="fN" value="' + esc(d?.item_name || "") + '"/></div>' +
    '<div class="form-group full-width"><label>Desc</label><input id="fDe" value="' + esc(d?.description || "") + '"/></div></div>'
  );

  $("#addFoodBtn")?.addEventListener("click", () => {
    openModal("Add Food Item", foodFormHtml(), '<button class="btn btn-primary" onclick="window.createFood()">Create</button>');
  });

  window.createFood = async function () {
    const db = getDb();
    await db.from("food_menu").insert({
      day_number: parseInt($("#fD").value), meal_type: $("#fM").value,
      food_type: $("#fT").value, item_name: $("#fN").value, description: $("#fDe").value
    });
    closeModal(); showToast("Added!"); loadFoodEditor();
  };

  window.editFood = async function (id) {
    const db = getDb();
    const { data } = await db.from("food_menu").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit Food", foodFormHtml(data), '<button class="btn btn-primary" onclick="window.saveFood(\'' + id + '\')">Save</button>');
  };

  window.saveFood = async function (id) {
    const db = getDb();
    await db.from("food_menu").update({
      day_number: parseInt($("#fD").value), meal_type: $("#fM").value,
      food_type: $("#fT").value, item_name: $("#fN").value, description: $("#fDe").value
    }).eq("id", id);
    closeModal(); showToast("Saved!"); loadFoodEditor();
  };

  async function loadAnnouncementsEditor() {
    const db = getDb();
    const { data } = await db.from("announcements").select("*").order("created_at", { ascending: false });
    const c = $("#announcementsList");
    if (!c) return;
    if (!data || !data.length) { c.innerHTML = '<p style="text-align:center;padding:24px;color:#999;">No announcements.</p>'; return; }
    c.innerHTML = data.map(a =>
      '<div class="content-editor-card"><div class="content-editor-header">' +
      '<h4>' + esc(a.title) + ' <span class="status-badge ' + a.priority + '">' + a.priority + '</span></h4>' +
      '<div class="action-btns"><button class="btn-sm blue" onclick="window.editAnnouncement(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'announcements\',\'' + a.id + '\')"><i data-lucide="trash-2"></i></button></div></div>' +
      '<p>' + esc(a.message) + '</p><small>' + (a.is_active ? "Active" : "Inactive") + ' · ' + (a.show_on_homepage ? "Homepage" : "Hidden") + '</small></div>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  const annFormHtml = (d) => (
    '<div class="form-group"><label>Title</label><input id="anT" value="' + esc(d?.title || "") + '"/></div>' +
    '<div class="form-group"><label>Message</label><textarea id="anM" rows="4">' + esc(d?.message || "") + '</textarea></div>' +
    '<div class="form-group"><label>Priority</label><select id="anP">' +
    ["low","normal","high","urgent"].map(p => '<option value="' + p + '"' + (d?.priority === p ? " selected" : "") + '>' + p + '</option>').join("") + '</select></div>' +
    '<div class="form-group"><label><input type="checkbox" id="anA"' + (d?.is_active !== false ? " checked" : "") + '/> Active</label></div>' +
    '<div class="form-group"><label><input type="checkbox" id="anH"' + (d?.show_on_homepage !== false ? " checked" : "") + '/> Homepage</label></div>'
  );

  $("#addAnnouncementBtn")?.addEventListener("click", () => {
    openModal("New Announcement", annFormHtml(), '<button class="btn btn-primary" onclick="window.createAnnouncement()">Create</button>');
  });

  window.createAnnouncement = async function () {
    const db = getDb();
    await db.from("announcements").insert({
      title: $("#anT").value, message: $("#anM").value, priority: $("#anP").value,
      is_active: $("#anA").checked, show_on_homepage: $("#anH").checked, created_by: currentAdmin.id
    });
    closeModal(); showToast("Created!"); loadAnnouncementsEditor();
  };

  window.editAnnouncement = async function (id) {
    const db = getDb();
    const { data } = await db.from("announcements").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit", annFormHtml(data), '<button class="btn btn-primary" onclick="window.saveAnnouncement(\'' + id + '\')">Save</button>');
  };

  window.saveAnnouncement = async function (id) {
    const db = getDb();
    await db.from("announcements").update({
      title: $("#anT").value, message: $("#anM").value, priority: $("#anP").value,
      is_active: $("#anA").checked, show_on_homepage: $("#anH").checked
    }).eq("id", id);
    closeModal(); showToast("Saved!"); loadAnnouncementsEditor();
  };

  async function loadFaqsEditor() {
    const db = getDb();
    const { data } = await db.from("faqs").select("*").order("sort_order");
    const tb = $("#faqTable tbody");
    if (!tb) return;
    if (!data || !data.length) { tb.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;">No FAQs</td></tr>'; return; }
    tb.innerHTML = data.map(f =>
      '<tr><td>' + esc(f.question) + '</td><td>' + f.category + '</td><td>' + f.sort_order + '</td>' +
      '<td>' + (f.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge gray">Hidden</span>') + '</td>' +
      '<td><div class="action-btns"><button class="btn-sm blue" onclick="window.editFaq(\'' + f.id + '\')"><i data-lucide="edit-3"></i></button>' +
      '<button class="btn-sm red" onclick="window.deleteItem(\'faqs\',\'' + f.id + '\')"><i data-lucide="trash-2"></i></button></div></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  const faqFormHtml = (d) => (
    '<div class="form-group"><label>Question</label><input id="fqQ" value="' + esc(d?.question || "") + '"/></div>' +
    '<div class="form-group"><label>Answer</label><textarea id="fqA" rows="4">' + esc(d?.answer || "") + '</textarea></div>' +
    '<div class="form-group"><label>Category</label><input id="fqC" value="' + (d?.category || "General") + '"/></div>' +
    '<div class="form-group"><label>Order</label><input type="number" id="fqO" value="' + (d?.sort_order || 0) + '"/></div>'
  );

  $("#addFaqBtn")?.addEventListener("click", () => {
    openModal("Add FAQ", faqFormHtml(), '<button class="btn btn-primary" onclick="window.createFaq()">Create</button>');
  });

  window.createFaq = async function () {
    const db = getDb();
    await db.from("faqs").insert({ question: $("#fqQ").value, answer: $("#fqA").value, category: $("#fqC").value, sort_order: parseInt($("#fqO").value) || 0 });
    closeModal(); showToast("Added!"); loadFaqsEditor();
  };

  window.editFaq = async function (id) {
    const db = getDb();
    const { data } = await db.from("faqs").select("*").eq("id", id).single();
    if (!data) return;
    openModal("Edit FAQ", faqFormHtml(data), '<button class="btn btn-primary" onclick="window.saveFaq(\'' + id + '\')">Save</button>');
  };

  window.saveFaq = async function (id) {
    const db = getDb();
    await db.from("faqs").update({ question: $("#fqQ").value, answer: $("#fqA").value, category: $("#fqC").value, sort_order: parseInt($("#fqO").value) || 0 }).eq("id", id);
    closeModal(); showToast("Saved!"); loadFaqsEditor();
  };

  async function loadAdminsEditor() {
    const db = getDb();
    if (!db || currentAdmin?.role !== "super_admin") return;
    const { data } = await db.from("admin_users").select("id,email,full_name,role,is_active,last_login").order("created_at");
    const tb = $("#adminsTable tbody");
    if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>' + esc(a.full_name) + '</td><td>' + a.email + '</td>' +
      '<td><span class="status-badge ' + (a.role === "super_admin" ? "green" : a.role === "scanner" ? "orange" : "blue") + '">' + a.role + '</span></td>' +
      '<td>' + (a.is_active ? '<span class="status-badge green">Active</span>' : '<span class="status-badge red">Inactive</span>') + '</td>' +
      '<td>' + formatDate(a.last_login) + '</td>' +
      '<td><button class="btn-sm blue" onclick="window.editAdmin(\'' + a.id + '\')"><i data-lucide="edit-3"></i></button></td></tr>'
    ).join("");
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  $("#addAdminBtn")?.addEventListener("click", () => {
    openModal("Add Admin",
      '<div class="form-group"><label>Name</label><input id="adN"/></div>' +
      '<div class="form-group"><label>Email</label><input id="adE" type="email"/></div>' +
      '<div class="form-group"><label>Password</label><input id="adP" type="password"/></div>' +
      '<div class="form-group"><label>Role</label><select id="adR"><option value="admin">Admin</option><option value="super_admin">Super Admin</option><option value="scanner">Scanner</option></select></div>',
      '<button class="btn btn-primary" onclick="window.createAdmin()">Create</button>');
  });

  window.createAdmin = async function () {
    const email = $("#adE").value.trim().toLowerCase();
    const pass = $("#adP").value;
    if (!email || !pass) { showToast("All fields required", "error"); return; }
    const db = getDb();
    try {
      const { error } = await db.rpc("create_admin", { p_email: email, p_password: pass, p_name: $("#adN").value, p_role: $("#adR").value });
      if (error) throw error;
      closeModal(); showToast("Created!"); loadAdminsEditor();
    } catch (e) { showToast("Failed: " + e.message, "error"); }
  };

  window.editAdmin = async function (id) {
    const db = getDb();
    const { data } = await db.from("admin_users").select("id,email,full_name,role,is_active").eq("id", id).single();
    if (!data) return;
    openModal("Edit Admin",
      '<div class="form-group"><label>Name</label><input id="adN" value="' + esc(data.full_name) + '"/></div>' +
      '<div class="form-group"><label>Email</label><input id="adE" value="' + data.email + '"/></div>' +
      '<div class="form-group"><label>Role</label><select id="adR">' +
      ["admin","super_admin","scanner"].map(r => '<option value="' + r + '"' + (data.role === r ? " selected" : "") + '>' + r + '</option>').join("") + '</select></div>' +
      '<div class="form-group"><label><input type="checkbox" id="adA"' + (data.is_active ? " checked" : "") + '/> Active</label></div>',
      '<button class="btn btn-primary" onclick="window.saveAdmin(\'' + id + '\')">Save</button>');
  };

  window.saveAdmin = async function (id) {
    const db = getDb();
    await db.from("admin_users").update({ full_name: $("#adN").value, email: $("#adE").value, role: $("#adR").value, is_active: $("#adA").checked }).eq("id", id);
    closeModal(); showToast("Saved!"); loadAdminsEditor();
  };

  async function loadActivityLog() {
    const db = getDb();
    if (!db) return;
    const { data } = await db.from("activity_log").select("*,admin_users(full_name)").order("created_at", { ascending: false }).limit(200);
    const tb = $("#activityTable tbody");
    if (!tb) return;
    tb.innerHTML = (data || []).map(a =>
      '<tr><td>' + formatDate(a.created_at) + '</td><td>' + esc(a.admin_users?.full_name || "System") + '</td>' +
      '<td><span class="status-badge blue">' + a.action_type + '</span></td>' +
      '<td>' + a.entity_type + '</td><td>' + esc(a.description) + '</td></tr>'
    ).join("");
  }

  window.deleteItem = function (table, id) {
    confirmAction("Delete Item", "This cannot be undone. Are you sure?", async () => {
      const db = getDb();
      try {
        await db.from(table).delete().eq("id", id);
        logAction("DELETE", table, id, "Deleted from " + table);
        showToast("Deleted");
        const v = $(".view.active")?.id?.replace("view-", "");
        if (v) navigateTo(v);
      } catch (err) { showToast("Delete failed", "error"); }
    }, true);
  };

  function exportExcel(data, name) {
    if (typeof XLSX === "undefined") { showToast("Export lib not loaded", "error"); return; }
    if (!data || !data.length) { showToast("No data", "warning"); return; }
    try {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      const ts = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, "ALTITUDE_" + name + "_" + ts + ".xlsx");
      showToast("Exported " + data.length + " records");
    } catch (e) { showToast("Export failed", "error"); }
  }

  // ==================== FILTERS ====================
  function initFilters() {
    const ms = $("#membersSearch"), mst = $("#membersStatusFilter"), mf = $("#membersFoodFilter"), mg = $("#membersGroupFilter");
    const filterMembers = debounce(() => {
      if (!window._cache.members) return;
      const q = (ms?.value || "").toLowerCase();
      const st = mst?.value || "", fd = mf?.value || "", gp = mg?.value || "";
      renderMembersTable(window._cache.members.filter(m =>
        (!q || m.full_name.toLowerCase().includes(q) || m.ri_id.toLowerCase().includes(q) || (m.clubs?.club_name || "").toLowerCase().includes(q)) &&
        (!st || m.status === st) && (!fd || m.food_preference === fd) && (!gp || String(m.clubs?.group_number) === gp)
      ));
    }, 200);
    ms?.addEventListener("input", filterMembers);
    mst?.addEventListener("change", filterMembers);
    mf?.addEventListener("change", filterMembers);
    mg?.addEventListener("change", filterMembers);

    const cs = $("#clubRegSearch"), cst = $("#clubRegStatusFilter");
    const filterCR = debounce(() => {
      if (!window._cache.registrations) return;
      const q = (cs?.value || "").toLowerCase();
      const st = cst?.value || "";
      renderClubRegTable(window._cache.registrations.filter(r =>
        (!q || r.registrant_name.toLowerCase().includes(q) || (r.clubs?.club_name || "").toLowerCase().includes(q) || r.transaction_id.toLowerCase().includes(q)) &&
        (!st || r.status === st)
      ));
    }, 200);
    cs?.addEventListener("input", filterCR);
    cst?.addEventListener("change", filterCR);

    const ds = $("#dcRegSearch"), dst = $("#dcRegStatusFilter");
    const filterDC = debounce(() => {
      if (!window._cache.dcRegistrations) return;
      const q = (ds?.value || "").toLowerCase();
      const st = dst?.value || "";
      renderDcRegTable(window._cache.dcRegistrations.filter(r =>
        (!q || r.full_name.toLowerCase().includes(q) || r.ri_id.toLowerCase().includes(q) || (r.portfolio || "").toLowerCase().includes(q)) &&
        (!st || r.status === st)
      ));
    }, 200);
    ds?.addEventListener("input", filterDC);
    dst?.addEventListener("change", filterDC);

    const cls = $("#clubsSearch"), clg = $("#clubsGroupFilter");
    const filterClubs = debounce(() => {
      if (!window._cache.clubs) return;
      const q = (cls?.value || "").toLowerCase();
      const gp = clg?.value || "";
      renderClubsTable(window._cache.clubs.filter(c =>
        (!q || c.club_name.toLowerCase().includes(q)) && (!gp || String(c.group_number) === gp)
      ));
    }, 200);
    cls?.addEventListener("input", filterClubs);
    clg?.addEventListener("change", filterClubs);

    const ats = $("#attSearch"), atf = $("#attFilter");
    const filterAtt = debounce(() => {
      if (!window._cache.attendance) return;
      const q = (ats?.value || "").toLowerCase();
      const stat = atf?.value || "";
      renderAttendanceTable(window._cache.attendance.filter(a =>
        (!q || a.full_name.toLowerCase().includes(q) || a.ri_id.toLowerCase().includes(q)) &&
        (!stat || (stat === "attended" ? a.attendance_checked : !a.attendance_checked))
      ));
    }, 200);
    ats?.addEventListener("input", filterAtt);
    atf?.addEventListener("change", filterAtt);
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

    $("#exportMembers")?.addEventListener("click", () => exportExcel((window._cache.members || []).map(m => ({
      Code: m.member_code, Name: m.full_name, "RI ID": m.ri_id,
      Club: m.clubs?.club_name, Group: m.clubs?.group_number,
      Email: m.email, Phone: m.contact_number,
      Food: m.food_preference, Board: m.is_board_member ? "Yes" : "No",
      Status: m.status, Attended: m.attendance_checked ? "Yes" : "No",
      Registered: formatDate(m.created_at)
    })), "Members"));

    $("#exportAttendance")?.addEventListener("click", () => exportExcel((window._cache.attendance || []).map(a => ({
      Code: a.member_code, Name: a.full_name, "RI ID": a.ri_id, Club: a.club, Type: a.type,
      Attended: a.attendance_checked ? "Yes" : "No", Time: a.attendance_checked_at ? formatDate(a.attendance_checked_at) : ""
    })), "Attendance"));

    $("#exportClubReg")?.addEventListener("click", () => exportExcel((window._cache.registrations || []).map(r => ({
      Code: r.registration_code, Club: r.clubs?.club_name, Registrant: r.registrant_name,
      Role: r.registrant_role, Email: r.registrant_email, Phone: r.registrant_phone,
      Members: r.total_members, Amount: r.total_amount, TxnID: r.transaction_id,
      Status: r.status, Date: formatDate(r.created_at)
    })), "ClubRegistrations"));

    $("#exportDcReg")?.addEventListener("click", () => exportExcel((window._cache.dcRegistrations || []).map(r => ({
      Code: r.registration_code, Name: r.full_name, "RI ID": r.ri_id,
      Portfolio: r.portfolio, Email: r.email, Phone: r.contact_number,
      Food: r.food_preference, TxnID: r.transaction_id, Status: r.status
    })), "DC_Registrations"));

    initFilters();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
