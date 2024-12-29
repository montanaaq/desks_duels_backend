const dbContext = require('../db');
const { Op } = require('sequelize');
const { Sequelize } = require('sequelize');
const cron = require('node-cron');

/**
 * Класс для управления дуэлями.
 */
class DuelService {
    /**
     * Запросить дуэль между двумя игроками за конкретное место.
     * @param {string} player1 - Telegram ID инициатора.
     * @param {string} player2 - Telegram ID оппонента.
     * @param {number} seatId - ID места.
     * @returns {Promise<Duel>} - Созданный или существующий объект дуэли.
     */
    static async requestDuel(player1, player2, seatId) {
        const transaction = await dbContext.sequelize.transaction();

        try {
            if (!player1 || !player2 || !seatId) {
                throw new Error('player1, player2 и seatId обязательны.');
            }

            // Получаем место с блокировкой для предотвращения одновременных изменений
            const seat = await dbContext.models.Seats.findByPk(seatId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!seat) throw new Error('Место не найдено.');
            if (!seat.occupiedBy) throw new Error('Место не занято.');
            if (seat.status === 'dueled') throw new Error('Место уже участвовало в дуэли.');

            // Проверяем, есть ли уже активная дуэль для этого места
            const existingDuel = await dbContext.models.Duel.findOne({
                where: {
                    seatId,
                    status: { [Op.in]: ['pending', 'accepted'] },
                },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (existingDuel) {
                await transaction.commit();
                return existingDuel;
            }

            // Создаем новую дуэль со статусом 'pending'
            const duel = await dbContext.models.Duel.create({
                player1,
                player2,
                seatId,
                status: 'pending',
            }, { transaction });

            await transaction.commit();

            // Запланируйте задание таймаута
            this.scheduleDuelTimeout(duel.id, player1, player2, seatId);

            return duel;
        } catch (error) {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.log(rollbackError)
                }
            }
            throw error;
        }
    }

