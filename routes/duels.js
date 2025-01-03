// routes/duels.js

const express = require('express');
const router = express.Router();
const DuelService = require('../services/duelService');

/**
 * Маршрут для получения всех дуэлей
 * Метод: GET
 * Путь: /duels
 */
router.get('/', async (req, res) => {
    try {
      const duels = await DuelService.getAllDuels();
      res.status(200).json(duels);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Ошибка при получении дуэлей' });
    }
  });

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
 */
router.put('/:duelId/complete', async (req, res) => {
    const { duelId } = req.params;
    try {
        const duel = await DuelService.completeDuel(parseInt(duelId));
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
    try {
        const { duelId } = req.params;
        const { isTimeout } = req.body;

        console.log(`Attempting to decline duel ${duelId}, isTimeout: ${isTimeout}`);

        const result = await DuelService.declineDuel(parseInt(duelId), isTimeout);
        
        // If the duel is already in a final state, return 200 with the message
        if (!result.success && result.message && (
            result.message.includes('завершена') || 
            result.message.includes('отклонена') || 
            result.message.includes('таймауту')
        )) {
            return res.status(200).json(result);
        }

        // For actual errors, return 400
        if (!result.success) {
            return res.status(400).json(result);
        }

        const io = global.io;
        if (io) {
            // Отправляем обновление всех измененных мест всем клиентам
            if (result.updatedSeats) {
                io.emit('seatsUpdated', result.updatedSeats);
            }

            // Уведомляем участников дуэли
            if (result.duel) {
                const notification = {
                    duel: {
                        seatId: result.duel.seatId,
                        player1: result.duel.player1,
                        player2: result.duel.player2,
                        isTimeout: isTimeout || false
                    }
                };

                const eventName = isTimeout ? 'duelTimeout' : 'duelDeclined';
                
                if (result.duel.player1) {
                    io.to(result.duel.player1).emit(eventName, notification);
                }
                if (result.duel.player2) {
                    io.to(result.duel.player2).emit(eventName, notification);
                }
            }
        }

        return res.json(result);
    } catch (error) {
        console.error('Ошибка при отклонении дуэли:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Внутренняя ошибка сервера при отклонении дуэли' 
        });
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

/**
 * Маршрут для получения тайм-аут дуэлей для пользователя
 * Метод: GET
 * Путь: /duels/timed-out
 * Параметр запроса: telegramId
 */
router.get('/timed-out', async (req, res) => {
    const { telegramId } = req.query;

    if (!telegramId) {
        return res.status(400).json({ error: 'Telegram ID обязателен' });
    }

    try {
        const timedOutDuels = await DuelService.getTimedOutDuelsForUser(telegramId);
        res.status(200).json(timedOutDuels);
    } catch (error) {
        console.error('Ошибка при получении тайм-аут дуэлей:', error);
        res.status(500).json({ 
            error: 'Не удалось получить тайм-аут дуэли', 
            details: error.message 
        });
    }
});

/**
 * Маршрут для получения активной дуэли пользователя
 * Метод: GET
 * Путь: /duels/active/:userId
 */
router.get('/active/:userId', async (req, res) => {
    const { userId } = req.params;
    
    if (!userId) {
        return res.status(400).json({ error: 'ID пользователя обязателен' });
    }

    try {
        const activeDuel = await DuelService.getActiveDuelForUser(userId);
        res.status(200).json({ duel: activeDuel });
    } catch (error) {
        console.error('Ошибка при получении активной дуэли:', error);
        res.status(500).json({ 
            error: 'Не удалось получить активную дуэль', 
            details: error.message 
        });
    }
});

/**
 * Маршрут для отклонения дуэли
 * Метод: POST
 * Путь: /duels/decline/:duelId
 */
router.post('/decline/:duelId', async (req, res) => {
  try {
    const { duelId } = req.params;
    const result = await DuelService.declineDuel(duelId);
    
    if (result.success) {
      // Отправляем событие всем клиентам об отклонении дуэли
      req.app.io.emit('duelDeclined', {
        success: true,
        message: 'Дуэль отклонена',
        duel: result.duel
      });
      
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error declining duel:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
