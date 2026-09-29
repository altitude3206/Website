/**
 * ALTITUDE 2026 — Registration Engine
 * Handles Club & District Council registration forms
 * Dynamic member entries, validation, payment upload, submission
 */

(function () {
  "use strict";

  // ==================== SUPABASE CLIENT ====================
  const SUPABASE_URL = "https://nywnwnforqyrtdmsregq.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY";

  let db;
  function initDb() {
    if (typeof supabase !== "undefined" && supabase.createClient) {
      db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      setTimeout(initDb, 300);
    }
  }
  initDb();

  const FEE_PER_PERSON = 3000;
  let memberCount = 0;

  // ==================== HELPERS ====================
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showToast(msg, type = "success") {
    if (window.showToast) return window.showToast(msg, type);
    alert(msg);
  }

  function showLoading(text) {
    if (window.showLoading) return window.showLoading(text);
  }

  function hideLoading() {
    if (window.hideLoading) return window.hideLoading();
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
      <div class="member-entry-header">
        <h4><i data-lucide="user"></i> Member #${memberCount}</h4>
        <button type="button" class="remove-member-btn" onclick="window.removeMember(${memberCount})" title="Remove Member">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Full Name <span class="req">*</span></label>
          <input type="text" name="member_name_${memberCount}" required placeholder="Full name as per RI records" />
        </div>
        <div class="form-group">
          <label>RI ID <span class="req">*</span></label>
          <input type="text" name="member_ri_id_${memberCount}" required placeholder="Unique Rotary International ID" class="ri-id-input" />
          <small class="ri-id-status" id="riStatus_${memberCount}"></small>
        </div>
        <div class="form-group">
          <label>Email <span class="req">*</span></label>
          <input type="email" name="member_email_${memberCount}" required placeholder="member@email.com" />
        </div>
        <div class="form-group">
          <label>Contact Number <span class="req">*</span></label>
          <input type="tel" name="member_phone_${memberCount}" pattern="[0-9]{10}" required placeholder="10-digit mobile number" maxlength="10" />
        </div>
        <div class="form-group">
          <label>Food Preference <span class="req">*</span></label>
          <select name="member_food_${memberCount}" required>
            <option value="">Select Preference</option>
            <option value="VEG">Vegetarian</option>
            <option value="NON-VEG">Non-Vegetarian</option>
          </select>
        </div>
        <div class="form-group">
          <label>Board Member <span class="req">*</span></label>
          <select name="member_board_${memberCount}" required>
            <option value="">Select</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div class="form-group full-width">
          <label>Expectations from ALTITUDE</label>
          <textarea name="member_expectations_${memberCount}" rows="2" placeholder="What do you look forward to?"></textarea>
        </div>
      </div>
    `;

    container.appendChild(entry);
    updateTotals();

    // Add RI ID duplicate check listener
    const riInput = entry.querySelector(`[name="member_ri_id_${memberCount}"]`);
    if (riInput) {
      riInput.addEventListener("blur", function () {
        checkRiIdDuplicate(this.value, memberCount);
      });
    }

    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  window.removeMember = function (index) {
    const entry = $("#member-" + index);
    if (entry) {
      entry.style.opacity = "0";
      entry.style.transform = "translateX(20px)";
      entry.style.transition = "all 0.3s ease";
      setTimeout(() => {
        entry.remove();
        renumberMembers();
        updateTotals();
      }, 300);
    }
  };

  function renumberMembers() {
    const entries = $$(".member-entry");
    entries.forEach((entry, i) => {
      const num = i + 1;
      const header = entry.querySelector("h4");
      if (header) header.innerHTML = `<i data-lucide="user"></i> Member #${num}`;
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
  }

  // ==================== RI ID DUPLICATE CHECK ====================
  async function checkRiIdDuplicate(riId, memberIndex) {
    if (!db || !riId || riId.trim().length < 3) return;
    const statusEl = $(`#riStatus_${memberIndex}`);
    if (!statusEl) return;

    const cleanId = riId.trim();

    try {
      // Check members table
      const { data: memberMatch } = await db
        .from("members")
        .select("id")
        .eq("ri_id", cleanId)
        .maybeSingle();

      // Check DC table
      const { data: dcMatch } = await db
        .from("district_council_registrations")
        .select("id")
        .eq("ri_id", cleanId)
        .maybeSingle();

      // Check within current form entries
      const localDuplicates = $$(".ri-id-input");
      let localDup = false;
      localDuplicates.forEach((input) => {
        if (input.value.trim() === cleanId && input.name !== `member_ri_id_${memberIndex}`) {
          localDup = true;
        }
      });

      if (memberMatch || dcMatch || localDup) {
        statusEl.textContent = "This RI ID is already registered!";
        statusEl.style.color = "var(--red)";
        statusEl.style.fontWeight = "700";
      } else {
        statusEl.textContent = "RI ID is available";
        statusEl.style.color = "var(--green-600)";
        statusEl.style.fontWeight = "600";
      }
    } catch (err) {
      console.error("RI ID check error:", err);
    }
  }

  // ==================== PAYMENT SCREENSHOT UPLOAD ====================
  async function uploadPaymentScreenshot(file, regCode) {
    if (!db) throw new Error("Database not initialized");
    if (!file) throw new Error("No file selected");

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new Error("File size exceeds 10MB limit");
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      throw new Error("Invalid file type. Upload JPG, PNG, WebP, or PDF only.");
    }

    const ext = file.name.split(".").pop();
    const fileName = `payment_${regCode}_${Date.now()}.${ext}`;
    const filePath = `registrations/${fileName}`;

    const { data, error } = await db.storage
      .from("payment-screenshots")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

    if (error) {
      console.error("Upload error:", error);
      throw new Error("Failed to upload payment screenshot: " + error.message);
    }

    // Get public URL
    const { data: urlData } = db.storage
      .from("payment-screenshots")
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  }

  // ==================== CLUB REGISTRATION SUBMISSION ====================
  async function submitClubRegistration(e) {
    e.preventDefault();
    if (!db) {
      showToast("System not ready. Please refresh the page.", "error");
      return;
    }

    const form = e.target;
    const entries = $$(".member-entry");

    if (entries.length === 0) {
      showToast("Please add at least one member to register.", "error");
      return;
    }

    // Collect registrant info
    const registrantRole = form.registrant_role.value;
    const clubId = form.club_id.value;
    const registrantName = form.registrant_name.value.trim();
    const registrantRiId = form.registrant_ri_id.value.trim();
    const registrantEmail = form.registrant_email.value.trim();
    const registrantPhone = form.registrant_phone.value.trim();
    const transactionId = form.transaction_id.value.trim();
    const screenshotFile = form.payment_screenshot.files[0];

    // Validate
    if (!registrantRole || !clubId || !registrantName || !registrantRiId || !registrantEmail || !registrantPhone || !transactionId || !screenshotFile) {
      showToast("Please fill all required fields including payment details.", "error");
      return;
    }

    // Check club slot availability
    const clubSelect = form.club_id;
    const selectedOption = clubSelect.options[clubSelect.selectedIndex];
    const available = parseInt(selectedOption.dataset.available || "0");
    if (entries.length > available) {
      showToast(`Only ${available} slots available for this club. You are trying to register ${entries.length} members.`, "error");
      return;
    }

    // Collect member data
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
        showToast(`Please fill all required fields for Member #${i + 1}.`, "error");
        hasError = true;
        return;
      }

      if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
        showToast(`Invalid contact number for Member #${i + 1}. Must be 10 digits.`, "error");
        hasError = true;
        return;
      }

      if (riIds.has(riId)) {
        showToast(`Duplicate RI ID "${riId}" found. Each member must have a unique RI ID.`, "error");
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

    showLoading("Submitting registration... This may take a moment.");

    try {
      const regCode = generateCode("ALT");
      const totalAmount = members.length * FEE_PER_PERSON;

      // Upload payment screenshot
      showLoading("Uploading payment proof...");
      let screenshotUrl = "";
      try {
        screenshotUrl = await uploadPaymentScreenshot(screenshotFile, regCode);
      } catch (uploadErr) {
        console.warn("Screenshot upload failed, continuing without:", uploadErr.message);
        screenshotUrl = "upload_failed_" + Date.now();
      }

      // Insert registration batch
      showLoading("Saving registration...");
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

      if (regError) {
        console.error("Registration insert error:", regError);
        throw new Error("Failed to save registration: " + regError.message);
      }

      // Insert all members
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
        console.error("Members insert error:", memError);
        // If RI ID duplicate at DB level
        if (memError.code === "23505") {
          throw new Error("One or more RI IDs are already registered in the system. Please check and use unique RI IDs.");
        }
        throw new Error("Failed to save member entries: " + memError.message);
      }

      // Success!
      hideLoading();
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

      showToast("Registration submitted successfully!", "success");

    } catch (err) {
      hideLoading();
      console.error("Registration error:", err);
      showToast(err.message || "Registration failed. Please try again.", "error");
    }
  }

  // ==================== DISTRICT COUNCIL REGISTRATION ====================
  async function submitDcRegistration(e) {
    e.preventDefault();
    if (!db) {
      showToast("System not ready. Please refresh the page.", "error");
      return;
    }

    const form = e.target;
    const fullName = form.full_name.value.trim();
    const riId = form.ri_id.value.trim();
    const portfolio = form.portfolio.value.trim();
    const clubName = form.club_name.value.trim();
    const email = form.email.value.trim();
    const phone = form.contact_number.value.trim();
    const food = form.food_preference.value;
    const expectations = form.expectations.value.trim();
    const transactionId = form.transaction_id.value.trim();
    const screenshotFile = form.payment_screenshot.files[0];

    // Validate
    if (!fullName || !riId || !portfolio || !email || !phone || !food || !transactionId || !screenshotFile) {
      showToast("Please fill all required fields.", "error");
      return;
    }

    if (phone.length !== 10 || !/^\d{10}$/.test(phone)) {
      showToast("Contact number must be exactly 10 digits.", "error");
      return;
    }

    showLoading("Submitting District Council registration...");

    try {
      // Check for duplicate RI ID
      const { data: existing } = await db
        .from("district_council_registrations")
        .select("id")
        .eq("ri_id", riId)
        .maybeSingle();

      if (existing) {
        throw new Error("This RI ID is already registered as a District Council member.");
      }

      const regCode = generateCode("ADC");

      // Upload screenshot
      showLoading("Uploading payment proof...");
      let screenshotUrl = "";
      try {
        screenshotUrl = await uploadPaymentScreenshot(screenshotFile, regCode);
      } catch (uploadErr) {
        console.warn("Upload failed:", uploadErr.message);
        screenshotUrl = "upload_failed_" + Date.now();
      }

      // Insert DC registration
      showLoading("Saving registration...");
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

      if (dcError) {
        console.error("DC registration error:", dcError);
        if (dcError.code === "23505") {
          throw new Error("This RI ID is already registered in the system.");
        }
        throw new Error("Failed to save registration: " + dcError.message);
      }

      hideLoading();
      const regIdDisplay = $("#regIdDisplay");
      if (regIdDisplay) regIdDisplay.textContent = regCode;
      const modal = $("#successModal");
      if (modal) modal.classList.add("active");

      form.reset();
      showToast("District Council registration submitted!", "success");

    } catch (err) {
      hideLoading();
      console.error("DC registration error:", err);
      showToast(err.message || "Registration failed. Please try again.", "error");
    }
  }

  // ==================== INIT ====================
  function init() {
    // Add Member button
    const addBtn = $("#addMemberBtn");
    if (addBtn) {
      addBtn.addEventListener("click", addMemberEntry);
    }

    // Club Registration Form
    const clubForm = $("#clubRegForm");
    if (clubForm) {
      clubForm.addEventListener("submit", submitClubRegistration);
    }

    // DC Registration Form
    const dcForm = $("#dcRegForm");
    if (dcForm) {
      dcForm.addEventListener("submit", submitDcRegistration);
    }

    // Add first member entry by default
    if ($("#membersContainer")) {
      addMemberEntry();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();