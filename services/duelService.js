const dbContext = require('../db');
const { Op } = require('sequelize');

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
        const transaction = await dbContext.sequelize.transaction();

        try {
            if (!player1 || !player2 || !seatId) {
                throw new Error('player1, player2, and seatId are required.');
            }

            // Fetch seat with a lock to prevent concurrent changes
            const seat = await dbContext.models.Seats.findByPk(seatId, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!seat) throw new Error('Seat not found.');
            if (!seat.occupiedBy) throw new Error('Seat is not occupied.');
            if (seat.status === 'dueled') throw new Error('Seat has already participated in a duel.');

            // Check if there is already an active duel for this seat
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

            // Create new duel with status 'pending'
            const duel = await dbContext.models.Duel.create({
                player1,
                player2,
                seatId,
                status: 'pending',
            }, { transaction });

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
     * Accept a duel.
     * @param {number} duelId - ID of the duel to accept.
     * @returns {Promise<Duel>} - The updated duel object.
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
                throw new Error('Duel not found.');
            }
    
            // Check that the duel has 'pending' status
            if (duel.status !== 'pending') {
                if (duel.status === 'accepted') {
                    await transaction.commit();
                    return duel;
                }
                
                throw new Error(`Cannot accept duel in ${duel.status} status`);
            }
    
            // Check if the duel has timed out
            const sixtySecondsAgo = new Date(Date.now() - 60000);
            if (duel.createdAt < sixtySecondsAgo) {
                duel.status = 'timeout';
                await duel.save({ transaction });
                await transaction.commit();
                return duel;
            }
    
            // Verify both players are available for dueling
            const player1 = await dbContext.models.User.findOne({ 
                where: { telegramId: duel.player1 }, 
                transaction 
            });
            const player2 = await dbContext.models.User.findOne({ 
                where: { telegramId: duel.player2 }, 
                transaction 
            });
    
            if (!player1 || !player2) {
                throw new Error('Players not found');
            }
    
            // Update duel status to 'accepted'
            duel.status = 'accepted';
            await duel.save({ transaction });
    
            // Update players' dueling status
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
     * Complete a duel by automatically selecting a winner.
     * @param {number} duelId - ID of the duel to complete.
     * @returns {Promise<Duel>} - The updated duel object.
     */
    static async completeDuel(duelId, retries = 5) {
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            let transaction;
            try {
                transaction = await dbContext.sequelize.transaction({
                    isolationLevel: 'SERIALIZABLE'
                });
                console.log(`[COMPLETE DUEL] Attempt ${attempt}: duelId=${duelId}`);

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
                    console.error(`[COMPLETE DUEL] Duel not found: ${duelId}`);
                    await transaction.rollback();
                    throw new Error('Duel not found.');
                }

                // Check duel status
                if (duel.status === 'completed') {
                    console.warn(`[COMPLETE DUEL] Duel ${duelId} already completed`);
                    await transaction.rollback();
                    return duel;
                }

                if (duel.status !== 'accepted') {
                    await transaction.rollback();
                    throw new Error(`Cannot complete duel in ${duel.status} status`);
                }

                // Randomly select winner
                const isInitiatorWinner = Math.random() < 0.5;
                const winnerId = isInitiatorWinner ? duel.player1 : duel.player2;
                
                // Determine coin flip result
                const coinFlipResult = isInitiatorWinner ? 'Орёл' : 'Решка';

                // Update duel status, winner, and coin flip result
                duel.winner = winnerId;
                duel.status = 'completed';
                duel.coinFlipResult = coinFlipResult;
                await duel.save({ transaction });

                const seat = await dbContext.models.Seats.findByPk(duel.seatId, { transaction });
                if (seat) {
                    seat.status = 'dueled';  
                    await seat.save({ transaction });
                    console.log(`[COMPLETE DUEL] Seat ${duel.seatId} marked as dueled`);
                    
                    // Use updateSeatStatus from app.js
                    const updateSeatStatus = require('../app').updateSeatStatus;
                    if (updateSeatStatus) {
                        await updateSeatStatus(duel.seatId);
                    }
                }
                
                // Reset dueling flags for both players
                await dbContext.models.User.update(
                    { dueling: false },
                    { 
                        where: { telegramId: { [Op.in]: [duel.player1, duel.player2] } },
                        transaction 
                    }
                );

                await transaction.commit();
                console.log(`[COMPLETE DUEL] Duel ${duelId} completed. Winner: ${winnerId}`);
                
                return duel;

            } catch (error) {
                if (transaction) {
                    try {
                        await transaction.rollback();
                    } catch (rollbackError) {
                        console.error('[COMPLETE DUEL] Error during transaction rollback:', rollbackError);
                    }
                }

                // Check if it's a database lock error
                if (error.name === 'SequelizeTimeoutError' || 
                    (error.parent && error.parent.code === 'SQLITE_BUSY')) {
                    console.warn(`[COMPLETE DUEL] Database lock detected. Retrying in ${attempt * 1000}ms...`);
                    await delay(attempt * 1000); // Exponential backoff
                    continue;
                }
                
                console.error(`[COMPLETE DUEL] Error completing duel on attempt ${attempt}:`, error);
                throw error;
            }
        }

        throw new Error('Failed to complete duel after maximum retries');
    }

    /**
     * Decline a duel.
     * @param {number} duelId - ID of the duel to decline.
     * @returns {Promise<Duel>} - The updated duel object.
     */
    static async declineDuel(duelId) {
        const transaction = await dbContext.sequelize.transaction();

        try {
            const duel = await dbContext.models.Duel.findByPk(duelId, { transaction });
            if (!duel) throw new Error('Duel not found.');
            if (duel.status !== 'pending') throw new Error('Duel is not in pending status.');

            duel.status = 'declined';
            await duel.save({ transaction });

            const seat = await dbContext.models.Seats.findByPk(duel.seatId, { transaction });
            if (seat) {
                seat.status = 'available';  
                await seat.save({ transaction });
            }

            // Reset dueling flags for both players
            const [player1Status, player2Status] = await Promise.all([
                dbContext.models.User.findOne({ where: { telegramId: duel.player1 }, transaction }),
                dbContext.models.User.findOne({ where: { telegramId: duel.player2 }, transaction }),
            ]);

            if (player1Status) {
                player1Status.dueling = false;
                await player1Status.save({ transaction });
            }

            if (player2Status) {
                player2Status.dueling = false;
                await player2Status.save({ transaction });
            }

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
     * Check and update timed-out duels.
     * @returns {Promise<number>} - Number of duels updated.
     */
    static async checkTimeoutDuels() {
        try {
            const transaction = await dbContext.sequelize.transaction();

            try {
                const sixtySecondsAgo = new Date(Date.now() - 60000);

                const [updatedCount] = await dbContext.models.Duel.update(
                    { status: 'timeout' },
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
        }, 60000); // Check every minute
    }

    /**
     * Get all duels.
     * @returns {Promise<Array<Duel>>} - Array of duel objects.
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
     * Get all duels for a specific seat.
     * @param {number} seatId - Seat ID.
     * @returns {Promise<Array<Duel>>} - Array of duel objects for the seat.
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
}

module.exports = DuelService;
