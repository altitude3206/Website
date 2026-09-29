/**
 * ALTITUDE 2026 — Authentication System
 * Handles secure Admin/Scanner sessions and route protection
 */

(function () {
  "use strict";

  const SUPABASE_URL = "https://nywnwnforqyrtdmsregq.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55d253bmZvcnF5cnRkbXNyZWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzcxMjYsImV4cCI6MjEwNjI1MzEyNn0.c3W0_t7CL3Suh7SXq4c-1jtvLN8hNB21WJW_8gKB3wY";

  let db;
  function init() {
    if (typeof supabase !== "undefined" && supabase.createClient) {
      db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      setTimeout(init, 200);
    }
  }
  init();

  const Auth = {
    /**
     * Authenticate an Admin or Scanner
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise<object>} Authenticated user data
     */
    login: async function (email, password) {
      if (!db) throw new Error("Database client not initialized");
      
      const cleanEmail = String(email).trim().toLowerCase();
      const cleanPassword = String(password).trim();

      // Call verification RPC function
      const { data, error } = await db.rpc("verify_admin", {
        p_email: cleanEmail,
        p_password: cleanPassword
      });

      if (error) {
        console.error("Auth call error:", error);
        throw new Error("Invalid login credentials or database connection failure.");
      }

      if (!data || data.length === 0) {
        throw new Error("Invalid email or password.");
      }

      const adminUser = data[0];

      // Update last login timestamp asynchronously
      db.from("admin_users")
        .update({ last_login: new Date().toISOString() })
        .eq("id", adminUser.id)
        .then(({ error }) => { if (error) console.error("Failed to update last_login", error); });

      // Save user details to secure localStorage
      const sessionData = {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name,
        role: adminUser.role,
        timestamp: Date.now()
      };

      localStorage.setItem("altitude_session", JSON.stringify(sessionData));
      
      // Log successful login action securely
      this.logActivity(adminUser.id, "LOGIN", "admin_users", adminUser.id, `User logged in with role: ${adminUser.role}`);

      return sessionData;
    },

    /**
     * Terminate the active session and redirect
     * @param {string} redirectUrl Location to send user to
     */
    logout: function (redirectUrl = "index.html") {
      const session = this.getSession();
      if (session) {
        this.logActivity(session.id, "LOGOUT", "admin_users", session.id, "User logged out manually");
      }
      localStorage.removeItem("altitude_session");
      window.location.replace(redirectUrl);
    },

    /**
     * Get active session and validate duration limit (8 hours)
     * @returns {object|null} Active user session or null
     */
    getSession: function () {
      const raw = localStorage.getItem("altitude_session");
      if (!raw) return null;

      try {
        const session = JSON.parse(raw);
        const eightHours = 8 * 60 * 60 * 1000;
        
        // If session is older than 8 hours, self-destruct session
        if (Date.now() - session.timestamp > eightHours) {
          localStorage.removeItem("altitude_session");
          return null;
        }
        return session;
      } catch (e) {
        localStorage.removeItem("altitude_session");
        return null;
      }
    },

    /**
     * Restrict page routing based on user status and accepted roles
     * @param {Array<string>} allowedRoles Roles permitted to see the view
     * @param {string} fallbackUrl Redirect URL if validation fails
     */
    protectPage: function (allowedRoles = ["super_admin", "admin"], fallbackUrl = "index.html") {
      const session = this.getSession();
      if (!session) {
        window.location.replace(fallbackUrl);
        return false;
      }

      if (allowedRoles && !allowedRoles.includes(session.role)) {
        // If logged in but unauthorized, kick to public homepage or scanner view
        const targetUrl = session.role === "scanner" ? "verify.html" : "index.html";
        window.location.replace(targetUrl);
        return false;
      }
      return true;
    },

    /**
     * Safely register action tracking inside table triggers
     */
    logActivity: function (adminId, actionType, entityType, entityId, description) {
      if (!db) return;
      db.from("activity_log")
        .insert({
          admin_id: adminId,
          action_type: actionType,
          entity_type: entityType,
          entity_id: entityId,
          description: description
        })
        .then(({ error }) => {
          if (error) console.error("Database log write failed:", error);
        });
    }
  };

  // Expose module globally
  window.Auth = Auth;
})();