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


// ================== ADMIN: GET BOOKINGS WITH PAGINATION ==================
router.get("/bookings", async (req, res) => {
    try {

        const {
            page = 1,
            limit = 10,
            search = "",
            status = ""
        } = req.query;

        const offset = (page - 1) * limit;

        let whereClause = "WHERE 1=1";
        let params = [];

        if (search) {
            whereClause += `
        AND (
          b.booking_number LIKE ?
          OR u.company_name LIKE ?
          OR p.name LIKE ?
        )
      `;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (status) {
            whereClause += " AND b.status = ?";
            params.push(status);
        }

        const [rows] = await db.promise().query(
            `
      SELECT 
        b.id,
        b.booking_number,
        b.total_amount,
        b.status,
        b.check_in,
        b.check_out,
        b.created_at,

        p.name AS property_name,
        u.company_name AS agent_name
      FROM bookings b
      JOIN properties p ON b.property_id = p.id
      JOIN users u ON b.agent_id = u.id
      ${whereClause}
      ORDER BY b.id DESC
      LIMIT ? OFFSET ?
      `,
            [...params, Number(limit), Number(offset)]
        );

        const [countResult] = await db.promise().query(
            `
      SELECT COUNT(*) as total
      FROM bookings b
      JOIN properties p ON b.property_id = p.id
      JOIN users u ON b.agent_id = u.id
      ${whereClause}
      `,
            params
        );

        res.json({
            data: rows,
            total: countResult[0].total
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================== ADMIN: GET ALL PROPERTIES ==================
router.get("/properties", async (req, res) => {

    try {

        const [rows] = await db.promise().query(`
      SELECT 
        p.id,
        p.name,
        p.category,
        p.city,
        p.created_at,
        u.company_name AS supplier_name

      FROM properties p
      JOIN users u ON p.supplier_id = u.id

      ORDER BY p.id DESC
    `);

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================= ADMIN CONFIRM =================
router.put("/confirm/:bookingNumber", async (req, res) => {
    const { bookingNumber } = req.params;

    try {
        await db.promise().query(
            `UPDATE bookings SET status = 'Confirmed' WHERE booking_number = ?`,
            [bookingNumber]
        );

        res.json({ message: "Booking confirmed" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// ================= ADMIN CANCEL WITH REFUND =================
router.put("/cancel/:bookingNumber", async (req, res) => {
    const { bookingNumber } = req.params;
    const { reason, customPercent } = req.body;

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `
      SELECT total_amount, status, check_in
      FROM bookings
      WHERE booking_number = ?
      FOR UPDATE
      `,
            [bookingNumber]
        );

        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ message: "Booking not found" });
        }

        const booking = rows[0];

        if (booking.status === "Cancelled") {
            await connection.rollback();
            return res.status(400).json({ message: "Already cancelled" });
        }

        const total = Number(booking.total_amount);

        let refundPercent = 0;

        // ================= REASON LOGIC =================
        switch (reason) {

            case "HOTEL_OVERBOOKED":
            case "HOTEL_CLOSED":
            case "SYSTEM_ERROR":
                refundPercent = 1; // 100%
                break;

            case "PAYMENT_FAILURE":
            case "POLICY_VIOLATION":
                refundPercent = 0; // 0%
                break;

            case "CUSTOMER_REQUEST":
                // example policy-based
                refundPercent = 0.7;
                break;

            case "SPECIAL_APPROVAL":
                refundPercent = (customPercent || 0) / 100;
                break;

            default:
                await connection.rollback();
                return res.status(400).json({ message: "Invalid cancellation reason" });
        }

        const refundAmount = Number((total * refundPercent).toFixed(2));
        const cancellationCharge = Number((total - refundAmount).toFixed(2));

        await connection.query(
            `
      UPDATE bookings
      SET 
        status = 'Cancelled',
        payment_status = 'Refunded',
        refund_amount = ?,
        cancellation_charge = ?,
        cancelled_by = 'admin',
        cancellation_reason = ?,
        cancelled_at = NOW()
      WHERE booking_number = ?
      `,
            [refundAmount, cancellationCharge, reason, bookingNumber]
        );

        await connection.commit();
        connection.release();

        res.json({
            message: "Booking cancelled by admin",
            refundAmount,
            cancellationCharge
        });

    } catch (err) {
        await connection.rollback();
        connection.release();
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;