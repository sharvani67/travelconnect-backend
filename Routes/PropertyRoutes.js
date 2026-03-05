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
const uploadFields = upload.fields([
    { name: "images", maxCount: 20 },
    { name: "videos", maxCount: 10 },
    { name: "staffPhotos", maxCount: 20 },
    { name: "cancelledCheque", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
]);

// ================== ADD PROPERTY FULL ==================
router.post("/add-property", uploadFields, async (req, res) => {

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
        total_rooms,
        hotel_remarks,
        rooms,
        policies,
        staff,
        amenities,
        sightseeing,
        faqs,
        cancellation_rules,
        checkin_data,
        bank_details,
        coverIndex,
        supplier_id,
    } = req.body;

    if (!name || !category || !city || !supplier_id) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    // ----------- PARSE ALL JSON ONCE -----------
    let parsedRooms = [];
    let parsedPolicies = {};
    let parsedStaff = [];
    let parsedAmenities = [];
    let parsedSightseeing = [];
    let parsedFaqs = [];
    let parsedRules = [];
    let parsedCheckin = {};
    let parsedBank = {};

    try {
        parsedRooms = rooms ? JSON.parse(rooms) : [];
        parsedPolicies = policies ? JSON.parse(policies) : {};
        parsedStaff = staff ? JSON.parse(staff) : [];
        parsedAmenities = amenities ? JSON.parse(amenities) : [];
        parsedSightseeing = sightseeing ? JSON.parse(sightseeing) : [];
        parsedFaqs = faqs ? JSON.parse(faqs) : [];
        parsedRules = cancellation_rules ? JSON.parse(cancellation_rules) : [];
        parsedCheckin = checkin_data ? JSON.parse(checkin_data) : {};
        parsedBank = bank_details ? JSON.parse(bank_details) : {};
    } catch (err) {
        return res.status(400).json({ message: "Invalid JSON format" });
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        // 1️⃣ INSERT PROPERTY
        const [propertyResult] = await connection.query(
            `INSERT INTO properties
(name, category, city, area, pincode, address, landmark,
 contact, email, supplier_id, total_rooms,
 hotel_remarks, registration_certificate, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                category,
                city,
                area || "",
                pincode || "",
                address || "",
                landmark || "",
                contact || "",
                email || "",
                supplier_id,
                Number(total_rooms) || 0,
                hotel_remarks || "", // ADD THIS
                req.files?.certificate?.[0]?.filename || "",
                "pending"
            ]
        );

        const propertyId = propertyResult.insertId;

        // 2️⃣ INSERT IMAGES
        if (req.files?.images?.length) {
            const imageValues = req.files.images.map((file, index) => [
                propertyId,
                file.filename,
                index == Number(coverIndex) ? 1 : 0
            ]);

            await connection.query(
                `INSERT INTO property_images
         (property_id, image_path, is_cover)
         VALUES ?`,
                [imageValues]
            );
        }

        // 3️⃣ INSERT VIDEOS
        if (req.files?.videos?.length) {
            for (const file of req.files.videos) {
                await connection.query(
                    `INSERT INTO property_videos
           (property_id, video_path)
           VALUES (?, ?)`,
                    [propertyId, file.filename]
                );
            }
        }

        // 4️⃣ INSERT ROOMS & RATES
        for (const room of parsedRooms) {

            const [roomResult] = await connection.query(
                `INSERT INTO property_rooms
         (property_id, type, max_adults, max_children)
         VALUES (?, ?, ?, ?)`,
                [
                    propertyId,
                    room.type || "",
                    Number(room.max_adults) || 0,
                    Number(room.max_children) || 0
                ]
            );

            const roomId = roomResult.insertId;

            if (room.ratePlans?.length) {

                const rateValues = [];

                room.ratePlans
                    .filter(plan => plan.enabled !== false)
                    .forEach(plan => {

                        ["weekday", "weekend", "longWeekend"].forEach(rateType => {

                            const dbRateType =
                                rateType === "longWeekend" ? "long_weekend" : rateType;

                            rateValues.push([
                                roomId,
                                plan.plan,
                                dbRateType,
                                Number(plan[rateType]) || 0,
                                Number(plan.extraAdult) || 0,
                                Number(plan.childWithBed) || 0,
                                Number(plan.childWithoutBed) || 0
                            ]);

                        });

                    });

                if (rateValues.length) {
                    await connection.query(
                        `INSERT INTO property_room_rates
             (room_id, plan, rate_type, base_price,
              extra_adult_price, child_with_bed_price,
              child_without_bed_price)
             VALUES ?`,
                        [rateValues]
                    );
                }
            }
        }

        // 5️⃣ INSERT POLICIES
        await connection.query(
            `INSERT INTO property_policies
       (property_id,
        booking_policy,
        cancellation_policy,
        child_policy,
        pet_policy,
        terms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                propertyId,
                parsedPolicies.booking_policy || "",
                parsedPolicies.cancellation_policy || "",
                parsedPolicies.child_policy || "",
                parsedPolicies.pet_policy || "",
                parsedPolicies.terms || ""
            ]
        );

        // 6️⃣ INSERT CANCELLATION RULES
        for (const rule of parsedRules) {
            await connection.query(
                `INSERT INTO property_cancellation_rules
         (property_id, from_days, to_days, charge_type, charge_value)
         VALUES (?, ?, ?, ?, ?)`,
                [
                    propertyId,
                    rule.from_days || 0,
                    rule.to_days || 0,
                    rule.charge_type || "percentage",
                    rule.charge_value || 0
                ]
            );
        }

        // 7️⃣ INSERT STAFF
        for (let i = 0; i < parsedStaff.length; i++) {

            const photoFile =
                req.files?.staffPhotos?.[i]?.filename || "";

            await connection.query(
                `INSERT INTO property_staff
         (property_id, name, designation, phones,
           email, photo)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    propertyId,
                    parsedStaff[i].name || "",
                    parsedStaff[i].designation || "",
                    JSON.stringify(parsedStaff[i].phones || []),
                    parsedStaff[i].email || "",
                    photoFile
                ]
            );
        }

        // 8️⃣ INSERT AMENITIES
        for (const amenity of parsedAmenities) {
            await connection.query(
                `INSERT INTO property_amenities
         (property_id, amenity_name)
         VALUES (?, ?)`,
                [propertyId, amenity]
            );
        }

        // 9️⃣ INSERT SIGHTSEEING
        for (const place of parsedSightseeing) {
            await connection.query(
                `INSERT INTO property_sightseeing
         (property_id, place_name, distance_km,
          travel_time, description)
         VALUES (?, ?, ?, ?, ?)`,
                [
                    propertyId,
                    place.place_name || "",
                    place.distance_km || "",
                    place.travel_time || "",
                    place.description || ""
                ]
            );
        }

        // 🔟 INSERT FAQ
        for (const faq of parsedFaqs) {
            await connection.query(
                `INSERT INTO property_faqs
         (property_id, question, answer)
         VALUES (?, ?, ?)`,
                [
                    propertyId,
                    faq.question || "",
                    faq.answer || ""
                ]
            );
        }

        // 11️⃣ INSERT CHECKIN DATA
        await connection.query(
            `INSERT INTO property_checkin
       (property_id,
        check_in_time,
        check_out_time,
        is_24hr_checkin,
        early_checkin_allowed,
        early_checkin_charge,
        late_checkout_allowed,
        late_checkout_charge,
        id_proof_required)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                propertyId,
                parsedCheckin.check_in_time || "",
                parsedCheckin.check_out_time || "",
                parsedCheckin.is_24hr_checkin ? 1 : 0,
                parsedCheckin.early_checkin_allowed ? 1 : 0,
                parsedCheckin.early_checkin_charge || 0,
                parsedCheckin.late_checkout_allowed ? 1 : 0,
                parsedCheckin.late_checkout_charge || 0,
                parsedCheckin.id_proof_required ? 1 : 0,
            ]
        );

        // 12️⃣ INSERT BANK DETAILS
        await connection.query(
            `INSERT INTO property_bank_details
       (property_id, account_holder, bank_name,
        account_number, ifsc, branch, cancelled_cheque)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                propertyId,
                parsedBank.account_holder || "",
                parsedBank.bank_name || "",
                parsedBank.account_number || "",
                parsedBank.ifsc || "",
                parsedBank.branch || "",
                req.files?.cancelledCheque?.[0]?.filename || ""
            ]
        );

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: "Property created successfully",
            propertyId
        });

    } catch (error) {

        await connection.rollback();
        connection.release();

        console.error(error);
        res.status(500).json({
            success: false,
            message: "Transaction failed"
        });
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
      AND rr.plan = 'EP'

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
      AND rr.plan = 'EP'

    WHERE p.supplier_id = ?
AND p.status != 'Deleted'

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

        // ❗ If deleted, block public access
        if (property[0].status === "Deleted") {
            return res.status(403).json({ message: "Property deleted" });
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


// ================== SOFT DELETE PROPERTY ==================
router.put("/:id/delete", async (req, res) => {

    const propertyId = req.params.id;

    try {
        await db.promise().query(
            `UPDATE properties 
             SET status = 'Deleted' 
             WHERE id = ?`,
            [propertyId]
        );

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to delete" });
    }
});


router.put("/staff/:id/delete", async (req, res) => {

    const staffId = req.params.id;

    await db.promise().query(
        `UPDATE property_staff 
         SET is_active = 0 
         WHERE id = ?`,
        [staffId]
    );

    res.json({ success: true });
});
module.exports = router;