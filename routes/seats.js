// routes/seats.js

const express = require('express');
const router = express.Router();
const Seats = require('../models/Seats');
const User = require('../models/User');
const retryOperation = require('../utils/retryOperation');

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
		if (isNaN(seatId)) {
			return res.status(400).json({ error: 'Неверный формат ID места.' });
		}

		const seat = await Seats.findByPk(seatId);
		if (!seat) {
			return res.status(404).json({ error: 'Место не найдено.' });
		}

		res.json(seat);
	} catch (error) {
		console.error('Ошибка при получении места:', error);
		res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
	}
});

// Обновление места при его занятии
router.post('/:seatId/take', async (req, res) => {
	const { seatId } = req.params;
	const { telegramId } = req.body;

	try {
		const result = await retryOperation(async () => {
			// Проверяем активные дуэли
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
				throw { status: 409, message: 'Вы не можете занять новое место, пока участвуете в активной дуэли.' };
			}

			// Находим текущее место пользователя
			const currentSeat = await Seats.findOne({
				where: { occupiedBy: telegramId }
			});

			// Проверяем новое место
			const newSeat = await Seats.findByPk(seatId);
			if (!newSeat) {
				throw { status: 404, message: 'Место не найдено.' };
			}
			if (newSeat.occupiedBy) {
				throw { status: 409, message: 'Место уже занято.' };
			}

			// Освобождаем текущее место
			if (currentSeat) {
				await Seats.update(
					{ occupiedBy: null, status: 'available' },
					{ where: { id: currentSeat.id } }
				);
			}

			// Занимаем новое место
			await Seats.update(
				{ occupiedBy: telegramId, status: 'occupied' },
				{ where: { id: seatId } }
			);

			// Обновляем информацию о пользователе
			await User.update(
				{ currentSeat: seatId },
				{ where: { telegramId } }
			);

			return await Seats.findByPk(seatId);
		});

		res.status(200).json({ message: 'Место успешно занято.', newSeat: result });
	} catch (error) {
		console.error('Ошибка при занятии места:', error);
		const status = error.status || 500;
		const message = error.message || 'Внутренняя ошибка сервера.';
		res.status(status).json({ error: message });
	}
});

module.exports = router;
