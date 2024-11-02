const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Модель User
const Seats = require('../models/Seats'); // Модель Seats

// Маршрут для регистрации пользователя
router.get('/', async (req, res) => {
  const users = await User.findAll();
  res.json(users);
})

module.exports = router;
