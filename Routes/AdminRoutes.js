const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const bcrypt = require("bcryptjs");
const transporter = require("../utils/mailer");


// ================= GET ALL USERS =================
router.get("/users", (req, res) => {
    db.query("SELECT * FROM users ORDER BY created_at DESC", (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});


// ================= GET SINGLE USER =================
router.get("/user/:id", (req, res) => {
    db.query(
        "SELECT * FROM users WHERE id=?",
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json(err);
            if (!rows.length) return res.status(404).json({});
            res.json(rows[0]);   // includes admin_password always
        }
    );
});


// ================= APPROVE + GENERATE ONCE =================


router.post("/approve/:id", (req, res) => {

    db.query(
        "SELECT admin_password, email, mobile, company_name FROM users WHERE id=?",
        [req.params.id],
        async (err, rows) => {

            if (err) return res.status(500).json(err);
            if (!rows.length) return res.status(404).json({});

            const user = rows[0];

            // 🔒 If already generated → just resend email
            if (user.admin_password && user.admin_password.trim() !== "") {

                await sendMail(user.email, user.admin_password, user.company_name);
                return res.json({ password: user.admin_password });
            }

            // Generate Password
            const rawPassword =
                user.email.split("@")[0].slice(0, 4).toUpperCase() +
                user.mobile.slice(-4);

            const hashed = await bcrypt.hash(rawPassword, 10);

            db.query(
                `UPDATE users 
                 SET status='approved',
                     password=?,
                     admin_password=?
                 WHERE id=?`,
                [hashed, rawPassword, req.params.id],
                async (err) => {

                    if (err) return res.status(500).json(err);

                    await sendMail(user.email, rawPassword, user.company_name);

                    res.json({ password: rawPassword });
                }
            );
        }
    );
});

router.post("/create-user", async (req, res) => {
  const {
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
  } = req.body;

  const rawPassword =
    email.split("@")[0].slice(0, 4).toUpperCase() +
    mobile.slice(-4);

  const hashed = await bcrypt.hash(rawPassword, 10);

  const sql = `
    INSERT INTO users
    (role, supplier_type, company_name, contact_person, email,
     mobile, country, city, pincode,
     gst_applicable, gst_number,
     password, admin_password, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
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
      hashed,
      rawPassword,
    ],
    async (err) => {
      if (err) return res.status(400).json(err);

      await sendMail(email, rawPassword, company_name);

      res.json({ message: "User created and credentials sent" });
    }
  );
});

async function sendMail(toEmail, password, companyName) {

    const mailOptions = {
        from: `"B2B Partners" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: "Your Account Has Been Approved 🎉",
        html: `
            <div style="font-family: Arial; padding:20px;">
                <h2>Hello ${companyName},</h2>
                <p>Your account has been <b>approved</b> by admin.</p>
                
                <h3>Login Credentials:</h3>
                <p><b>Email:</b> ${toEmail}</p>
                <p><b>Password:</b> ${password}</p>

                <p>Please login and change your password after first login.</p>

                <br/>
                <a href="http://localhost:5173/login"
                   style="background:#16a34a;color:white;padding:10px 20px;
                   text-decoration:none;border-radius:5px;">
                   Login Now
                </a>

                <br/><br/>
                <p>Regards,<br/>B2B Partners Team</p>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
}

// ================= UPDATE STATUS =================
router.put("/update-status/:id", (req, res) => {
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
    }

    db.query(
        "UPDATE users SET status=? WHERE id=?",
        [status, req.params.id],
        err => {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
        }
    );
});


// ================= DELETE USER =================
router.delete("/delete/:id", (req, res) => {
    db.query(
        "DELETE FROM users WHERE id=?",
        [req.params.id],
        err => {
            if (err) return res.status(500).json(err);
            res.json({ success: true });
        }
    );
});

module.exports = router;