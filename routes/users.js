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
router.post('/set-dueling', async (req, res) => {
  const { telegramId, dueling } = req.body;

  try {
      const user = await User.findOne({ where: { telegramId } });

      if (!user) {
          return res.status(404).json({ error: 'Пользователь не найден.' });
      }

      user.dueling = dueling;
      await user.save();

      return res.status(200).json({ message: 'Флаг dueling обновлён.' });
  } catch (error) {
      console.error('Ошибка при обновлении флага dueling:', error);
      return res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
  }
});


module.exports = router;
