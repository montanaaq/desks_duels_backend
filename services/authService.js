// services/authService.js

const dbContext = require('../db');
const { Op } = require('sequelize');

// Функция для поиска пользователя по telegramId
const findOrCreateUser = async ({ telegramId, name, username }) => {
    try {
        // Ensure the User model is fully initialized
        const User = dbContext.models.User;
        if (!User || typeof User.findOne !== 'function') {
            console.error('User model is not properly initialized');
            throw new Error('User model initialization failed');
        }

        let user = await User.findOne({ where: { telegramId } });
        
        // If user not found, create a new one
        if (!user) {
            try {
                user = await User.create({
                    telegramId,
                    name: name || 'Anonymous',
                    username: username || null,
                    rules_seen: false,
                    dueling: false
                });
            } catch (createError) {
                console.error("Error creating user:", createError);
                // Check if the error is due to database connection or table issues
                if (createError.name === 'SequelizeDatabaseError') {
                    console.error('Possible database synchronization issue');
                    throw new Error('Database synchronization failed');
                }
                throw createError;
            }
        }
        return user;
    } catch (error) {
        console.error("Error finding or creating user:", error);
        throw error;
    }
};

// Функция для проверки существования пользователя
async function getUserByTelegramId(telegramId, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const user = await dbContext.models.User.findOne({
                where: { telegramId: telegramId.toString() }
            });
            return user;
        } catch (error) {
            if (error.name === 'SequelizeTimeoutError' && attempt < retries) {
                console.warn(`[GET USER] Database lock detected. Retrying in ${attempt * 500}ms...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 500));
                continue;
            }
            throw error;
        }
    }
    throw new Error('Failed to retrieve user after maximum retries');
};

// Функция установки прочтения правил
const setRulesSeen = async (telegramId) => {
    try {
        const User = dbContext.models.User;
        const user = await User.findOne({ where: { telegramId } });
        if (user && !user.rules_seen) {
            user.rules_seen = true;
            await user.save();
            return "Правила прочитаны";
        } else {
            return "Пользователь не найден или правила уже были прочитаны";
        }
    } catch (error) {
        console.error("Ошибка при обновлении правил:", error);
    }
};

const deleteUser = async (telegramId) => {
    const { User, Duel, Seats } = dbContext.models;
    const transaction = await dbContext.sequelize.transaction();

    try {
        // 1. Delete all duels associated with this user
        await Duel.destroy({
            where: {
                [Op.or]: [
                    { player1: telegramId },
                    { player2: telegramId }
                ]
            },
            transaction
        });

        // 2. Update seats occupied by this user
        await Seats.update(
            { occupiedBy: null, status: 'available' },
            {
                where: { occupiedBy: telegramId },
                transaction
            }
        );

        // 3. Delete the user
        const deletedUserCount = await User.destroy({
            where: { telegramId },
            transaction
        });

        // Commit the transaction
        await transaction.commit();

        return deletedUserCount > 0;
    } catch (error) {
        // Rollback the transaction in case of error
        await transaction.rollback();
        console.error('Error deleting user:', error);
        throw error;
    }
};

module.exports = { setRulesSeen, findOrCreateUser, getUserByTelegramId, deleteUser };
