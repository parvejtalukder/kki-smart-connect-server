import express from "express";

const router = express.Router();

router.get("/non", (req, res) => {
  res.json({
    success: true,
    users: [],
    message: "",
  });
});

export default router;