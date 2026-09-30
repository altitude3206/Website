/**
 * ALTITUDE — Main Application Logic v3.0
 * Integrates with centralized config.js — Single DB instance
 * Powers index.html with dynamic Supabase content
 */

(function () {
  "use strict";

  // ==================== DATABASE ACCESS ====================
  // Uses the single consolidated instance from config.js
  function getDb() {
    return window.db || null;
  }

  // Wait for DB to be ready (handles script load order)
  function waitForDb(callback, maxWait = 8000) {
    if (getDb()) {
      callback(getDb());
      return;
    }
    const startTime = Date.now();
    const check = setInterval(() => {
      if (getDb()) {
        clearInterval(check);
        callback(getDb());
      } else if (Date.now() - startTime > maxWait) {
        clearInterval(check);
        if (window.CONFIG) window.CONFIG.warn("Database not available after timeout.", "APP");
      }
    }, 200);

    // Also listen for the custom event from config.js
    window.addEventListener("dbReady", function handler(e) {
      clearInterval(check);
      window.removeEventListener("dbReady", handler);
      callback(e.detail.db);
    });
  }

  // ==================== UTILITY FUNCTIONS ====================
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showToast(message, type = "success") {
    const toast = $("#toast");
    const msg = $("#toastMessage");
    const icon = toast?.querySelector(".toast-icon");
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.className = "toast " + type;
    if (icon) {
      icon.setAttribute("data-lucide", type === "error" ? "alert-circle" : type === "warning" ? "alert-triangle" : "check-circle");
    }
    toast.classList.add("show");
    if (typeof lucide !== "undefined") lucide.createIcons();
    setTimeout(() => toast.classList.remove("show"), 4000);
  }
  window.showToast = showToast;

  function showLoading(text = "Processing...") {
    const overlay = $("#loadingOverlay");
    const txt = $("#loadingText");
    if (overlay) overlay.classList.add("active");
    if (txt) txt.textContent = text;
  }
  window.showLoading = showLoading;

  function hideLoading() {
    const overlay = $("#loadingOverlay");
    if (overlay) overlay.classList.remove("active");
  }
  window.hideLoading = hideLoading;

  function safeText(val, fallback = "") {
    return val != null && val !== "" ? String(val) : fallback;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(d) {
    if (!d) return "N/A";
    try {
      return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch { return "N/A"; }
  }

  // ==================== NAVBAR ====================
  function initNavbar() {
    const navbar = $("#navbar");
    const toggle = $("#navToggle");
    const menu = $("#navMenu");
    if (!navbar) return;

    window.addEventListener("scroll", () => {
      navbar.classList.toggle("scrolled", window.scrollY > 60);
      highlightActiveNav();
    }, { passive: true });

    if (toggle && menu) {
      toggle.addEventListener("click", () => {
        toggle.classList.toggle("active");
        menu.classList.toggle("active");
      });
      menu.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => {
          toggle.classList.remove("active");
          menu.classList.remove("active");
        });
      });
    }
  }

  function highlightActiveNav() {
    const sections = $$("section[id]");
    const navLinks = $$(".nav-link[href^='#']");
    let current = "";
    sections.forEach(sec => {
      if (window.scrollY >= sec.offsetTop - 120) current = sec.id;
    });
    navLinks.forEach(link => {
      link.classList.toggle("active", link.getAttribute("href") === "#" + current);
    });
  }

  // ==================== COUNTDOWN ====================
  function initCountdown() {
    const target = new Date("2026-12-12T06:00:00+05:30").getTime();
    const prev = {};

    function update() {
      const diff = target - Date.now();
      if (diff <= 0) {
        ["cd-days", "cd-hours", "cd-mins", "cd-secs"].forEach(id => setText(id, "00"));
        return;
      }
      const vals = {
        "cd-days": String(Math.floor(diff / 86400000)).padStart(2, "0"),
        "cd-hours": String(Math.floor((diff % 86400000) / 3600000)).padStart(2, "0"),
        "cd-mins": String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0"),
        "cd-secs": String(Math.floor((diff % 60000) / 1000)).padStart(2, "0")
      };
      for (const [id, val] of Object.entries(vals)) {
        if (prev[id] !== val) {
          setText(id, val);
          prev[id] = val;
          // Trigger flip animation
          const el = document.getElementById(id);
          if (el) {
            el.classList.remove("flip");
            void el.offsetWidth;
            el.classList.add("flip");
          }
        }
      }
    }
    update();
    setInterval(update, 1000);
  }

  // ==================== LOAD SITE CONTENT ====================
  async function loadSiteContent(db) {
    try {
      const { data, error } = await db.from("site_content").select("*").eq("is_active", true);
      if (error || !data) return;

      const map = {};
      data.forEach(row => { map[row.section_key] = row; });

      // Hero
      if (map.hero) {
        const extra = map.hero.extra_data || {};
        setText("heroSubtitle", safeText(extra.subtitle));
        setText("heroDate", safeText(extra.date));
        setText("heroLocation", safeText(extra.location));
      }

      // About
      if (map.about) {
        setText("aboutTitle", safeText(map.about.title));
        const aboutEl = $("#aboutContent");
        if (aboutEl) aboutEl.textContent = safeText(map.about.content,
          "ALTITUDE is the Rotaract District trekking event organized by Rotaract Clubs of Coimbatore Unity, Young Vibrants and TNAU (Tamil Nadu Agricultural University). Join fellow Rotaractors for an unforgettable adventure in the beautiful Nilgiri Hills of Ooty. Two days of trekking, team building, treasure hunts, colour challenges, and lasting memories await you."
        );
        const highlights = map.about.extra_data?.highlights || [];
        const hlContainer = $("#aboutHighlights");
        if (hlContainer && highlights.length) {
          hlContainer.innerHTML = highlights.map(h =>
            '<div class="highlight-item"><i data-lucide="check-circle-2"></i> ' + escapeHtml(h) + '</div>'
          ).join("");
        }
      }

      // Event Chair
      if (map.event_chair) {
        setText("chairTitle", safeText(map.event_chair.title));
        setText("chairName", safeText(map.event_chair.content));
        const extra = map.event_chair.extra_data || {};
        setText("chairDesignation", safeText(extra.designation));
        const msgEl = $("#chairMessage");
        if (msgEl && extra.message) msgEl.textContent = safeText(extra.message);
      }

      // Host Clubs
      if (map.host_clubs) {
        const clubs = map.host_clubs.extra_data?.clubs || [];
        const container = $("#hostClubsList");
        if (container && clubs.length) {
          container.innerHTML = clubs.map(c => '<div class="host-club-badge">' + escapeHtml(c) + '</div>').join("");
        }
      }

      // Terms
      if (map.terms_conditions) {
        const terms = map.terms_conditions.extra_data?.terms || [];
        const list = $("#termsList");
        if (list && terms.length) {
          list.innerHTML = terms.map(t => '<li>' + escapeHtml(t) + '</li>').join("");
        }
      }

      // Registration Status
      if (map.registration_status) {
        const isOpen = map.registration_status.extra_data?.is_open;
        if (isOpen === false) {
          const regSection = $("#register");
          if (regSection && !regSection.querySelector(".reg-closed-notice")) {
            const notice = document.createElement("div");
            notice.className = "reg-closed-notice";
            notice.innerHTML = '<i data-lucide="lock"></i> <span>Registrations are currently closed.</span>';
            regSection.querySelector(".container").prepend(notice);
          }
        }
      }
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load site content.", err, "APP");
    }
  }

  // ==================== LOAD CLUBS ====================
  async function loadClubs(db) {
    try {
      const { data, error } = await db
        .from("clubs")
        .select("id, club_name, group_number, max_registrations, current_registrations")
        .eq("is_active", true)
        .order("club_name", { ascending: true });

      if (error || !data) return;
      window.CLUBS_DATA = data;

      const select = $("#clubSelect");
      if (!select) return;

      const groups = { 1: [], 2: [], 3: [], 4: [] };
      data.forEach(c => { if (groups[c.group_number]) groups[c.group_number].push(c); });

      let html = '<option value="">Select Your Club</option>';
      for (const g of [1, 2, 3, 4]) {
        if (!groups[g].length) continue;
        html += '<optgroup label="Group ' + g + '">';
        groups[g].forEach(c => {
          const avail = c.max_registrations - c.current_registrations;
          const disabled = avail <= 0 ? "disabled" : "";
          const label = avail <= 0 ? " (Full)" : "";
          html += '<option value="' + c.id + '" data-group="' + c.group_number + '" data-available="' + avail + '" ' + disabled + '>' + escapeHtml(c.club_name) + label + '</option>';
        });
        html += '</optgroup>';
      }
      select.innerHTML = html;

      select.addEventListener("change", function () {
        const opt = this.options[this.selectedIndex];
        const groupDisplay = $("#groupDisplay");
        const slotsInfo = $("#slotsInfo");
        if (opt && opt.dataset.group) {
          if (groupDisplay) groupDisplay.value = "Group " + opt.dataset.group;
          if (slotsInfo) { slotsInfo.textContent = ""; slotsInfo.style.display = "none"; }
        } else {
          if (groupDisplay) groupDisplay.value = "";
          if (slotsInfo) { slotsInfo.textContent = ""; slotsInfo.style.display = "none"; }
        }
      });
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load clubs.", err, "APP");
    }
  }

  // ==================== LOAD AGENDA ====================
  async function loadAgenda(db) {
    try {
      const { data, error } = await db.from("agenda").select("*").eq("is_active", true).order("sort_order", { ascending: true });
      if (error || !data) return;
      renderAgenda(data.filter(a => a.day_number === 1), "#agendaDay1");
      renderAgenda(data.filter(a => a.day_number === 2), "#agendaDay2");
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load agenda.", err, "APP");
    }
  }

  function renderAgenda(items, sel) {
    const container = $(sel);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:var(--space-xl);">Agenda items will be updated soon.</p>';
      return;
    }
    container.innerHTML = items.map(a =>
      '<div class="agenda-item" data-aos="fade-up">' +
        '<div class="agenda-time">' + escapeHtml(safeText(a.time_slot)) + '</div>' +
        '<div class="agenda-title">' + escapeHtml(safeText(a.title)) + '</div>' +
        '<div class="agenda-desc">' + escapeHtml(safeText(a.description)) + '</div>' +
        (a.location ? '<div class="agenda-location"><i data-lucide="map-pin"></i> ' + escapeHtml(a.location) + '</div>' : '') +
      '</div>'
    ).join("");
  }

  function initAgendaTabs() {
    $$(".agenda-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        $$(".agenda-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        const day = this.dataset.day;
        $("#agendaDay1").style.display = day === "1" ? "block" : "none";
        $("#agendaDay2").style.display = day === "2" ? "block" : "none";
      });
    });
  }

  // ==================== LOAD FOOD MENU ====================
  async function loadFoodMenu(db) {
    try {
      const { data, error } = await db.from("food_menu").select("*").eq("is_active", true).order("sort_order", { ascending: true });
      if (error || !data) return;
      renderFoodMenu(data.filter(f => f.day_number === 1), "#foodMenuDay1");
      renderFoodMenu(data.filter(f => f.day_number === 2), "#foodMenuDay2");
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load food menu.", err, "APP");
    }
  }

  function renderFoodMenu(items, sel) {
    const container = $(sel);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:var(--space-xl);">Menu will be updated soon.</p>';
      return;
    }
    const meals = {};
    items.forEach(item => {
      if (!meals[item.meal_type]) meals[item.meal_type] = [];
      meals[item.meal_type].push(item);
    });
    const icons = { Breakfast: "coffee", Lunch: "utensils", Snacks: "cookie", Dinner: "moon", Beverages: "cup-soda" };
    let html = "";
    for (const [meal, mealItems] of Object.entries(meals)) {
      html += '<div class="food-meal-card"><div class="food-meal-header"><i data-lucide="' + (icons[meal] || "utensils") + '"></i><h4>' + meal + '</h4></div>';
      mealItems.forEach(item => {
        const cls = item.food_type === "VEG" ? "veg" : item.food_type === "NON-VEG" ? "non-veg" : "common";
        html += '<div class="food-item"><div><div class="food-item-name">' + escapeHtml(item.item_name) + '</div>' +
          (item.description ? '<div class="food-item-desc">' + escapeHtml(item.description) + '</div>' : '') +
          '</div><span class="food-type-badge ' + cls + '">' + item.food_type + '</span></div>';
      });
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function initFoodTabs() {
    $$(".food-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        $$(".food-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        const day = this.dataset.fday;
        $("#foodMenuDay1").style.display = day === "1" ? "grid" : "none";
        $("#foodMenuDay2").style.display = day === "2" ? "grid" : "none";
      });
    });
  }

  // ==================== LOAD GROUP LEADERS ====================
  async function loadGroupLeaders(db) {
    try {
      const { data, error } = await db.from("group_leaders").select("*").eq("is_active", true).order("group_number").order("sort_order");
      if (error || !data || !data.length) return;
      const grid = $("#leadersGrid");
      if (!grid) return;
      grid.innerHTML = data.map(l =>
        '<div class="leader-card" data-aos="fade-up">' +
          '<div class="leader-avatar"><i data-lucide="user-round"></i></div>' +
          '<div class="leader-group-badge">Group ' + l.group_number + '</div>' +
          '<h4>' + escapeHtml(safeText(l.leader_name)) + '</h4>' +
          '<div class="leader-role">' + escapeHtml(safeText(l.leader_role)) + (l.leader_club ? ' · ' + escapeHtml(l.leader_club) : '') + '</div>' +
          '<a href="tel:' + escapeHtml(l.contact_number) + '" class="leader-contact"><i data-lucide="phone"></i> ' + escapeHtml(safeText(l.contact_number)) + '</a>' +
        '</div>'
      ).join("");
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load leaders.", err, "APP");
    }
  }

  // ==================== LOAD COLOUR HUNT ====================
  async function loadColourHunt(db) {
    try {
      const { data, error } = await db.from("colour_hunt").select("*").eq("is_active", true).order("sort_order").limit(1);
      if (error || !data || !data.length) return;
      const ch = data[0];
      setText("colourHuntTitle", safeText(ch.title, "Colour Hunt Challenge"));
      setText("colourHuntDesc", safeText(ch.description));
      const details = $("#colourHuntDetails");
      if (details && ch.rules) details.textContent = ch.rules;
      const tags = $("#colourHuntTags");
      if (tags && ch.hashtags) {
        tags.innerHTML = ch.hashtags.split(" ").filter(t => t.startsWith("#")).map(t => '<span class="hashtag">' + escapeHtml(t) + '</span>').join("");
      }
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load colour hunt.", err, "APP");
    }
  }

  // ==================== LOAD TREASURE HUNT ====================
  async function loadTreasureHunt(db) {
    try {
      const { data, error } = await db.from("treasure_hunt").select("*").eq("is_active", true).eq("is_revealed", true).order("sort_order");
      if (error || !data || !data.length) return;
      const container = $("#treasureCluesContainer");
      if (!container) return;
      container.innerHTML = data.map(c =>
        '<div class="clue-item"><h4>Clue #' + c.clue_number + ': ' + escapeHtml(safeText(c.clue_title)) + '</h4>' +
        '<p>' + escapeHtml(safeText(c.clue_text)) + '</p>' +
        (c.hint ? '<p><strong>Hint:</strong> ' + escapeHtml(c.hint) + '</p>' : '') +
        (c.location_hint ? '<p><strong>Location:</strong> ' + escapeHtml(c.location_hint) + '</p>' : '') +
        '</div>'
      ).join("");
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load treasure hunt.", err, "APP");
    }
  }

  // ==================== LOAD FAQs ====================
  async function loadFAQs(db) {
    try {
      const { data, error } = await db.from("faqs").select("*").eq("is_active", true).order("sort_order");
      if (error || !data || !data.length) return;
      const container = $("#faqContainer");
      if (!container) return;
      container.innerHTML = data.map(f =>
        '<div class="faq-item" data-aos="fade-up">' +
          '<div class="faq-question" onclick="toggleFaq(this)"><span>' + escapeHtml(safeText(f.question)) + '</span><i data-lucide="chevron-down"></i></div>' +
          '<div class="faq-answer"><div class="faq-answer-inner">' + escapeHtml(safeText(f.answer)) + '</div></div>' +
        '</div>'
      ).join("");
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load FAQs.", err, "APP");
    }
  }

  window.toggleFaq = function (el) {
    const item = el.parentElement;
    const answer = item.querySelector(".faq-answer");
    const isActive = item.classList.contains("active");
    $$(".faq-item").forEach(fi => {
      fi.classList.remove("active");
      fi.querySelector(".faq-answer").style.maxHeight = null;
    });
    if (!isActive) {
      item.classList.add("active");
      answer.style.maxHeight = answer.scrollHeight + "px";
    }
  };

  // ==================== LOAD ANNOUNCEMENTS ====================
  async function loadAnnouncements(db) {
    try {
      const { data, error } = await db.from("announcements").select("*").eq("is_active", true).eq("show_on_homepage", true).order("created_at", { ascending: false }).limit(1);
      if (error || !data || !data.length) return;
      const bar = $("#announcementBar");
      const text = $("#announcementText");
      if (bar && text) {
        text.textContent = data[0].message || data[0].title;
        bar.style.display = "block";
      }
    } catch (err) {
      if (window.CONFIG) window.CONFIG.error("Failed to load announcements.", err, "APP");
    }
  }

  // ==================== INDIVIDUAL REGISTRATION TRACKER ====================
  function initTracker() {
    const form = document.getElementById("trackerForm");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const riIdEl = document.getElementById("trackerRiId");
      if (!riIdEl) return;
      const riId = riIdEl.value.trim();
      if (!riId) { showToast("Please enter your RI ID", "error"); return; }
      await searchRegistration(riId);
    });

    // Auto-fill from URL
    const params = new URLSearchParams(window.location.search);
    const paramRiId = params.get("ri_id");
    if (paramRiId) {
      const input = document.getElementById("trackerRiId");
      if (input) {
        input.value = paramRiId;
        setTimeout(() => searchRegistration(paramRiId), 1000);
      }
    }
  }

  async function searchRegistration(riId) {
    const db = getDb();
    if (!db) { showToast("System not ready. Please refresh.", "error"); return; }

    const resultEl = document.getElementById("trackerResult");
    const notFoundEl = document.getElementById("trackerNotFound");
    const searchBtn = document.getElementById("trackerSearchBtn");

    if (resultEl) resultEl.style.display = "none";
    if (notFoundEl) notFoundEl.style.display = "none";
    if (searchBtn) {
      searchBtn.disabled = true;
      searchBtn.innerHTML = '<i data-lucide="loader-2"></i> Searching...';
      if (typeof lucide !== "undefined") lucide.createIcons();
    }

    try {
      let { data: member } = await db
        .from("members")
        .select("*, clubs(club_name, group_number), registrations(registration_code, status, created_at, verified_at, rejection_reason)")
        .eq("ri_id", riId)
        .maybeSingle();

      let memberType = "Club";

      if (!member) {
        const { data: dc } = await db
          .from("district_council_registrations")
          .select("*")
          .eq("ri_id", riId)
          .maybeSingle();
        if (dc) {
          member = {
            ...dc,
            clubs: { club_name: dc.portfolio || "District Council", group_number: "DC" },
            registrations: { registration_code: dc.registration_code, status: dc.status, created_at: dc.created_at, verified_at: dc.verified_at, rejection_reason: dc.rejection_reason }
          };
          memberType = "District Council";
        }
      }

      if (!member) {
        if (notFoundEl) { notFoundEl.style.display = "block"; notFoundEl.scrollIntoView({ behavior: "smooth", block: "center" }); }
      } else {
        renderTrackerResult(member, memberType);
        if (resultEl) resultEl.style.display = "block";
      }
    } catch (err) {
      console.error("Tracker error:", err);
      showToast("Search failed. Please try again.", "error");
    }

    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.innerHTML = '<i data-lucide="search"></i> Track Status';
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  function renderTrackerResult(member, type) {
    const container = document.getElementById("trackerResult");
    if (!container) return;

    const status = member.status || member.registrations?.status || "pending";
    const regCode = member.registrations?.registration_code || member.registration_code || "N/A";
    const clubName = member.clubs?.club_name || type;
    const groupNum = member.clubs?.group_number || "DC";
    const memberCode = member.member_code || "N/A";
    const food = member.food_preference || "N/A";
    const isBoard = member.is_board_member ? "Yes" : "No";
    const createdAt = member.registrations?.created_at || member.created_at;
    const verifiedAt = member.registrations?.verified_at || member.verified_at;
    const rejectionReason = member.registrations?.rejection_reason || member.rejection_reason;
    const passGenerated = member.pass_generated || false;
    const attended = member.attendance_checked || false;

    const statusIcons = { approved: "check-circle-2", pending: "clock", rejected: "x-circle" };
    const statusLabels = { approved: "Registration Approved", pending: "Verification Pending", rejected: "Registration Rejected" };

    const steps = [
      { label: "Registered", completed: true, icon: "file-text" },
      { label: "Payment", completed: true, icon: "credit-card" },
      { label: "Verification", completed: status === "approved" || status === "rejected", current: status === "pending", icon: "shield-check" },
      { label: "Approved", completed: status === "approved", current: false, icon: "check-circle" },
      { label: "Pass Ready", completed: passGenerated && status === "approved", current: status === "approved" && !passGenerated, icon: "ticket" },
      { label: "Attended", completed: attended, current: status === "approved" && passGenerated && !attended, icon: "map-pin" }
    ];

    const timelineHtml = steps.map(s => {
      let cls = s.completed ? "completed" : s.current ? "current" : "";
      return '<div class="tracker-timeline-step ' + cls + '"><div class="tracker-step-dot"><i data-lucide="' + s.icon + '"></i></div><div class="tracker-step-label">' + s.label + '</div></div>';
    }).join("");

    const groupDisplay = groupNum === "DC" ? "District Council" : "Group " + groupNum;

    container.innerHTML =
      '<div class="tracker-result-card">' +
        '<div class="tracker-result-header status-' + status + '">' +
          '<div class="tracker-status-icon"><i data-lucide="' + (statusIcons[status] || "help-circle") + '"></i></div>' +
          '<div class="tracker-status-info"><h3>' + escapeHtml(member.full_name || "Member") + '</h3><div class="tracker-status-label">' + (statusLabels[status] || "Unknown") + '</div></div>' +
        '</div>' +
        '<div class="tracker-result-body"><div class="tracker-detail-grid">' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Registration ID</div><div class="tracker-detail-value mono">' + escapeHtml(regCode) + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Member Code</div><div class="tracker-detail-value mono">' + escapeHtml(memberCode) + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">RI ID</div><div class="tracker-detail-value mono">' + escapeHtml(member.ri_id || "N/A") + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Type</div><div class="tracker-detail-value">' + escapeHtml(type) + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Club</div><div class="tracker-detail-value">' + escapeHtml(clubName) + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Group</div><div class="tracker-detail-value">' + groupDisplay + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Food Preference</div><div class="tracker-detail-value">' + escapeHtml(food) + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Board Member</div><div class="tracker-detail-value">' + isBoard + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Registered On</div><div class="tracker-detail-value">' + formatDate(createdAt) + '</div></div>' +
          '<div class="tracker-detail-item"><div class="tracker-detail-label">Verified On</div><div class="tracker-detail-value">' + (verifiedAt ? formatDate(verifiedAt) : "Pending") + '</div></div>' +
        '</div></div>' +
        '<div class="tracker-timeline">' + timelineHtml + '</div>' +
        (status === "approved" ? '<div class="tracker-result-footer"><a href="pass.html?ri_id=' + encodeURIComponent(member.ri_id || "") + '&email=' + encodeURIComponent(member.email || "") + '" class="btn btn-primary"><i data-lucide="download"></i> Download Pass</a></div>' : "") +
        (status === "rejected" ? '<div class="tracker-result-footer" style="background:var(--red-light);"><p style="color:var(--red);font-weight:600;margin:0;text-align:center;"><strong>Reason:</strong> ' + escapeHtml(rejectionReason || "Contact the organizing team") + '</p></div>' : "") +
        (status === "pending" ? '<div class="tracker-result-footer" style="background:var(--orange-light);"><p style="color:var(--orange);font-weight:600;margin:0;text-align:center;"><i data-lucide="clock" style="width:16px;height:16px;display:inline;vertical-align:middle;"></i> Your payment is under verification. We will notify you via email once approved.</p></div>' : "") +
      '</div>';

    if (typeof lucide !== "undefined") lucide.createIcons();
    setTimeout(() => container.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
  }

  // ==================== REGISTRATION TABS ====================
  function initRegTabs() {
    $$(".reg-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        $$(".reg-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        $$(".reg-form-container").forEach(c => c.classList.remove("active"));
        const panel = $("#tab-" + this.dataset.tab);
        if (panel) panel.classList.add("active");
      });
    });
  }

  // ==================== SMOOTH SCROLL ====================
  function initSmoothScroll() {
    $$('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener("click", function (e) {
        const href = this.getAttribute("href");
        if (href === "#") return;
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  // ==================== INIT EVERYTHING ====================
  function initApp() {
    initNavbar();
    initCountdown();
    initAgendaTabs();
    initFoodTabs();
    initRegTabs();
    initSmoothScroll();
    initTracker();

    // Wait for DB then load all content
    waitForDb(async (db) => {
      await Promise.allSettled([
        loadSiteContent(db),
        loadClubs(db),
        loadAgenda(db),
        loadFoodMenu(db),
        loadGroupLeaders(db),
        loadColourHunt(db),
        loadTreasureHunt(db),
        loadFAQs(db),
        loadAnnouncements(db)
      ]);

      if (typeof lucide !== "undefined") lucide.createIcons();
      if (typeof AOS !== "undefined") AOS.refresh();

      if (window.CONFIG) window.CONFIG.log("All content modules loaded successfully.", "APP");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();