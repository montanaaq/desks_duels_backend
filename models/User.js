const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../db');
const Seat = require('./Seats'); // Импорт модели Seat

class User extends Model {}

User.init({
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    username: {  // Telegram username
        type: DataTypes.STRING,
        allowNull: true,
        unique: true, // Уникальный username для пользователя
    },
    telegramId: {  // Telegram ID пользователя
        type: DataTypes.STRING,
        allowNull: false,
        unique: true, // Обеспечивает уникальность записи для каждого пользователя Telegram
    },
    rules_seen: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    currentSeat: {
        type: DataTypes.INTEGER,
        references: {
            model: Seat,
            key: 'id',
        },
        allowNull: true,
    },
}, {
    sequelize,
    modelName: 'User',
});

module.exports = User;
