// models/Duel.js

const { Model, DataTypes, Op } = require('sequelize'); // Убедитесь, что Op импортирован
const { sequelize } = require('../db');

class Duel extends Model {}

Duel.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    player1: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    player2: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    seatId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('pending', 'accepted', 'completed', 'declined'),
        allowNull: false,
    },
    winner: {
        type: DataTypes.STRING,
        allowNull: true,
    },
}, {
    sequelize,
    modelName: 'Duel',
    timestamps: true, // This adds createdAt and updatedAt automatically
    // Удаляем индексы из модели
    indexes: [
        // {
        //     unique: true,
        //     fields: ['seatId'],
        //     where: {
        //         status: {
        //             [Op.in]: ['pending', 'accepted'],
        //         },
        //     },
        //     name: 'unique_active_duel_per_seat',
        // },
    ],
});

module.exports = Duel;