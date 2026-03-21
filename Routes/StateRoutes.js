const express = require("express");
const router = express.Router();
const db = require("../Config/db");


// ======================
// CREATE STATE
// ======================
router.post("/", (req, res) => {
    const { state_name, status } = req.body;

    if (!state_name) {
        return res.status(400).json({ message: "State name is required" });
    }

    const sql = "INSERT INTO states (state_name, status) VALUES (?, ?)";

    db.query(sql, [state_name, status ?? 1], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Server error" });
        }

        res.status(201).json({
            message: "State created successfully",
            id: result.insertId,
        });
    });
});


// ======================
// GET ALL STATES
// ======================
router.get("/", (req, res) => {
    const sql = "SELECT * FROM states ORDER BY state_name ASC";

    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ message: "Server error" });
        res.json(results);
    });
});


// ======================
// UPDATE STATE
// ======================
router.put("/:id", (req, res) => {
    const { id } = req.params;
    const { state_name, status } = req.body;

    const sql = `
    UPDATE states 
    SET state_name = ?, status = ?
    WHERE id = ?
  `;

    db.query(sql, [state_name, status, id], (err, result) => {
        if (err) return res.status(500).json({ message: "Server error" });

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "State not found" });
        }

        res.json({ message: "State updated successfully" });
    });
});


// ======================
// DELETE STATE
// ======================
router.delete("/:id", (req, res) => {
    const { id } = req.params;

    db.query("DELETE FROM states WHERE id = ?", [id], (err, result) => {
        if (err) return res.status(500).json({ message: "Server error" });

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "State not found" });
        }

        res.json({ message: "State deleted successfully" });
    });
});


// ======================
// TOGGLE STATUS (IMPORTANT)
// ======================
router.patch("/:id/status", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    db.query(
        "UPDATE states SET status = ? WHERE id = ?",
        [status, id],
        (err, result) => {
            if (err) return res.status(500).json({ message: "Server error" });

            res.json({ message: "Status updated" });
        }
    );
});

module.exports = router;