    /**
     * Обработать таймаут дуэли, автоматически отклонив ее и присвоив место инициатору
     * @param {number} duelId - ID дуэли
     * @returns {Promise<Object>} - Результат операции таймаута
     */
    static async handleDuelTimeout(duelId) {
        let transaction;
        try {
            transaction = await dbContext.sequelize.transaction({
                isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
            });

            // Находим дуэль с блокировкой
            const duel = await dbContext.models.Duel.findOne({
                where: {
                    id: duelId,
                    status: 'pending'
                },
                transaction,
                lock: true
            });

            if (!duel) {
                await transaction.rollback();
                return { success: false, message: 'Дуэль не найдена или уже завершена' };
            }

            // Обновляем статус дуэли на таймаут
            duel.status = 'timeout';
            await duel.save({ transaction });

            // Находим все места, занятые обоими игроками
            const [player1Seats, player2Seats] = await Promise.all([
                dbContext.models.Seats.findAll({
                    where: {
                        occupiedBy: duel.player1
                    },
                    transaction,
                    lock: true
                }),
                dbContext.models.Seats.findAll({
                    where: {
                        occupiedBy: duel.player2
                    },
                    transaction,
                    lock: true
                })
            ]);

            // Находим целевое место для этой дуэли
            const targetSeat = await dbContext.models.Seats.findByPk(duel.seatId, {
                transaction,
                lock: true
            });

            if (!targetSeat) {
                await transaction.rollback();
                return { success: false, message: 'Место не найдено' };
            }

            // Очищаем все предыдущие места для player1 (победителя)
            const clearedSeats = [];
            for (const seat of player1Seats) {
                if (seat.id !== targetSeat.id) {
                    seat.occupiedBy = null;
                    seat.status = 'available';
                    await seat.save({ transaction });
                    clearedSeats.push(seat);
                }
            }

            // Очищаем все места для player2 (проигравшего)
            for (const seat of player2Seats) {
                seat.occupiedBy = null;
                seat.status = 'available';
                await seat.save({ transaction });
                clearedSeats.push(seat);
            }

            // Назначаем целевое место победителю (player1)
            targetSeat.occupiedBy = duel.player1;
            targetSeat.status = 'dueled';
            await targetSeat.save({ transaction });

            // Сбрасываем статус дуэли для обоих игроков
            await dbContext.models.User.update(
                { dueling: false },
                {
                    where: { telegramId: { [Op.in]: [duel.player1, duel.player2] } },
                    transaction
                }
            );

            // Обновляем текущее место в модели User для обоих игроков
            await Promise.all([
                // Устанавливаем победителю целевое место
                dbContext.models.User.update(
                    { currentSeat: targetSeat.id },
                    {
                        where: { telegramId: duel.player1 },
                        transaction
                    }
                ),
                // Очищаем текущее место проигравшего
                dbContext.models.User.update(
                    { currentSeat: null },
                    {
                        where: { telegramId: duel.player2 },
                        transaction
                    }
                )
            ]);

            // Фиксируем все изменения
            await transaction.commit();

            // Уведомляем через сокет после успешной фиксации
            const io = global.io;
            if (io) {
                // Получаем свежие данные о местах после фиксации
                const updatedSeats = await dbContext.models.Seats.findAll();
                io.emit('seatsUpdated', updatedSeats);

                // Уведомляем обоих игроков о таймауте
                const timeoutNotification = {
                    duel: {
                        seatId: duel.seatId,
                        player1: duel.player1,
                        player2: duel.player2,
                        isTimeout: true,
                        clearedSeats: clearedSeats.map(seat => seat.id)
                    }
                };

                io.to(duel.player1).emit('duelTimeout', timeoutNotification);
                io.to(duel.player2).emit('duelTimeout', timeoutNotification);
            }

            return {
                success: true,
                message: 'Дуэль завершена по таймауту, место занято инициатором',
                duel,
                targetSeat,
                clearedSeats
            };
        } catch (error) {
            console.error('Ошибка при обработке таймаута дуэли:', error);
            if (transaction) {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error('Ошибка при откате транзакции:', rollbackError);
                }
            }
            throw error;
        }
    }

    /**
     * Запланируйте таймаут для дуэли
     * @param {number} duelId - ID дуэли
     * @param {string} player1 - Telegram ID инициатора
     * @param {string} player2 - Telegram ID оппонента
     * @param {number} seatId - ID места
     */
    static scheduleDuelTimeout(duelId, player1, player2, seatId) {
        setTimeout(async () => {
            try {
                // Проверяем текущий статус дуэли
                const duel = await dbContext.models.Duel.findByPk(duelId);
                if (!duel || duel.status !== 'pending') {
                    return; // Дуэль уже завершена или не в ожидании
                }

                const result = await declineDuel(duelId, true);
                if (result.success) {
                    console.log(`Дуэль ${duelId} автоматически отклонена по истечении времени`);
                    
                    // Отправляем уведомления после успешного отклонения
                    const io = global.io;
                    if (io) {
                        // Обновляем всех клиентов о изменениях мест
                        const updatedSeats = await dbContext.models.Seats.findAll();
                        io.emit('seatsUpdated', updatedSeats);

                        // Уведомляем обоих игроков об автоматическом отклонении
                        const notification = {
                            duel: {
                                seatId: seatId,
                                player1: player1,
                                player2: player2,
                                isAutoDeclined: true
                            }
                        };

                        io.to(player1).emit('duelDeclined', notification);
                        io.to(player2).emit('duelDeclined', notification);
                    }
                } else {
                    console.error('Не удалось автоматически отклонить дуэль:', result.message);
                }
            } catch (error) {
                console.error('Ошибка при автоматическом отклонении дуэли:', error);
            }
        }, 60000); // таймаут 60 секунд
    }

    /**
     * Принять дуэль.
     * @param {number} duelId - ID дуэли для принятия.
     * @returns {Promise<Duel>} - Обновленный объект дуэли.
     */
    static async acceptDuel(duelId) {
        const transaction = await dbContext.sequelize.transaction();
    
        try {
            const duel = await dbContext.models.Duel.findByPk(duelId, { 
                transaction,
                include: [
                    { 
                        model: dbContext.models.User, 
                        as: 'initiator', 
                        attributes: ['telegramId', 'dueling'] 
                    },
                    { 
                        model: dbContext.models.User, 
                        as: 'opponent', 
                        attributes: ['telegramId', 'dueling'] 
                    }
                ]
            });
    
            if (!duel) {
                throw new Error('Дуэль не найдена.');
            }
    
            // Проверяем, что дуэль имеет статус 'pending'
            if (duel.status !== 'pending') {
                if (duel.status === 'accepted') {
                    await transaction.commit();
                    return duel;
                }
                
                throw new Error(`Нельзя принять дуэль в статусе ${duel.status}`);
            }
    
            // Проверяем, не истек ли таймаут дуэли
            const sixtySecondsAgo = new Date(Date.now() - 60000);
            if (duel.createdAt < sixtySecondsAgo) {
                duel.status = 'timeout';
                await duel.save({ transaction });
                await transaction.commit();
                return duel;
            }
    
            // Проверяем, доступны ли оба игрока для дуэли
            const player1 = await dbContext.models.User.findOne({ 
                where: { telegramId: duel.player1 }, 
                transaction 
            });
            const player2 = await dbContext.models.User.findOne({ 
                where: { telegramId: duel.player2 }, 
                transaction 
            });
    
            if (!player1 || !player2) {
                throw new Error('Игроки не найдены');
            }
    
            // Обновляем статус дуэли на 'accepted'
            duel.status = 'accepted';
            await duel.save({ transaction });
    
            // Обновляем статус дуэли для обоих игроков
            player1.dueling = true;
            player2.dueling = true;
            await player1.save({ transaction });
            await player2.save({ transaction });
    
            await transaction.commit();
            return duel;
        } catch (error) {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    // Silently handle rollback errors
                }
            }
            throw error;
        }
    }

    /**
     * Завершить дуэль, автоматически выбрав победителя.
     * @param {number} duelId - ID дуэли для завершения.
     * @returns {Promise<Duel>} - Обновленный объект дуэли.
     */
    static async completeDuel(duelId, retries = 5) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            let transaction;
            try {
                transaction = await dbContext.sequelize.transaction({
                    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
                });
                console.log(`[Завершение дуэли] Попытка ${attempt}: duelId=${duelId}`);

                const duel = await dbContext.models.Duel.findByPk(duelId, { 
                    transaction,
                    lock: true,
                    include: [
                        { 
                            model: dbContext.models.User, 
                            as: 'initiator', 
                            attributes: ['telegramId', 'dueling'] 
                        },
                        { 
                            model: dbContext.models.User, 
                            as: 'opponent', 
                            attributes: ['telegramId', 'dueling'] 
                        }
                    ]
                });

                if (!duel) {
                    console.error(`[Завершение дуэли] Дуэль не найдена: ${duelId}`);
                    await transaction.rollback();
                    throw new Error('Дуэль не найдена.');
                }

                // Проверяем статус дуэли
                if (duel.status === 'completed') {
                    console.warn(`[Завершение дуэли] Дуэль ${duelId} уже завершена`);
                    await transaction.rollback();
                    return duel;
                }

                if (duel.status !== 'accepted') {
                    await transaction.rollback();
                    throw new Error(`Нельзя завершить дуэль в статусе ${duel.status}`);
                }

                // Случайно выбираем победителя
                const isInitiatorWinner = Math.random() < 0.5;
                const winnerId = isInitiatorWinner ? duel.player1 : duel.player2;
                
                // Определяем результат подбрасывания монеты
                const coinFlipResult = isInitiatorWinner ? 'Орёл' : 'Решка';

                // Обновляем статус дуэли, победителя и результат подбрасывания монеты
                duel.winner = winnerId;
                duel.status = 'completed';
                duel.coinFlipResult = coinFlipResult;
                await duel.save({ transaction });

                const seat = await dbContext.models.Seats.findByPk(duel.seatId, { transaction });
                if (seat) {
                    seat.status = 'dueled';
                    await seat.save({ transaction });
                    console.log(`[Завершение дуэли] Место ${duel.seatId} помечено как завершенное`);
                    
                    // Используем updateSeatStatus из app.js
                    const updateSeatStatus = require('../app').updateSeatStatus;
                    if (updateSeatStatus) {
                        await updateSeatStatus(duel.seatId);
                    }
                }
                
                // Сбрасываем статус дуэли для обоих игроков
                await dbContext.models.User.update(
                    { dueling: false },
                    { 
                        where: { telegramId: { [Op.in]: [duel.player1, duel.player2] } },
                        transaction 
                    }
                );

                // Находим и обновляем любые красные места, принадлежащие проигравшему
                const loserId = isInitiatorWinner ? duel.player2 : duel.player1;
                const loserRedSeat = await dbContext.models.Seats.findOne({
                    where: { 
                        occupiedBy: loserId,
                        status: 'dueled'
                    },
                    transaction
                });

                if (loserRedSeat) {
                    loserRedSeat.occupiedBy = null;
                    loserRedSeat.status = 'available';
                    await loserRedSeat.save({ transaction });
                    console.log(`[Завершение дуэли] Место проигравшего ${loserRedSeat.id} помечено как доступное`);
                    
                    // Обновляем статус места в режиме реального времени
                    const updateSeatStatus = require('../app').updateSeatStatus;
                    if (updateSeatStatus) {
                        await updateSeatStatus(loserRedSeat.id);
                    }
                }

                await transaction.commit();
                console.log(`[Завершение дуэли] Дуэль ${duelId} завершена. Победитель: ${winnerId}`);
                
                return duel;

            } catch (error) {
                if (transaction) {
                    try {
                        await transaction.rollback();
                    } catch (rollbackError) {
                        console.error('[Завершение дуэли] Ошибка при откате транзакции:', rollbackError);
                    }
                }

                // Проверяем, является ли это ошибкой блокировки базы данных
                if (error.name === 'SequelizeTimeoutError' || 
                    (error.parent && error.parent.code === 'SQLITE_BUSY')) {
                    console.warn(`[Завершение дуэли] Обнаружена блокировка базы данных. Повторная попытка через ${attempt * 1000}мс...`);
                    await delay(attempt * 1000); // Экспоненциальный откат
                    continue;
                }
                
                console.error(`[Завершение дуэли] Ошибка завершения дуэли на попытке ${attempt}:`, error);
                throw error;
            }
        }

        throw new Error('Не удалось завершить дуэль после максимального количества повторов');
    }

    /**
     * Отклонить дуэль.
     * @param {number} duelId - ID дуэли для отклонения.
     * @param {boolean} isAutoDeclined - Отклонена ли дуэль автоматически по истечении времени.
     * @returns {Promise<{ duel: Duel, updatedSeats: Array<Seat> }>} - Обновленные объекты дуэли и места.
     */
    static async declineDuel(duelId, isAutoDeclined = false) {
        const performDecline = async () => {
            const transaction = await dbContext.sequelize.transaction({
                isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
            });
            try {
                // Получаем дуэль и проверяем ее существование
                const duel = await dbContext.models.Duel.findByPk(duelId, { transaction });
                if (!duel) {
                    throw new Error('Дуэль не найдена');
                }
    
                // Обновляем статус дуэли на "отклонено"
                await duel.update({ status: 'declined', isAutoDeclined }, { transaction });
    
                // Если дуэль отклонена автоматически, присваиваем место инициатору
                if (isAutoDeclined) {
                    // Очищаем предыдущие места обоих игроков
                    await dbContext.models.Seat.update(
                        { currentUser: null },
                        {
                            where: { userId: { [Op.in]: [duel.player1, duel.player2] } },
                            transaction
                        }
                    );
    
                    // Присваиваем оспариваемое место инициатору дуэли
                    const [updatedRowsCount, updatedSeats] = await dbContext.models.Seat.update(
                        { currentUser: duel.player1 },
                        {
                            where: { id: duel.seatId },
                            returning: true, // Чтобы получить обновленные строки
                            transaction
                        }
                    );
    
                    // Если ни одна строка не была обновлена
                    if (updatedRowsCount === 0) {
                        throw new Error('Не удалось обновить место');
                    }
    
                    // Возвращаем обновленные места
                    const updatedSeat = updatedSeats[0];
    
                    await transaction.commit();
                    return { duel, updatedSeats: [updatedSeat] };
                }
    
                await transaction.commit();
                return { duel, updatedSeats: [] };
            } catch (error) {
                console.error('Ошибка при отклонении дуэли:', error);
                await transaction.rollback();
                throw error;
            }
        };
    
        try {
            return await DuelService.retryOperation(performDecline, 5, 1000);
        } catch (error) {
            console.error('Ошибка при отклонении дуэли:', error);
            throw error;
        }
    }
    
    
    /**
     * Выполняет операцию с повторными попытками в случае ошибки
     * @param {Function} operation - Операция для выполнения
     * @param {number} maxRetries - Максимальное количество попыток
     * @param {number} delay - Задержка между попытками в миллисекундах
     * @returns {Promise<*>} - Результат операции
     */
    static async retryOperation(operation, maxRetries, delay) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }

    /**
     * Проверьте и обновите дуэли, истекшие по таймауту.
     * @returns {Promise<number>} - Количество обновленных дуэлей.
     */
    static async checkTimeoutDuels() {
        try {
            const transaction = await dbContext.sequelize.transaction();

            try {
                const sixtySecondsAgo = new Date(Date.now() - 60000);

                const [updatedCount] = await dbContext.models.Duel.update(
                    { status: 'declined' },
                    {
                        where: {
                            status: 'pending',
                            createdAt: { [Op.lt]: sixtySecondsAgo }
                        },
                        transaction
                    }
                );

                await transaction.commit();
                return updatedCount;
            } catch (updateError) {
                await transaction.rollback();
                throw updateError;
            }
        } catch (error) {
            throw error;
        }
    }
    static initTimeoutCheck() {
        setInterval(() => {
            this.checkTimeoutDuels().catch(error => {
                // Silently handle errors
            });
        }, 60000); // Проверяем каждую минуту
    }

    /**
     * Получить все дуэли.
     * @returns {Promise<Array<Duel>>} - Массив объектов дуэлей.
     */
    static async getAllDuels() {
        try {
            const duels = await dbContext.models.Duel.findAll();
            return duels;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Получить все дуэли для конкретного места.
     * @param {number} seatId - ID места.
     * @returns {Promise<Array<Duel>>} - Массив объектов дуэлей для места.
     */
    static async getDuelsBySeat(seatId) {
        try {
            const duels = await dbContext.models.Duel.findAll({
                where: { seatId },
                order: [['createdAt', 'DESC']],
            });
            return duels;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Получить последнюю дуэль, истекшую по таймауту, для конкретного пользователя
     * @param {string} telegramId - Telegram ID пользователя
     * @returns {Promise<Duel|null>} - Последняя дуэль, истекшая по таймауту, или null
     */
    static async getTimedOutDuelsForUser(telegramId) {
        try {
            // Находим последнюю дуэль, истекшую по таймауту, где пользователь является либо player1, либо player2
            const latestTimedOutDuel = await dbContext.models.Duel.findOne({
                where: {
                    status: 'declined',
                    [Op.or]: [
                        { player1: telegramId },
                        { player2: telegramId }
                    ]
                },
                order: [['updatedAt', 'DESC']], // Получаем последнюю дуэль, истекшую по таймауту
                include: [
                    {
                        model: dbContext.models.Seats,
                        as: 'seat',
                        attributes: ['id', 'status', 'occupiedBy']
                    }
                ]
            });

            return latestTimedOutDuel ? [latestTimedOutDuel] : []; // Возвращаем как массив для совместимости с фронтом
        } catch (error) {
            console.error('Ошибка при получении последней дуэли, истекшей по таймауту:', error);
            throw error;
        }
    }
}

module.exports = DuelService;