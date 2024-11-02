const { Model, DataTypes } = require('sequelize');
const { sequelize  } = require('../db');
const User = require('./User'); // Импорт модели User
const Seat = require('./Seats'); // Импорт модели Seat

class Duel extends Model {}

Duel.init({
    player1: {
        type: DataTypes.STRING,
        references: {
            model: User,
            key: 'telegramId',
        },
    },
    player2: {
        type: DataTypes.STRING,
        references: {
            model: User,
            key: 'telegramId',
        },
    },
    seatId: {
        type: DataTypes.INTEGER,
        references: {
            model: Seat,
            key: 'id',
        },
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'timeout'),
        defaultValue: 'pending',
    },
    winner: {
        type: DataTypes.INTEGER, // ID победителя, если дуэль завершена
        allowNull: true,
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    sequelize,
    modelName: 'Duel',
});

module.exports = Duel;
