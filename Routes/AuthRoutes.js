const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const bcrypt = require("bcryptjs");

// ================= REGISTER =================
router.post("/register", async (req, res) => {
  const {
    role,
    company_name,
    contact_person,
    email,
    mobile,
    country,
    city,
    password,
  } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);

  const sql = `
    INSERT INTO users 
    (role, company_name, contact_person, email, mobile, country, city, password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      role,
      company_name,
      contact_person,
      email,
      mobile,
      country,
      city,
      hashedPassword,
    ],
    (err) => {
      if (err) {
        return res.status(400).json({ message: "User already exists or error occurred" });
      }

      res.json({ message: "Registration successful" });
    }
  );
});


// ================= LOGIN =================
router.post("/login", (req, res) => {
  const { email, password, role } = req.body;

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = results[0];

    // ✅ ROLE CHECK
    if (user.role !== role) {
      return res.status(403).json({
        message: `This account is registered as ${user.role}. Please login as ${user.role}.`
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
        company_name: user.company_name,
      },
    });
  });
});
module.exports = router;