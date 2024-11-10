// routes/duels.js

const express = require('express');
const router = express.Router();
const DuelService = require('../services/duelService');

/**
 * Маршрут для запроса дуэли
 * Метод: POST
 * Путь: /duels/request
 * Тело запроса: { player1: string, player2: string, seatId: number }
 */
router.post('/request', async (req, res) => {
    const { player1, player2, seatId } = req.body;
    try {
        const duel = await DuelService.requestDuel(player1, player2, seatId);
        res.status(201).json({ 
            message: 'Дуэль запрошена. У противника есть 1 минута для принятия дуэли, после чего дуэль будет завершена.', 
            duel 
        });
    } catch (error) {
        console.error('Ошибка при запросе дуэли:', error);
        const errorMessage = error.message;

        if (errorMessage.includes('player1, player2 и seatId обязательны.')) {
            res.status(400).json({ error: errorMessage });
        } else if (errorMessage.includes('Место не найдено.')) {
            res.status(404).json({ error: errorMessage });
        } else if (errorMessage.includes('Место не занято.')) {
            res.status(409).json({ error: errorMessage });
        } else if (errorMessage.includes('Место уже участвовало в дуэли.')) {
            res.status(409).json({ error: errorMessage });
        } else if (errorMessage.includes('Один из игроков уже участвует в активной дуэли.')) {
            res.status(409).json({ error: errorMessage });
        } else if (errorMessage.includes('Дуэль для этого места уже существует и находится в процессе.')) {
            res.status(409).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
        }
    }
});

/**
 * Маршрут для принятия дуэли
 * Метод: PUT
 * Путь: /duels/:duelId/accept
 */
router.put('/:duelId/accept', async (req, res) => {
    const { duelId } = req.params;
    try {
        const duel = await DuelService.acceptDuel(parseInt(duelId));
        res.status(200).json({ message: 'Дуэль принята.', duel });
    } catch (error) {
        console.error('Ошибка при принятии дуэли:', error);
        const errorMessage = error.message;

        if (errorMessage.includes('Дуэль не найдена.')) {
            res.status(404).json({ error: errorMessage });
        } else if (errorMessage.includes('Дуэль не в статусе ожидания.')) {
            res.status(409).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
        }
    }
});

/**
 * Маршрут для завершения дуэли
 * Метод: PUT
 * Путь: /duels/:duelId/complete
 * Тело запроса: { winnerId: string }
 */
router.put('/:duelId/complete', async (req, res) => {
    const { duelId } = req.params;
    const { winnerId } = req.body;
    try {
        const duel = await DuelService.completeDuel(parseInt(duelId), winnerId);
        res.status(200).json({ message: 'Дуэль завершена.', duel });
    } catch (error) {
        console.error('Ошибка при завершении дуэли:', error);
        const errorMessage = error.message;

        if (errorMessage.includes('Дуэль не найдена.')) {
            res.status(404).json({ error: errorMessage });
        } else if (errorMessage.includes('Дуэль не принята.')) {
            res.status(409).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
        }
    }
});

/**
 * Маршрут для отклонения дуэли
 * Метод: PUT
 * Путь: /duels/:duelId/decline
 */
router.put('/:duelId/decline', async (req, res) => {
    const { duelId } = req.params;
    try {
        const duel = await DuelService.declineDuel(parseInt(duelId));
        res.status(200).json({ message: 'Дуэль отклонена.', duel });
    } catch (error) {
        console.error('Ошибка при отклонении дуэли:', error);
        const errorMessage = error.message;

        if (errorMessage.includes('Дуэль не найдена.')) {
            res.status(404).json({ error: errorMessage });
        } else if (errorMessage.includes('Дуэль не в статусе ожидания.')) {
            res.status(409).json({ error: errorMessage });
        } else {
            res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
        }
    }
});

/**
 * Маршрут для получения всех дуэлей по seatId
 * Метод: GET
 * Путь: /duels/seat/:seatId
 */
router.get('/seat/:seatId', async (req, res) => {
    const { seatId } = req.params;
    try {
        const duels = await DuelService.getDuelsBySeat(seatId);
        res.status(200).json({ duels });
    } catch (error) {
        console.error('Ошибка при получении дуэлей по seatId:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера.' });
    }
});

module.exports = router;
