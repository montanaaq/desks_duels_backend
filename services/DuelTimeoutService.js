// services/DuelTimeoutService.js

const cron = require('node-cron');
const DuelService = require('./duelService')

class DuelTimeoutService {
    static start() {
        // Запускаем задачу каждые 5 минут
        cron.schedule('*/5 * * * *', async () => {
            console.log('Запуск проверки таймаутов дуэлей');
            try {
                const Duels = require('../models/Duel');
                const { Op } = require('sequelize');
                const sequelize = require('../db').sequelize;
                const io = global.io; // Используем глобальный io

                const timeoutThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 минут назад

                // Находим дуэли в статусе 'pending', которые были созданы более 5 минут назад
                const duelsToTimeout = await Duels.findAll({
                    where: {
                        status: 'pending',
                        createdAt: {
                            [Op.lt]: timeoutThreshold,
                        },
                    },
                });

                for (const duel of duelsToTimeout) {
                    console.log(`Таймаут дуэли: duel.id=${duel.id}`);
                    const result = await DuelService.declineDuel(duel.id, true);

                    // Уведомляем участников дуэли через socket
                    if (io) {
                        // Отправляем обновление всех измененных мест всем клиентам
                        io.emit('seatsUpdated', result.updatedSeats);

                        // Уведомляем участников дуэли
                        io.to(duel.player1).emit('duelTimeout', {
                            duel: {
                                seatId: duel.seatId,
                                player1: duel.player1,
                                player2: duel.player2,
                                isTimeout: true
                            }
                        });

                        io.to(duel.player2).emit('duelTimeout', {
                            duel: {
                                seatId: duel.seatId,
                                player1: duel.player1,
                                player2: duel.player2,
                                isTimeout: true
                            }
                        });
                    }
                }
            } catch (error) {
                console.error('Ошибка при проверке таймаутов дуэлей:', error);
            }
        });
    }
}

module.exports = DuelTimeoutService;
