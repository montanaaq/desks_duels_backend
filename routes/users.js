const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Модель User

// Маршрут для регистрации пользователя
router.get('/', async (req, res) => {
  const users = await User.findAll();
  res.json(users);
})
router.post('/get-occupiedBy-user', async (req, res) => {
  try {
      const { occupiedById } = req.body;
      const user = await User.findOne({ where: { telegramId: occupiedById } });
      
      res.json({ user });
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
})

module.exports = router;
