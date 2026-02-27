const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const multer = require("multer");
const path = require("path");

// ================== MULTER CONFIG ==================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },
    filename: function (req, file, cb) {
        const uniqueName =
            Date.now() + "-" + Math.round(Math.random() * 1e9) +
            path.extname(file.originalname);
        cb(null, uniqueName);
    },
});

const upload = multer({ storage });


// ================== ADD PROPERTY ==================
router.post("/add-property", upload.array("images"), async (req, res) => {

    const {
        name,
        category,
        city,
        area,
        pincode,
        address,
        landmark,
        contact,
        email,
        rooms,
        policies,
        coverIndex,
        supplier_id,
    } = req.body;

    if (!name || !category || !city) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    let parsedRooms = [];
    let parsedPolicies = {};

    try {
        parsedRooms = rooms ? JSON.parse(rooms) : [];
        parsedPolicies = policies ? JSON.parse(policies) : {};
    } catch (err) {
        return res.status(400).json({ message: "Invalid rooms or policies format" });
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        // 1️⃣ Insert Property
        const [propertyResult] = await connection.query(
            `
      INSERT INTO properties 
      (name, category, city, area, pincode, address, landmark, contact, email, supplier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [name, category, city, area, pincode, address, landmark, contact, email, supplier_id]
        );

        const propertyId = propertyResult.insertId;

        // 2️⃣ Insert Images
        if (req.files && req.files.length > 0) {
            const imageValues = req.files.map((file, index) => [
                propertyId,
                file.filename,
                index == coverIndex ? 1 : 0,
            ]);

            await connection.query(
                `
        INSERT INTO property_images 
        (property_id, image_path, is_cover)
        VALUES ?
        `,
                [imageValues]
            );
        }

        // 3️⃣ Insert Rooms & Rate Plans
        for (const room of parsedRooms) {

            const [roomResult] = await connection.query(
                `
        INSERT INTO property_rooms
        (property_id, type, max_adults, max_children)
        VALUES (?, ?, ?, ?)
        `,
                [
                    propertyId,
                    room.type || "",
                    room.max_adults || 0,
                    room.max_children || 0
                ]
            );

            const roomId = roomResult.insertId;

            if (room.ratePlans && room.ratePlans.length > 0) {

                const rateValues = [];

                room.ratePlans.forEach(plan => {
                    ["weekday", "weekend", "long_weekend"].forEach(rateType => {
                        rateValues.push([
                            roomId,
                            plan.plan,
                            rateType,
                            plan[rateType] || 0,
                            plan.extraAdult || 0,
                            plan.childWithBed || 0,
                            plan.childWithoutBed || 0
                        ]);
                    });
                });

                await connection.query(
                    `
          INSERT INTO property_room_rates
          (room_id, plan, rate_type, base_price, extra_adult_price, child_with_bed_price, child_without_bed_price)
          VALUES ?
          `,
                    [rateValues]
                );
            }
        }

        // 4️⃣ Insert Policies
        await connection.query(
            `
      INSERT INTO property_policies
      (property_id, booking_policy, cancellation_policy, terms)
      VALUES (?, ?, ?, ?)
      `,
            [
                propertyId,
                parsedPolicies.booking || "",
                parsedPolicies.cancellation || "",
                parsedPolicies.terms || "",
            ]
        );

        await connection.commit();
        connection.release();

        return res.json({ message: "Property created successfully" });

    } catch (error) {

        await connection.rollback();
        connection.release();

        console.error("Transaction Error:", error);
        return res.status(500).json({ message: "Database error" });
    }
});

router.get("/", (req, res) => {
    const sql = `
    SELECT 
      p.id,
      p.name,
      p.category,
      p.city,
      p.area,
      p.pincode,
      img.image_path AS cover_image,
      MIN(rr.base_price) AS starting_price
    FROM properties p

    LEFT JOIN property_images img
      ON p.id = img.property_id AND img.is_cover = 1

    LEFT JOIN property_rooms pr
      ON p.id = pr.property_id

    LEFT JOIN property_room_rates rr
      ON pr.id = rr.room_id
      AND rr.rate_type = 'weekday'
      AND rr.plan = 'CP'

    WHERE p.status = 'Approved'   -- ✅ IMPORTANT

    GROUP BY 
      p.id, p.name, p.category, p.city, 
      p.area, p.pincode, img.image_path

    ORDER BY p.id DESC
  `;

    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ message: err.message });
        }

        res.json(results);
    });
});

// ================== GET SUPPLIER DASHBOARD ==================
router.get("/supplier/:supplierId", (req, res) => {
    const supplierId = Number(req.params.supplierId);

    if (!supplierId) {
        return res.status(400).json({ message: "Invalid supplier ID" });
    }

    const propertySql = `
    SELECT COUNT(*) AS totalProperties
    FROM properties
    WHERE supplier_id = ?
  `;

    db.query(propertySql, [supplierId], (err, propertyResult) => {
        if (err) {
            console.error("Property Count Error:", err);
            return res.status(500).json({ message: err.message });
        }

        // If bookings table doesn't exist yet, return zeros
        const bookingSql = `
      SELECT 
        COUNT(*) AS totalBookings,
        IFNULL(SUM(amount), 0) AS totalEarnings
      FROM bookings
      WHERE supplier_id = ?
    `;

        db.query(bookingSql, [supplierId], (err2, bookingResult) => {
            if (err2) {
                console.error("Booking Query Error:", err2);

                return res.json({
                    totalProperties: propertyResult[0]?.totalProperties || 0,
                    totalBookings: 0,
                    totalEarnings: 0,
                });
            }

            res.json({
                totalProperties: propertyResult[0]?.totalProperties || 0,
                totalBookings: bookingResult[0]?.totalBookings || 0,
                totalEarnings: bookingResult[0]?.totalEarnings || 0,
            });
        });
    });
});

// ================== GET SUPPLIER PROPERTIES ==================
router.get("/supplier/:supplierId/list", (req, res) => {
    const supplierId = req.params.supplierId;

    const sql = `
    SELECT 
      p.id,
      p.name,
      p.category,
      p.area,
      p.city,
      p.pincode,
      img.image_path AS cover_image,
      MIN(rr.base_price) AS starting_price
    FROM properties p

    LEFT JOIN property_images img 
      ON p.id = img.property_id AND img.is_cover = 1

    LEFT JOIN property_rooms pr
      ON p.id = pr.property_id

    LEFT JOIN property_room_rates rr
      ON pr.id = rr.room_id
      AND rr.rate_type = 'weekday'
      AND rr.plan = 'CP'

    WHERE p.supplier_id = ?

    GROUP BY 
      p.id, p.name, p.category, p.area, p.city, p.pincode, img.image_path

    ORDER BY p.id DESC
  `;

    db.query(sql, [supplierId], (err, results) => {
        if (err) {
            console.error("Fetch Properties Error:", err);
            return res.status(500).json({ message: err.message });
        }

        res.json(results);
    });
});

// ================== GET PROPERTY DETAILS ==================
router.get("/:propertyId", (req, res) => {
    const propertyId = req.params.propertyId;

    const propertySql = `SELECT * FROM properties WHERE id = ?`;
    const imageSql = `SELECT * FROM property_images WHERE property_id = ?`;
    const roomSql = `
SELECT pr.*, rr.plan, rr.rate_type, rr.base_price
FROM property_rooms pr
LEFT JOIN property_room_rates rr
ON pr.id = rr.room_id
WHERE pr.property_id = ?
`;
    const policySql = `SELECT * FROM property_policies WHERE property_id = ?`;

    db.query(propertySql, [propertyId], (err, property) => {
        if (err) return res.status(500).json({ message: err.message });

        db.query(imageSql, [propertyId], (err2, images) => {
            if (err2) return res.status(500).json({ message: err2.message });

            db.query(roomSql, [propertyId], (err3, rooms) => {
                if (err3) return res.status(500).json({ message: err3.message });

                db.query(policySql, [propertyId], (err4, policies) => {
                    if (err4) return res.status(500).json({ message: err4.message });

                    res.json({
                        property: property[0],
                        images,
                        rooms,
                        policies: policies[0] || {},
                    });
                });
            });
        });
    });
});

// ================== GET FULL PROPERTY ==================
router.get("/:id/full", async (req, res) => {

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

        // 2️⃣ Images
        const [images] = await db.promise().query(
            `SELECT * FROM property_images WHERE property_id = ?`,
            [propertyId]
        );

        // 3️⃣ Rooms
        const [rooms] = await db.promise().query(
            `SELECT * FROM property_rooms WHERE property_id = ?`,
            [propertyId]
        );

        // 4️⃣ Rates
        const [rates] = await db.promise().query(
            `
      SELECT r.room_id, r.plan, r.rate_type,
             r.base_price, r.extra_adult_price,
             r.child_with_bed_price, r.child_without_bed_price
      FROM property_room_rates r
      JOIN property_rooms pr ON r.room_id = pr.id
      WHERE pr.property_id = ?
      `,
            [propertyId]
        );

        // 5️⃣ Policies
        const [policies] = await db.promise().query(
            `SELECT * FROM property_policies WHERE property_id = ?`,
            [propertyId]
        );

        res.json({
            property: property[0],
            images,
            rooms,
            rates,
            policies: policies[0] || {}
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;