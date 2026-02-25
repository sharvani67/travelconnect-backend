const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const bcrypt = require("bcryptjs");


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
        "SELECT admin_password, email, mobile FROM users WHERE id=?",
        [req.params.id],
        async (err, rows) => {

            if (err) return res.status(500).json(err);
            if (!rows.length) return res.status(404).json({});

            const user = rows[0];

            // 🔒 Already exists → NEVER regenerate
            if (user.admin_password && user.admin_password.trim() !== "") {
                return res.json({ password: user.admin_password });
            }

            // ✅ Professional readable credential
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
                err => {
                    if (err) return res.status(500).json(err);
                    res.json({ password: rawPassword });
                }
            );
        }
    );
});


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