const { Model, DataTypes } = require('sequelize');
const { sequelize  } = require('../db');

class Seats extends Model {}

Seats.init({
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
        type: DataTypes.STRING, // ID пользователя, который занял место
        allowNull: true,
    },
    dueled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false, // Место можно использовать для дуэли только один раз
    },
}, {
    sequelize,
    modelName: 'Seats',
});

module.exports = Seats;
