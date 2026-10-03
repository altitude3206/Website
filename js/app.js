/**
 * ============================================================
 * ALTITUDE - MAIN APPLICATION LOGIC v14.0 (CONSOLIDATED)
 * ============================================================
 * Centralized config.js Integration - Single DB Instance
 * Powers index.html with Dynamic Supabase Content
 * Fully Responsive, Touch-Optimized, and Error-Free
 * ============================================================
 */

(function () {
  "use strict";

  // ==================== STATE MANAGEMENT ====================
  const STATE = {
    db: null,
    clubs: []
  };

  // ==================== SAFE LOGGING ====================
  function logWarn(msg, tag = "APP") {
    if (window.CONFIG && typeof window.CONFIG.warn === "function") window.CONFIG.warn(msg, tag);
    else console.warn(`[${tag}] ${msg}`);
  }
  function logError(msg, err, tag = "APP") {
    if (window.CONFIG && typeof window.CONFIG.error === "function") window.CONFIG.error(msg, err, tag);
    else console.error(`[${tag}] ${msg}`, err || "");
  }
  function logInfo(msg, tag = "APP") {
    if (window.CONFIG && typeof window.CONFIG.log === "function") window.CONFIG.log(msg, tag);
    else console.log(`[${tag}] ${msg}`);
  }
  function refreshIcons() {
    if (typeof lucide !== "undefined" && lucide.createIcons) lucide.createIcons();
  }
  function refreshAos() {
    if (typeof AOS !== "undefined") {
      if (AOS.refreshHard) AOS.refreshHard(); else AOS.refresh();
    }
  }

  // ==================== DATABASE ACCESS ====================
  /**
   * Retrieves the centralized, single Supabase instance from config.js
   */
  function getDb() {
    return window.db || null;
  }

  /**
   * Promise-wrapped helper ensuring database connection before loaders execute
   * @param {number} maxWait - Timeout limit in milliseconds
   * @returns {Promise<object>} Resolved database instance
   */
  function waitForDb(maxWait = 8000) {
    return new Promise((resolve, reject) => {
      const activeDb = getDb();
      if (activeDb) {
        STATE.db = activeDb;
        return resolve(activeDb);
      }

      const startTime = Date.now();
      let check = null;
      const finish = (found) => {
        clearInterval(check);
        window.removeEventListener("dbReady", onReady);
        STATE.db = found;
        resolve(found);
      };
      const onReady = (e) => {
        const resolvedDb = (e.detail && e.detail.db) || getDb();
        if (resolvedDb) finish(resolvedDb);
      };
      window.addEventListener("dbReady", onReady);
      check = setInterval(() => {
        const currentDb = getDb();
        if (currentDb) return finish(currentDb);
        if (Date.now() - startTime > maxWait) {
          clearInterval(check);
          window.removeEventListener("dbReady", onReady);
          const warnMsg = "Database connection timed out.";
          logWarn(warnMsg);
          reject(new Error(warnMsg));
        }
      }, 200);
    });
  }

  // ==================== DOM & UI HELPERS ====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function showToast(message, type = "success") {
    const toast = $("#toast");
    const msg = $("#toastMessage");
    if (!toast || !msg) return;

    msg.textContent = message;
    toast.className = `toast ${type}`;
    const oldIcon = toast.querySelector(".toast-icon");
    if (oldIcon) {
      const fresh = document.createElement("i");
      fresh.className = "toast-icon";
      fresh.setAttribute(
        "data-lucide",
        type === "error" ? "alert-circle" : type === "warning" ? "alert-triangle" : "check-circle"
      );
      oldIcon.replaceWith(fresh);
    }
    toast.classList.add("show");
    refreshIcons();
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 4000);
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

  // Only overwrite the built-in default text when the database actually has a value
  function setTextIf(id, val) {
    if (val != null && String(val).trim() !== "") setText(id, String(val));
  }

  /**
   * Fast, secure HTML escaper using regex-based lookup (prevents memory churn)
   */
  function escapeHtml(str) {
    if (str == null) return "";
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return String(str).replace(/[&<>"']/g, (m) => map[m]);
  }

  function formatDate(d) {
    if (!d) return "N/A";
    try {
      const date = new Date(d);
      if (isNaN(date.getTime())) return "N/A";
      return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      });
    } catch {
      return "N/A";
    }
  }

  // ==================== NAVBAR & NAVIGATION ====================
  function initNavbar() {
    const navbar = $("#navbar");
    const toggle = $("#navToggle");
    const menu = $("#navMenu");
    if (!navbar) return;

    let ticking = false;
    function onScroll() {
      navbar.classList.toggle("scrolled", window.scrollY > 60);
      highlightActiveNav();
      ticking = false;
    }
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(onScroll);
    }, { passive: true });
    onScroll();

    if (toggle && menu) {
      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        toggle.classList.toggle("active");
        menu.classList.toggle("active");
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && menu.classList.contains("active")) {
          toggle.setAttribute("aria-expanded", "false");
          toggle.classList.remove("active");
          menu.classList.remove("active");
          toggle.focus();
        }
      });

      menu.querySelectorAll(".nav-link").forEach(link => {
        link.addEventListener("click", () => {
          toggle.setAttribute("aria-expanded", "false");
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
      link.classList.toggle("active", link.getAttribute("href") === `#${current}`);
    });
  }

  // ==================== HIGH-PRECISION COUNTDOWN ====================
  function initCountdown() {
    const target = new Date("2026-12-12T06:00:00+05:30").getTime();
    const prev = {};
    let timer = null;

    function update() {
      const diff = target - Date.now();
      if (diff <= 0) {
        if (timer) clearInterval(timer);
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

          const el = document.getElementById(id);
          if (el) {
            el.classList.remove("flip");
            void el.offsetWidth; // Force layout reflow for smooth keyframes
            el.classList.add("flip");
          }
        }
      }
    }
    update();
    timer = setInterval(update, 1000);
  }

  // ==================== LOAD SITE CONTENT ====================
  async function loadSiteContent(db) {
    try {
      const { data, error } = await db.from("site_content").select("*").eq("is_active", true);
      if (error || !data) return;

      const map = {};
      data.forEach(row => { map[row.section_key] = row; });

      // Hero Content
      if (map.hero) {
        const extra = map.hero.extra_data || {};
        setTextIf("heroSubtitle", extra.subtitle);
        setTextIf("heroDate", extra.date);
        setTextIf("heroLocation", extra.location);
      }

      // About Content
      if (map.about) {
        setTextIf("aboutTitle", map.about.title);
        setTextIf("aboutContent", map.about.content);
        const highlights = Array.isArray(map.about.extra_data?.highlights) ? map.about.extra_data.highlights : [];
        const hlContainer = $("#aboutHighlights");
        if (hlContainer && highlights.length) {
          hlContainer.innerHTML = highlights
            .map(h => `<div class="highlight-item"><i data-lucide="check-circle-2"></i> ${escapeHtml(h)}</div>`)
            .join("");
        }
      }

      // Event Chair Vitals
      if (map.event_chair) {
        setTextIf("chairTitle", map.event_chair.title);
        setTextIf("chairName", map.event_chair.content);
        const extra = map.event_chair.extra_data || {};
        setTextIf("chairDesignation", extra.designation);
        setTextIf("chairMessage", extra.message);
      }

      // Host Club Alliance
      if (map.host_clubs) {
        const clubs = Array.isArray(map.host_clubs.extra_data?.clubs) ? map.host_clubs.extra_data.clubs : [];
        const container = $("#hostClubsList");
        if (container && clubs.length) {
          container.innerHTML = clubs.map(c => `<div class="host-club-badge">${escapeHtml(c)}</div>`).join("");
        }
      }

      // Compliance / Terms & Conditions
      if (map.terms_conditions) {
        const terms = Array.isArray(map.terms_conditions.extra_data?.terms) ? map.terms_conditions.extra_data.terms : [];
        const list = $("#termsList");
        if (list && terms.length) {
          list.innerHTML = terms.map(t => `<li>${escapeHtml(t)}</li>`).join("");
        }
      }

      // Dynamic Registration Closed Notice
      if (map.registration_status) {
        const isOpen = map.registration_status.extra_data?.is_open;
        if (isOpen === false) {
          const regSection = $("#register");
          if (regSection && !regSection.querySelector(".reg-closed-notice")) {
            const container = regSection.querySelector(".container");
            if (container) {
              const notice = document.createElement("div");
              notice.className = "reg-closed-notice";
              notice.innerHTML = '<i data-lucide="lock"></i> <span>Registrations are currently closed.</span>';
              container.prepend(notice);
            }
          }
          ["submitClubReg", "submitDcReg"].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
              btn.disabled = true;
              btn.setAttribute("aria-disabled", "true");
            }
          });
        }
      }
    } catch (err) {
      logError("Failed to load site content.", err);
    }
  }

  // ==================== LOAD CLUBS WITH SEAT ALLOCATION ====================
  async function loadClubs(db) {
    try {
      const { data, error } = await db
        .from("clubs")
        .select("id, club_name, group_number, max_registrations, current_registrations")
        .eq("is_active", true)
        .order("club_name", { ascending: true });

      if (error || !data) return;
      STATE.clubs = data;
      window.CLUBS_DATA = data;

      const select = $("#clubSelect");
      if (!select) return;

      const groups = {};
      data.forEach(c => {
        const key = c.group_number == null ? "" : String(c.group_number);
        (groups[key] = groups[key] || []).push(c);
      });
      const groupKeys = Object.keys(groups).sort((a, b) => {
        if (a === "") return 1;
        if (b === "") return -1;
        return a.localeCompare(b, undefined, { numeric: true });
      });

      let html = '<option value="">Select Your Club</option>';
      for (const g of groupKeys) {
        html += `<optgroup label="${g === "" ? "Other" : "Group " + escapeHtml(g)}">`;
        groups[g].forEach(c => {
          const avail = (Number(c.max_registrations) || 0) - (Number(c.current_registrations) || 0);
          const disabled = avail <= 0 ? "disabled" : "";
          const label = avail <= 0 ? " (Full)" : "";
          html += `<option value="${escapeHtml(c.id)}" data-group="${escapeHtml(g)}" data-available="${avail}" ${disabled}>${escapeHtml(c.club_name)}${label}</option>`;
        });
        html += "</optgroup>";
      }
      select.innerHTML = html;
      window.dispatchEvent(new CustomEvent("clubsLoaded", { detail: { clubs: data } }));

      select.addEventListener("change", function () {
        const opt = this.options[this.selectedIndex];
        const groupDisplay = $("#groupDisplay");
        const slotsInfo = $("#slotsInfo");

        if (groupDisplay) {
          groupDisplay.value = opt && opt.dataset.group ? `Group ${opt.dataset.group}` : "";
        }
        if (slotsInfo) {
          const avail = opt && opt.dataset.available;
          if (avail !== undefined && avail !== "") {
            slotsInfo.textContent = `${avail} seat${Number(avail) === 1 ? "" : "s"} available`;
            slotsInfo.style.display = "block";
          } else {
            slotsInfo.textContent = "";
            slotsInfo.style.display = "none";
          }
        }
      });
    } catch (err) {
      logError("Failed to load clubs.", err);
    }
  }

  // ==================== LOAD AGENDA ====================
  async function loadAgenda(db) {
    try {
      const { data, error } = await db
        .from("agenda")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error || !data) return;

      renderAgenda(data.filter(a => Number(a.day_number) === 1), "#agendaDay1");
      renderAgenda(data.filter(a => Number(a.day_number) === 2), "#agendaDay2");
    } catch (err) {
      logError("Failed to load agenda.", err);
    }
  }

  function renderAgenda(items, sel) {
    const container = $(sel);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:var(--space-xl);">Agenda items will be updated soon.</p>';
      return;
    }
    container.innerHTML = items.map(a => `
      <div class="agenda-item" data-aos="fade-up">
        <div class="agenda-time">${escapeHtml(safeText(a.time_slot))}</div>
        <div class="agenda-title">${escapeHtml(safeText(a.title))}</div>
        <div class="agenda-desc">${escapeHtml(safeText(a.description))}</div>
        ${a.location ? `<div class="agenda-location"><i data-lucide="map-pin"></i> ${escapeHtml(a.location)}</div>` : ""}
      </div>
    `).join("");
  }

  function initAgendaTabs() {
    $$(".agenda-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        $$(".agenda-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        const day = this.dataset.day;
        const d1 = $("#agendaDay1");
        const d2 = $("#agendaDay2");
        if (d1) d1.style.display = day === "1" ? "block" : "none";
        if (d2) d2.style.display = day === "2" ? "block" : "none";
        refreshAos();
      });
    });
  }

  // ==================== LOAD CATERING MENU ====================
  async function loadFoodMenu(db) {
    try {
      const { data, error } = await db
        .from("food_menu")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error || !data) return;

      renderFoodMenu(data.filter(f => Number(f.day_number) === 1), "#foodMenuDay1");
      renderFoodMenu(data.filter(f => Number(f.day_number) === 2), "#foodMenuDay2");
    } catch (err) {
      logError("Failed to load food menu.", err);
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
      const key = item.meal_type || "Other";
      (meals[key] = meals[key] || []).push(item);
    });

    const icons = { Breakfast: "coffee", Lunch: "utensils", Snacks: "cookie", Dinner: "moon", Beverages: "cup-soda" };
    let html = "";
    for (const [meal, mealItems] of Object.entries(meals)) {
      html += `
        <div class="food-meal-card">
          <div class="food-meal-header">
            <i data-lucide="${icons[meal] || "utensils"}"></i>
            <h4>${escapeHtml(meal)}</h4>
          </div>
      `;
      mealItems.forEach(item => {
        const cls = item.food_type === "VEG" ? "veg" : item.food_type === "NON-VEG" ? "non-veg" : "common";
        html += `
          <div class="food-item">
            <div>
              <div class="food-item-name">${escapeHtml(item.item_name)}</div>
              ${item.description ? `<div class="food-item-desc">${escapeHtml(item.description)}</div>` : ""}
            </div>
            <span class="food-type-badge ${cls}">${escapeHtml(item.food_type || "COMMON")}</span>
          </div>
        `;
      });
      html += "</div>";
    }
    container.innerHTML = html;
  }

  function initFoodTabs() {
    $$(".food-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        $$(".food-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        const day = this.dataset.fday;
        const d1 = $("#foodMenuDay1");
        const d2 = $("#foodMenuDay2");
        if (d1) d1.style.display = day === "1" ? "grid" : "none";
        if (d2) d2.style.display = day === "2" ? "grid" : "none";
        refreshAos();
      });
    });
  }

  // ==================== LOAD GROUP MARSHALS ====================
  async function loadGroupLeaders(db) {
    try {
      const { data, error } = await db
        .from("group_leaders")
        .select("*")
        .eq("is_active", true)
        .order("group_number")
        .order("sort_order");
      if (error || !data || !data.length) return;

      const grid = $("#leadersGrid");
      if (!grid) return;
      grid.innerHTML = data.map(l => `
        <div class="leader-card" data-aos="fade-up">
          <div class="leader-avatar"><i data-lucide="user-round"></i></div>
          <div class="leader-group-badge">Group ${escapeHtml(l.group_number)}</div>
          <h4>${escapeHtml(safeText(l.leader_name))}</h4>
          <div class="leader-role">${escapeHtml(safeText(l.leader_role))}${l.leader_club ? ` · ${escapeHtml(l.leader_club)}` : ""}</div>
          ${l.contact_number ? `<a href="tel:${escapeHtml(String(l.contact_number).replace(/[^\d+]/g, ""))}" class="leader-contact">
            <i data-lucide="phone"></i> ${escapeHtml(l.contact_number)}
          </a>` : ""}
        </div>
      `).join("");
    } catch (err) {
      logError("Failed to load leaders.", err);
    }
  }

  // ==================== LOAD COLOUR HUNT MODULE ====================
  async function loadColourHunt(db) {
    try {
      const { data, error } = await db
        .from("colour_hunt")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .limit(1);
      if (error || !data || !data.length) return;

      const ch = data[0];
      setText("colourHuntTitle", safeText(ch.title, "Colour Hunt Challenge"));
      setText("colourHuntDesc", safeText(ch.description));

      const details = $("#colourHuntDetails");
      if (details && ch.rules) {
        details.innerHTML = String(ch.rules)
          .split(/\r?\n/)
          .filter(line => line.trim())
          .map(line => `<p>${escapeHtml(line.trim())}</p>`)
          .join("");
      }

      const tags = $("#colourHuntTags");
      if (tags && ch.hashtags) {
        tags.innerHTML = (Array.isArray(ch.hashtags) ? ch.hashtags.map(String) : String(ch.hashtags).split(/\s+/))
          .filter(t => t.startsWith("#"))
          .map(t => `<span class="hashtag">${escapeHtml(t)}</span>`)
          .join("");
      }
    } catch (err) {
      logError("Failed to load colour hunt.", err);
    }
  }

  // ==================== LOAD TREASURE HUNT MODULE ====================
  async function loadTreasureHunt(db) {
    try {
      const { data, error } = await db
        .from("treasure_hunt")
        .select("*")
        .eq("is_active", true)
        .eq("is_revealed", true)
        .order("sort_order");
      if (error || !data || !data.length) return;

      const container = $("#treasureCluesContainer");
      if (!container) return;
      container.innerHTML = data.map(c => `
        <div class="clue-item">
          <h4>Clue #${escapeHtml(c.clue_number)}: ${escapeHtml(safeText(c.clue_title))}</h4>
          <p>${escapeHtml(safeText(c.clue_text))}</p>
          ${c.hint ? `<p><strong>Hint:</strong> ${escapeHtml(c.hint)}</p>` : ""}
          ${c.location_hint ? `<p><strong>Location:</strong> ${escapeHtml(c.location_hint)}</p>` : ""}
        </div>
      `).join("");
    } catch (err) {
      logError("Failed to load treasure hunt.", err);
    }
  }

  // ==================== LOAD FAQs ====================
  async function loadFAQs(db) {
    try {
      const { data, error } = await db
        .from("faqs")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error || !data || !data.length) return;

      const container = $("#faqContainer");
      if (!container) return;
      container.innerHTML = data.map(f => `
        <div class="faq-item" data-aos="fade-up">
          <div class="faq-question" role="button" tabindex="0" aria-expanded="false">
            <span>${escapeHtml(safeText(f.question))}</span>
            <i data-lucide="chevron-down"></i>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">${escapeHtml(safeText(f.answer))}</div>
          </div>
        </div>
      `).join("");
    } catch (err) {
      logError("Failed to load FAQs.", err);
    }
  }

  function toggleFaq(el) {
    const item = el.parentElement;
    if (!item) return;
    const answer = item.querySelector(".faq-answer");
    const isActive = item.classList.contains("active");

    $$(".faq-item").forEach(fi => {
      fi.classList.remove("active");
      const fa = fi.querySelector(".faq-answer");
      if (fa) fa.style.maxHeight = null;
      const fq = fi.querySelector(".faq-question");
      if (fq) fq.setAttribute("aria-expanded", "false");
    });

    if (!isActive && answer) {
      item.classList.add("active");
      el.setAttribute("aria-expanded", "true");
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    }
  }
  window.toggleFaq = toggleFaq; // kept for backward compatibility

  function initFaq() {
    const container = document.getElementById("faqContainer");
    if (!container) return;
    container.addEventListener("click", (e) => {
      const q = e.target.closest(".faq-question");
      if (q && container.contains(q)) toggleFaq(q);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const q = e.target.closest(".faq-question");
      if (q && container.contains(q)) {
        e.preventDefault();
        toggleFaq(q);
      }
    });
    window.addEventListener("resize", () => {
      const open = container.querySelector(".faq-item.active .faq-answer");
      if (open) open.style.maxHeight = `${open.scrollHeight}px`;
    }, { passive: true });
  }

  // ==================== LOAD ANNOUNCEMENTS ====================
  async function loadAnnouncements(db) {
    try {
      const { data, error } = await db
        .from("announcements")
        .select("*")
        .eq("is_active", true)
        .eq("show_on_homepage", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error || !data || !data.length) return;

      const bar = $("#announcementBar");
      const text = $("#announcementText");
      const msg = data[0].message || data[0].title;
      if (bar && text && msg) {
        let dismissed = false;
        try { dismissed = sessionStorage.getItem("altitudeAnnouncementClosed") === msg; } catch (e) { /* private mode */ }
        if (dismissed) return;
        text.textContent = msg;
        bar.style.display = "block";
        syncAnnouncementOffset();
      }
    } catch (err) {
      logError("Failed to load announcements.", err);
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
    let db = STATE.db || getDb();
    if (!db) {
      try { db = await waitForDb(5000); } catch (e) { /* handled below */ }
    }
    if (!db) { showToast("System not ready. Please refresh.", "error"); return; }

    const resultEl = document.getElementById("trackerResult");
    const notFoundEl = document.getElementById("trackerNotFound");
    const searchBtn = document.getElementById("trackerSearchBtn");

    if (resultEl) resultEl.style.display = "none";
    if (notFoundEl) notFoundEl.style.display = "none";
    const originalBtnHtml = searchBtn ? searchBtn.innerHTML : "";
    if (searchBtn) {
      searchBtn.disabled = true;
      searchBtn.innerHTML = '<i data-lucide="loader-2"></i> Searching...';
      refreshIcons();
    }

    try {
      const { data: foundMember, error: memberErr } = await db
        .from("members")
        .select("*, clubs(club_name, group_number), registrations(registration_code, status, created_at, verified_at, rejection_reason)")
        .eq("ri_id", riId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (memberErr) throw memberErr;
      let member = foundMember;

      let memberType = "Club";

      if (!member) {
        const { data: dc, error: dcErr } = await db
          .from("district_council_registrations")
          .select("*")
          .eq("ri_id", riId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (dcErr) throw dcErr;
        if (dc) {
          member = {
            ...dc,
            clubs: { club_name: dc.portfolio || "District Council", group_number: "DC" },
            registrations: {
              registration_code: dc.registration_code,
              status: dc.status,
              created_at: dc.created_at,
              verified_at: dc.verified_at,
              rejection_reason: dc.rejection_reason
            }
          };
          memberType = "District Council";
        }
      }

      if (!member) {
        if (notFoundEl) {
          notFoundEl.style.display = "block";
          notFoundEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        renderTrackerResult(member, memberType);
        if (resultEl) resultEl.style.display = "block";
      }
    } catch (err) {
      logError("Tracker error:", err);
      showToast("Search failed. Please try again.", "error");
    } finally {
      if (searchBtn) {
        searchBtn.disabled = false;
        searchBtn.innerHTML = originalBtnHtml || '<i data-lucide="search"></i> Track';
        refreshIcons();
      }
    }
  }

  function renderTrackerResult(member, type) {
    const container = document.getElementById("trackerResult");
    if (!container) return;
    if (Array.isArray(member.registrations)) member = { ...member, registrations: member.registrations[0] || null };

    const status = String(member.status || member.registrations?.status || "pending").toLowerCase();
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
      const cls = s.completed ? "completed" : s.current ? "current" : "";
      return `
        <div class="tracker-timeline-step ${cls}">
          <div class="tracker-step-dot"><i data-lucide="${s.icon}"></i></div>
          <div class="tracker-step-label">${escapeHtml(s.label)}</div>
        </div>
      `;
    }).join("");

    const groupDisplay = groupNum === "DC" ? "District Council" : `Group ${groupNum}`;

    container.innerHTML = `
      <div class="tracker-result-card">
        <div class="tracker-result-header status-${escapeHtml(status)}">
          <div class="tracker-status-icon"><i data-lucide="${statusIcons[status] || "help-circle"}"></i></div>
          <div class="tracker-status-info">
            <h3>${escapeHtml(member.full_name || "Member")}</h3>
            <div class="tracker-status-label">${escapeHtml(statusLabels[status] || "Unknown")}</div>
          </div>
        </div>
        <div class="tracker-result-body">
          <div class="tracker-detail-grid">
            <div class="tracker-detail-item"><div class="tracker-detail-label">Registration ID</div><div class="tracker-detail-value mono">${escapeHtml(regCode)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Member Code</div><div class="tracker-detail-value mono">${escapeHtml(memberCode)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">RI ID</div><div class="tracker-detail-value mono">${escapeHtml(member.ri_id || "N/A")}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Type</div><div class="tracker-detail-value">${escapeHtml(type)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Club</div><div class="tracker-detail-value">${escapeHtml(clubName)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Group</div><div class="tracker-detail-value">${escapeHtml(groupDisplay)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Food Preference</div><div class="tracker-detail-value">${escapeHtml(food)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Board Member</div><div class="tracker-detail-value">${escapeHtml(isBoard)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Registered On</div><div class="tracker-detail-value">${formatDate(createdAt)}</div></div>
            <div class="tracker-detail-item"><div class="tracker-detail-label">Verified On</div><div class="tracker-detail-value">${verifiedAt ? formatDate(verifiedAt) : "Pending"}</div></div>
          </div>
        </div>
        <div class="tracker-timeline">${timelineHtml}</div>
        ${status === "approved" ? `
          <div class="tracker-result-footer">
            <a href="pass.html?ri_id=${encodeURIComponent(member.ri_id || "")}&email=${encodeURIComponent(member.email || "")}" class="btn btn-primary">
              <i data-lucide="download"></i> Download Pass
            </a>
          </div>` : ""
        }
        ${status === "rejected" ? `
          <div class="tracker-result-footer" style="background:var(--red-light);">
            <p style="color:var(--red);font-weight:600;margin:0;text-align:center;">
              <strong>Reason:</strong> ${escapeHtml(rejectionReason || "Contact the organizing team")}
            </p>
          </div>` : ""
        }
        ${status === "pending" ? `
          <div class="tracker-result-footer" style="background:var(--orange-light);">
            <p style="color:var(--orange);font-weight:600;margin:0;text-align:center;">
              <i data-lucide="clock" style="width:16px;height:16px;display:inline;vertical-align:middle;"></i>
              Your payment is under verification. We will notify you via email once approved.
            </p>
          </div>` : ""
        }
      </div>
    `;

    refreshIcons();
    setTimeout(() => container.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
  }

  // ==================== REGISTRATION TABS ====================
  function initRegTabs() {
    $$(".reg-tab").forEach(tab => {
      tab.addEventListener("click", function () {
        $$(".reg-tab").forEach(t => t.classList.remove("active"));
        this.classList.add("active");
        $$(".reg-form-container").forEach(c => c.classList.remove("active"));
        const panel = $(`#tab-${this.dataset.tab}`);
        if (panel) panel.classList.add("active");
        refreshAos();
      });
    });
  }

  // ==================== SMOOTH SCROLL ====================
  function initSmoothScroll() {
    $$('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener("click", function (e) {
        const href = this.getAttribute("href");
        if (href === "#") return;
        let target = null;
        try { target = document.querySelector(href); } catch (err) { return; }
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
          try { history.pushState(null, "", href); } catch (err) { /* file:// etc. */ }
        }
      });
    });
  }

  // ==================== MEMBER ENTRIES: REMOVE BUTTON UX ====================
  function entryHasData(entry) {
    return Array.from(entry.querySelectorAll("input, select, textarea")).some(el => {
      if (el.type === "hidden" || el.type === "button" || el.type === "submit") return false;
      if (el.type === "checkbox" || el.type === "radio") return false;
      if (el.type === "file") return el.files && el.files.length > 0;
      return String(el.value || "").trim() !== "";
    });
  }

  function isRemoveBtnClean(btn) {
    const nodes = Array.from(btn.childNodes).filter(n => n.nodeType === 1 || n.textContent.trim());
    if (nodes.length !== 2) return false;
    const [icon, label] = nodes;
    const cls = icon.nodeType === 1 ? (icon.getAttribute("class") || "") : "";
    const iconOk = icon.nodeType === 1 && (icon.getAttribute("data-lucide") === "trash-2" || /lucide-trash-2/.test(cls));
    return iconOk && label.nodeType === 1 && label.classList.contains("remove-label");
  }

  // Normalises every remove button to ONE trash icon (+ screen-reader label). Safe to run repeatedly.
  function enhanceRemoveButtons(root) {
    root.querySelectorAll(".member-entry").forEach(entry => {
      entry.querySelectorAll(".remove-member-btn").forEach((b, i) => { if (i > 0) b.remove(); });
    });
    let needIcons = false;
    root.querySelectorAll(".remove-member-btn").forEach(btn => {
      if (btn.tagName === "BUTTON") btn.type = "button";
      else { btn.setAttribute("role", "button"); btn.tabIndex = 0; }
      const entry = btn.closest(".member-entry");
      const heading = entry && entry.querySelector("h4");
      const title = heading ? heading.textContent.trim() : "";
      const confirming = btn.classList.contains("confirm");
      btn.setAttribute("title", confirming ? "Tap again to confirm" : "Remove this member");
      btn.setAttribute("aria-label", confirming
        ? `Tap again to confirm removing ${title || "this member"}`
        : (title ? `Remove ${title}` : "Remove this member"));
      if (isRemoveBtnClean(btn)) return;
      btn.textContent = "";
      const icon = document.createElement("i");
      icon.setAttribute("data-lucide", "trash-2");
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "remove-label";
      label.textContent = confirming ? "Confirm?" : "Remove";
      btn.append(icon, label);
      needIcons = true;
    });
    if (needIcons) refreshIcons();
  }

  function setRemoveConfirm(btn, on) {
    btn.classList.toggle("confirm", on);
    const label = btn.querySelector(".remove-label");
    if (label) label.textContent = on ? "Confirm?" : "Remove";
    enhanceRemoveButtons(btn.closest(".member-entry") || document);
  }

  function initMemberEntries() {
    const container = document.getElementById("membersContainer");
    if (!container) return;
    container.setAttribute("aria-live", "polite");
    enhanceRemoveButtons(container);

    // Two-step removal for entries that already contain data (prevents accidental loss)
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".remove-member-btn");
      if (!btn || !container.contains(btn)) return;
      const entry = btn.closest(".member-entry");
      if (!entry || btn.classList.contains("confirm") || !entryHasData(entry)) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setRemoveConfirm(btn, true);
      clearTimeout(btn._confirmTimer);
      btn._confirmTimer = setTimeout(() => setRemoveConfirm(btn, false), 3000);
    }, true);

    // Re-normalise whenever registration.js adds, renumbers or re-renders entries
    if (typeof MutationObserver === "undefined") return;
    let queued = false;
    new MutationObserver(mutations => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        enhanceRemoveButtons(container);
        const added = [];
        mutations.forEach(m => m.addedNodes.forEach(n => {
          if (n.nodeType === 1 && n.classList.contains("member-entry")) added.push(n);
        }));
        if (added.length === 1) added[0].scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }).observe(container, { childList: true, subtree: true, characterData: true });
  }

  // ==================== ANNOUNCEMENT BAR (no overlap with fixed navbar) ====================
  function syncAnnouncementOffset() {
    const bar = $("#announcementBar");
    const visible = bar && bar.style.display !== "none";
    document.documentElement.style.setProperty("--announce-h", visible ? `${bar.offsetHeight}px` : "0px");
  }

  function initAnnouncement() {
    const bar = $("#announcementBar");
    const closeBtn = bar && bar.querySelector(".close-announcement");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        bar.style.display = "none";
        try { sessionStorage.setItem("altitudeAnnouncementClosed", $("#announcementText").textContent); } catch (e) { /* private mode */ }
        syncAnnouncementOffset();
      });
    }
    window.addEventListener("resize", syncAnnouncementOffset, { passive: true });
  }

  // ==================== SUCCESS MODAL ====================
  function initSuccessModal() {
    const modal = $("#successModal");
    if (!modal) return;
    const close = () => modal.classList.remove("active");
    const btn = $("#successModalClose");
    if (btn) btn.addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("active")) close();
    });
  }

  // ==================== ACCESSIBLE TABS (ARIA + arrow keys) ====================
  function syncTabs(tabs) {
    tabs.forEach(t => {
      const on = t.classList.contains("active");
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
  }

  function initTabAria() {
    ["#register .reg-tabs", ".agenda-tabs", ".food-tabs"].forEach(sel => {
      const list = $(sel);
      if (!list) return;
      list.setAttribute("role", "tablist");
      const tabs = Array.from(list.querySelectorAll("button"));
      syncTabs(tabs);
      list.addEventListener("click", () => requestAnimationFrame(() => syncTabs(tabs)));
      list.addEventListener("keydown", (e) => {
        const i = tabs.indexOf(document.activeElement);
        if (i < 0 || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const n = e.key === "Home" ? 0
          : e.key === "End" ? tabs.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[n].focus();
        tabs[n].click();
      });
    });
  }

  // ==================== FALLBACK WHEN DATABASE IS UNREACHABLE ====================
  function showOfflineFallbacks() {
    renderAgenda([], "#agendaDay1");
    renderAgenda([], "#agendaDay2");
    renderFoodMenu([], "#foodMenuDay1");
    renderFoodMenu([], "#foodMenuDay2");
    const faq = $("#faqContainer");
    if (faq && !faq.children.length) {
      faq.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:var(--space-xl);">FAQs could not be loaded. Please refresh the page.</p>';
    }
    const terms = $("#termsList");
    if (terms && !terms.children.length) {
      terms.innerHTML = "<li>Terms &amp; conditions could not be loaded. Please refresh the page.</li>";
    }
    refreshIcons();
  }

  // ==================== INITIALIZATION ====================
  async function initApp() {
    initNavbar();
    initCountdown();
    initAgendaTabs();
    initFoodTabs();
    initRegTabs();
    initSmoothScroll();
    initTracker();
    initFaq();
    initMemberEntries();
    initAnnouncement();
    initSuccessModal();
    initTabAria();

    try {
      const db = await waitForDb();
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

      refreshIcons();
      refreshAos();
      logInfo("Database parameters synced.");
    } catch (err) {
      console.error("[APP] Initialization failed:", err);
      showOfflineFallbacks();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
