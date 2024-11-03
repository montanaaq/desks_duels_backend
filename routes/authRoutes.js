// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { findOrCreateUser, getUserByTelegramId, setRulesSeen, deleteUser } = require('../services/authService');

// Telegram Web App Authentication
router.post('/register', async (req, res) => {
  const { telegramId, username, firstName } = req.body;

  if (!telegramId || !username || !firstName) {
    return res.status(400).json({ message: 'Требуются поля telegramId, username, firstName' });
  }

  try {
    const user = await findOrCreateUser({ telegramId, name: firstName, username });
    
    // Return user data with a success message
    res.status(200).json({ message: 'Пользователь успешно зарегестрирован', user });
  } catch (error) {
    console.error('Telegram Auth error:', error);
    res.status(500).json({ message: 'Ошибка сервера, попробуйте позже' });
  }
});

// Endpoint to check if user exists based on Telegram ID
router.post('/check', async (req, res) => {
  const { telegramId } = req.body;

  if (!telegramId) {
    return res.status(400).json({ message: 'Требуется поле telegramId' });
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (user) {
      res.status(200).json({ message: 'Пользователь найден', user });
    } else {
      res.status(404).json({ message: 'Пользователь не найден' });
    }
  } catch (error) {
    console.error('Error checking user by Telegram ID:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});
router.post('/accept-rules', async (req, res) => {
    const { telegramId } = req.body; 
    try {
        const response = await setRulesSeen(telegramId);
        res.status(200).json({ message: response });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
  });

router.delete('/delete', async (req, res) => {
  const { telegramId } = req.body;

  if (!telegramId) {
    return res.status(400).json({ message: 'Требуется поле telegramId' });
  }

  try {
    const user = await getUserByTelegramId(telegramId);
    if (user) {
      await deleteUser(telegramId);
      res.status(200).json({ message: 'Пользователь удален' });
    } else {
      res.status(404).json({ message: 'Пользователь не найден' });
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

module.exports = router;
