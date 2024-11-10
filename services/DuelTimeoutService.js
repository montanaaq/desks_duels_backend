// services/DuelTimeoutService.js

const cron = require('node-cron');
const DuelService = require('./DuelService');

class DuelTimeoutService {
    static start() {
        // Запускаем задачу каждые 5 минут
        cron.schedule('*/5 * * * *', async () => {
            console.log('Запуск проверки таймаутов дуэлей');
            try {
                const Duels = require('../models/Duel');
                const { Op } = require('sequelize');
                const sequelize = require('../db').sequelize;

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
                    await DuelService.declineDuel(duel.id);
                }
            } catch (error) {
                console.error('Ошибка при проверке таймаутов дуэлей:', error);
            }
        });
    }
}

module.exports = DuelTimeoutService;
