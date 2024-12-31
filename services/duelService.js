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
    static async acceptDuel(duelId, retries = 5) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        let lastError = null;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            let transaction;
            try {
                transaction = await dbContext.sequelize.transaction({
                    isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
                });

                console.log(`[Принятие дуэли] Попытка ${attempt}: duelId=${duelId}`);

                const duel = await dbContext.models.Duel.findByPk(duelId, {
                    transaction,
                    lock: true,
                    include: [
                        { model: dbContext.models.User, as: 'initiator' },
                        { model: dbContext.models.User, as: 'opponent' }
                    ]
                });

                if (!duel) {
                    await transaction.rollback();
                    lastError = new Error('Дуэль не найдена');
                    throw lastError;
                }

                if (duel.status === 'accepted') {
                    await transaction.rollback();
                    // Если дуэль уже принята, считаем это успехом
                    return duel;
                }

                if (duel.status !== 'pending') {
                    await transaction.rollback();
                    lastError = new Error(`Нельзя принять дуэль в статусе ${duel.status}`);
                    throw lastError;
                }

                // Обновляем статус дуэли
                duel.status = 'accepted';
                await duel.save({ transaction });

                // Обновляем статус участников
                await dbContext.models.User.update(
                    { dueling: true },
                    {
                        where: {
                            telegramId: {
                                [Op.in]: [duel.player1, duel.player2]
                            }
                        },
                        transaction
                    }
                );

                await transaction.commit();
                console.log(`[Принятие дуэли] Дуэль ${duelId} успешно принята`);
                return duel;

            } catch (error) {
                if (transaction) {
                    try {
                        await transaction.rollback();
                    } catch (rollbackError) {
                        // Игнорируем ошибку отката, если транзакция уже завершена
                        if (!rollbackError.message.includes('has been finished')) {
                            console.error('[Принятие дуэли] Ошибка при откате транзакции:', rollbackError);
                        }
                    }
                }

                // Проверяем, является ли это ошибкой блокировки базы данных
                if (error.name === 'SequelizeTimeoutError' || 
                    (error.parent && error.parent.code === 'SQLITE_BUSY')) {
                    console.warn(`[Принятие дуэли] База данных заблокирована. Повторная попытка через ${attempt * 1000}мс...`);
                    lastError = error;
                    await delay(attempt * 1000); // Экспоненциальный откат
                    continue;
                }
                
                lastError = error;
                throw error;
            }
        }

        throw lastError || new Error('Не удалось принять дуэль после максимального количества повторов');
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
                const loserId = isInitiatorWinner ? duel.player2 : duel.player1;
                
                // Определяем результат подбрасывания монеты
                const coinFlipResult = isInitiatorWinner ? 'Орёл' : 'Решка';

                // Обновляем статус дуэли, победителя и результат подбрасывания монеты
                duel.winner = winnerId;
                duel.status = 'completed';
                duel.coinFlipResult = coinFlipResult;
                await duel.save({ transaction });

                // Очищаем все предыдущие места победителя и проигравшего
                await dbContext.models.Seats.update(
                    { 
                        occupiedBy: null,
                        status: 'available'
                    },
                    {
                        where: { 
                            occupiedBy: {
                                [Op.in]: [winnerId, loserId]
                            }
                        },
                        transaction
                    }
                );

                // Присваиваем оспариваемое место победителю
                const seat = await dbContext.models.Seats.findByPk(duel.seatId, { transaction });
                if (seat) {
                    seat.occupiedBy = winnerId;
                    seat.status = 'dueled';
                    await seat.save({ transaction });
                    console.log(`[Завершение дуэли] Место ${duel.seatId} присвоено победителю ${winnerId}`);
                }

                // Сбрасываем статус дуэли для обоих игроков
                await dbContext.models.User.update(
                    { 
                        dueling: false,
                        currentSeat: null  // Сначала очищаем текущее место у всех
                    },
                    { 
                        where: { telegramId: { [Op.in]: [duel.player1, duel.player2] } },
                        transaction 
                    }
                );

                // Устанавливаем новое место только победителю
                await dbContext.models.User.update(
                    { currentSeat: duel.seatId },
                    { 
                        where: { telegramId: winnerId },
                        transaction 
                    }
                );

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
        const retryOperation = require('../utils/retryOperation');
        const { Op } = require('sequelize');

        try {
            return await retryOperation(async () => {
                let transaction;
                try {
                    transaction = await dbContext.sequelize.transaction({
                        isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
                    });

                    // Получаем дуэль и проверяем ее существование
                    const duel = await dbContext.models.Duel.findByPk(duelId, { transaction });
                    if (!duel) {
                        throw new Error('Дуэль не найдена');
                    }

                    // Если дуэль уже отклонена или завершена, возвращаем успешный результат
                    if (duel.status === 'declined' || duel.status === 'completed' || duel.status === 'timeout') {
                        await transaction.commit();
                        return {
                            success: true,
                            duel,
                            updatedSeats: await dbContext.models.Seats.findAll()
                        };
                    }

                    // Обновляем статус дуэли на "отклонено"
                    await duel.update({ status: 'declined', isAutoDeclined }, { transaction });

                    // Сначала очищаем все места обоих игроков
                    await dbContext.models.Seats.update(
                        { 
                            occupiedBy: null,
                            status: 'available'
                        },
                        {
                            where: { occupiedBy: { [Op.in]: [duel.player1, duel.player2] } },
                            transaction
                        }
                    );

                    // Затем присваиваем оспариваемое место инициатору дуэли
                    const updatedSeat = await dbContext.models.Seats.update(
                        { 
                            occupiedBy: duel.player1,
                            status: 'dueled'
                        },
                        {
                            where: { id: duel.seatId },
                            returning: true,
                            transaction
                        }
                    );

                    // Обновляем информацию о текущих местах пользователей
                    await Promise.all([
                        dbContext.models.User.update(
                            { currentSeat: duel.seatId },
                            {
                                where: { telegramId: duel.player1 },
                                transaction
                            }
                        ),
                        dbContext.models.User.update(
                            { currentSeat: null },
                            {
                                where: { telegramId: duel.player2 },
                                transaction
                            }
                        )
                    ]);

                    await transaction.commit();
                    
                    // Получаем обновленный список мест
                    const updatedSeats = await dbContext.models.Seats.findAll();
                    
                    return {
                        success: true,
                        duel,
                        updatedSeats
                    };

                } catch (error) {
                    // Проверяем, не была ли транзакция уже завершена
                    if (transaction && !transaction.finished) {
                        await transaction.rollback();
                    }
                    throw error;
                }
            });
        } catch (error) {
            console.error('Ошибка при отклонении дуэли:', error);
            return {
                success: false,
                message: error.message || 'Произошла ошибка при отклонении дуэли'
            };
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

                // Сначала находим все дуэли, которые нужно обновить
                const duelsToUpdate = await dbContext.models.Duel.findAll({
                    where: {
                        status: 'pending',
                        createdAt: { [Op.lt]: sixtySecondsAgo }
                    },
                    transaction
                });

                // Обновляем каждую дуэль через declineDuel для правильной обработки
                for (const duel of duelsToUpdate) {
                    try {
                        await this.declineDuel(duel.id, true);
                    } catch (error) {
                        console.error(`Error declining duel ${duel.id} on timeout:`, error);
                    }
                }

                await transaction.commit();
                return duelsToUpdate.length;
            } catch (updateError) {
                if (!transaction.finished) {
                    await transaction.rollback();
                }
                throw updateError;
            }
        } catch (error) {
            console.error('Error in checkTimeoutDuels:', error);
            return 0;
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

    /**
     * Получить активную дуэль пользователя
     * @param {string} userId - Telegram ID пользователя
     * @returns {Promise<Duel|null>} - Активная дуэль или null
     */
    static async getActiveDuelForUser(userId) {
        try {
            // Находим активную дуэль, где пользователь является либо player1, либо player2
            const activeDuel = await dbContext.models.Duel.findOne({
                where: {
                    [Op.or]: [
                        { player1: userId },
                        { player2: userId }
                    ],
                    status: {
                        [Op.in]: ['pending', 'accepted']
                    }
                },
                include: [
                    {
                        model: dbContext.models.Seats,
                        as: 'seat',
                        attributes: ['id', 'status', 'occupiedBy']
                    }
                ],
                order: [['createdAt', 'DESC']]
            });

            return activeDuel;
        } catch (error) {
            console.error('Ошибка при получении активной дуэли:', error);
            throw error;
        }
    }
}

module.exports = DuelService;