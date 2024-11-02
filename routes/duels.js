const express = require('express');
const router = express.Router();
const Duels = require('../models/Duels');
const Seats = require('../models/Seats');
const User = require('../models/User');

// Получение всех дуэлей
router.get('/', async (req, res) => {
    try {
        const duels = await Duels.findAll();
        res.json(duels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/request', async (req, res) => {
    const { player1, player2, seatId } = req.body;

    try {
        const seat = await Seats.findByPk(seatId);
        if (!seat || seat.dueled) {
            return res.status(400).json({ message: 'Место недоступно для дуэли' });
        }

        const duel = await Duels.create({ player1, player2, seatId });
        res.status(201).json({ message: 'Дуэль запрошена. У противника есть 1 минута для принятия дуэли, после чего дуэль будет завершена.', duel });

        // Установим таймер для автоматического завершения дуэли, если она не принята
        setTimeout(async () => {
            const duelStatus = await Duels.findByPk(duel.id);
            if (duelStatus && duelStatus.status === 'pending') {
                await duelStatus.update({ status: 'timeout', winner: player1 });
                await seat.update({ occupiedBy: player1, dueled: true });
                console.log(`Время вышло! Место было занято: ${player1}`);
            }
        }, 60000); // 1 минута
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Принятие дуэли
router.put('/:id/accept', async (req, res) => {
    try {
        const duel = await Duels.findByPk(req.params.id);
        if (!duel || duel.status !== 'pending') {
            return res.status(400).json({ message: 'Неверная дуэль' });
        }

        await duel.update({ status: 'accepted' });
        res.json({ message: 'Дуэль принята' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Завершение дуэли
router.put('/:id/complete', async (req, res) => {
    const { winnerId } = req.body;
    try {
        const duel = await Duels.findByPk(req.params.id);
        if (!duel || duel.status !== 'accepted') {
            return res.status(400).json({ message: 'Неверная дуэль' });
        }

        // Обновляем статус дуэли
        await duel.update({ status: 'completed', winner: winnerId });

        // Сбрасываем предыдущее место победителя
        await Seats.update({ occupiedBy: null, dueled: false }, { where: { occupiedBy: winnerId } });
        await User.update({ currentSeat: null }, { where: { id: winnerId } });

        // Назначаем новое место победителя
        await Seats.update({ occupiedBy: winnerId, dueled: true }, { where: { id: duel.seatId } });
        await User.update({ currentSeat: duel.seatId }, { where: { id: winnerId } });

        res.json({ message: 'Дуэль завершена, место назначено победителю', duel });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;