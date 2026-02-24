const express = require("express");
const router = express.Router();
const db = require("../Config/db");


// ================= REGISTER =================
router.post("/register", (req, res) => {
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

  const sql = `
    INSERT INTO users 
    (role, company_name, contact_person, email, mobile, country, city, password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [role, company_name, contact_person, email, mobile, country, city, password],
    (err, result) => {
      if (err) {
        return res.status(400).json({ message: "User already exists or error occurred" });
      }

      res.json({ message: "Registration successful" });
    }
  );
});


// ================= LOGIN =================
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM users WHERE email = ? AND password = ?";

  db.query(sql, [email, password], (err, results) => {
    if (err || results.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = results[0];

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