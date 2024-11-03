const express = require('express');
const router = express.Router();
const Seats = require('../models/Seats'); // Импорт модели Seats
const User = require('../models/User'); // Импорт модели User

// Получение всех мест
router.get('/', async (req, res) => {
    try {
        const seats = await Seats.findAll();
        res.json(seats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновление состояния места (например, пометить как занятое)
router.put('/:id', async (req, res) => {
    try {
        const seat = await Seats.findByPk(req.params.id);
        if (!seat) return res.status(404).json({ message: 'Seat not found' });

        seat.occupiedBy = req.body.occupiedBy || null; // ID пользователя, занимающего место
        seat.isRed = req.body.isRed || false;
        await seat.save(); // Сохраняем изменения в конкретной записи

        res.json({ message: 'Seat updated', seat });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
router.put('/:id/take', async (req, res) => {
    try {
      const seatId = req.params.id;
      const { telegramId } = req.body;
  
      if (!telegramId) {
        return res.status(400).json({ error: 'telegramId is required in the request body' });
      }
  
      // Find the seat by id
      const seat = await Seats.findOne({ where: { id: seatId } });
  
      if (!seat) {
        return res.status(404).json({ error: 'Seat not found' });
      }
  
      // Find the user by telegramId
      const user = await User.findOne({ where: { telegramId } });
  
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      // Check if the user already has a seat occupied
      if (user.currentSeat) {
        // Find the previous seat
        const previousSeat = await Seats.findOne({ where: { id: user.currentSeat } });
  
        // Update the previous seat's occupiedBy field to null
        previousSeat.occupiedBy = null;
        await previousSeat.save();
      }
  
      // Update the new seat's occupiedBy field to the user's telegramId
      seat.occupiedBy = telegramId;
      await seat.save();
  
      // Update the user's currentSeat field
      user.currentSeat = seatId;
      await user.save();
  
      res.status(200).json({ message: 'Место успешно занято!', seat });
  
    } catch (error) {
      console.error('Error updating seat:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
module.exports = router;
