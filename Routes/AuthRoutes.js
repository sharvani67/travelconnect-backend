const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const bcrypt = require("bcryptjs");


// ================= REGISTER =================
router.post("/register", (req, res) => {
  const {
    role,
    company_name,
    contact_person,
    email,
    mobile,
    city,
    pincode,
    country,
    supplier_type,
    gst_applicable,
    gst_number,
    agent_type,
    allow_duplicate
  } = req.body;

  // ================= VALIDATION =================
  if (!role || !company_name || !contact_person || !email || !mobile) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (gst_applicable === "yes" && !gst_number) {
    return res.status(400).json({ message: "GST number required" });
  }

  if (role === "supplier" && !supplier_type) {
    return res.status(400).json({ message: "Supplier type required" });
  }

  if (role === "agent" && !agent_type) {
    return res.status(400).json({ message: "Agent type required" });
  }

  // ================= DUPLICATE COMPANY CHECK =================
  const checkNameSql = `SELECT id FROM users WHERE company_name = ?`;

  db.query(checkNameSql, [company_name], (err, existing) => {

    if (err) {
      console.error("Company check error:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (existing.length > 0 && !allow_duplicate) {
      return res.status(409).json({
        duplicate: true,
        message: "Company name already exists. Do you want to continue?"
      });
    }

    // ================= EMAIL DUPLICATE CHECK =================
    const checkEmailSql = `SELECT id FROM users WHERE email = ?`;

    db.query(checkEmailSql, [email], (err, emailRows) => {

      if (err) {
        console.error("Email check error:", err);
        return res.status(500).json({ message: "Database error" });
      }

      if (emailRows.length > 0) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // ================= INSERT FUNCTION =================
      const insertUser = (agentCode = null) => {

        const sql = `
          INSERT INTO users
          (role, agent_type, agent_code, supplier_type, company_name,
           contact_person, email, mobile, country, city, pincode,
           gst_applicable, gst_number, status, registration_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'self')
        `;

        const values = [
          role,
          agent_type || null,
          agentCode || null,
          supplier_type || null,
          company_name,
          contact_person,
          email,
          mobile,
          country || null,
          city || null,
          pincode || null,
          gst_applicable || "no",
          gst_number || null
        ];

        db.query(sql, values, (err) => {

          if (err) {
            console.error("Insert user error:", err);
            return res.status(500).json({ message: "Database error" });
          }

          return res.json({
            message: "Registration submitted for admin approval"
          });
        });
      };

      // ================= AGENT CODE GENERATION =================
      if (role === "agent") {

        const prefix = agent_type === "Domestic" ? "DOMA" : "INTA";

        const codeSql = `
          SELECT agent_code FROM users
          WHERE agent_code LIKE ?
          ORDER BY id DESC
          LIMIT 1
        `;

        db.query(codeSql, [`${prefix}%`], (err, rows) => {

          if (err) {
            console.error("Agent code error:", err);
            return res.status(500).json({ message: "Database error" });
          }

          let nextNumber = 1;

          if (rows.length > 0) {
            const lastCode = rows[0].agent_code;
            const numberPart = parseInt(lastCode.replace(prefix, ""));
            nextNumber = numberPart + 1;
          }

          const newCode = prefix + String(nextNumber).padStart(6, "0");

          insertUser(newCode);
        });

      } else {
        insertUser();
      }

    });

  });
});

module.exports = router;

// ================= LOGIN =================
router.post("/login", (req, res) => {
  const { email, password, role } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ? LIMIT 1",
    [email],
    async (err, results) => {

      if (err) return res.status(500).json({ message: "Database error" });

      if (!results.length) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const user = results[0];

      if (user.role !== role) {
        return res.status(403).json({
          message: `Registered as ${user.role}. Please login as ${user.role}.`
        });
      }

      if (user.status !== "approved") {
        return res.status(403).json({
          message: "Account pending admin approval"
        });
      }

      if (user.is_active === 0) {
        return res.status(403).json({
          message: "Your account has been deactivated by B2B Partners"
        });
      }

      // FIRST LOGIN → use admin_password
      if (user.admin_password && user.admin_password.trim() !== "") {

        if (password !== user.admin_password) {
          return res.status(400).json({ message: "Invalid credentials" });
        }

        return res.json({
          firstLogin: true,
          message: "Please change your password"
        });
      }

      // NORMAL LOGIN → use hashed password
      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      res.json({
        message: "Login successful",
        user: {
          id: user.id,
          role: user.role,
          company_name: user.company_name
        }
      });
    }
  );
});


router.post("/admin-login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  db.query(
    "SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1",
    [email],
    (err, rows) => {
      if (err) return res.status(500).json(err);

      if (!rows.length) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const admin = rows[0];

      // ✅ Compare with admin_password (plain text)
      if (password !== admin.admin_password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      delete admin.password;
      delete admin.admin_password;

      res.json({
        message: "Login successful",
        admin,
      });
    }
  );
});

// ================= GET CATEGORIES =================
router.get("/categories", (req, res) => {
  const sql = "SELECT id, category_name FROM categories";

  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ message: "Database error" });
    }

    res.json(results);
  });
});



// ================= GET AGENT COUNT AND SUPPLIER COUNT =================
router.get("/count", (req, res) => {
  const sql = `
    SELECT 
      COUNT(CASE WHEN role = 'agent' THEN 1 END) AS total_agents,
      COUNT(CASE WHEN role = 'supplier' THEN 1 END) AS total_suppliers
    FROM users
  `;

  db.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Database error" });
    }

    res.json(result[0]);
  });
});

module.exports = router;