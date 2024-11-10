const { sequelize } = require('../db');
const { Op } = require('sequelize'); // Import Op for queries
const Seats = require('../models/Seats');
const Duel = require('../models/Duel');
const User = require('../models/User');

/**
 * Class for managing duels.
 */
class DuelService {
    /**
     * Request a duel between two players for a specific seat.
     * @param {string} player1 - Telegram ID of the initiator.
     * @param {string} player2 - Telegram ID of the opponent.
     * @param {number} seatId - Seat ID.
     * @returns {Promise<Duel>} - The created or existing duel object.
     */
    static async requestDuel(player1, player2, seatId) {
        const transaction = await sequelize.transaction();

        try {
            console.log(`Requesting duel: player1=${player1}, player2=${player2}, seatId=${seatId}`);

            if (!player1 || !player2 || !seatId) {
                throw new Error('player1, player2, and seatId are required.');
            }

            // Fetch seat with a lock to prevent concurrent changes
            const seat = await Seats.findByPk(seatId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!seat) throw new Error('Seat not found.');
            if (!seat.occupiedBy) throw new Error('Seat is not occupied.');
            if (seat.dueled) throw new Error('Seat has already participated in a duel.');

            // Check if there is already an active duel for this seat
            const existingDuel = await Duel.findOne({
                where: {
                    seatId,
                    status: { [Op.in]: ['pending', 'accepted'] },
                },
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (existingDuel) {
                console.log(`Existing duel found: ID=${existingDuel.id}`);
                await transaction.commit();
                return existingDuel;
            }

            // Create new duel with status 'pending'
            const duel = await Duel.create({
                player1,
                player2,
                seatId,
                status: 'pending',
            }, { transaction });

            console.log(`Duel created: duel.id=${duel.id}`);
            await transaction.commit();
            return duel;
        } catch (error) {
            console.error('Error requesting duel:', error);
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error('Transaction rollback error:', rollbackError);
                }
            }
            throw error;
        }
    }

    /**
     * Accept a duel.
     * @param {number} duelId - ID of the duel to accept.
     * @returns {Promise<Duel>} - The updated duel object.
     */
    static async acceptDuel(duelId) {
        const transaction = await sequelize.transaction();
    
        try {
            console.log(`Принятие дуэли: duelId=${duelId}`);
    
            const duel = await Duel.findByPk(duelId, { transaction });
    
            if (!duel) {
                throw new Error('Дуэль не найдена.');
            }
    
            // Проверяем, что дуэль имеет статус 'pending'
            if (duel.status !== 'pending') {
                console.log(`Дуэль ${duelId} не в статусе ожидания, текущий статус: ${duel.status}`);
                await transaction.commit(); // Завершаем транзакцию, так как статус не подходит
                return duel; // Возвращаем текущую дуэль без изменений
            }
    
            // Если статус 'pending', обновляем статус дуэли на 'accepted'
            duel.status = 'accepted';
            await duel.save({ transaction });
    
            console.log(`Дуэль ${duelId} принята.`);
    
            // Завершаем транзакцию
            await transaction.commit();
            return duel;
        } catch (error) {
            console.error('Ошибка при принятии дуэли:', error);
            // Проверяем, завершена ли транзакция
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
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
     * Complete a duel by setting the winner.
     * @param {number} duelId - ID of the duel to complete.
     * @param {string} winnerId - Telegram ID of the winner.
     * @returns {Promise<Duel>} - The updated duel object.
     */
    static async completeDuel(duelId, winnerId) {
        const transaction = await sequelize.transaction();

        try {
            console.log(`Completing duel: duelId=${duelId}, winnerId=${winnerId}`);

            const duel = await Duel.findByPk(duelId, { transaction });
            if (!duel) throw new Error('Duel not found.');
            if (duel.status !== 'accepted') throw new Error('Duel is not in accepted status.');

            duel.winner = winnerId;
            duel.status = 'completed';
            await duel.save({ transaction });

            const seat = await Seats.findByPk(duel.seatId, { transaction });
            if (seat) {
                seat.dueled = true;
                await seat.save({ transaction });
                console.log(`Seat ${duel.seatId} marked as completed in a duel.`);
            }

            // Reset dueling flags for both players
            const [player1Status, player2Status] = await Promise.all([
                User.findOne({ where: { telegramId: duel.player1 }, transaction }),
                User.findOne({ where: { telegramId: duel.player2 }, transaction }),
            ]);

            if (player1Status) {
                player1Status.dueling = false;
                await player1Status.save({ transaction });
                console.log(`Dueling flag reset for player: ${duel.player1}`);
            }

            if (player2Status) {
                player2Status.dueling = false;
                await player2Status.save({ transaction });
                console.log(`Dueling flag reset for player: ${duel.player2}`);
            }

            await transaction.commit();
            return duel;
        } catch (error) {
            console.error('Error completing duel:', error);
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error('Transaction rollback error:', rollbackError);
                }
            }
            throw error;
        }
    }

    /**
     * Decline a duel.
     * @param {number} duelId - ID of the duel to decline.
     * @returns {Promise<Duel>} - The updated duel object.
     */
    static async declineDuel(duelId) {
        const transaction = await sequelize.transaction();

        try {
            console.log(`Declining duel: duelId=${duelId}`);

            const duel = await Duel.findByPk(duelId, { transaction });
            if (!duel) throw new Error('Duel not found.');
            if (duel.status !== 'pending') throw new Error('Duel is not in pending status.');

            duel.status = 'declined';
            await duel.save({ transaction });

            const seat = await Seats.findByPk(duel.seatId, { transaction });
            if (seat) {
                seat.dueled = false;
                await seat.save({ transaction });
                console.log(`Seat ${duel.seatId} marked as available for future duels.`);
            }

            // Reset dueling flags for both players
            const [player1Status, player2Status] = await Promise.all([
                User.findOne({ where: { telegramId: duel.player1 }, transaction }),
                User.findOne({ where: { telegramId: duel.player2 }, transaction }),
            ]);

            if (player1Status) {
                player1Status.dueling = false;
                await player1Status.save({ transaction });
                console.log(`Dueling flag reset for player: ${duel.player1}`);
            }

            if (player2Status) {
                player2Status.dueling = false;
                await player2Status.save({ transaction });
                console.log(`Dueling flag reset for player: ${duel.player2}`);
            }

            await transaction.commit();
            return duel;
        } catch (error) {
            console.error('Error declining duel:', error);
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    console.error('Transaction rollback error:', rollbackError);
                }
            }
            throw error;
        }
    }

    /**
     * Get all duels.
     * @returns {Promise<Array<Duel>>} - Array of duel objects.
     */
    static async getAllDuels() {
        try {
            const duels = await Duel.findAll();
            return duels;
        } catch (error) {
            console.error('Error retrieving all duels:', error);
            throw error;
        }
    }

    /**
     * Get all duels for a specific seat.
     * @param {number} seatId - Seat ID.
     * @returns {Promise<Array<Duel>>} - Array of duel objects for the seat.
     */
    static async getDuelsBySeat(seatId) {
        try {
            const duels = await Duel.findAll({
                where: { seatId },
                order: [['createdAt', 'DESC']],
            });
            return duels;
        } catch (error) {
            console.error('Error retrieving duels by seatId:', error);
            throw error;
        }
    }
}

module.exports = DuelService;
