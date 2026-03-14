const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const bcrypt = require("bcryptjs");
const transporter = require("../utils/mailer");


// ================= ADMIN DASHBOARD ADVANCED STATS =================
router.get("/dashboard-stats", async (req, res) => {
    try {
        const [suppliers] = await db.promise().query(
            "SELECT COUNT(*) as total FROM users WHERE role = 'supplier'"
        );

        const [agents] = await db.promise().query(
            "SELECT COUNT(*) as total FROM users WHERE role = 'agent'"
        );


        // Approved Suppliers
        const [approvedSuppliers] = await db.promise().query(
            "SELECT COUNT(*) as total FROM users WHERE role='supplier' AND status='approved'"
        );

        // Pending Suppliers
        const [pendingSuppliers] = await db.promise().query(
            "SELECT COUNT(*) as total FROM users WHERE role='supplier' AND status='pending'"
        );

        // Today New Registrations
        const [todayRegistrations] = await db.promise().query(
            "SELECT COUNT(*) as total FROM users WHERE DATE(created_at) = CURDATE()"
        );

        // Total Properties
        const [totalProperties] = await db.promise().query(
            "SELECT COUNT(*) as total FROM properties"
        );

        // Total Bookings
        const [totalBookings] = await db.promise().query(
            "SELECT COUNT(*) as total FROM bookings"
        );

        // Total Revenue (Only Confirmed bookings)
        const [totalRevenue] = await db.promise().query(
            "SELECT IFNULL(SUM(total_amount),0) as total FROM bookings WHERE status='Confirmed'"
        );

        res.json({
            suppliers: suppliers[0].total,
            agents: agents[0].total,
            approvedSuppliers: approvedSuppliers[0].total,
            pendingSuppliers: pendingSuppliers[0].total,
            todayRegistrations: todayRegistrations[0].total,
            totalProperties: totalProperties[0].total,
            totalBookings: totalBookings[0].total,
            totalRevenue: totalRevenue[0].total
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================= MONTHLY DEALS & REVENUE =================
router.get("/dashboard-monthly", async (req, res) => {
    try {

        const [rows] = await db.promise().query(`
            SELECT 
                DATE_FORMAT(created_at, '%b') as month,
                COUNT(*) as deals,
                IFNULL(SUM(total_amount),0) as revenue
            FROM bookings
            WHERE status = 'Confirmed'
            GROUP BY MONTH(created_at)
            ORDER BY MONTH(created_at)
        `);

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

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
        subject: "Your Login Credentials",
        html: `
        <div style="font-family: Arial; padding:20px;">
            <h2>Hello ${companyName}</h2>

            <p>Your account has been approved.</p>

            <h3>Login Credentials</h3>

            <p><b>Email:</b> ${toEmail}</p>
            <p><b>Password:</b> ${password}</p>

            <br/>

            <a href="http://b2bpartners.in/login"
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


router.post("/create-user", async (req, res) => {

    const {
        role,
        supplier_type,
        company_name,
        contact_person,
        email,
        mobile,
        address_line1,
        address_line2,
        city,
        state,
        pincode,
        country,
        gst_applicable,
        gst_number,
        agent_type
    } = req.body;

    if (!role || !company_name || !contact_person || !email || !mobile) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const generateAndInsert = (agentCode = null) => {

        const sql = `
        INSERT INTO users
        (role, agent_type, agent_code, supplier_type,
        company_name, contact_person, email,
        mobile,
        address_line1, address_line2, city, state, pincode, country,
        gst_applicable, gst_number,
        status, registration_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'admin')
        `;

        db.query(
            sql,
            [
                role,
                agent_type || null,
                agentCode,
                supplier_type || null,
                company_name,
                contact_person,
                email,
                mobile,
                address_line1,
                address_line2,
                city,
                state,
                pincode,
                country,
                gst_applicable,
                gst_number
            ],
            (err) => {

                if (err) {
                    return res.status(400).json({ message: "Database error" });
                }

                res.json({ message: "User created successfully" });

            }
        );
    };

    if (role === "agent") {

        const prefix = agent_type === "Domestic" ? "DOMA" : "INTA";

        db.query(
            `SELECT agent_code FROM users WHERE agent_code LIKE ? ORDER BY id DESC LIMIT 1`,
            [`${prefix}%`],
            (err, rows) => {

                let nextNumber = 1;

                if (rows.length > 0 && rows[0].agent_code) {
                    const numberPart = parseInt(
                        rows[0].agent_code.replace(prefix, "")
                    );
                    nextNumber = numberPart + 1;
                }

                const newCode =
                    prefix + String(nextNumber).padStart(6, "0");

                generateAndInsert(newCode);
            }
        );

    } else {

        generateAndInsert();

    }

});

router.put("/update-user/:id", (req, res) => {

  const { id } = req.params;

  const {
    supplier_type,
    company_name,
    contact_person,
    email,
    mobile,
    address_line1,
    address_line2,
    city,
    state,
    pincode,
    country,
    gst_applicable,
    gst_number,
    agent_type
  } = req.body;

  const sql = `
  UPDATE users SET
  supplier_type=?,
  company_name=?,
  contact_person=?,
  email=?,
  mobile=?,
  address_line1=?,
  address_line2=?,
  city=?,
  state=?,
  pincode=?,
  country=?,
  gst_applicable=?,
  gst_number=?,
  agent_type=?
  WHERE id=?
  `;

  db.query(
    sql,
    [
      supplier_type,
      company_name,
      contact_person,
      email,
      mobile,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
      country,
      gst_applicable,
      gst_number,
      agent_type,
      id
    ],
    (err) => {

      if (err) {
        return res.status(500).json({ message: "Database error" });
      }

      res.json({ message: "User updated successfully" });

    }
  );
});



const crypto = require("crypto");

// ================= SEND RESET OTP =================
// ================= SEND RESET OTP =================
router.post("/send-reset-otp", (req, res) => {
    const { email } = req.body;

    if (!email)
        return res.status(400).json({ message: "Email required" });

    db.query(
        "SELECT id, company_name, status FROM users WHERE email=?",
        [email],
        async (err, rows) => {

            if (err)
                return res.status(500).json({ message: "Database error" });

            if (!rows.length)
                return res.status(404).json({ message: "User not found" });

            const user = rows[0];

            // 🔥 NEW CONDITION ADDED
            if (user.status !== "approved") {
                return res.status(403).json({
                    message: "Your account is not approved yet. Please contact admin."
                });
            }

            // 🔐 Generate 6 digit OTP
            const otp = crypto.randomInt(100000, 999999).toString();
            const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            db.query(
                "UPDATE users SET reset_otp=?, reset_otp_expiry=? WHERE email=?",
                [otp, expiry, email],
                async (err) => {

                    if (err)
                        return res.status(500).json({ message: "Database error" });

                    try {
                        await transporter.sendMail({
                            from: `"B2B Partners" <${process.env.SMTP_EMAIL}>`,
                            to: email,
                            subject: "Password Reset OTP 🔐",
                            html: `
                <div style="font-family: Arial; padding:20px;">
                  <h2>Hello ${user.company_name},</h2>
                  <p>Your password reset OTP is:</p>
                  
                  <h1 style="letter-spacing:5px;">${otp}</h1>
                  
                  <p>This OTP will expire in <b>10 minutes</b>.</p>
                  <p>If you did not request this, please ignore this email.</p>
                  
                  <br/>
                  <p>Regards,<br/>B2B Partners Team</p>
                </div>
              `,
                        });

                        res.json({ message: "OTP sent to your email" });

                    } catch (error) {
                        console.error(error);
                        res.status(500).json({ message: "Failed to send OTP email" });
                    }
                }
            );
        }
    );
});


// ================= RESET PASSWORD =================
router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword)
        return res.status(400).json({ message: "All fields required" });

    db.query(
        "SELECT id, role, reset_otp, reset_otp_expiry FROM users WHERE email=?",
        [email],
        async (err, rows) => {
            if (err) return res.status(500).json({ message: "Database error" });
            if (!rows.length)
                return res.status(404).json({ message: "User not found" });

            const user = rows[0];

            // ❌ Invalid OTP
            if (user.reset_otp !== otp)
                return res.status(400).json({ message: "Invalid OTP" });

            // ❌ Expired OTP
            if (new Date(user.reset_otp_expiry) < new Date())
                return res.status(400).json({ message: "OTP expired" });

            // 🔐 Hash new password
            const hashed = await bcrypt.hash(newPassword, 10);

            db.query(
                `UPDATE users 
         SET password=?, 
             admin_password=NULL,
             reset_otp=NULL,
             reset_otp_expiry=NULL
         WHERE email=?`,
                [hashed, email],
                (err) => {
                    if (err)
                        return res.status(500).json({ message: "Database error" });

                    res.json({
                        message: "Password reset successful",
                        user: {
                            id: user.id,
                            role: user.role,
                            email: email
                        }
                    });
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


router.put("/toggle-active/:id", async (req, res) => {
    const { is_active } = req.body;

    try {
        await db.promise().query(
            "UPDATE users SET is_active=? WHERE id=?",
            [is_active, req.params.id]
        );

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
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
        let { page = 1, limit = 10, search = "", status = "" } = req.query;

        page = Number(page);
        limit = Number(limit);

        const offset = (page - 1) * limit;

        let where = "WHERE 1=1";
        let params = [];

        // 🔎 Search filter
        if (search) {
            where += `
        AND (
          p.name LIKE ?
          OR p.city LIKE ?
          OR u.company_name LIKE ?
        )
      `;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        // ✅ Status filter
        if (status) {
            where += ` AND p.status = ?`;
            params.push(status);
        }

        // 📌 Fetch paginated data
        const [rows] = await db.promise().query(
`
SELECT 
  p.id,
  p.name,
  p.category,
  p.city,
  p.status,
  p.visibility_type,
  p.property_status,
  p.created_at,
  u.company_name AS supplier_name
FROM properties p
LEFT JOIN users u ON p.supplier_id = u.id
${where}
ORDER BY p.id DESC
LIMIT ? OFFSET ?
`,
[...params, limit, offset]
);

        // 📌 Count total
        const [count] = await db.promise().query(
            `
      SELECT COUNT(*) as total
      FROM properties p
      JOIN users u ON p.supplier_id = u.id
      ${where}
      `,
            params
        );

        res.json({
            data: rows,
            total: count[0].total
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================= ADMIN UPDATE PROPERTY STATUS =================
router.put("/property-status/:id", async (req, res) => {
    const { status } = req.body;

    const allowedStatuses = [
        "Pending",
        "Approved",
        "Rejected",
        "Inactive",
        "Deleted"
    ];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
    }

    try {
        await db.promise().query(
            "UPDATE properties SET status = ? WHERE id = ?",
            [status, req.params.id]
        );

        res.json({ success: true });
    } catch (err) {
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

router.get("/property/:id", async (req, res) => {
    try {

        const [rows] = await db.promise().query(`
      SELECT 
        p.*,
        u.company_name AS supplier_name,
        u.email AS supplier_email,
        u.mobile AS supplier_mobile
      FROM properties p
      JOIN users u ON p.supplier_id = u.id
      WHERE p.id = ?
    `, [req.params.id]);

        if (!rows.length) {
            return res.status(404).json(null);
        }

        res.json(rows[0]);

    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

router.get("/property/:id/full", async (req, res) => {

    const propertyId = req.params.id;

    try {

        // 1️⃣ Property
        const [property] = await db.promise().query(
            `SELECT * FROM properties WHERE id = ?`,
            [propertyId]
        );

        if (!property.length) {
            return res.status(404).json({ message: "Property not found" });
        }

        if (!property.length) {
            return res.status(404).json({ message: "Property not found" });
        }

        // 2️⃣ Images
        const [images] = await db.promise().query(
            `SELECT * FROM property_images WHERE property_id = ?`,
            [propertyId]
        );

        // 3️⃣ Videos
        const [videos] = await db.promise().query(
            `SELECT * FROM property_videos WHERE property_id = ?`,
            [propertyId]
        );

        // 4️⃣ Rooms
        const [rooms] = await db.promise().query(
            `SELECT * FROM property_rooms WHERE property_id = ?`,
            [propertyId]
        );

        // 5️⃣ Rates
        const [rates] = await db.promise().query(
            `
            SELECT r.*
            FROM property_room_rates r
            JOIN property_rooms pr ON r.room_id = pr.id
            WHERE pr.property_id = ?
            `,
            [propertyId]
        );

        // 6️⃣ Policies
        const [policies] = await db.promise().query(
            `SELECT * FROM property_policies WHERE property_id = ?`,
            [propertyId]
        );

        // 7️⃣ Cancellation Rules
        const [cancellationRules] = await db.promise().query(
            `SELECT * FROM property_cancellation_rules WHERE property_id = ?`,
            [propertyId]
        );

        // 8️⃣ Staff
        const [staff] = await db.promise().query(
            `SELECT * FROM property_staff WHERE property_id = ?`,
            [propertyId]
        );

        // 9️⃣ Amenities
        const [amenities] = await db.promise().query(
            `SELECT * FROM property_amenities WHERE property_id = ?`,
            [propertyId]
        );

        // 🔟 Sightseeing
        const [sightseeing] = await db.promise().query(
            `SELECT * FROM property_sightseeing WHERE property_id = ?`,
            [propertyId]
        );

        // 11️⃣ FAQs
        const [faqs] = await db.promise().query(
            `SELECT * FROM property_faqs WHERE property_id = ?`,
            [propertyId]
        );

        // 12️⃣ Check-in Data
        const [checkin] = await db.promise().query(
            `SELECT * FROM property_checkin WHERE property_id = ?`,
            [propertyId]
        );

        // 13️⃣ Bank Details
        const [bank] = await db.promise().query(
            `SELECT * FROM property_bank_details WHERE property_id = ?`,
            [propertyId]
        );

        res.json({
            property: property[0],
            images,
            videos,
            rooms,
            rates,
            policies: policies[0] || {},
            cancellationRules,
            staff,
            amenities,
            sightseeing,
            faqs,
            checkin: checkin[0] || {},
            bank: bank[0] || {}
        });

    } catch (err) {
        console.error("FULL PROPERTY FETCH ERROR:", err);
        res.status(500).json({ message: "Server error" });
    }
});


router.delete("/delete-property/:id", async (req, res) => {
    try {

        await db.promise().query(
            "DELETE FROM properties WHERE id = ?",
            [req.params.id]
        );

        res.json({ success: true });

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


// ================= UPDATE PROPERTY STATUS =================

router.put("/update-property-status/:id", async (req, res) => {

  try {

    const { id } = req.params;
    const { property_status } = req.body;

    await db.promise().query(
      `UPDATE properties SET property_status=? WHERE id=?`,
      [property_status, id]
    );

    res.json({
      message: "Property status updated successfully"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }

});

module.exports = router;