const express = require("express");
const router = express.Router();
const db = require("../Config/db");
const path = require("path");

// ================== PRICE CALCULATION FUNCTION ==================
const calculateBookingPrice = async ({
    roomId,
    plan,
    checkIn,
    checkOut,
    adults,
    childrenWithBed,
    childrenWithoutBed
}) => {

    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    if (nights <= 0) {
        throw new Error("Invalid dates");
    }

    let totalBase = 0;
    let totalExtra = 0;

    for (let i = 0; i < nights; i++) {

        const currentDate = new Date(start);
        currentDate.setDate(start.getDate() + i);

        const day = currentDate.getDay();
        const rateType = (day === 0 || day === 6) ? "weekend" : "weekday";

        const [rateRows] = await db.promise().query(
            `
        SELECT base_price, extra_adult_price, child_with_bed_price, child_without_bed_price
        FROM property_room_rates
        WHERE room_id = ? AND plan = ? AND rate_type = ?
        `,
            [roomId, plan, rateType]
        );

        if (!rateRows.length) {
            throw new Error("Rate not configured properly");
        }

        const rate = rateRows[0];

        totalBase += Number(rate.base_price);

        const extraAdults = Math.max(0, adults - 2);

        totalExtra +=
            (extraAdults * Number(rate.extra_adult_price || 0)) +
            (childrenWithBed * Number(rate.child_with_bed_price || 0)) +
            (childrenWithoutBed * Number(rate.child_without_bed_price || 0));
    }

    return {
        nights,
        baseAmount: totalBase,
        extraAmount: totalExtra,
        totalAmount: totalBase + totalExtra
    };
};

// ================== CALCULATE BOOKING ==================
router.post("/calculate-booking", async (req, res) => {

    const {
        roomId,
        plan,
        checkIn,
        checkOut,
        adults,
        childrenWithBed,
        childrenWithoutBed
    } = req.body;

    if (!roomId || !plan || !checkIn || !checkOut) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    try {

        const price = await calculateBookingPrice({
            roomId,
            plan,
            checkIn,
            checkOut,
            adults,
            childrenWithBed,
            childrenWithoutBed
        });

        res.json(price);

    } catch (error) {
        console.error("Calculation Error:", error);
        res.status(500).json({ message: error.message });
    }
});

