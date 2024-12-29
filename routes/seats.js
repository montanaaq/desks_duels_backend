// routes/seats.js

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

// Получение места по ID
router.get('/:id', async (req, res) => {
	try {
		const seatId = req.params.id;

		// Проверка, является ли seatId числом
		if (isNaN(seatId)) {
			return res.status(400).json({ error: 'Invalid seat ID format.' });
		}

		const seat = await Seats.findByPk(seatId);

		if (!seat) {
			return res.status(404).json({ error: 'Seat not found.' });
		}

		res.json(seat);
	} catch (error) {
		console.error('Error fetching seat by ID:', error);
		res.status(500).json({ error: 'Internal server error.' });
	}
});

// Обновление состояния места (например, пометить как занятое)
router.put('/:id', async (req, res) => {
	try {
		const seat = await Seats.findByPk(req.params.id);
		if (!seat) return res.status(404).json({ message: 'Seat not found' });

		seat.occupiedBy = req.body.occupiedBy || null;
		seat.isRed = req.body.isRed || false;
		await seat.save();

		res.json({ message: 'Seat updated', seat });
	} catch (error) {
		res.status(400).json({ error: error.message });
	}
});

// Обновление места при его занятии
router.post('/:seatId/take', async (req, res) => {
    const { seatId } = req.params;
    const { telegramId } = req.body;

    try {
        // Check if user is involved in any active duels
        const Duel = require('../models/Duel');
        const { Op } = require('sequelize');
        const activeDuel = await Duel.findOne({
            where: {
                [Op.or]: [
                    { player1: telegramId },
                    { player2: telegramId }
                ],
                status: {
                    [Op.in]: ['pending', 'accepted']
                }
            }
        });

        if (activeDuel) {
            return res.status(409).json({ 
                error: 'Вы не можете занять новое место, пока участвуете в активной дуэли.' 
            });
        }

        // Находим текущее место, которое занимает пользователь
        const currentSeat = await Seats.findOne({
            where: { occupiedBy: telegramId }
        });

        // Проверяем, свободно ли запрашиваемое место
        const newSeat = await Seats.findByPk(seatId);
        if (!newSeat) {
            return res.status(404).json({ error: 'Место не найдено.' });
        }
        if (newSeat.occupiedBy) {
            return res.status(409).json({ error: 'Место уже занято.' });
        }

        // Освобождаем предыдущее место, если оно существует, независимо от его статуса
        if (currentSeat) {
            currentSeat.occupiedBy = null;
            currentSeat.status = 'available';
            await currentSeat.save();
        }

        // Занимаем новое место пользователем
        newSeat.occupiedBy = telegramId;
        newSeat.status = 'occupied';
        await newSeat.save();

        // Update user's currentSeat in the User model
        const User = require('../models/User');
        await User.update(
            { currentSeat: seatId },
            { where: { telegramId } }
        );

        res.status(200).json({ message: 'Место успешно занято.', newSeat });
    } catch (error) {
        console.error('Error taking seat:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
    }
});

module.exports = router;
