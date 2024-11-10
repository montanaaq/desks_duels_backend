// models/Seats.js

const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../db');

class Seat extends Model {}

Seat.init({
    rowNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    deskNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    variant: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    occupiedBy: {
        type: DataTypes.STRING, // Telegram ID пользователя
        allowNull: true,
    },
    dueled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false, // Указывает, был ли проведён дуэль на этом месте
    }
}, {
    sequelize,
    modelName: 'Seat',
});

module.exports = Seat;
