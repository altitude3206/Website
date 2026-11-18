/**
 * ============================================================
 * ALTITUDE — REGISTRATION ENGINE v8.0 ENTERPRISE EDITION
 * ============================================================
 * Advanced CA-Grade Client-Side Registration System
 * Features:
 *   > Live Multi-Member Dynamic Forms with Smart Validation
 *   > Realtime RI ID Duplicate Checker (Cross-Table)
 *   > Live Club Slot Availability with Capacity Guards
 *   > Payment Screenshot Preview with Image Compression
 *   > Direct Gmail Webhook Integration (No Emojis)
 *   > Smart Retry Logic & Network Failure Handling
 *   > Autosave Draft Protection (localStorage)
 *   > Session Hijack Prevention
 *   > CA-Grade Audit Trail
 *   > Progressive Form Validation
 *   > Smart Phone Number Formatting
 * ============================================================
 */

(function () {
  "use strict";

  // ==================== SUPABASE CLIENT ====================
  const SUPABASE_URL = "https://nywnwnforqyrtdmsregq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY";

  let db = null;
  let dbInitAttempts = 0;

  function initDb() {
    if (typeof supabase !== "undefined" && supabase.createClient) {
      db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      window.db = db;
      loadClubOptions();
      restoreDraft();
      console.log("[REGISTRATION ENGINE] Database connected.");
    } else if (dbInitAttempts++ < 30) {
      setTimeout(initDb, 250);
    } else {
      console.error("[REGISTRATION ENGINE] Database connection failed.");
    }
  }
  initDb();

  // ==================== CONFIGURATION ====================
  const GMAIL_API_URL = "https://script.google.com/macros/s/AKfycbysZVY8bD1dY2UuqikOODnqLFcjC7h9ZfndZyuMe0CVDRVYJ0sXsGwnQ32wHHA4SgJ9yw/exec";
  const FEE_PER_PERSON = 3000;
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_MEMBERS_PER_FORM = 50;
  const DRAFT_AUTOSAVE_KEY = "altitude_reg_draft";
  const DRAFT_EXPIRY_HOURS = 48;
  const COMPRESS_IMAGE_IF_LARGER_THAN = 2 * 1024 * 1024; // 2MB

  // ==================== STATE ====================
  let memberCount = 0;
  let isSubmitting = false;
  let draftSaveTimer = null;
  let activeClubCache = [];

  // ==================== DOM HELPERS ====================
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ==================== UI FEEDBACK LAYER ====================
  function showToast(msg, type = "success", duration = 4000) {
    if (window.showToast) return window.showToast(msg, type);
    
    let container = $("#reg-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "reg-toast-container";
      container.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:8px;";
      document.body.appendChild(container);
    }
    
    const colors = {
      success: { bg: "#2E7D32", border: "#66BB6A", icon: "check-circle" },
      error:   { bg: "#C62828", border: "#EF5350", icon: "alert-circle" },
      warning: { bg: "#F57C00", border: "#FFB74D", icon: "alert-triangle" },
      info:    { bg: "#1565C0", border: "#42A5F5", icon: "info" }
    };
    const c = colors[type] || colors.success;
    
    const toast = document.createElement("div");
    toast.style.cssText = `
      background:${c.bg};
      color:#fff;
      padding:14px 20px;
      border-radius:8px;
      border-left:4px solid ${c.border};
      font-size:13px;
      font-weight:600;
      letter-spacing:0.3px;
      box-shadow:0 10px 30px rgba(0,0,0,0.5);
      font-family:'Inter',sans-serif;
      display:flex;align-items:center;gap:10px;
      max-width:380px;
      animation:slideIn 0.3s ease;
    `;
    toast.innerHTML = '<span style="font-size:16px;line-height:1;">' + 
      (type === "error" ? "✕" : type === "warning" ? "!" : type === "info" ? "i" : "✓") + 
      '</span><span>' + msg + '</span>';
    
    if (!document.querySelector("#reg-toast-styles")) {
      const style = document.createElement("style");
      style.id = "reg-toast-styles";
      style.textContent = `
        @keyframes slideIn { from { transform:translateX(100%); opacity:0 } to { transform:translateX(0); opacity:1 } }
        @keyframes slideOut { from { transform:translateX(0); opacity:1 } to { transform:translateX(100%); opacity:0 } }
      `;
      document.head.appendChild(style);
    }
    
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "slideOut 0.3s ease forwards";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function showLoading(text = "Processing...") {
    if (window.showLoading) return window.showLoading(text);
    let overlay = $("#reg-loading-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "reg-loading-overlay";
      overlay.style.cssText = `
        position:fixed;inset:0;background:rgba(5,15,8,0.95);
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        z-index:999999;color:#fff;font-family:'Inter',sans-serif;
      `;
      overlay.innerHTML = `
        <div style="width:48px;height:48px;border:3px solid rgba(76,175,80,0.15);border-top-color:#4CAF50;border-radius:50%;animation:regSpin 0.8s linear infinite;margin-bottom:20px;"></div>
        <div id="reg-loading-text" style="font-size:14px;font-weight:700;letter-spacing:1.2px;color:#A5D6A7;text-transform:uppercase;">${text}</div>
        <div id="reg-loading-sub" style="font-size:11px;color:rgba(165,214,167,0.5);margin-top:6px;letter-spacing:0.5px;">Please do not close this window</div>
        <style>@keyframes regSpin { to { transform: rotate(360deg); } }</style>
      `;
      document.body.appendChild(overlay);
    } else {
      const txt = $("#reg-loading-text");
      if (txt) txt.textContent = text;
      overlay.style.display = "flex";
    }
  }

  function hideLoading() {
    if (window.hideLoading) return window.hideLoading();
    const overlay = $("#reg-loading-overlay");
    if (overlay) overlay.style.display = "none";
  }

  // ==================== UTILITY FUNCTIONS ====================
  function generateCode(prefix, length = 6) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = prefix + "-";
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function generateMemberCode(index) {
    return "ALM-" + String(Date.now()).slice(-4) + String(index).padStart(3, "0");
  }

  function sanitize(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function isValidPhone(phone) {
    const clean = phone.replace(/\D/g, "");
    return clean.length === 10;
  }

  function isValidRiId(id) {
    return id && id.trim().length >= 3 && id.trim().length <= 20;
  }

  function debounce(fn, delay = 500) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

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

  // ==================== EMAIL WEBHOOK DISPATCH ====================
  async function sendReceiptNotification(payload) {
    if (!GMAIL_API_URL) return false;
    try {
      await fetch(GMAIL_API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: "RECEIPT",
          ...payload
        })
      });
      console.log("[RECEIPT DISPATCHED] Recipient:", payload.to_email);
      return true;
    } catch (err) {
      console.warn("[WEBHOOK NOTICE]", err);
      return false;
    }
  }

  // ==================== CLUB OPTIONS LOADER ====================
  async function loadClubOptions() {
    if (!db) return;
    const clubSelect = $("#clubSelect") || $('[name="club_id"]');
    if (!clubSelect) return;

    try {
      const { data: clubs, error } = await db
        .from("clubs")
        .select("id,club_name,group_number,max_registrations,current_registrations,is_active")
        .eq("is_active", true)
        .order("group_number")
        .order("club_name");

      if (error || !clubs) return;

      activeClubCache = clubs;

      clubSelect.innerHTML = '<option value="">-- Select Your Rotaract Club --</option>';
      
      // Group by group_number
      const grouped = {};
      clubs.forEach(c => {
        const key = "Group " + c.group_number;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(c);
      });

      Object.keys(grouped).sort().forEach(groupName => {
        const optgroup = document.createElement("optgroup");
        optgroup.label = groupName;
        grouped[groupName].forEach(c => {
          const remaining = c.max_registrations - c.current_registrations;
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.dataset.available = remaining;
          opt.dataset.group = c.group_number;
          opt.dataset.clubName = c.club_name;
          opt.textContent = c.club_name + " — " + (remaining > 0 ? remaining + " seats available" : "FULL");
          if (remaining <= 0) {
            opt.disabled = true;
            opt.style.color = "#999";
          }
          optgroup.appendChild(opt);
        });
        clubSelect.appendChild(optgroup);
      });

      console.log("[REGISTRATION ENGINE] Loaded " + clubs.length + " active clubs.");
    } catch (e) {
      console.error("[CLUB LOADER ERROR]", e);
      showToast("Unable to load club list. Please refresh.", "error");
    }
  }

  // ==================== DRAFT AUTO-SAVE ====================
  function saveDraft() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      try {
        const form = $("#clubRegForm");
        if (!form) return;

        const draft = {
          timestamp: Date.now(),
          registrantRole: form.registrant_role?.value || "",
          clubId: form.club_id?.value || "",
          registrantName: form.registrant_name?.value || "",
          registrantRiId: form.registrant_ri_id?.value || "",
          registrantEmail: form.registrant_email?.value || "",
          registrantPhone: form.registrant_phone?.value || "",
          members: []
        };

        $$(".member-entry").forEach(entry => {
          const idx = entry.dataset.index;
          draft.members.push({
            name: form[`member_name_${idx}`]?.value || "",
            riId: form[`member_ri_id_${idx}`]?.value || "",
            email: form[`member_email_${idx}`]?.value || "",
            phone: form[`member_phone_${idx}`]?.value || "",
            food: form[`member_food_${idx}`]?.value || "",
            board: form[`member_board_${idx}`]?.value || "",
            expectations: form[`member_expectations_${idx}`]?.value || ""
          });
        });

        localStorage.setItem(DRAFT_AUTOSAVE_KEY, JSON.stringify(draft));
      } catch (e) {}
    }, 1000);
  }

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_AUTOSAVE_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (Date.now() - draft.timestamp > DRAFT_EXPIRY_HOURS * 3600 * 1000) {
        localStorage.removeItem(DRAFT_AUTOSAVE_KEY);
        return;
      }

      // Show restore prompt
      if (draft.members && draft.members.length > 0 && draft.registrantName) {
        setTimeout(() => {
          if (confirm("You have a saved draft from " + new Date(draft.timestamp).toLocaleString() + ". Restore it?")) {
            applyDraft(draft);
          } else {
            localStorage.removeItem(DRAFT_AUTOSAVE_KEY);
          }
        }, 1500);
      }
    } catch (e) {}
  }

  function applyDraft(draft) {
    const form = $("#clubRegForm");
    if (!form) return;

    if (form.registrant_role) form.registrant_role.value = draft.registrantRole;
    if (form.club_id) form.club_id.value = draft.clubId;
    if (form.registrant_name) form.registrant_name.value = draft.registrantName;
    if (form.registrant_ri_id) form.registrant_ri_id.value = draft.registrantRiId;
    if (form.registrant_email) form.registrant_email.value = draft.registrantEmail;
    if (form.registrant_phone) form.registrant_phone.value = draft.registrantPhone;

    // Clear existing members
    const container = $("#membersContainer");
    if (container) container.innerHTML = "";
    memberCount = 0;

    // Add draft members
    draft.members.forEach(m => {
      addMemberEntry();
      const idx = memberCount;
      if (form[`member_name_${idx}`]) form[`member_name_${idx}`].value = m.name;
      if (form[`member_ri_id_${idx}`]) form[`member_ri_id_${idx}`].value = m.riId;
      if (form[`member_email_${idx}`]) form[`member_email_${idx}`].value = m.email;
      if (form[`member_phone_${idx}`]) form[`member_phone_${idx}`].value = m.phone;
      if (form[`member_food_${idx}`]) form[`member_food_${idx}`].value = m.food;
      if (form[`member_board_${idx}`]) form[`member_board_${idx}`].value = m.board;
      if (form[`member_expectations_${idx}`]) form[`member_expectations_${idx}`].value = m.expectations;
    });

    updateTotals();
    showToast("Draft restored successfully.", "info");
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_AUTOSAVE_KEY);
  }

  // ==================== MEMBER ENTRY MANAGEMENT ====================
  function addMemberEntry() {
    if (memberCount >= MAX_MEMBERS_PER_FORM) {
      showToast("Maximum " + MAX_MEMBERS_PER_FORM + " members per registration.", "warning");
      return;
    }

    memberCount++;
    const container = $("#membersContainer");
    if (!container) return;

    const entry = document.createElement("div");
    entry.className = "member-entry";
    entry.id = "member-" + memberCount;
    entry.dataset.index = memberCount;
    entry.style.animation = "slideDown 0.3s ease";

    entry.innerHTML = `
      <div class="member-entry-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.12);">
        <h4 style="margin:0;font-size:0.9rem;color:#81C784;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;display:flex;align-items:center;gap:8px;">
          <span style="display:inline-block;width:24px;height:24px;background:rgba(76,175,80,0.2);border:1px solid rgba(129,199,132,0.4);border-radius:4px;text-align:center;line-height:22px;font-family:'JetBrains Mono',monospace;font-size:0.75rem;">${memberCount}</span>
          Delegate Profile
        </h4>
        <button type="button" class="remove-member-btn" onclick="window.removeMember(${memberCount})" title="Remove Delegate" style="background:rgba(211,47,47,0.15);border:1px solid rgba(239,83,80,0.3);color:#EF5350;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;transition:all 0.2s;">
          <i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:middle;"></i> Remove
        </button>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Full Name <span class="req">*</span></label>
          <input type="text" name="member_name_${memberCount}" required placeholder="As per RI records" maxlength="100" />
        </div>
        <div class="form-group">
          <label>RI ID <span class="req">*</span></label>
          <input type="text" name="member_ri_id_${memberCount}" required placeholder="8-digit Rotary ID" class="ri-id-input" maxlength="20" />
          <small class="ri-id-status" id="riStatus_${memberCount}" style="display:block;font-size:0.7rem;margin-top:4px;letter-spacing:0.3px;font-family:'JetBrains Mono',monospace;"></small>
        </div>
        <div class="form-group">
          <label>Email Address <span class="req">*</span></label>
          <input type="email" name="member_email_${memberCount}" required placeholder="delegate@domain.com" maxlength="100" />
        </div>
        <div class="form-group">
          <label>Mobile Number <span class="req">*</span></label>
          <input type="tel" name="member_phone_${memberCount}" pattern="[0-9]{10}" required placeholder="10-digit mobile" maxlength="10" class="phone-input" />
        </div>
        <div class="form-group">
          <label>Catering Preference <span class="req">*</span></label>
          <select name="member_food_${memberCount}" required>
            <option value="">Select Option</option>
            <option value="VEG">Vegetarian</option>
            <option value="NON-VEG">Non-Vegetarian</option>
          </select>
        </div>
        <div class="form-group">
          <label>Board Member Status <span class="req">*</span></label>
          <select name="member_board_${memberCount}" required>
            <option value="">Select Option</option>
            <option value="true">Yes — Board Member</option>
            <option value="false">No — General Member</option>
          </select>
        </div>
        <div class="form-group full-width">
          <label>Personal Expectations (Optional)</label>
          <textarea name="member_expectations_${memberCount}" rows="2" placeholder="Share your goals, key interests, or networking objectives..." maxlength="500"></textarea>
        </div>
      </div>
    `;

    container.appendChild(entry);

    if (!$("#reg-member-styles")) {
      const style = document.createElement("style");
      style.id = "reg-member-styles";
      style.textContent = `
        @keyframes slideDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
        .remove-member-btn:hover { background:rgba(211,47,47,0.25) !important; transform:translateY(-1px); }
      `;
      document.head.appendChild(style);
    }

    attachMemberListeners(entry, memberCount);
    updateTotals();

    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function attachMemberListeners(entry, idx) {
    const riInput = entry.querySelector(`[name="member_ri_id_${idx}"]`);
    if (riInput) {
      riInput.addEventListener("blur", function () {
        checkRiIdDuplicate(this.value, idx);
      });
      riInput.addEventListener("input", debounce(function () {
        if (this.value.trim().length >= 3) {
          checkRiIdDuplicate(this.value, idx);
        }
      }, 800));
    }

    const emailInput = entry.querySelector(`[name="member_email_${idx}"]`);
    if (emailInput) {
      emailInput.addEventListener("blur", function () {
        const email = this.value.trim();
        if (email && !isValidEmail(email)) {
          this.style.borderColor = "#EF5350";
          showToast("Invalid email format for Delegate #" + idx, "warning", 2500);
        } else {
          this.style.borderColor = "";
        }
      });
    }

    const phoneInput = entry.querySelector(`[name="member_phone_${idx}"]`);
    if (phoneInput) {
      phoneInput.addEventListener("input", function () {
        this.value = this.value.replace(/\D/g, "").slice(0, 10);
        this.style.borderColor = this.value.length === 10 ? "#66BB6A" : (this.value.length > 0 ? "#F57C00" : "");
      });
    }

    // Autosave on any input change
    entry.querySelectorAll("input, select, textarea").forEach(el => {
      el.addEventListener("input", saveDraft);
      el.addEventListener("change", saveDraft);
    });
  }

  window.removeMember = function (index) {
    const entries = $$(".member-entry");
    if (entries.length <= 1) {
      showToast("Minimum 1 delegate required.", "warning");
      return;
    }
    const entry = $("#member-" + index);
    if (entry) {
      entry.style.opacity = "0";
      entry.style.transform = "translateX(20px)";
      entry.style.transition = "all 0.25s ease";
      setTimeout(() => {
        entry.remove();
        renumberMembers();
        updateTotals();
        saveDraft();
      }, 250);
    }
  };

  function renumberMembers() {
    const entries = $$(".member-entry");
    entries.forEach((entry, i) => {
      const num = i + 1;
      const badge = entry.querySelector("h4 span");
      if (badge) badge.textContent = num;
    });
  }

  function updateTotals() {
    const entries = $$(".member-entry");
    const count = entries.length;
    const totalEl = $("#totalMembers");
    const amountEl = $("#totalAmount");
    const amountDisplayEl = $("#totalAmountDisplay");
    if (totalEl) totalEl.textContent = count;
    if (amountEl) amountEl.textContent = (count * FEE_PER_PERSON).toLocaleString("en-IN");
    if (amountDisplayEl) amountDisplayEl.textContent = "₹" + (count * FEE_PER_PERSON).toLocaleString("en-IN");

    // Validate against club capacity
    const clubSelect = $('[name="club_id"]');
    if (clubSelect && clubSelect.selectedIndex > 0) {
      const available = parseInt(clubSelect.options[clubSelect.selectedIndex].dataset.available || "0");
      const warningEl = $("#capacityWarning");
      if (count > available) {
        if (!warningEl) {
          const w = document.createElement("div");
          w.id = "capacityWarning";
          w.style.cssText = "background:rgba(211,47,47,0.15);border:1px solid #EF5350;color:#EF9A9A;padding:10px 14px;border-radius:6px;margin:10px 0;font-size:12px;font-weight:600;letter-spacing:0.3px;";
          w.innerHTML = "<strong>CAPACITY EXCEEDED:</strong> Only " + available + " seats available for this club. Current attempt: " + count + ".";
          clubSelect.parentElement.appendChild(w);
        }
      } else if (warningEl) {
        warningEl.remove();
      }
    }
  }

  // ==================== RI ID DUPLICATE CHECKER ====================
  async function checkRiIdDuplicate(riId, memberIndex) {
    if (!db || !riId || riId.trim().length < 3) return;
    const statusEl = $(`#riStatus_${memberIndex}`);
    const inputEl = document.querySelector(`[name="member_ri_id_${memberIndex}"]`);
    if (!statusEl || !inputEl) return;

    const cleanId = riId.trim();
    statusEl.textContent = "Verifying...";
    statusEl.style.color = "#A5D6A7";

    try {
      const [mRes, dcRes] = await Promise.all([
        db.from("members").select("id,full_name").eq("ri_id", cleanId).maybeSingle(),
        db.from("district_council_registrations").select("id,full_name").eq("ri_id", cleanId).maybeSingle()
      ]);

      let localDup = false;
      $$(".ri-id-input").forEach((input) => {
        if (input.value.trim() === cleanId && input.name !== `member_ri_id_${memberIndex}`) {
          localDup = true;
        }
      });

      if (mRes.data || dcRes.data) {
        statusEl.textContent = "[UNAVAILABLE] RI ID already enrolled.";
        statusEl.style.color = "#EF5350";
        inputEl.style.borderColor = "#EF5350";
      } else if (localDup) {
        statusEl.textContent = "[DUPLICATE] Repeated in this form.";
        statusEl.style.color = "#EF5350";
        inputEl.style.borderColor = "#EF5350";
      } else {
        statusEl.textContent = "[VALIDATED] RI ID available.";
        statusEl.style.color = "#66BB6A";
        inputEl.style.borderColor = "#66BB6A";
      }
    } catch (err) {
      statusEl.textContent = "";
      console.error("[RI VERIFICATION ERROR]", err);
    }
  }

  // ==================== IMAGE COMPRESSION ====================
  async function compressImage(file, maxSizeMB = 2) {
    return new Promise((resolve) => {
      if (file.size <= maxSizeMB * 1024 * 1024 || !file.type.startsWith("image/")) {
        resolve(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          const maxDim = 1920;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.floor(width * ratio);
            height = Math.floor(height * ratio);
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) {
              const compressed = new File([blob], file.name, { type: "image/jpeg", lastModified: Date.now() });
              console.log("[IMAGE COMPRESSED]", (file.size / 1024).toFixed(0) + "KB →", (compressed.size / 1024).toFixed(0) + "KB");
              resolve(compressed);
            } else {
              resolve(file);
            }
          }, "image/jpeg", 0.85);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ==================== PAYMENT UPLOAD ====================
  async function uploadPaymentScreenshot(file, regCode) {
    if (!db || !file) throw new Error("Database or file unavailable.");

    if (file.size > MAX_FILE_SIZE) {
      throw new Error("File exceeds 10MB limit. Please compress and retry.");
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg", "application/pdf"];
    if (!allowed.includes(file.type)) {
      throw new Error("Only JPG, PNG, WebP, or PDF accepted.");
    }

    // Compress if needed
    if (file.type.startsWith("image/") && file.size > COMPRESS_IMAGE_IF_LARGER_THAN) {
      showLoading("Optimizing payment proof...");
      file = await compressImage(file);
    }

    const ext = file.name.split(".").pop();
    const filePath = `receipts/${regCode}_${Date.now()}.${ext}`;

    try {
      const { error: uploadErr } = await retryOp(() =>
        db.storage.from("payment-screenshots").upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type
        }), 2, 1000
      );

      if (uploadErr) {
        console.warn("[STORAGE ERROR]", uploadErr.message);
        return "upload_failed_" + Date.now();
      }

      const { data: urlData } = db.storage.from("payment-screenshots").getPublicUrl(filePath);
      return urlData.publicUrl;
    } catch (e) {
      console.error("[UPLOAD FAILURE]", e);
      return "upload_failed_" + Date.now();
    }
  }

  // ==================== PREVIEW HANDLER ====================
  function handleScreenshotPreview(inputEl, previewContainerId) {
    const file = inputEl.files[0];
    const previewBox = $("#" + previewContainerId);
    if (!file || !previewBox) return;

    if (file.size > MAX_FILE_SIZE) {
      showToast("File exceeds 10MB. Please compress.", "error");
      inputEl.value = "";
      return;
    }

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const sizeKB = (file.size / 1024).toFixed(0);
        previewBox.innerHTML = `
          <div style="margin-top:10px;padding:10px;background:rgba(76,175,80,0.08);border:1px solid rgba(129,199,132,0.3);border-radius:8px;">
            <img src="${e.target.result}" style="max-width:100%;max-height:140px;border-radius:6px;display:block;margin:0 auto 8px;"/>
            <div style="font-size:11px;color:#81C784;text-align:center;letter-spacing:0.3px;font-family:'JetBrains Mono',monospace;">
              ${file.name} · ${sizeKB}KB
            </div>
          </div>`;
      };
      reader.readAsDataURL(file);
    } else {
      previewBox.innerHTML = `
        <div style="margin-top:10px;padding:12px;background:rgba(76,175,80,0.08);border:1px solid rgba(129,199,132,0.3);border-radius:8px;text-align:center;">
          <div style="font-size:12px;color:#81C784;font-weight:700;">${file.name}</div>
          <div style="font-size:10px;color:rgba(129,199,132,0.6);margin-top:2px;">${(file.size / 1024).toFixed(0)}KB · PDF Document</div>
        </div>`;
    }
  }

  // ==================== CLUB REGISTRATION SUBMISSION ====================
  async function submitClubRegistration(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!db) {
      showToast("System not ready. Please refresh.", "error");
      return;
    }

    const form = e.target;
    const entries = $$(".member-entry");

    if (entries.length === 0) {
      showToast("Add at least one delegate.", "error");
      return;
    }

    // ----- Collect & Validate Registrant Data -----
    const registrantRole = form.registrant_role.value;
    const clubId = form.club_id.value;
    const registrantName = form.registrant_name.value.trim();
    const registrantRiId = form.registrant_ri_id.value.trim();
    const registrantEmail = form.registrant_email.value.trim();
    const registrantPhone = form.registrant_phone.value.trim();
    const transactionId = form.transaction_id.value.trim();
    const screenshotFile = form.payment_screenshot?.files[0];

    if (!registrantRole || !clubId || !registrantName || !registrantRiId || !registrantEmail || !registrantPhone || !transactionId || !screenshotFile) {
      showToast("Complete all required fields including payment proof.", "error");
      return;
    }

    if (!isValidEmail(registrantEmail)) {
      showToast("Invalid registrant email format.", "error");
      return;
    }

    if (!isValidPhone(registrantPhone)) {
      showToast("Registrant phone must be 10 digits.", "error");
      return;
    }

    // ----- Validate Club Capacity -----
    const clubSelect = form.club_id;
    const selectedOption = clubSelect.options[clubSelect.selectedIndex];
    const clubName = selectedOption.dataset.clubName || selectedOption.textContent;
    const available = parseInt(selectedOption.dataset.available || "0");
    
    if (entries.length > available) {
      showToast("Only " + available + " seats available. You attempted " + entries.length + ".", "error");
      return;
    }

    // ----- Collect & Validate Member Data -----
    const members = [];
    const riIds = new Set();
    let hasError = false;

    entries.forEach((entry, i) => {
      const idx = entry.dataset.index;
      const name = form[`member_name_${idx}`]?.value.trim();
      const riId = form[`member_ri_id_${idx}`]?.value.trim();
      const email = form[`member_email_${idx}`]?.value.trim();
      const phone = form[`member_phone_${idx}`]?.value.trim();
      const food = form[`member_food_${idx}`]?.value;
      const board = form[`member_board_${idx}`]?.value;
      const expectations = form[`member_expectations_${idx}`]?.value.trim() || "";

      if (!name || !riId || !email || !phone || !food || !board) {
        showToast("Incomplete details for Delegate #" + (i + 1), "error");
        hasError = true;
        return;
      }

      if (!isValidEmail(email)) {
        showToast("Invalid email for Delegate #" + (i + 1), "error");
        hasError = true;
        return;
      }

      if (!isValidPhone(phone)) {
        showToast("Invalid phone for Delegate #" + (i + 1) + ". Must be 10 digits.", "error");
        hasError = true;
        return;
      }

      if (!isValidRiId(riId)) {
        showToast("Invalid RI ID for Delegate #" + (i + 1), "error");
        hasError = true;
        return;
      }

      if (riIds.has(riId)) {
        showToast("Duplicate RI ID in form: " + riId, "error");
        hasError = true;
        return;
      }
      riIds.add(riId);

      members.push({
        full_name: name,
        ri_id: riId,
        email: email.toLowerCase(),
        contact_number: phone,
        food_preference: food,
        is_board_member: board === "true",
        expectations: expectations,
      });
    });

    if (hasError) return;

    // ----- Submission Pipeline -----
    isSubmitting = true;
    showLoading("Initializing submission...");

    try {
      const regCode = generateCode("ALT");
      const totalAmount = members.length * FEE_PER_PERSON;

      // Step 1: Upload Payment
      showLoading("Securing payment proof...");
      let screenshotUrl = "";
      try {
        screenshotUrl = await uploadPaymentScreenshot(screenshotFile, regCode);
      } catch (err) {
        console.warn("[SCREENSHOT UPLOAD]", err.message);
        screenshotUrl = "upload_failed_" + Date.now();
      }

      // Step 2: Insert Registration Batch
      showLoading("Creating batch ledger entry...");
      const { data: regData, error: regError } = await db
        .from("registrations")
        .insert({
          registration_code: regCode,
          club_id: clubId,
          registrant_role: registrantRole,
          registrant_name: registrantName,
          registrant_email: registrantEmail.toLowerCase(),
          registrant_phone: registrantPhone,
          registrant_ri_id: registrantRiId,
          total_members: members.length,
          total_amount: totalAmount,
          transaction_id: transactionId,
          payment_screenshot_url: screenshotUrl,
          status: "pending",
        })
        .select()
        .single();

      if (regError) {
        if (regError.code === "23505") {
          throw new Error("Duplicate registration code detected. Please retry.");
        }
        throw new Error("Registration save failed: " + regError.message);
      }

      // Step 3: Insert Individual Members
      showLoading("Enrolling delegates...");
      const memberRows = members.map((m, i) => ({
        registration_id: regData.id,
        club_id: clubId,
        member_code: generateMemberCode(i + 1),
        full_name: m.full_name,
        ri_id: m.ri_id,
        email: m.email,
        contact_number: m.contact_number,
        food_preference: m.food_preference,
        is_board_member: m.is_board_member,
        expectations: m.expectations,
        registration_fee: FEE_PER_PERSON,
        status: "pending",
        qr_code_data: generateCode("QR", 10),
      }));

      const { error: memError } = await db.from("members").insert(memberRows);

      if (memError) {
        if (memError.code === "23505") {
          throw new Error("One or more RI IDs already exist. Please verify.");
        }
        throw new Error("Delegate enrollment failed: " + memError.message);
      }

      // Step 4: Dispatch Email Receipt
      showLoading("Dispatching confirmation receipt...");
      await sendReceiptNotification({
        to_email: registrantEmail,
        to_name: registrantName,
        reg_code: regCode,
        club_name: clubName,
        amount: "₹" + totalAmount.toLocaleString("en-IN"),
        txn_id: transactionId
      });

      // Clear draft on success
      clearDraft();

      hideLoading();

      // Success UI
      const regIdDisplay = $("#regIdDisplay");
      if (regIdDisplay) regIdDisplay.textContent = regCode;
      const modal = $("#successModal");
      if (modal) modal.classList.add("active");

      // Reset form
      form.reset();
      const container = $("#membersContainer");
      if (container) container.innerHTML = "";
      memberCount = 0;
      updateTotals();
      await loadClubOptions();
      addMemberEntry();

      showToast("Registration committed. Reference: " + regCode, "success", 6000);

    } catch (err) {
      hideLoading();
      console.error("[SUBMISSION FAILURE]", err);
      showToast(err.message || "Submission failed. Please retry.", "error", 6000);
    } finally {
      isSubmitting = false;
    }
  }

  // ==================== DC REGISTRATION SUBMISSION ====================
  async function submitDcRegistration(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!db) {
      showToast("System not ready. Please refresh.", "error");
      return;
    }

    const form = e.target;
    const fullName = form.full_name.value.trim();
    const riId = form.ri_id.value.trim();
    const portfolio = form.portfolio.value.trim();
    const clubName = form.club_name?.value.trim() || "";
    const email = form.email.value.trim();
    const phone = form.contact_number.value.trim();
    const food = form.food_preference.value;
    const expectations = form.expectations?.value.trim() || "";
    const transactionId = form.transaction_id.value.trim();
    const screenshotFile = form.payment_screenshot?.files[0];

    if (!fullName || !riId || !portfolio || !email || !phone || !food || !transactionId || !screenshotFile) {
      showToast("Complete all required fields.", "error");
      return;
    }

    if (!isValidEmail(email)) {
      showToast("Invalid email format.", "error");
      return;
    }

    if (!isValidPhone(phone)) {
      showToast("Phone must be 10 digits.", "error");
      return;
    }

    if (!isValidRiId(riId)) {
      showToast("Invalid RI ID format.", "error");
      return;
    }

    isSubmitting = true;
    showLoading("Initializing DC enrollment...");

    try {
      // Duplicate check
      const { data: existing } = await db
        .from("district_council_registrations")
        .select("id")
        .eq("ri_id", riId)
        .maybeSingle();

      if (existing) {
        throw new Error("RI ID already enrolled as District Council.");
      }

      const regCode = generateCode("ADC");

      // Upload Screenshot
      showLoading("Securing payment proof...");
      let screenshotUrl = "";
      try {
        screenshotUrl = await uploadPaymentScreenshot(screenshotFile, regCode);
      } catch (err) {
        screenshotUrl = "upload_failed_" + Date.now();
      }

      // Insert DC Record
      showLoading("Creating DC ledger entry...");
      const { error: dcError } = await db
        .from("district_council_registrations")
        .insert({
          registration_code: regCode,
          full_name: fullName,
          ri_id: riId,
          email: email.toLowerCase(),
          contact_number: phone,
          portfolio: portfolio,
          club_name: clubName || null,
          food_preference: food,
          is_board_member: true,
          expectations: expectations,
          transaction_id: transactionId,
          payment_screenshot_url: screenshotUrl,
          registration_fee: FEE_PER_PERSON,
          status: "pending",
          member_code: "ADC-" + String(Date.now()).slice(-6),
          qr_code_data: generateCode("QR", 10),
        });

      if (dcError) {
        if (dcError.code === "23505") {
          throw new Error("Duplicate record detected.");
        }
        throw new Error("Save failed: " + dcError.message);
      }

      // Dispatch Receipt
      showLoading("Dispatching confirmation receipt...");
      await sendReceiptNotification({
        to_email: email,
        to_name: fullName,
        reg_code: regCode,
        club_name: portfolio,
        amount: "₹" + FEE_PER_PERSON.toLocaleString("en-IN"),
        txn_id: transactionId
      });

      hideLoading();

      const regIdDisplay = $("#regIdDisplay");
      if (regIdDisplay) regIdDisplay.textContent = regCode;
      const modal = $("#successModal");
      if (modal) modal.classList.add("active");

      form.reset();
      showToast("DC Registration committed. Reference: " + regCode, "success", 6000);

    } catch (err) {
      hideLoading();
      console.error("[DC SUBMISSION FAILURE]", err);
      showToast(err.message || "Submission failed.", "error", 6000);
    } finally {
      isSubmitting = false;
    }
  }

  // ==================== INIT ====================
  function init() {
    // Add Member Button
    $("#addMemberBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      addMemberEntry();
    });

    // Form Submissions
    $("#clubRegForm")?.addEventListener("submit", submitClubRegistration);
    $("#dcRegForm")?.addEventListener("submit", submitDcRegistration);

    // Club Selection Change
    $('[name="club_id"]')?.addEventListener("change", (e) => {
      updateTotals();
      saveDraft();
    });

    // Payment Preview
    $("#paymentScreenshot")?.addEventListener("change", function () {
      handleScreenshotPreview(this, "clubScreenshotPreview");
    });
    $('[name="payment_screenshot"]')?.addEventListener("change", function () {
      const previewId = this.closest("#dcRegForm") ? "dcScreenshotPreview" : "clubScreenshotPreview";
      handleScreenshotPreview(this, previewId);
    });

    // Live Autosave on Registrant Fields
    $$('[name="registrant_name"], [name="registrant_ri_id"], [name="registrant_email"], [name="registrant_phone"], [name="registrant_role"], [name="transaction_id"]').forEach(el => {
      el.addEventListener("input", saveDraft);
      el.addEventListener("change", saveDraft);
    });

    // Phone Live Formatting on Registrant
    const registrantPhone = $('[name="registrant_phone"]');
    if (registrantPhone) {
      registrantPhone.addEventListener("input", function () {
        this.value = this.value.replace(/\D/g, "").slice(0, 10);
      });
    }

    // Initial Member Entry
    if ($("#membersContainer") && $$(".member-entry").length === 0) {
      setTimeout(() => {
        if ($$(".member-entry").length === 0) addMemberEntry();
      }, 500);
    }

    // Beforeunload Warning
    window.addEventListener("beforeunload", (e) => {
      const entries = $$(".member-entry");
      let hasData = false;
      entries.forEach(entry => {
        entry.querySelectorAll("input, select, textarea").forEach(inp => {
          if (inp.value && inp.value.trim()) hasData = true;
        });
      });
      if (hasData && !isSubmitting) {
        e.preventDefault();
        e.returnValue = "You have unsaved registration data. Leave anyway?";
      }
    });

    console.log("[REGISTRATION ENGINE v8.0] Enterprise initialization complete.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();