// ================== CONFIRM BOOKING ==================
router.post("/confirm-booking", async (req, res) => {

    const {
        propertyId,
        roomId,
        plan,
        checkIn,
        checkOut,
        adults,
        childrenWithBed,
        childrenWithoutBed,
        agentId
    } = req.body;

    if (!propertyId || !roomId || !plan || !checkIn || !checkOut || !agentId) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const connection = await db.promise().getConnection();

    try {

        await connection.beginTransaction();

        // 🔥 Recalculate price (never trust frontend)
        const price = await calculateBookingPrice({
            roomId,
            plan,
            checkIn,
            checkOut,
            adults,
            childrenWithBed,
            childrenWithoutBed
        });

        // 🔥 Commission (example 10%)
        const commissionPercent = 10;
        const commissionAmount = (price.totalAmount * commissionPercent) / 100;
        const finalPayable = price.totalAmount - commissionAmount;

        // 🔥 Generate Booking Number
        const bookingNumber = "BK" + Date.now();

        // 1️⃣ Insert booking
        const [bookingResult] = await connection.query(
            `
      INSERT INTO bookings
      (booking_number, property_id, agent_id, check_in, check_out,
       total_nights, base_amount, extra_amount, total_amount,
       commission_amount, final_payable, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
            [
                bookingNumber,
                propertyId,
                agentId,
                checkIn,
                checkOut,
                price.nights,
                price.baseAmount,
                price.extraAmount,
                price.totalAmount,
                commissionAmount,
                finalPayable,
                "Pending"
            ]
        );

        const bookingId = bookingResult.insertId;

        // 2️⃣ Insert booking room
        await connection.query(
            `
      INSERT INTO booking_rooms
      (booking_id, room_id, plan, adults, children_with_bed, children_without_bed, price_per_night)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
            [
                bookingId,
                roomId,
                plan,
                adults,
                childrenWithBed,
                childrenWithoutBed,
                price.totalAmount / price.nights
            ]
        );

        await connection.commit();
        connection.release();

        res.json({
            message: "Booking Confirmed",
            bookingNumber,
            totalAmount: price.totalAmount,
            commissionAmount,
            finalPayable
        });

    } catch (error) {

        await connection.rollback();
        connection.release();

        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
});


// ================== GET AGENT BOOKINGS ==================
router.get("/agent/:agentId", async (req, res) => {

    const agentId = req.params.agentId;

    try {

        const [rows] = await db.promise().query(
            `
            SELECT 
                b.id,
                b.booking_number,
                p.name AS property_name,
                p.city,
                b.check_in,
                b.check_out,
                b.total_amount,
                b.status,
                b.created_at
            FROM bookings b
            JOIN properties p ON b.property_id = p.id
            WHERE b.agent_id = ?
            ORDER BY b.id DESC
            `,
            [agentId]
        );

        res.json(rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});


// ================== GET BOOKING DETAILS ==================
router.get("/details/:bookingNumber", async (req, res) => {

    const bookingNumber = req.params.bookingNumber;

    try {

        const [booking] = await db.promise().query(
            `
  SELECT 
      b.*, 

      p.name AS property_name,
      p.city,
      p.address,
      p.category,

      u.company_name AS agent_name,
      u.contact_person,
      u.mobile AS agent_mobile,
      u.email AS agent_email

  FROM bookings b
  JOIN properties p ON b.property_id = p.id
  JOIN users u ON b.agent_id = u.id
  WHERE b.booking_number = ?
  `,
            [bookingNumber]
        );

        if (!booking.length) {
            return res.status(404).json({ message: "Booking not found" });
        }

        const [rooms] = await db.promise().query(
            `
  SELECT 
    br.*,
    pr.type AS room_type
  FROM booking_rooms br
  JOIN property_rooms pr ON br.room_id = pr.id
  WHERE br.booking_id = ?
  `,
            [booking[0].id]
        );

        res.json({
            booking: booking[0],
            rooms
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// ================== CANCEL BOOKING ==================
router.put("/cancel/:bookingNumber", async (req, res) => {
    const { bookingNumber } = req.params;

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `
      SELECT 
        total_amount,
        check_in,
        status,
        payment_status
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

        const today = new Date();
        const checkIn = new Date(booking.check_in);

        const diffDays = Math.ceil(
            (checkIn.getTime() - today.getTime()) /
            (1000 * 60 * 60 * 24)
        );

        // ❌ Cannot cancel after check-in
        if (diffDays < 0) {
            await connection.rollback();
            return res.status(400).json({
                message: "Cannot cancel after check-in date"
            });
        }

        const total = Number(booking.total_amount);

        let refundPercent = 0;

        if (diffDays >= 7) refundPercent = 1;
        else if (diffDays >= 3) refundPercent = 0.7;
        else if (diffDays >= 1) refundPercent = 0.5;
        else refundPercent = 0;

        const refundAmount = Number((total * refundPercent).toFixed(2));
        const cancellationCharge = Number((total - refundAmount).toFixed(2));

        await connection.query(
            `
      UPDATE bookings
      SET 
        status = 'Cancelled',
        payment_status = 
          CASE 
            WHEN payment_status = 'Paid' THEN 'Refunded'
            ELSE payment_status
          END,
        refund_amount = ?,
        cancellation_charge = ?,
        cancelled_by = 'agent',
        cancelled_at = NOW()
      WHERE booking_number = ?
      `,
            [refundAmount, cancellationCharge, bookingNumber]
        );

        await connection.commit();
        connection.release();

        res.json({
            message: "Booking cancelled successfully",
            refundAmount,
            cancellationCharge
        });

    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});
module.exports = router;