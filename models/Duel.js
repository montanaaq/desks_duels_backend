// models/Duel.js

const { Model } = require('sequelize');

class Duel extends Model {
    static init(sequelize, DataTypes) {
        if (!sequelize) {
            throw new Error('Sequelize instance must be provided');
        }
        
        if (!DataTypes) {
            throw new Error('DataTypes must be provided');
        }

        return super.init({
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
                type: DataTypes.ENUM('pending', 'accepted', 'completed', 'declined', 'timeout'),
                allowNull: false,
                defaultValue: 'pending'
            },
            winner: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            coinFlipResult: {
                type: DataTypes.ENUM('Орёл', 'Решка'),
                allowNull: true,
            },
        }, {
            sequelize,
            modelName: 'Duel',
            timestamps: true,
        });
    }

    static associate(models) {
        // Explicitly define associations with unique aliases
        if (models.User) {
            this.belongsTo(models.User, { 
                foreignKey: 'player1', 
                as: 'initiator' 
            });
            this.belongsTo(models.User, { 
                foreignKey: 'player2', 
                as: 'opponent' 
            });
        }

        if (models.Seats) {
            this.belongsTo(models.Seats, { 
                foreignKey: 'seatId', 
                as: 'seat' 
            });
        }
    }
}

module.exports = Duel;