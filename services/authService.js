// services/authService.js

const User = require('../models/User');


// Функция для поиска пользователя по telegramId
const findOrCreateUser = async ({ telegramId, name, username }) => {
    try {
        let user = await User.findOne({ where: { telegramId } });
        
        // Если пользователь не найден, создаем нового
        if (!user) {
            user = await User.create({
                telegramId,
                name,
                username,
            });
        }
        return user;
    } catch (error) {
        console.error("Ошибка при поиске или создании пользователя:", error);
        throw error;
    }
};

// Функция для проверки существования пользователя
const getUserByTelegramId = async (telegramId) => {
    try {
        return await User.findOne({ where: { telegramId } });
    } catch (error) {
        console.error("Ошибка при поиске пользователя по telegramId", error);
        return null;
    }
};

// Функция установки прочтения правил
const setRulesSeen = async (telegramId) => {
    try {
        const user = await User.findOne({ where: { telegramId } });
        if (user && !user.rules_seen) {
            user.rules_seen = true;
            await user.save();
            return "Правила прочитаны";
        } else {
            return "Пользователь не найден или правила уже были прочитаны";
        }
    } catch (error) {
        console.error("Ошибка при обновлении правил:", error);
    }
};
const deleteUser = async (telegramId) => {
    try {
      await User.destroy({ where: { telegramId } });
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  };

module.exports = { setRulesSeen, findOrCreateUser, getUserByTelegramId, deleteUser };
