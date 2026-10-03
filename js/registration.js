/**
 * ALTITUDE 2026 — REGISTRATION ENGINE v7.0
 * Enterprise Client-Side Registration Engine
 * Live RI ID Duplicate Check · Auto Slot Validation · Payment Proof Upload · Real-time Receipts
 */

(function () {
  "use strict";

  // ==================== SUPABASE CLIENT ====================
  const SUPABASE_URL = "https://nywnwnforqyrtdmsregq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY";

  let db = null;
  function initDb() {
    if (typeof supabase !== "undefined" && supabase.createClient) {
      db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      loadClubOptions();
    } else {
      setTimeout(initDb, 250);
    }
  }
  initDb();

  // ==================== CONFIGURATION ====================
  const FEE_PER_PERSON = 3000;
  const EMAILJS_SERVICE_ID = "service_ojeg5q8";
  const EMAILJS_PUBLIC_KEY = "M1tEIYjvJ0UmKdDW8";
  const EMAILJS_TEMPLATE_NOTIFICATION = "template_notification";
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  let memberCount = 0;
  let isSubmitting = false;

  // ==================== HELPERS ====================
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showToast(msg, type = "success") {
    if (window.showToast) return window.showToast(msg, type);
    const toast = document.createElement("div");
    toast.className = `custom-toast ${type}`;
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:${type === "error" ? "#C62828" : "#2E7D32"};color:#fff;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 10px 30px rgba(0,0,0,0.3);`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function showLoading(text = "Processing...") {
    if (window.showLoading) return window.showLoading(text);
    let overlay = $("#loadingOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "loadingOverlay";
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999999;color:#fff;font-family:sans-serif;";
      overlay.innerHTML = '<div style="width:48px;height:48px;border:4px solid rgba(76,175,80,0.2);border-top-color:#4CAF50;border-radius:50%;animation:spin 0.8s linear infinite;margin-bottom:16px;"></div><div id="loadingText" style="font-size:16px;font-weight:600;color:#A5D6A7;">' + text + '</div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
      document.body.appendChild(overlay);
    } else {
      const txt = $("#loadingText");
      if (txt) txt.textContent = text;
      overlay.style.display = "flex";
    }
  }

  function hideLoading() {
    if (window.hideLoading) return window.hideLoading();
    const overlay = $("#loadingOverlay");
    if (overlay) overlay.style.display = "none";
  }

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

  // ==================== EMAIL ENGINE ====================
  function loadEmailScript() {
    return new Promise((resolve) => {
      if (typeof emailjs !== "undefined") {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      script.onload = () => resolve();
      script.onerror = () => {
        console.warn("Failed to load EmailJS SDK dynamically.");
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  async function sendEmailReceipt(toName, toEmail, subject, badge, heading, message, d1L, d1V, d2L, d2V, d3L, d3V, alertMsg = "") {
    if (typeof emailjs === "undefined") {
      await loadEmailScript();
    }
    if (typeof emailjs === "undefined") return false;

    try {
      emailjs.init(EMAILJS_PUBLIC_KEY);
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_NOTIFICATION, {
        to_name: toName,
        to_email: toEmail,
        email_subject: subject,
        badge_text: badge,
        heading: heading,
        main_message: message,
        detail_1_label: d1L,
        detail_1_val: d1V,
        detail_2_label: d2L,
        detail_2_val: d2V,
        detail_3_label: d3L,
        detail_3_val: d3V,
        alert_display: alertMsg ? "block" : "none",
        alert_message: alertMsg,
        button_display: "none",
        button_text: "",
        button_url: ""
      }, EMAILJS_PUBLIC_KEY);
      return true;
    } catch (err) {
      console.warn("Email delivery notice:", err);
      return false;
    }
  }

  // ==================== CLUB OPTIONS LOADER ====================
  async function loadClubOptions() {
    if (!db) return;
    const clubSelect = $("#clubSelect");
    if (!clubSelect) return;

    try {
      const { data: clubs, error } = await db
        .from("clubs")
        .select("id,club_name,group_number,max_registrations,current_registrations,is_active")
        .eq("is_active", true)
        .order("group_number")
        .order("club_name");

      if (error || !clubs) return;

      clubSelect.innerHTML = '<option value="">-- Choose Your Rotaract Club --</option>';
      clubs.forEach((c) => {
        const remaining = c.max_registrations - c.current_registrations;
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.dataset.available = remaining;
        opt.dataset.group = c.group_number;
        opt.textContent = `${c.club_name} (Group ${c.group_number}) — ${remaining > 0 ? remaining + " slots left" : "FULL"}`;
        if (remaining <= 0) opt.disabled = true;
        clubSelect.appendChild(opt);
      });
    } catch (e) {
      console.error("Error loading clubs:", e);
    }
  }

  // ==================== MEMBER ENTRY MANAGEMENT ====================
  function addMemberEntry() {
    memberCount++;
    const container = $("#membersContainer");
    if (!container) return;

    const entry = document.createElement("div");
    entry.className = "member-entry";
    entry.id = "member-" + memberCount;
    entry.dataset.index = memberCount;

    entry.innerHTML = `
      <div class="member-entry-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);">
        <h4 style="margin:0;font-size:0.95rem;color:#81C784;display:flex;align-items:center;gap:6px;">
          <i data-lucide="user" style="width:16px;height:16px;"></i> Member #${memberCount}
        </h4>
        <button type="button" class="remove-member-btn" onclick="window.removeMember(${memberCount})" title="Remove Member" style="background:none;border:none;color:#EF5350;cursor:pointer;padding:4px;">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Full Name <span class="req">*</span></label>
          <input type="text" name="member_name_${memberCount}" required placeholder="Full name as per RI records" />
        </div>
        <div class="form-group">
          <label>RI ID <span class="req">*</span></label>
          <input type="text" name="member_ri_id_${memberCount}" required placeholder="8-digit Rotary International ID" class="ri-id-input" />
          <small class="ri-id-status" id="riStatus_${memberCount}" style="display:block;font-size:0.75rem;margin-top:4px;"></small>
        </div>
        <div class="form-group">
          <label>Email Address <span class="req">*</span></label>
          <input type="email" name="member_email_${memberCount}" required placeholder="member@email.com" />
        </div>
        <div class="form-group">
          <label>Mobile Number <span class="req">*</span></label>
          <input type="tel" name="member_phone_${memberCount}" pattern="[0-9]{10}" required placeholder="10-digit mobile number" maxlength="10" />
        </div>
        <div class="form-group">
          <label>Food Preference <span class="req">*</span></label>
          <select name="member_food_${memberCount}" required>
            <option value="">Select Food</option>
            <option value="VEG">Vegetarian</option>
            <option value="NON-VEG">Non-Vegetarian</option>
          </select>
        </div>
        <div class="form-group">
          <label>Board Member <span class="req">*</span></label>
          <select name="member_board_${memberCount}" required>
            <option value="">Select Option</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div class="form-group full-width">
          <label>Expectations from ALTITUDE (Optional)</label>
          <textarea name="member_expectations_${memberCount}" rows="2" placeholder="What are you most excited for?"></textarea>
        </div>
      </div>
    `;

    container.appendChild(entry);
    updateTotals();

    // Attach Realtime Duplicate Check
    const riInput = entry.querySelector(`[name="member_ri_id_${memberCount}"]`);
    if (riInput) {
      riInput.addEventListener("blur", function () {
        checkRiIdDuplicate(this.value, memberCount);
      });
    }

    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.removeMember = function (index) {
    const entries = $$(".member-entry");
    if (entries.length <= 1) {
      showToast("You must register at least 1 member.", "error");
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
      }, 250);
    }
  };

  function renumberMembers() {
    const entries = $$(".member-entry");
    entries.forEach((entry, i) => {
      const num = i + 1;
      const header = entry.querySelector("h4");
      if (header) header.innerHTML = `<i data-lucide="user" style="width:16px;height:16px;"></i> Member #${num}`;
    });
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  function updateTotals() {
    const entries = $$(".member-entry");
    const count = entries.length;
    const totalEl = $("#totalMembers");
    const amountEl = $("#totalAmount");
    if (totalEl) totalEl.textContent = count;
    if (amountEl) amountEl.textContent = (count * FEE_PER_PERSON).toLocaleString("en-IN");

    // Live slot comparison
    const clubSelect = $("#clubSelect");
    if (clubSelect && clubSelect.selectedIndex > 0) {
      const available = parseInt(clubSelect.options[clubSelect.selectedIndex].dataset.available || "0");
      if (count > available) {
        showToast(`Selected club has only ${available} seats left.`, "error");
      }
    }
  }

  // ==================== RI ID DUPLICATE CHECK ====================
  async function checkRiIdDuplicate(riId, memberIndex) {
    if (!db || !riId || riId.trim().length < 3) return;
    const statusEl = $(`#riStatus_${memberIndex}`);
    if (!statusEl) return;

    const cleanId = riId.trim();

    try {
      const { data: mMatch } = await db.from("members").select("id").eq("ri_id", cleanId).maybeSingle();
      const { data: dcMatch } = await db.from("district_council_registrations").select("id").eq("ri_id", cleanId).maybeSingle();

      let localDup = false;
      $$(".ri-id-input").forEach((input) => {
        if (input.value.trim() === cleanId && input.name !== `member_ri_id_${memberIndex}`) {
          localDup = true;
        }
      });

      if (mMatch || dcMatch || localDup) {
        statusEl.textContent = "⚠️ RI ID already registered or duplicated";
        statusEl.style.color = "#EF5350";
        statusEl.style.fontWeight = "700";
      } else {
        statusEl.textContent = "✓ RI ID is available";
        statusEl.style.color = "#66BB6A";
        statusEl.style.fontWeight = "600";
      }
    } catch (err) {
      console.error("RI ID check error:", err);
    }
  }

  // ==================== PAYMENT SCREENSHOT UPLOAD ====================
  async function uploadPaymentScreenshot(file, regCode) {
    if (!db || !file) throw new Error("File or Database missing");

    if (file.size > MAX_FILE_SIZE) {
      throw new Error("Screenshot exceeds 10MB limit. Please compress and upload.");
    }

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg", "application/pdf"];
    if (!allowed.includes(file.type)) {
      throw new Error("Invalid file type. Please upload a JPG, PNG, or PDF.");
    }

    const ext = file.name.split(".").pop();
    const filePath = `receipts/${regCode}_${Date.now()}.${ext}`;

    const { error: uploadErr } = await db.storage
      .from("payment-screenshots")
      .upload(filePath, file, { cacheControl: "3600", upsert: false });

    if (uploadErr) {
      console.warn("Upload storage failure:", uploadErr.message);
      return "upload_failed_" + Date.now();
    }

    const { data: urlData } = db.storage.from("payment-screenshots").getPublicUrl(filePath);
    return urlData.publicUrl;
  }

  // ==================== PAYMENT PREVIEW HANDLER ====================
  function handleScreenshotPreview(inputEl, previewContainerId) {
    const file = inputEl.files[0];
    const previewBox = $(`#${previewContainerId}`);
    if (!file || !previewBox) return;

    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewBox.innerHTML = `<img src="${e.target.result}" style="max-height:120px;border-radius:8px;margin-top:8px;border:1px solid rgba(255,255,255,0.2);" alt="Preview"/>`;
      };
      reader.readAsDataURL(file);
    } else {
      previewBox.innerHTML = `<p style="font-size:12px;color:#81C784;margin-top:6px;">📄 ${file.name} selected</p>`;
    }
  }

  // ==================== SUBMIT CLUB REGISTRATION ====================
  async function submitClubRegistration(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!db) {
      showToast("Database connecting... Please retry in a few seconds.", "error");
      return;
    }

    const form = e.target;
    const entries = $$(".member-entry");

    if (entries.length === 0) {
      showToast("Please add at least one member.", "error");
      return;
    }

    const registrantRole = form.registrant_role.value;
    const clubId = form.club_id.value;
    const registrantName = form.registrant_name.value.trim();
    const registrantRiId = form.registrant_ri_id.value.trim();
    const registrantEmail = form.registrant_email.value.trim();
    const registrantPhone = form.registrant_phone.value.trim();
    const transactionId = form.transaction_id.value.trim();
    const screenshotFile = form.payment_screenshot?.files[0];

    if (!registrantRole || !clubId || !registrantName || !registrantRiId || !registrantEmail || !registrantPhone || !transactionId || !screenshotFile) {
      showToast("Please complete all required fields including payment proof.", "error");
      return;
    }

    // Check club slots
    const clubSelect = form.club_id;
    const selectedOption = clubSelect.options[clubSelect.selectedIndex];
    const clubName = selectedOption.textContent;
    const available = parseInt(selectedOption.dataset.available || "0");
    if (entries.length > available) {
      showToast(`Only ${available} slots remaining for this club. You are submitting ${entries.length} members.`, "error");
      return;
    }

    // Validate members
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
        showToast(`Please fill all fields for Member #${i + 1}.`, "error");
        hasError = true;
        return;
      }

      if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
        showToast(`Member #${i + 1} phone must be 10 digits.`, "error");
        hasError = true;
        return;
      }

      if (riIds.has(riId)) {
        showToast(`Duplicate RI ID "${riId}" detected in your form.`, "error");
        hasError = true;
        return;
      }
      riIds.add(riId);

      members.push({
        full_name: name,
        ri_id: riId,
        email: email,
        contact_number: phone,
        food_preference: food,
        is_board_member: board === "true",
        expectations: expectations,
      });
    });

    if (hasError) return;

    isSubmitting = true;
    showLoading("Submitting Registration...");

    try {
      const regCode = generateCode("ALT");
      const totalAmount = members.length * FEE_PER_PERSON;

      // 1. Upload Screenshot
      showLoading("Uploading payment proof...");
      let screenshotUrl = "";
      try {
        screenshotUrl = await uploadPaymentScreenshot(screenshotFile, regCode);
      } catch (err) {
        console.warn("Screenshot upload failed:", err.message);
        screenshotUrl = "upload_failed_" + Date.now();
      }

      // 2. Insert Batch Registration Record
      showLoading("Saving registration data...");
      const { data: regData, error: regError } = await db
        .from("registrations")
        .insert({
          registration_code: regCode,
          club_id: clubId,
          registrant_role: registrantRole,
          registrant_name: registrantName,
          registrant_email: registrantEmail,
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

      if (regError) throw new Error(regError.message);

      // 3. Insert Members
      showLoading("Registering members...");
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
          throw new Error("One or more RI IDs are already registered in the system.");
        }
        throw new Error(memError.message);
      }

      // 4. Send Confirmation Email Receipt
      showLoading("Sending email receipt...");
      await sendEmailReceipt(
        registrantName,
        registrantEmail,
        "📩 Registration Received — ALTITUDE 2026",
        "Pending Verification",
        "We've Received Your Registration! 🏔️",
        `Thank you for registering for ALTITUDE 2026. Your payment proof (Transaction ID: ${transactionId}) is currently being verified by our treasury team. Once verified, event passes will be delivered via email.`,
        "Registration Code",
        regCode,
        "Club Details",
        clubName || "Rotaract Club",
        "Total Fee",
        `₹${totalAmount.toLocaleString("en-IN")}`,
        "Verification typically completes within 24-48 hours. Please save your registration code for tracking."
      );

      hideLoading();

      // UI Updates
      const regIdDisplay = $("#regIdDisplay");
      if (regIdDisplay) regIdDisplay.textContent = regCode;
      const modal = $("#successModal");
      if (modal) modal.classList.add("active");

      form.reset();
      const container = $("#membersContainer");
      if (container) container.innerHTML = "";
      memberCount = 0;
      updateTotals();
      loadClubOptions();

      showToast("Registration submitted successfully!");
    } catch (err) {
      hideLoading();
      console.error("Submission Error:", err);
      showToast(err.message || "Registration failed. Please try again.", "error");
    } finally {
      isSubmitting = false;
    }
  }

  // ==================== SUBMIT DC REGISTRATION ====================
  async function submitDcRegistration(e) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!db) {
      showToast("Database connecting... Please retry.", "error");
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
      showToast("Please complete all required fields.", "error");
      return;
    }

    if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
      showToast("Mobile number must be 10 digits.", "error");
      return;
    }

    isSubmitting = true;
    showLoading("Submitting DC Registration...");

    try {
      const { data: existing } = await db
        .from("district_council_registrations")
        .select("id")
        .eq("ri_id", riId)
        .maybeSingle();

      if (existing) {
        throw new Error("This RI ID is already registered as District Council.");
      }

      const regCode = generateCode("ADC");

      // 1. Upload Screenshot
      showLoading("Uploading payment proof...");
      let screenshotUrl = "";
      try {
        screenshotUrl = await uploadPaymentScreenshot(screenshotFile, regCode);
      } catch (err) {
        console.warn("Screenshot upload failed:", err.message);
        screenshotUrl = "upload_failed_" + Date.now();
      }

      // 2. Insert DC Registration Record
      showLoading("Saving details...");
      const { error: dcError } = await db
        .from("district_council_registrations")
        .insert({
          registration_code: regCode,
          full_name: fullName,
          ri_id: riId,
          email: email,
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

      if (dcError) throw new Error(dcError.message);

      // 3. Send Email Receipt
      showLoading("Sending email receipt...");
      await sendEmailReceipt(
        fullName,
        email,
        "📩 DC Registration Received — ALTITUDE 2026",
        "Pending Verification",
        "We've Received Your DC Registration! 👑",
        `Thank you for registering for ALTITUDE 2026 as District Council. Your payment proof (Transaction ID: ${transactionId}) is being verified by our treasury team. Your digital pass will be issued once approved.`,
        "Registration Code",
        regCode,
        "Portfolio",
        portfolio,
        "Amount Paid",
        `₹${FEE_PER_PERSON.toLocaleString("en-IN")}`,
        "Verification typically completes within 24-48 hours."
      );

      hideLoading();

      const regIdDisplay = $("#regIdDisplay");
      if (regIdDisplay) regIdDisplay.textContent = regCode;
      const modal = $("#successModal");
      if (modal) modal.classList.add("active");

      form.reset();
      showToast("District Council registration submitted!");
    } catch (err) {
      hideLoading();
      console.error("DC Error:", err);
      showToast(err.message || "Registration failed. Please try again.", "error");
    } finally {
      isSubmitting = false;
    }
  }

  // ==================== INIT ====================
  function init() {
    // Add Member button
    const addBtn = $("#addMemberBtn");
    if (addBtn) {
      addBtn.addEventListener("click", addMemberEntry);
    }

    // Forms
    const clubForm = $("#clubRegForm");
    if (clubForm) {
      clubForm.addEventListener("submit", submitClubRegistration);
    }

    const dcForm = $("#dcRegForm");
    if (dcForm) {
      dcForm.addEventListener("submit", submitDcRegistration);
    }

    // Screenshot Previews
    const clubScreenshot = $("#paymentScreenshot");
    if (clubScreenshot) {
      clubScreenshot.addEventListener("change", function () {
        handleScreenshotPreview(this, "clubScreenshotPreview");
      });
    }

    const dcScreenshot = $("#dcPaymentScreenshot");
    if (dcScreenshot) {
      dcScreenshot.addEventListener("change", function () {
        handleScreenshotPreview(this, "dcScreenshotPreview");
      });
    }

    // Club selection change listener
    const clubSelect = $("#clubSelect");
    if (clubSelect) {
      clubSelect.addEventListener("change", updateTotals);
    }

    // Initial member row
    if ($("#membersContainer") && $$(".member-entry").length === 0) {
      addMemberEntry();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
