const express = require("express");
const router = express.Router();
const db = require("../Config/db");

// ======================
// CREATE CATEGORY
// ======================
router.post("/", (req, res) => {
  const { category_name } = req.body;

  if (!category_name) {
    return res.status(400).json({ message: "Category name is required" });
  }

  const sql = "INSERT INTO categories (category_name) VALUES (?)";

  db.query(sql, [category_name], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Server error" });
    }

    res.status(201).json({
      message: "Category created successfully",
      id: result.insertId,
    });
  });
});

// ======================
// GET ALL CATEGORIES
// ======================
router.get("/", (req, res) => {
  const sql = "SELECT * FROM categories ORDER BY id DESC";

  db.query(sql, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Server error" });
    }

    res.json(results);
  });
});

// ======================
// GET SINGLE CATEGORY
// ======================
router.get("/:id", (req, res) => {
  const { id } = req.params;

  const sql = "SELECT * FROM categories WHERE id = ?";

  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Server error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json(results[0]);
  });
});

// ======================
// UPDATE CATEGORY
// ======================
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { category_name } = req.body;

  if (!category_name) {
    return res.status(400).json({ message: "Category name is required" });
  }

  const sql = "UPDATE categories SET category_name = ? WHERE id = ?";

  db.query(sql, [category_name, id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Server error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category updated successfully" });
  });
});

// ======================
// DELETE CATEGORY
// ======================
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM categories WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: "Server error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category deleted successfully" });
  });
});

module.exports = router;