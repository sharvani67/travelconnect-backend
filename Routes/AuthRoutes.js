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
  } = req.body;
  if (!role || !company_name || !contact_person || !email || !mobile) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (gst_applicable === "yes" && !gst_number) {
    return res.status(400).json({ message: "GST number required" });
  }

  if (role === "supplier" && !supplier_type) {
    return res.status(400).json({ message: "Supplier type required" });
  }
  const sql = `
  
    INSERT INTO users
    (role, supplier_type, company_name, contact_person, email,
     mobile, country, city, pincode,
     gst_applicable, gst_number, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `;

  db.query(
    sql,
    [
      role,
      supplier_type,
      company_name,
      contact_person,
      email,
      mobile,
      country,
      city,
      pincode,
      gst_applicable,
      gst_number,
    ],
    (err) => {
      if (err) {
        return res.status(400).json({ message: "User already exists" });
      }
      res.json({ message: "Registration submitted for admin approval" });
    }
  );
});

// ================= LOGIN =================
router.post("/login", (req, res) => {
  const { email, role } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    (err, results) => {
      if (err || results.length === 0) {
        return res.status(400).json({ message: "Invalid credentials" });
      }

      const user = results[0];

      if (user.role !== role) {
        return res.status(403).json({
          message: `Registered as ${user.role}. Please login as ${user.role}.`,
        });
      }

      if (user.status !== "approved") {
        return res.status(403).json({
          message: "Account pending admin approval",
        });
      }

      res.json({
        message: "Login successful",
        user: {
          id: user.id,
          role: user.role,
          company_name: user.company_name,
        },
      });
    }
  );
});
module.exports = router;